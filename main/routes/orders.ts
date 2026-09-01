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
import { generateOrdersTransactionReportExcel } from '../services/reports-excel';
import { maskNik } from '../services/privacy';
import { AuthenticatedRequest } from '../middleware/auth';
import { createAuditLog } from '../services/audit';
import { executeStockMovement } from '../services/cooperative';

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
    const rawSearch = search && search.trim() ? search.trim() : '';
    const selectSql = rawSearch
      ? `
      SELECT o.*
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      ${whereClause}
      ORDER BY
        CASE
          WHEN LOWER(TRIM(o.order_number)) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(c.name, ''))) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(c.nik, ''))) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(c.member_no, ''))) = LOWER(TRIM(?)) THEN 0
          WHEN LOWER(o.order_number) LIKE LOWER(? || '%') OR LOWER(COALESCE(c.name, '')) LIKE LOWER(? || '%') OR LOWER(COALESCE(c.member_no, '')) LIKE LOWER(? || '%') THEN 1
          WHEN LOWER(o.order_number) LIKE '%' || LOWER(?) || '%' OR LOWER(COALESCE(c.name, '')) LIKE '%' || LOWER(?) || '%' THEN 2
          ELSE 3
        END,
        o.created_at DESC
      LIMIT ? OFFSET ?
    `
      : `
      SELECT o.*
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const selectParams = rawSearch
      ? [...params, rawSearch, rawSearch, rawSearch, rawSearch, rawSearch, rawSearch, rawSearch, rawSearch, rawSearch, pageSize, offset]
      : [...params, pageSize, offset];

    const orders = db.prepare(selectSql).all(...selectParams) as any[];

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
    res.status(500).json({ error: error.message || 'Gagal membuat file CSV' });
  }
});

/**
 * GET /api/orders/export-xlsx
 * Download Excel (.xlsx) report of filtered transactions.
 */
router.get('/export-xlsx', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = buildFilteredOrdersForExport(req);
    const excelBuffer = await generateOrdersTransactionReportExcel({
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

    const filename = `Laporan_Transaksi_Koperasi_${data.activeRange.startDate}_sd_${data.activeRange.endDate}.xlsx`;

    const db = getDatabase();
    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'EXPORT_ORDERS_REPORT_XLSX',
      target_type: 'orders',
      details: { period: data.activeRange.period, totalCount: data.orders.length, netSales: data.summary.netSales },
      ip_address: req.ip,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);
    res.end(excelBuffer);
  } catch (error: any) {
    console.error('[Orders Export XLSX Error]', error);
    res.status(500).json({ error: error.message || 'Gagal membuat laporan Excel' });
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

router.post('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { table_id, customer_id, type = 'takeaway', guest_count, special_instructions, packaging_charge, items } = req.body;
    const userId = req.user?.id || req.body.user_id || 'system';

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Minimal 1 item barang harus ada di pesanan' });
    }

    if (!type || !['dine_in', 'takeaway', 'delivery', 'online'].includes(type)) {
      return res.status(400).json({ error: 'Valid type is required (dine_in, takeaway, delivery, online)' });
    }

    const db = getDatabase();

    // Get settings for tax calculation
    const settings: Record<string, string> = {};
    db.prepare('SELECT key, value FROM settings').all().forEach((row: any) => {
      settings[row.key] = row.value;
    });

    const tenantInfo = {
      country: settings.country || 'ID',
      business_type: settings.business_type || 'cooperative',
      state_code: settings.state_code || '',
    };

    // Execute whole order creation + stock deduction + ledger insertion in atomic transaction
    const createOrderTx = db.transaction(() => {
      // 1. Aggregate requested quantities per product to validate against available stock
      const aggregatedQtyMap: Record<string, number> = {};

      for (const item of items) {
        if (!item.product_id && !item.addon_group_id) {
          throw new Error('Setiap item wajib memiliki product_id atau addon_group_id');
        }
        const q = Number(item.quantity);
        if (isNaN(q) || !Number.isFinite(q) || q <= 0) {
          throw new Error('Jumlah barang harus berupa angka positif lebih dari 0');
        }

        const isBundle = item.is_bundle || Boolean(item.addon_group_id) || String(item.product_id).startsWith('bundle_');
        if (isBundle) {
          const bundleId = item.addon_group_id || String(item.product_id).replace(/^bundle_/, '');
          const bundle = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(bundleId) as any;
          if (!bundle) {
            throw new Error(`Paket bundling dengan ID '${bundleId}' tidak ditemukan`);
          }
          const components = db.prepare(`
            SELECT a.*, p.name as product_name, p.track_inventory, p.stock_quantity, p.allow_decimal
            FROM addons a
            LEFT JOIN products p ON a.product_id = p.id
            WHERE a.addon_group_id = ? AND (a.is_active IS NULL OR a.is_active = 1)
          `).all(bundleId) as any[];

          for (const comp of components) {
            if (comp.product_id) {
              const compReqQty = Math.max(0.01, Number(comp.quantity || 1)) * q;
              aggregatedQtyMap[comp.product_id] = (aggregatedQtyMap[comp.product_id] || 0) + compReqQty;
            }
          }
        } else {
          aggregatedQtyMap[item.product_id] = (aggregatedQtyMap[item.product_id] || 0) + q;
        }
      }

      // 2. Pre-validate stock availability and decimal rules
      for (const [prodId, totalRequestedQty] of Object.entries(aggregatedQtyMap)) {
        const prod = db.prepare('SELECT id, name, stock_quantity, track_inventory, allow_decimal, price FROM products WHERE id = ?').get(prodId) as any;
        if (!prod) {
          throw new Error(`Produk dengan ID '${prodId}' tidak ditemukan`);
        }

        // Validate decimal support
        if (!prod.allow_decimal && totalRequestedQty % 1 !== 0) {
          throw new Error(`Produk '${prod.name}' tidak mendukung jumlah desimal (${totalRequestedQty})`);
        }

        // Validate stock
        if (prod.track_inventory === 1 && Number(prod.stock_quantity || 0) < totalRequestedQty) {
          throw new Error(`Stok tidak mencukupi untuk '${prod.name}'. Stok tersedia: ${prod.stock_quantity}, dibutuhkan: ${totalRequestedQty}`);
        }
      }

      const orderNumber = generateOrderNumber();

      const orderResult = db.prepare(`
        INSERT INTO orders (order_number, table_id, customer_id, user_id, type, guest_count, special_instructions,
          packaging_charge, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(orderNumber, table_id || null, customer_id || null, userId, type, guest_count || null,
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
        const isBundle = item.is_bundle || Boolean(item.addon_group_id) || String(item.product_id).startsWith('bundle_');
        const quantity = Number(item.quantity);
        const itemDiscount = item.discount_amount || 0;

        if (isBundle) {
          const bundleId = item.addon_group_id || String(item.product_id).replace(/^bundle_/, '');
          const bundle = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(bundleId) as any;
          if (!bundle) {
            throw new Error(`Paket bundling dengan ID '${bundleId}' tidak ditemukan`);
          }

          const components = db.prepare(`
            SELECT a.*, p.name as product_name, p.unit as product_unit, p.price as product_unit_price, p.track_inventory, p.stock_quantity
            FROM addons a
            LEFT JOIN products p ON a.product_id = p.id
            WHERE a.addon_group_id = ? AND (a.is_active IS NULL OR a.is_active = 1)
          `).all(bundleId) as any[];

          const unitPrice = Number(bundle.bundle_price || 0);
          const itemSubtotal = Math.max(0, unitPrice * quantity - itemDiscount);
          const itemTotal = itemSubtotal;
          subtotal += itemSubtotal;

          // Store component snapshot in addons column for receipt printing & history
          const componentsSnapshot = components.map((c) => ({
            id: c.id,
            product_id: c.product_id,
            name: c.product_name || c.name,
            quantity: Number(c.quantity || 1),
            unit: c.product_unit || 'pcs',
            price: Number(c.product_unit_price || c.price || 0),
          }));

          insertItem.run(
            orderId,
            `bundle_${bundle.id}`,
            `[PAKET] ${bundle.name}`,
            `BUNDLE-${bundle.id.slice(0, 8)}`,
            unitPrice,
            quantity,
            itemSubtotal,
            0,
            JSON.stringify([]),
            'none',
            itemDiscount,
            itemTotal,
            JSON.stringify(item.variant_selection || null),
            JSON.stringify(item.modifier_selection || null),
            JSON.stringify(componentsSnapshot),
            item.special_instructions || null,
            now(),
            now()
          );

          // Deduct inventory atomically for each component product
          for (const comp of components) {
            if (comp.product_id && comp.track_inventory === 1) {
              const compQtyToDeduct = Number(comp.quantity || 1) * quantity;
              const moveRes = executeStockMovement(db, {
                productId: comp.product_id,
                movementType: 'sale',
                quantityChange: -compQtyToDeduct,
                referenceType: 'bundle_sale',
                referenceId: orderNumber,
                notes: `Penjualan Komponen Paket '${bundle.name}' #${orderNumber} (${compQtyToDeduct} ${comp.product_unit || 'pcs'})`,
                createdBy: userId,
              });

              if (!moveRes.success) {
                throw new Error(`Gagal memotong stok komponen '${comp.product_name}' untuk paket '${bundle.name}': ${moveRes.error}`);
              }
            }
          }
        } else {
          // Regular product item
          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
          if (!product) {
            throw new Error(`Produk dengan ID '${item.product_id}' tidak ditemukan`);
          }
          const unitPrice = parseFloat(product.price);

          let itemSubtotal = unitPrice * quantity;
          if (item.addons && Array.isArray(item.addons)) {
            for (const addon of item.addons) {
              itemSubtotal += (addon.price || 0) * quantity;
            }
          }
          itemSubtotal = Math.max(0, itemSubtotal - itemDiscount);

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

          // Deduct inventory atomically and create stock movement record
          if (product.track_inventory === 1) {
            const moveRes = executeStockMovement(db, {
              productId: product.id,
              movementType: 'sale',
              quantityChange: -quantity,
              referenceType: 'order',
              referenceId: orderNumber,
              notes: `Penjualan POS #${orderNumber}`,
              createdBy: userId,
            });

            if (!moveRes.success) {
              throw new Error(`Gagal memotong stok untuk ${product.name}: ${moveRes.error}`);
            }
          }
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

      return { order: Object.assign({}, order, { items: orderItems }) };
    });

    const result = createOrderTx();
    notifyKdsUpdate();
    res.status(201).json(result);
  } catch (error: any) {
    console.error('[Orders] Create error:', error);
    res.status(422).json({ error: error.message });
  }
});

