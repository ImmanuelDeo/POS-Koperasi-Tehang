import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { createAuditLog } from '../services/audit';
import { maskNik } from '../services/privacy';
import {
  generateSalaryDeductionsRekapPdf,
  generateMemberSalaryDeductionPdf,
  SalaryDeductionReportItem,
} from '../services/reports-pdf';

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

// ── GET /api/reports/salary-deductions/pdf ──────────────────────────────────
// Rekapitulasi transaksi potong gaji periode (PDF format)
// RBAC: Restricted to owner, admin, and office_hr

router.get(
  '/salary-deductions/pdf',
  authenticateToken,
  requireRole(['owner', 'admin', 'office_hr']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const { from_date, to_date, period_month, status, member_id } = req.query;

      const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('business_name', 'business_address', 'business_phone', 'report_header_title')").all() as { key: string; value: string }[];
      const sMap: Record<string, string> = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
      const businessName = sMap.business_name || 'POS Koperasi';
      const businessAddress = sMap.business_address || '';
      const businessPhone = sMap.business_phone || '';
      const reportHeaderTitle = sMap.report_header_title || 'REKAPITULASI TRANSAKSI POTONG GAJI';

      let query = `
        SELECT
          sd.id, sd.deduction_number, sd.period_month, sd.amount, sd.status, sd.created_at,
          sd.confirmed_at, sd.rejection_reason,
          c.name as member_name, c.member_no, c.employee_id, c.nik, c.department,
          u_created.name as created_by_name,
          u_confirmed.name as confirmed_by_name
        FROM salary_deductions sd
        JOIN customers c ON sd.member_id = c.id
        LEFT JOIN users u_created ON sd.created_by = u_created.id
        LEFT JOIN users u_confirmed ON sd.confirmed_by = u_confirmed.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (from_date && typeof from_date === 'string') {
        query += ' AND date(sd.created_at) >= date(?)';
        params.push(from_date.slice(0, 10));
      }
      if (to_date && typeof to_date === 'string') {
        query += ' AND date(sd.created_at) <= date(?)';
        params.push(to_date.slice(0, 10));
      }
      if (period_month && typeof period_month === 'string') {
        query += ' AND sd.period_month = ?';
        params.push(period_month);
      }
      if (status && typeof status === 'string' && status !== 'all') {
        query += ' AND sd.status = ?';
        params.push(status);
      }
      if (member_id && typeof member_id === 'string') {
        query += ' AND sd.member_id = ?';
        params.push(member_id);
      }

      query += ' ORDER BY sd.created_at DESC';

      const rows = db.prepare(query).all(...params) as any[];

      // Mask NIK on every row for safe export
      const items: SalaryDeductionReportItem[] = rows.map((r) => ({
        id: r.id,
        deduction_number: r.deduction_number,
        period_month: r.period_month,
        created_at: r.created_at,
        amount: r.amount,
        status: r.status,
        member_name: r.member_name,
        member_no: r.member_no,
        employee_id: r.employee_id,
        nik_masked: maskNik(r.nik),
        department: r.department,
        created_by_name: r.created_by_name,
        confirmed_by_name: r.confirmed_by_name,
        confirmed_at: r.confirmed_at,
        rejection_reason: r.rejection_reason,
      }));

      const todayStr = new Date().toISOString().slice(0, 10);
      const startDate = (from_date as string) || (period_month ? `${period_month}-01` : todayStr);
      const endDate = (to_date as string) || (period_month ? `${period_month}-31` : todayStr);

      const printedAt = new Date().toLocaleString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const pdfBuffer = await generateSalaryDeductionsRekapPdf({
        businessName,
        businessAddress,
        businessPhone,
        reportHeaderTitle,
        startDate,
        endDate,
        statusFilter: (status as string) || 'all',
        printedAt,
        printedByName: req.user?.name || 'Petugas',
        printedByRole: req.user?.role || 'Staff',
        items,
      });

      // Audit Log recording for PDF export
      createAuditLog(db, {
        actor_user_id: req.user?.id,
        actor_role: req.user?.role,
        action: 'salary_deduction.report.downloaded',
        target_type: 'report',
        details: {
          start_date: startDate,
          end_date: endDate,
          status_filter: status || 'all',
          total_records: items.length,
          total_amount: items.reduce((s, i) => s + i.amount, 0),
        },
        ip_address: req.ip,
      });

      const filename = `laporan-rekap-potong-gaji-${startDate}_${endDate}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error('[Reports] Error generating salary deductions PDF:', error);
      res.status(500).json({ error: error.message || 'Gagal membuat dokumen PDF laporan potong gaji' });
    }
  }
);

// ── GET /api/reports/salary-deductions/members/:memberId/pdf ────────────────
// Laporan bon transaksi potong gaji per anggota (PDF format)
// RBAC: Restricted to owner, admin, and office_hr

