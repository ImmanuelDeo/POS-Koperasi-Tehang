import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';

const router = Router();

/**
 * Safely parse and aggregate payment methods from the bills table.
 * Bulletproof against JSON format differences or single-object/array formats.
 */
function getPaymentMethodBreakdown(dateOrStart: string, endDate?: string) {
  const db = getDatabase();
  let query = "SELECT payment_details, paid_amount FROM bills WHERE payment_status = 'paid'";
  const params: any[] = [];

  if (endDate) {
    query += " AND date(paid_at) BETWEEN date(?) AND date(?)";
    params.push(dateOrStart, endDate);
  } else {
    query += " AND date(paid_at) = date(?)";
    params.push(dateOrStart);
  }

  const rows = db.prepare(query).all(...params) as { payment_details: string | null; paid_amount: number }[];
  const map = new Map<string, { method: string; count: number; total: number }>();

  for (const row of rows) {
    let method = 'cash';
    if (row.payment_details) {
      try {
        const parsed = JSON.parse(row.payment_details);
        if (Array.isArray(parsed) && parsed.length > 0) {
          method = parsed[0].method || 'cash';
        } else if (parsed && typeof parsed === 'object' && parsed.method) {
          method = parsed.method;
        }
      } catch {
        if (row.payment_details.includes('salary_deduction')) method = 'salary_deduction';
        else if (row.payment_details.includes('card')) method = 'card';
        else if (row.payment_details.includes('upi')) method = 'upi';
        else if (row.payment_details.includes('wallet')) method = 'wallet';
      }
    }
    const current = map.get(method) || { method, count: 0, total: 0 };
    current.count += 1;
    current.total += row.paid_amount || 0;
    map.set(method, current);
  }

  return Array.from(map.values());
}