router.post('/:id/items', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const userId = req.user?.id || 'system';
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (['completed', 'cancelled'].includes(order.status)) {
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
      country: settings.country || 'ID',
      business_type: settings.business_type || 'cooperative',
      state_code: settings.state_code || '',
    };

    const customer = order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) as any : null;

    const addItemsTx = db.transaction(() => {
      // 1. Aggregate and pre-validate requested quantities
      const aggregatedQtyMap: Record<string, number> = {};
      for (const item of items) {
        if (!item.product_id) {
          throw new Error('Setiap item wajib memiliki product_id');
        }
        const q = Number(item.quantity);
        if (isNaN(q) || !Number.isFinite(q) || q <= 0) {
          throw new Error('Jumlah barang harus berupa angka positif lebih dari 0');
        }
        aggregatedQtyMap[item.product_id] = (aggregatedQtyMap[item.product_id] || 0) + q;
      }

      for (const [prodId, totalRequestedQty] of Object.entries(aggregatedQtyMap)) {
        const prod = db.prepare('SELECT id, name, stock_quantity, track_inventory, allow_decimal, price FROM products WHERE id = ?').get(prodId) as any;
        if (!prod) {
          throw new Error(`Produk dengan ID ${prodId} tidak ditemukan`);
        }

        if (!prod.allow_decimal && totalRequestedQty % 1 !== 0) {
          throw new Error(`Produk '${prod.name}' tidak mendukung jumlah desimal (${totalRequestedQty})`);
        }

        if (prod.track_inventory === 1 && Number(prod.stock_quantity || 0) < totalRequestedQty) {
          throw new Error(`Stok tidak mencukupi untuk '${prod.name}'. Stok tersedia: ${prod.stock_quantity}, diminta: ${totalRequestedQty}`);
        }
      }

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity,
          subtotal, tax_amount, tax_breakdown, tax_type, discount_amount, total, variant_selection,
          modifier_selection, addons, special_instructions, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);

      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id) as any;
        const unitPrice = parseFloat(product.price);
        const quantity = Number(item.quantity);
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

        if (product.track_inventory === 1) {
          const moveRes = executeStockMovement(db, {
            productId: product.id,
            movementType: 'sale',
            quantityChange: -quantity,
            referenceType: 'order_add_items',
            referenceId: order.order_number,
            notes: `Penambahan item pada order #${order.order_number}`,
            createdBy: userId,
          });

          if (!moveRes.success) {
            throw new Error(`Gagal memotong stok untuk ${product.name}: ${moveRes.error}`);
          }
        }
      }

      // Recalculate order totals
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND status != \'cancelled\'').all(req.params.id) as any[];
      let subtotal = 0;
      let totalTax = 0;
      for (const item of orderItems) {
        subtotal += item.subtotal;
        totalTax += item.tax_amount;
      }

      const preRoundTotal = subtotal + totalTax + (order.packaging_charge || 0);
      const roundOff = Math.round(preRoundTotal) - preRoundTotal;
      const total = Math.round(preRoundTotal) + roundOff;

      db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, totalTax, total, roundOff, now(), req.params.id);

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
      const updatedItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);

      return { order: Object.assign({}, updatedOrder, { items: updatedItems }) };
    });

    const result = addItemsTx();
    res.json(result);
  } catch (error: any) {
    res.status(422).json({ error: error.message });
  }
});

