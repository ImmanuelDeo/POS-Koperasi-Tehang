import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { isSameBusinessDay, executeStockMovement } from '../services/cooperative';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// ── GET /api/salary-deductions ────────────────────────────────────────────────
// List and filter salary deduction records

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { period_month, member_id, status, from_date, to_date, page = '1', per_page = '50' } = req.query;

    let query = `
      SELECT
        sd.id, sd.deduction_number, sd.member_id, sd.order_id, sd.bill_id,
        sd.amount, sd.period_month, sd.status,
        sd.confirmed_by, sd.confirmed_at,
        sd.rejected_by, sd.rejected_at, sd.rejection_reason,
        sd.cancelled_by, sd.cancelled_at, sd.cancellation_reason,
        sd.created_by, sd.created_at, sd.updated_at,
        c.name as member_name, c.member_no, c.employee_id, c.department as member_department,
        b.bill_number, b.total as bill_total,
        o.order_number,
        u_create.name as created_by_name,
        u_confirm.name as confirmed_by_name,
        u_reject.name as rejected_by_name,
        u_cancel.name as cancelled_by_name
      FROM salary_deductions sd
      LEFT JOIN customers c ON sd.member_id = c.id
      LEFT JOIN bills b ON sd.bill_id = b.id
      LEFT JOIN orders o ON sd.order_id = o.id
      LEFT JOIN users u_create ON sd.created_by = u_create.id
      LEFT JOIN users u_confirm ON sd.confirmed_by = u_confirm.id
      LEFT JOIN users u_reject ON sd.rejected_by = u_reject.id
      LEFT JOIN users u_cancel ON sd.cancelled_by = u_cancel.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (period_month && /^\d{4}-\d{2}$/.test(String(period_month))) {
      query += ' AND sd.period_month = ?';
      params.push(String(period_month));
    }

    if (member_id) {
      query += ' AND sd.member_id = ?';
      params.push(member_id);
    }

    if (status && ['pending', 'confirmed', 'rejected', 'cancelled'].includes(String(status))) {
      query += ' AND sd.status = ?';
      params.push(String(status));
    }

    if (from_date) {
      query += ' AND sd.created_at >= ?';
      params.push(from_date);
    }

    if (to_date) {
      query += ' AND sd.created_at <= ?';
      params.push(to_date);
    }

    // Total count
    const countSql = `SELECT COUNT(*) as total FROM salary_deductions sd WHERE 1=1` +
      (period_month && /^\d{4}-\d{2}$/.test(String(period_month)) ? ' AND sd.period_month = ?' : '') +
      (member_id ? ' AND sd.member_id = ?' : '') +
      (status && ['pending', 'confirmed', 'rejected', 'cancelled'].includes(String(status)) ? ' AND sd.status = ?' : '') +
      (from_date ? ' AND sd.created_at >= ?' : '') +
      (to_date ? ' AND sd.created_at <= ?' : '');

    const totalCount = (db.prepare(countSql).get(...params) as any)?.total || 0;

    query += ' ORDER BY sd.created_at DESC';

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(per_page), 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    query += ` LIMIT ${limitNum} OFFSET ${offset}`;

    const deductions = db.prepare(query).all(...params);

    res.json({
      deductions,
      pagination: {
        page: pageNum,
        per_page: limitNum,
        total: totalCount,
        total_pages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/salary-deductions/:id/confirm ───────────────────────────────────
// Confirm pending salary deduction after payroll verification (Office HR / Owner)

router.post('/:id/confirm', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();

    const confirmTx = db.transaction(() => {
      const deduction = db.prepare('SELECT * FROM salary_deductions WHERE id = ?').get(req.params.id) as any;
      if (!deduction) {
        return { error: 'Salary deduction record not found', status: 404 };
      }

      if (deduction.status !== 'pending') {
        return {
          error: `Cannot confirm salary deduction with status '${deduction.status}'. Only 'pending' deductions can be confirmed.`,
          status: 409,
        };
      }

      db.prepare(`
        UPDATE salary_deductions SET
          status = 'confirmed',
          confirmed_by = ?,
          confirmed_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(req.user!.id, now(), now(), req.params.id);

      const updated = db.prepare(`
        SELECT sd.*, c.name as member_name, c.member_no, c.employee_id, u.name as confirmed_by_name
        FROM salary_deductions sd
        LEFT JOIN customers c ON sd.member_id = c.id
        LEFT JOIN users u ON sd.confirmed_by = u.id
        WHERE sd.id = ?
      `).get(req.params.id);

      return { success: true, deduction: updated };
    });

    const result = confirmTx();
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({
      message: 'Salary deduction confirmed successfully',
      deduction: result.deduction,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/salary-deductions/:id/reject ────────────────────────────────────
// Reject pending salary deduction with audit reason (Office HR / Owner)

router.post('/:id/reject', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(422).json({ error: 'A valid rejection reason with at least 5 characters is required' });
    }

    const cleanReason = reason.trim().slice(0, 500);
    const db = getDatabase();

    const rejectTx = db.transaction(() => {
      const deduction = db.prepare('SELECT * FROM salary_deductions WHERE id = ?').get(req.params.id) as any;
      if (!deduction) {
        return { error: 'Salary deduction record not found', status: 404 };
      }

      if (deduction.status !== 'pending') {
        return {
          error: `Cannot reject salary deduction with status '${deduction.status}'. Only 'pending' deductions can be rejected.`,
          status: 409,
        };
      }

      db.prepare(`
        UPDATE salary_deductions SET
          status = 'rejected',
          rejection_reason = ?,
          rejected_by = ?,
          rejected_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(cleanReason, req.user!.id, now(), now(), req.params.id);

      const updated = db.prepare(`
        SELECT sd.*, c.name as member_name, c.member_no, c.employee_id, u.name as rejected_by_name
        FROM salary_deductions sd
        LEFT JOIN customers c ON sd.member_id = c.id
        LEFT JOIN users u ON sd.rejected_by = u.id
        WHERE sd.id = ?
      `).get(req.params.id);

      return { success: true, deduction: updated };
    });

    const result = rejectTx();
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({
      message: 'Salary deduction rejected',
      deduction: result.deduction,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/salary-deductions/:id/cancel ────────────────────────────────────
// Void/cancel salary deduction on the same business day & reverse stock/bill (Cashier/Admin/Owner)

router.post('/:id/cancel', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(422).json({ error: 'A valid cancellation reason with at least 5 characters is required' });
    }

    const cleanReason = reason.trim().slice(0, 500);
    const db = getDatabase();

    const cancelTx = db.transaction(() => {
      const deduction = db.prepare('SELECT * FROM salary_deductions WHERE id = ?').get(req.params.id) as any;
      if (!deduction) {
        return { error: 'Salary deduction record not found', status: 404 };
      }

      if (deduction.status !== 'pending') {
        return {
          error: `Cannot cancel salary deduction with status '${deduction.status}'. Only 'pending' deductions can be cancelled.`,
          status: 409,
        };
      }

      // Check same business calendar day
      if (!isSameBusinessDay(db, deduction.created_at, new Date())) {
        return {
          error: 'Salary deductions can only be cancelled on the same business calendar day as creation.',
          status: 422,
        };
      }

      // 1. Update salary deduction status
      db.prepare(`
        UPDATE salary_deductions SET
          status = 'cancelled',
          cancellation_reason = ?,
          cancelled_by = ?,
          cancelled_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(cleanReason, req.user!.id, now(), now(), req.params.id);

      // 2. Reverse Bill status to unpaid
      if (deduction.bill_id) {
        const bill = db.prepare('SELECT id, total FROM bills WHERE id = ?').get(deduction.bill_id) as any;
        if (bill) {
          db.prepare(`
            UPDATE bills SET
              payment_status = 'unpaid',
              paid_amount = 0,
              balance = ?,
              paid_at = NULL,
              updated_at = ?
            WHERE id = ?
          `).run(bill.total, now(), deduction.bill_id);
        }
      }

      // 3. Update Order status to cancelled
      if (deduction.order_id) {
        db.prepare(`
          UPDATE orders SET
            status = 'cancelled',
            cancelled_at = ?,
            cancellation_reason = ?,
            completed_at = NULL,
            updated_at = ?
          WHERE id = ?
        `).run(now(), cleanReason, now(), deduction.order_id);

        // 4. Restore inventory for tracked items in order
        const orderItems = db.prepare(`
          SELECT oi.product_id, oi.quantity, p.track_inventory, p.name as product_name
          FROM order_items oi
          JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = ? AND oi.status != 'cancelled'
        `).all(deduction.order_id) as any[];

        for (const item of orderItems) {
          if (item.track_inventory === 1) {
            const stockResult = executeStockMovement(db, {
              productId: item.product_id,
              movementType: 'void',
              quantityChange: item.quantity,
              referenceType: 'salary_deduction_cancellation',
              referenceId: deduction.id,
              notes: `Stock restored upon cancellation of salary deduction ${deduction.deduction_number}`,
              createdBy: req.user!.id,
            });

            if (!stockResult.success) {
              throw new Error(`Failed to restore stock for product ${item.product_name}: ${stockResult.error}`);
            }
          }
        }
      }

      const updated = db.prepare(`
        SELECT sd.*, c.name as member_name, c.member_no, c.employee_id, u.name as cancelled_by_name
        FROM salary_deductions sd
        LEFT JOIN customers c ON sd.member_id = c.id
        LEFT JOIN users u ON sd.cancelled_by = u.id
        WHERE sd.id = ?
      `).get(req.params.id);

      return { success: true, deduction: updated };
    });

    const result = cancelTx();
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error });
    }

    res.json({
      message: 'Salary deduction cancelled and inventory restored successfully',
      deduction: result.deduction,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const salaryDeductionRoutes = router;