router.get(
  '/salary-deductions/members/:memberId/pdf',
  authenticateToken,
  requireRole(['owner', 'admin', 'office_hr']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDatabase();
      const { memberId } = req.params;
      const { from_date, to_date, period_month } = req.query;

      const member = db.prepare('SELECT * FROM customers WHERE id = ?').get(memberId) as any;
      if (!member) {
        return res.status(404).json({ error: 'Anggota koperasi tidak ditemukan' });
      }

      const settingsRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('business_name', 'business_address', 'business_phone', 'report_header_title')").all() as { key: string; value: string }[];
      const sMap: Record<string, string> = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));
      const businessName = sMap.business_name || 'POS Koperasi';
      const businessAddress = sMap.business_address || '';
      const businessPhone = sMap.business_phone || '';
      const reportHeaderTitle = sMap.report_header_title || 'RINCIAN BON POTONG GAJI ANGGOTA';

      let query = `
        SELECT
          sd.id, sd.deduction_number, sd.period_month, sd.amount, sd.status, sd.created_at,
          sd.confirmed_at, sd.rejection_reason,
          c.name as member_name, c.member_no, c.employee_id, c.nik, c.department,
          u_created.name as created_by_name,
          u_confirmed.name as confirmed_by_name
        FROM salary_deductions sd
        JOIN customers c ON sd.member_id = c.id
        LEFT JOIN users u_created ON sd.created_by = u_created.id
        LEFT JOIN users u_confirmed ON sd.confirmed_by = u_confirmed.id
        WHERE sd.member_id = ?
      `;
      const params: any[] = [memberId];

      if (from_date && typeof from_date === 'string') {
        query += ' AND date(sd.created_at) >= date(?)';
        params.push(from_date.slice(0, 10));
      }
      if (to_date && typeof to_date === 'string') {
        query += ' AND date(sd.created_at) <= date(?)';
        params.push(to_date.slice(0, 10));
      }
      if (period_month && typeof period_month === 'string') {
        query += ' AND sd.period_month = ?';
        params.push(period_month);
      }

      query += ' ORDER BY sd.created_at DESC';

      const rows = db.prepare(query).all(...params) as any[];

      const items: SalaryDeductionReportItem[] = rows.map((r) => ({
        id: r.id,
        deduction_number: r.deduction_number,
        period_month: r.period_month,
        created_at: r.created_at,
        amount: r.amount,
        status: r.status,
        member_name: r.member_name,
        member_no: r.member_no,
        employee_id: r.employee_id,
        nik_masked: maskNik(r.nik),
        department: r.department,
        created_by_name: r.created_by_name,
        confirmed_by_name: r.confirmed_by_name,
        confirmed_at: r.confirmed_at,
        rejection_reason: r.rejection_reason,
      }));

      const todayStr = new Date().toISOString().slice(0, 10);
      const startDate = (from_date as string) || (period_month ? `${period_month}-01` : todayStr);
      const endDate = (to_date as string) || (period_month ? `${period_month}-31` : todayStr);

      const printedAt = new Date().toLocaleString('id-ID', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const pdfBuffer = await generateMemberSalaryDeductionPdf({
        businessName,
        businessAddress,
        businessPhone,
        reportHeaderTitle,
        member: {
          id: member.id,
          name: member.name,
          member_no: member.member_no,
          employee_id: member.employee_id,
          nik_masked: maskNik(member.nik),
          department: member.department,
          monthly_deduction_limit: member.monthly_deduction_limit || 0,
          outstanding_deduction_limit: member.outstanding_deduction_limit || 0,
          is_active: Boolean(member.is_active),
        },
        startDate,
        endDate,
        printedAt,
        printedByName: req.user?.name || 'Petugas',
        printedByRole: req.user?.role || 'Staff',
        items,
      });

      // Audit Log recording
      createAuditLog(db, {
        actor_user_id: req.user?.id,
        actor_role: req.user?.role,
        action: 'salary_deduction.member_report.downloaded',
        target_type: 'member',
        target_id: member.id,
        details: {
          member_id: member.id,
          member_no: member.member_no || member.employee_id,
          start_date: startDate,
          end_date: endDate,
          total_records: items.length,
          total_amount: items.reduce((s, i) => s + i.amount, 0),
        },
        ip_address: req.ip,
      });

      const safeMemberNo = (member.member_no || member.employee_id || member.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `bon-potong-gaji-${safeMemberNo}_${startDate}_${endDate}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error('[Reports] Error generating member salary deduction PDF:', error);
      res.status(500).json({ error: error.message || 'Gagal membuat dokumen PDF bon anggota' });
    }
  }
);

export const reportRoutes = router;