router.patch('/:id/status', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, reason } = req.body;
    const userId = req.user?.id || 'system';

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const validStatuses = ['preparing', 'ready', 'served', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
    }

    const db = getDatabase();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Idempotency check: if order is already in the requested status, return early
    if (order.status === status) {
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);
      return res.json({ order: Object.assign({}, order, { items: orderItems }), idempotent: true });
    }

    const nowStr = now();

    const updateStatusTx = db.transaction(() => {
      switch (status) {
        case 'preparing':
        case 'ready':
        case 'served':
          db.prepare(`UPDATE orders SET status = ?, ${status === 'preparing' ? 'cooking_started_at' : status === 'ready' ? 'ready_at' : 'served_at'} = ?, updated_at = ? WHERE id = ?`)
            .run(status, nowStr, nowStr, req.params.id);
          break;

        case 'completed':
          db.prepare('UPDATE orders SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, nowStr, req.params.id);
          // Free table
          if (order.table_id) {
            db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
              .run(nowStr, order.table_id);
          }
          break;

        case 'cancelled':
          // Restore stock exactly once using executeStockMovement
          if (order.status !== 'cancelled') {
            const items = db.prepare(`
              SELECT oi.product_id, oi.quantity, p.track_inventory, p.name as product_name
              FROM order_items oi
              JOIN products p ON oi.product_id = p.id
              WHERE oi.order_id = ? AND oi.status != 'cancelled'
            `).all(req.params.id) as any[];

            for (const item of items) {
              if (item.track_inventory === 1) {
                const moveRes = executeStockMovement(db, {
                  productId: item.product_id,
                  movementType: 'void',
                  quantityChange: item.quantity,
                  referenceType: 'order_cancellation',
                  referenceId: order.order_number,
                  notes: `Pembatalan order #${order.order_number}${reason ? ': ' + reason : ''}`,
                  createdBy: userId,
                });

                if (!moveRes.success) {
                  throw new Error(`Gagal mengembalikan stok untuk ${item.product_name}: ${moveRes.error}`);
                }
              }
            }

            // Cancel any associated pending salary deduction
            db.prepare(`
              UPDATE salary_deductions SET
                status = 'cancelled',
                cancellation_reason = COALESCE(?, 'Order dibatalkan'),
                cancelled_by = ?,
                cancelled_at = ?,
                updated_at = ?
              WHERE order_id = ? AND status = 'pending'
            `).run(reason || null, userId, nowStr, nowStr, req.params.id);

            // Revert any associated bill to unpaid
            db.prepare(`
              UPDATE bills SET
                payment_status = 'unpaid',
                paid_amount = 0,
                balance = total,
                paid_at = NULL,
                updated_at = ?
              WHERE order_id = ?
            `).run(nowStr, req.params.id);
          }

          db.prepare('UPDATE orders SET status = ?, cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ?')
            .run(status, nowStr, reason || null, nowStr, req.params.id);

          // Free table
          if (order.table_id) {
            db.prepare("UPDATE tables SET status = 'available', updated_at = ? WHERE id = ?")
              .run(nowStr, order.table_id);
          }
          break;
      }

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id) as any;
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id).map(parseItemJson);
      const tableRow2 = updatedOrder.table_id ? db.prepare('SELECT * FROM tables WHERE id = ?').get(updatedOrder.table_id) as any : null;
      const table = tableRow2 ? { ...tableRow2, name: tableRow2.number } : null;

      return { order: Object.assign({}, updatedOrder, { items: orderItems, table }) };
    });

    const result = updateStatusTx();
    notifyKdsUpdate();
    res.json(result);
  } catch (error: any) {
    console.error('[Orders] Status update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/orders/:id - Permanently delete an order and associated records (Super Admin / Owner only)
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const orderId = req.params.id;
    const authUser = (req as AuthenticatedRequest).user;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
    if (!order) {
      return res.status(404).json({ error: 'Order tidak ditemukan' });
    }

    const deleteOrderTx = db.transaction(() => {
      // 1. Delete associated salary deductions
      db.prepare('DELETE FROM salary_deductions WHERE order_id = ?').run(orderId);

      // 2. Delete loyalty ledger records for any bills belonging to this order
      db.prepare(`
        DELETE FROM loyalty_ledger
        WHERE bill_id IN (SELECT id FROM bills WHERE order_id = ?)
      `).run(orderId);

      // 3. Delete associated bills
      db.prepare('DELETE FROM bills WHERE order_id = ?').run(orderId);

      // 4. Delete associated order items
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);

      // 5. Delete order record
      db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);

      // 6. Free table if applicable
      if (order.table_id) {
        const remainingActive = db.prepare(`
          SELECT COUNT(*) as count FROM orders
          WHERE table_id = ? AND status NOT IN ('completed', 'cancelled')
        `).get(order.table_id) as any;
        if (!remainingActive || remainingActive.count === 0) {
          db.prepare("UPDATE tables SET status = 'available', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(order.table_id);
        }
      }

      // 7. Record immutable audit log
      createAuditLog(db, {
        actor_user_id: authUser?.id || null,
        actor_role: authUser?.role || 'owner',
        action: 'DELETE_ORDER_TRANSACTION',
        target_type: 'order',
        target_id: String(order.id),
        details: {
          order_id: order.id,
          order_number: order.order_number,
          total: order.total,
          status: order.status,
          customer_id: order.customer_id,
          created_at: order.created_at,
          deleted_by: authUser?.name || 'Super Admin',
        },
        ip_address: req.ip || null,
      });

      return true;
    });

    deleteOrderTx();
    notifyKdsUpdate();

    res.json({
      success: true,
      message: `Order #${order.order_number} berhasil dihapus permanen dari database.`,
      orderId: order.id,
    });
  } catch (error: any) {
    console.error('[Orders] Delete order error:', error);
    res.status(500).json({ error: error.message || 'Gagal menghapus order' });
  }
});

export const orderRoutes = router;
