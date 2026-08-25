import { Router, Request, Response } from 'express';
import { getDatabase, generateOrderNumber, now, parseItemJson } from '../db';
import { calculateItemTax } from '../services/tax';
import { notifyKdsUpdate } from '../services/kds';
import { calculatePeriodRange, getWibDateString } from '../services/analytics';
import {
  generateOrdersTransactionReportPdf,
  generateOrdersTransactionReportCsv,
  TransactionReportOrderItem,
} from '../services/reports-pdf';
import { maskNik } from '../services/privacy';
import { AuthenticatedRequest } from '../middleware/auth';
import { createAuditLog } from '../services/audit';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      period,
      date,
      startDate,
      endDate,
      status,
      type,
      search,
      today,
      table_id,
    } = req.query as Record<string, string>;

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize || req.query.per_page) as string) || 25));
    const offset = (page - 1) * pageSize;

    let whereClause = ' WHERE 1=1';
    const params: any[] = [];

    // Date range filtering
    let activeRange = null;
    if (period || today !== undefined || startDate || date) {
      const selectedPeriod = period || (today && today !== '0' && today !== 'false' ? 'daily' : 'daily');
      activeRange = calculatePeriodRange(selectedPeriod, date, startDate, endDate);
      if (selectedPeriod !== 'all') {
        whereClause += ' AND (o.created_at >= ? AND o.created_at <= ?)';
        params.push(activeRange.startUtcIso, activeRange.endUtcIso);
      }
    }

    if (status) {
      if (status === 'active') {
        whereClause += " AND o.status IN ('pending', 'preparing', 'ready', 'served')";
      } else {
        whereClause += ' AND o.status = ?';
        params.push(status);
      }
    }

    if (type) {
      whereClause += ' AND o.type = ?';
      params.push(type);
    }

    if (table_id) {
      whereClause += ' AND o.table_id = ?';
      params.push(table_id);
    }

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereClause += ' AND (o.order_number LIKE ? OR c.name LIKE ? OR c.nik LIKE ? OR c.member_no LIKE ?)';
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total matching orders
    const countSql = `
      SELECT COUNT(*) as total
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      ${whereClause}
    `;
    const countResult = db.prepare(countSql).get(...params) as { total: number };
    const totalCount = countResult ? Number(countResult.total) : 0;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;

    // Fetch paginated orders
    const selectSql = `
      SELECT o.*
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const orders = db.prepare(selectSql).all(...params, pageSize, offset) as any[];

    // Load related data
    const ordersWithRelations = orders.map((order: any) => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(parseItemJson);
      const tableRow = order.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(order.table_id) as any : null;
      const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
      const customer = order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) : null;
      const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(order.id) as any;
      return { ...order, items, table, customer, bill };
    });

    res.json({
      orders: ordersWithRelations,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages,
      },
      activeRange,
    });
  } catch (error: any) {
    console.error('[Orders GET Error]', error);
    res.status(500).json({ error: error.message });
  }
});

function buildFilteredOrdersForExport(req: AuthenticatedRequest) {
  const db = getDatabase();
  const {
    period,
    date,
    startDate,
    endDate,
    status,
    type,
    search,
  } = req.query as Record<string, string>;

  const activeRange = calculatePeriodRange(period || 'daily', date, startDate, endDate);
  let whereClause = ' WHERE 1=1';
  const params: any[] = [];

  if (activeRange.period !== 'all') {
    whereClause += ' AND (o.created_at >= ? AND o.created_at <= ?)';
    params.push(activeRange.startUtcIso, activeRange.endUtcIso);
  }

  if (status) {
    if (status === 'active') {
      whereClause += " AND o.status IN ('pending', 'preparing', 'ready', 'served')";
    } else {
      whereClause += ' AND o.status = ?';
      params.push(status);
    }
  }

  if (type) {
    whereClause += ' AND o.type = ?';
    params.push(type);
  }

  if (search && search.trim()) {
    const searchTerm = `%${search.trim()}%`;
    whereClause += ' AND (o.order_number LIKE ? OR c.name LIKE ? OR c.nik LIKE ? OR c.member_no LIKE ?)';
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  const selectSql = `
    SELECT
      o.*,
      b.id as bill_id,
      b.bill_number,
      b.paid_amount,
      b.payment_status,
      b.payment_details,
      c.name as customer_name,
      c.nik as customer_nik,
      c.member_no as customer_member_no
    FROM orders o
    LEFT JOIN bills b ON b.order_id = o.id
    LEFT JOIN customers c ON o.customer_id = c.id
    ${whereClause}
    ORDER BY o.created_at DESC
  `;

  const rawOrders = db.prepare(selectSql).all(...params) as any[];

  let totalOrders = 0;
  let grossSales = 0;
  let totalDiscounts = 0;
  let netSales = 0;
  let cashSales = 0;
  let salaryDeductionSales = 0;

  const isHrOrAdminOrOwner = ['owner', 'admin', 'office_hr'].includes(req.user?.role || '');

  const exportOrders: TransactionReportOrderItem[] = rawOrders.map((ord: any) => {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(ord.id) as any[];
    const itemsSummary = items
      .filter((i) => i.status !== 'cancelled')
      .map((i) => `${i.quantity}x ${i.product_name}`)
      .join(', ');

    let paymentMethod = 'cash';
    if (ord.payment_details) {
      try {
        const parsed = JSON.parse(ord.payment_details);
        paymentMethod = parsed.method || 'cash';
      } catch {
        if (ord.payment_details.includes('salary_deduction')) {
          paymentMethod = 'salary_deduction';
        }
      }
    }

    const isPaid = ord.payment_status === 'paid';
    const isCancelled = ord.status === 'cancelled';

    if (isPaid && !isCancelled) {
      totalOrders += 1;
      grossSales += Number(ord.subtotal || 0);
      totalDiscounts += Number(ord.discount_amount || 0);
      netSales += Number(ord.total || 0);
      if (paymentMethod === 'salary_deduction') {
        salaryDeductionSales += Number(ord.paid_amount || ord.total || 0);
      } else {
        cashSales += Number(ord.paid_amount || ord.total || 0);
      }
    }

    const maskedNik = ord.customer_nik
      ? isHrOrAdminOrOwner
        ? ord.customer_nik
        : maskNik(ord.customer_nik)
      : undefined;

    return {
      id: ord.id,
      order_number: ord.order_number,
      bill_number: ord.bill_number || undefined,
      created_at: ord.created_at,
      customer_name: ord.customer_name || undefined,
      customer_nik: maskedNik,
      customer_member_no: ord.customer_member_no || undefined,
      payment_method: paymentMethod,
      payment_status: ord.payment_status || 'unpaid',
      order_status: ord.status,
      items_summary: itemsSummary || '—',
      subtotal: Number(ord.subtotal || 0),
      discount_amount: Number(ord.discount_amount || 0),
      total: Number(ord.total || 0),
    };
  });

  const bizNameRow = db.prepare("SELECT value FROM settings WHERE key = 'business_name'").get() as { value?: string };
  const businessName = bizNameRow?.value || 'POS Koperasi';

  const printedAtStr = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date()) + ' WIB';

  return {
    activeRange,
    businessName,
    printedAt: printedAtStr,
    summary: {
      totalOrders,
      grossSales,
      totalDiscounts,
      netSales,
      cashSales,
      salaryDeductionSales,
    },
    orders: exportOrders,
  };
}

/**
 * GET /api/orders/export-pdf
 * Download formatted PDF report of filtered transactions.
 */
router.get('/export-pdf', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = buildFilteredOrdersForExport(req);
    const pdfBuffer = await generateOrdersTransactionReportPdf({
      businessName: data.businessName,
      periodLabel: data.activeRange.label,
      startDate: data.activeRange.startDate,
      endDate: data.activeRange.endDate,
      printedAt: data.printedAt,
      printedByName: req.user?.name || 'Petugas Kasir',
      printedByRole: req.user?.role || 'cashier',
      summary: data.summary,
      orders: data.orders,
    });

    const filename = `Laporan_Transaksi_Koperasi_${data.activeRange.startDate}_sd_${data.activeRange.endDate}.pdf`;

    const db = getDatabase();
    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'EXPORT_ORDERS_REPORT_PDF',
      target_type: 'orders',
      details: { period: data.activeRange.period, totalCount: data.orders.length, netSales: data.summary.netSales },
      ip_address: req.ip,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (error: any) {
    console.error('[Orders Export PDF Error]', error);
    res.status(500).json({ error: error.message || 'Gagal membuat laporan PDF' });
  }
});

/**
 * GET /api/orders/export-csv
 * Download CSV report of filtered transactions.
 */
router.get('/export-csv', (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = buildFilteredOrdersForExport(req);
    const csvContent = generateOrdersTransactionReportCsv(data.orders);
    const filename = `Laporan_Transaksi_Koperasi_${data.activeRange.startDate}_sd_${data.activeRange.endDate}.csv`;

    const db = getDatabase();
    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'EXPORT_ORDERS_REPORT_CSV',
      target_type: 'orders',
      details: { period: data.activeRange.period, totalCount: data.orders.length, netSales: data.summary.netSales },
      ip_address: req.ip,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csvContent); // Add UTF-8 BOM for Excel compatibility
  } catch (error: any) {
    console.error('[Orders Export CSV Error]', error);
    res.status(500).json({ error: error.message || 'Gagal membuat laporan CSV' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);
    const tableRow = (order as any).table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get((order as any).table_id) as any : null;
    const table = tableRow ? { ...tableRow, name: tableRow.number } : null;
    const customer = (order as any).customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get((order as any).customer_id) : null;
    const bill = db.prepare('SELECT * FROM bills WHERE order_id = ?').get(req.params.id);

    res.json({ order: { ...order, items, table, customer, bill } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const { table_id, customer_id, user_id, type, guest_count, special_instructions, packaging_charge, items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    if (!type || !['dine_in', 'takeaway', 'delivery', 'online'].includes(type)) {
      return res.status(400).json({ error: 'Valid type is required (dine_in, takeaway, delivery, online)' });
    }

    const db = getDatabase();
    const orderNumber = generateOrderNumber();

    // Get settings for tax calculation
    const settings: Record<string, string> = {};
    db.prepare('SELECT key, value FROM settings').all().forEach((row: any) => {
      settings[row.key] = row.value;
    });

    const tenantInfo = {
      country: settings.country || 'IN',
      business_type: settings.business_type || 'restaurant',
      state_code: settings.state_code || '',
    };

    // Create order
    const orderResult = db.prepare(`
      INSERT INTO orders (order_number, table_id, customer_id, user_id, type, guest_count, special_instructions,
        packaging_charge, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(orderNumber, table_id || null, customer_id || null, user_id || null, type, guest_count || null,
      special_instructions || null, packaging_charge || 0, now(), now());

    const orderId = orderResult.lastInsertRowid;

    // Insert items
    let subtotal = 0;
    let totalTax = 0;
    const allTaxBreakdowns: any[] = [];

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity,
        subtotal, tax_amount, tax_breakdown, tax_type, discount_amount, total, variant_selection,
        modifier_selection, addons, special_instructions, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
      if (!product) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      // Check stock
      if (product.track_inventory && product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      const unitPrice = parseFloat(product.price);
      const quantity = item.quantity;
      const itemDiscount = item.discount_amount || 0;

      let itemSubtotal = unitPrice * quantity;
      if (item.addons) {
        for (const addon of item.addons) {
          itemSubtotal += (addon.price || 0) * quantity;
        }
      }
      itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);

      // Calculate tax
      const customer = customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id) as any : null;
      const taxResult = calculateItemTax(tenantInfo, product, itemSubtotal, customer);

      totalTax += taxResult.tax_amount;
      if (taxResult.tax_breakdown) {
        allTaxBreakdowns.push(taxResult.tax_breakdown);
      }

      const itemTotal = itemSubtotal + taxResult.tax_amount;
      subtotal += itemSubtotal;

      insertItem.run(
        orderId, product.id, product.name, product.sku, unitPrice, quantity,
        itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown),
        product.tax_type, itemDiscount, itemTotal,
        JSON.stringify(item.variant_selection || null),
        JSON.stringify(item.modifier_selection || null),
        JSON.stringify(item.addons || null),
        item.special_instructions || null, now(), now()
      );

      // Decrease stock
      if (product.track_inventory) {
        db.prepare('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?')
          .run(quantity, now(), product.id);
      }
    }

    // Calculate round off
    const preRoundTotal = subtotal + totalTax + (packaging_charge || 0);
    const roundOff = Math.round(preRoundTotal) - preRoundTotal;
    const total = Math.round(preRoundTotal) + roundOff;

    // Update order totals
    db.prepare(`
      UPDATE orders SET subtotal = ?, tax_amount = ?, tax_breakdown = ?, total = ?,
        round_off = ?, updated_at = ? WHERE id = ?
    `).run(subtotal, totalTax, JSON.stringify(allTaxBreakdowns), total, roundOff, now(), orderId);

    // Mark table as occupied
    if (table_id && type === 'dine_in') {
      db.prepare("UPDATE tables SET status = 'occupied', updated_at = ? WHERE id = ?").run(now(), table_id);
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(parseItemJson);

    notifyKdsUpdate();

    res.status(201).json({ order: Object.assign({}, order, { items: orderItems }) });
  } catch (error: any) {
    console.error('[Orders] Create error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/items', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (['completed', 'cancelled'].includes((order as any).status)) {
      return res.status(400).json({ error: 'Cannot add items to a completed or cancelled order' });
    }

    const { items } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // Get settings
    const settings: Record<string, string> = {};
    db.prepare('SELECT key, value FROM settings').all().forEach((row: any) => {
      settings[row.key] = row.value;
    });

    const tenantInfo = {
      country: settings.country || 'IN',
      business_type: settings.business_type || 'restaurant',
      state_code: settings.state_code || '',
    };

    const customer = (order as any).customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get((order as any).customer_id) as any : null;

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity,
        subtotal, tax_amount, tax_breakdown, tax_type, discount_amount, total, variant_selection,
        modifier_selection, addons, special_instructions, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);

    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
      if (!product) {
        throw new Error(`Product ${item.product_id} not found`);
      }

      if (product.track_inventory && product.stock_quantity < item.quantity) {
        throw new Error(`Insufficient stock for ${product.name}`);
      }

      const unitPrice = parseFloat(product.price);
      const quantity = item.quantity;
      const itemDiscount = item.discount_amount || 0;

      let itemSubtotal = unitPrice * quantity;
      if (item.addons) {
        for (const addon of item.addons) {
          itemSubtotal += (addon.price || 0) * quantity;
        }
      }
      itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);

      const taxResult = calculateItemTax(tenantInfo, product, itemSubtotal, customer);
      const itemTotal = itemSubtotal + taxResult.tax_amount;

      insertItem.run(
        req.params.id, product.id, product.name, product.sku, unitPrice, quantity,
        itemSubtotal, taxResult.tax_amount, JSON.stringify(taxResult.tax_breakdown),
        product.tax_type, itemDiscount, itemTotal,
        JSON.stringify(item.variant_selection || null),
        JSON.stringify(item.modifier_selection || null),
        JSON.stringify(item.addons || null),
        item.special_instructions || null, now(), now()
      );

      if (product.track_inventory) {
        db.prepare('UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ?')
          .run(quantity, now(), product.id);
      }
    }

    // Recalculate order totals
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id) as any[];
    let subtotal = 0;
    let totalTax = 0;
    for (const item of orderItems) {
      subtotal += item.subtotal;
      totalTax += item.tax_amount;
    }

    const preRoundTotal = subtotal + totalTax + ((order as any).packaging_charge || 0);
    const roundOff = Math.round(preRoundTotal) - preRoundTotal;
    const total = Math.round(preRoundTotal) + roundOff;

    db.prepare(`
      UPDATE orders SET subtotal = ?, tax_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
    `).run(subtotal, totalTax, total, roundOff, now(), req.params.id);

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
    const updatedItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);

    res.json({ order: Object.assign({}, updatedOrder, { items: updatedItems }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/status', (req: Request, res: Response) => {
  try {
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const validStatuses = ['preparing', 'ready', 'served', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
    }

    // reason is optional for cancellation

    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const nowStr = now();

    switch (status) {
      case 'preparing':
        db.prepare('UPDATE orders SET status = ?, cooking_started_at = ?, updated_at = ? WHERE id = ?')
          .run(status, nowStr, nowStr, req.params.id);
        break;

      case 'ready':
        db.prepare('UPDATE orders SET status = ?, ready_at = ?, updated_at = ? WHERE id = ?')
          .run(status, nowStr, nowStr, req.params.id);
        break;

      case 'served':
        db.prepare('UPDATE orders SET status = ?, served_at = ?, updated_at = ? WHERE id = ?')
          .run(status, nowStr, nowStr, req.params.id);
        break;

      case 'completed':
        db.prepare('UPDATE orders SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
          .run(status, nowStr, nowStr, req.params.id);
        // Free table
        if ((order as any).table_id) {
          db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
            .run(nowStr, (order as any).table_id);
        }
        break;

      case 'cancelled':
        // Restore stock
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id) as any[];
        for (const item of items) {
          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
          if (product && product.track_inventory) {
            db.prepare('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ?')
              .run(item.quantity, nowStr, product.id);
          }
        }
        db.prepare('UPDATE orders SET status = ?, cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?')
          .run(status, nowStr, reason, nowStr, req.params.id);
        // Free table
        if ((order as any).table_id) {
          db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
            .run(nowStr, (order as any).table_id);
        }
        break;
    }

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
    const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);
    const tableRow2 = updatedOrder.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(updatedOrder.table_id) as any : null;
    const table = tableRow2 ? { ...tableRow2, name: tableRow2.number } : null;

    res.json({ order: Object.assign({}, updatedOrder, { items: orderItems, table }) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const orderRoutes = router;