router.get('/daily-stats', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const today = new Date().toISOString().slice(0, 10);

    const salesToday = db.prepare(`
      SELECT COALESCE(SUM(paid_amount), 0) as sales
      FROM bills WHERE date(created_at) = date(?)
    `).get(today) as { sales: number };

    const runningOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')
    `).get() as { count: number };

    const pendingOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE status = 'pending'
    `).get() as { count: number };

    const tablesOccupied = db.prepare(`
      SELECT COUNT(*) as count FROM tables WHERE status = 'occupied'
    `).get() as { count: number };

    const paymentMethods = getPaymentMethodBreakdown(today);

    res.json({
      sales: salesToday.sales,
      runningOrders: runningOrders.count,
      pendingOrders: pendingOrders.count,
      tablesOccupied: tablesOccupied.count,
      paymentMethods,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/summary', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const date = req.query.date as string || new Date().toISOString().slice(0, 10);

    const ordersToday = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM orders WHERE date(created_at) = date(?)
    `).get(date) as { count: number; total: number };

    const billsToday = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total, COALESCE(SUM(paid_amount), 0) as collected
      FROM bills WHERE date(created_at) = date(?)
    `).get(date) as { count: number; total: number; collected: number };

    const customersToday = db.prepare(`
      SELECT COUNT(*) as count FROM customers WHERE date(created_at) = date(?)
    `).get(date) as { count: number };

    const ordersByStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM orders WHERE date(created_at) = date(?) GROUP BY status
    `).all(date);

    const topPaymentMethods = getPaymentMethodBreakdown(date);

    res.json({
      summary: {
        date,
        orders: { count: ordersToday.count, total: ordersToday.total },
        bills: { count: billsToday.count, total: billsToday.total, collected: billsToday.collected },
        customers: { new: customersToday.count },
        ordersByStatus,
        topPaymentMethods,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/sales', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const startDate = req.query.start_date as string || new Date().toISOString().slice(0, 10);
    const endDate = req.query.end_date as string || new Date().toISOString().slice(0, 10);

    const dailySales = db.prepare(`
      SELECT date(created_at) as date, COUNT(*) as orders, SUM(total) as sales
      FROM orders
      WHERE date(created_at) BETWEEN date(?) AND date(?)
      GROUP BY date(created_at)
      ORDER BY date
    `).all(startDate, endDate);

    const byPaymentMethod = getPaymentMethodBreakdown(startDate, endDate);

    const byOrderType = db.prepare(`
      SELECT type, COUNT(*) as count, SUM(total) as total
      FROM orders
      WHERE date(created_at) BETWEEN date(?) AND date(?)
      GROUP BY type
    `).all(startDate, endDate);

    res.json({
      sales: {
        startDate,
        endDate,
        dailySales,
        byPaymentMethod,
        byOrderType,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/topProducts', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const startDate = req.query.start_date as string || new Date().toISOString().slice(0, 10);
    const endDate = req.query.end_date as string || new Date().toISOString().slice(0, 10);
    const limit = parseInt(req.query.limit as string) || 10;

    const topProducts = db.prepare(`
      SELECT oi.product_id, oi.product_name,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.subtotal) as total_revenue,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE date(o.created_at) BETWEEN date(?) AND date(?)
      GROUP BY oi.product_id
      ORDER BY total_quantity DESC
      LIMIT ?
    `).all(startDate, endDate, limit);

    res.json({ topProducts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/recentOrders', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = parseInt(req.query.limit as string) || 20;

    const recentOrders = db.prepare(`
      SELECT o.*, t.number as table_name, c.name as customer_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
      LIMIT ?
    `).all(limit);

    const ordersWithItems = recentOrders.map((order: any) => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      return { ...order, items };
    });

    res.json({ recentOrders: ordersWithItems });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/insights', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const windowDays = parseInt(req.query.days as string) || 30;

    // AOV (Average Order Value)
    const aovRow = db.prepare(`
      SELECT COALESCE(AVG(total), 0) as aov
      FROM orders
      WHERE created_at >= datetime('now', '-' || ? || ' days')
        AND status != 'cancelled'
    `).get(windowDays) as { aov: number };

    // Avg Prep Time (in minutes)
    const prepRow = db.prepare(`
      SELECT AVG((julianday(completed_at) - julianday(created_at)) * 24 * 60) as avg_prep
      FROM orders
      WHERE completed_at IS NOT NULL
        AND created_at >= datetime('now', '-' || ? || ' days')
        AND status = 'completed'
    `).get(windowDays) as { avg_prep: number | null };

    // Top Staff
    const topStaff = db.prepare(`
      SELECT
        COALESCE(u.id, 'unknown') as user_id,
        COALESCE(u.name, 'Kasir') as name,
        COALESCE(u.role, 'cashier') as role,
        COALESCE(SUM(o.total), 0) as revenue,
        COUNT(o.id) as orderCount
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.created_at >= datetime('now', '-' || ? || ' days')
        AND o.status != 'cancelled'
      GROUP BY o.user_id
      ORDER BY revenue DESC
      LIMIT 5
    `).all(windowDays) as any[];

    // Top Categories
    const topCategories = db.prepare(`
      SELECT
        c.id as category_id,
        COALESCE(c.name, 'Tanpa Kategori') as name,
        COALESCE(SUM(oi.quantity), 0) as quantity,
        COALESCE(SUM(oi.subtotal), 0) as revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE o.created_at >= datetime('now', '-' || ? || ' days')
        AND o.status != 'cancelled'
      GROUP BY c.id
      ORDER BY revenue DESC
      LIMIT 5
    `).all(windowDays) as any[];

    // Hourly buckets
    const hourlyRows = db.prepare(`
      SELECT
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as orderCount
      FROM orders
      WHERE created_at >= datetime('now', '-' || ? || ' days')
        AND status != 'cancelled'
      GROUP BY hour
      ORDER BY orderCount DESC
    `).all(windowDays) as { hour: number; orderCount: number }[];

    const busiestHour = hourlyRows.length > 0 ? hourlyRows[0] : null;
    const idlestHour = hourlyRows.length > 1 ? hourlyRows[hourlyRows.length - 1] : null;

    // Day of week buckets (0=Sunday..6=Saturday)
    const dailyRows = db.prepare(`
      SELECT
        CAST(strftime('%w', created_at) AS INTEGER) as dayIndex,
        COUNT(*) as orderCount
      FROM orders
      WHERE created_at >= datetime('now', '-' || ? || ' days')
        AND status != 'cancelled'
      GROUP BY dayIndex
      ORDER BY orderCount DESC
    `).all(windowDays) as { dayIndex: number; orderCount: number }[];

    const busiestDayOfWeek = dailyRows.length > 0 ? dailyRows[0] : null;
    const idlestDayOfWeek = dailyRows.length > 1 ? dailyRows[dailyRows.length - 1] : null;

    res.json({
      windowDays,
      aov: Math.round((aovRow?.aov || 0) * 100) / 100,
      avgPrepTimeMinutes: prepRow?.avg_prep != null ? Math.round(prepRow.avg_prep * 10) / 10 : null,
      topStaff,
      topCategories,
      busiestHour,
      idlestHour,
      busiestDayOfWeek,
      idlestDayOfWeek,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tables', (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const tableStats = db.prepare(`
      SELECT t.*,
        COUNT(DISTINCT o.id) as total_orders,
        COALESCE(SUM(o.total), 0) as total_revenue,
        MAX(o.created_at) as last_order_at
      FROM tables t
      LEFT JOIN orders o ON t.id = o.table_id
      WHERE date(o.created_at) = date('now') OR o.id IS NULL
      GROUP BY t.id
    `).all();

    const tableUtilization = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) as occupied,
        SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END) as reserved,
        SUM(CASE WHEN status = 'cleaning' THEN 1 ELSE 0 END) as cleaning,
        COUNT(*) as total
      FROM tables
    `).get();

    res.json({
      tableStats,
      tableUtilization
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const reportRoutes = router;
