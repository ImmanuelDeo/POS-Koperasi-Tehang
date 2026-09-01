import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { normalizeNik, maskNik } from '../services/privacy';
import { createAuditLog } from '../services/audit';
import {
  calculatePayrollPeriod,
  getMemberMonthlyUsage,
  getMemberTotalAccumulatedUsage,
  getMemberOutstandingExposure,
} from '../services/cooperative';

const router = Router();

function getWalletBalance(customerId: string | number): number {
  const db = getDatabase();
  const credits = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger
    WHERE customer_id = ? AND type = 'credit' AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).get(customerId) as { total: number };

  const debits = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM loyalty_ledger
    WHERE customer_id = ? AND type = 'debit'
  `).get(customerId) as { total: number };

  return Math.max(0, credits.total - debits.total);
}

function formatCustomerResponse(c: any, userRole?: string) {
  if (!c) return null;
  const db = getDatabase();
  const periodMonth = calculatePayrollPeriod(db);

  const monthlyLimit = Number(c.monthly_deduction_limit ?? 0);
  const outstandingLimit = Number(c.outstanding_deduction_limit ?? 0);
  const monthlyUsage = getMemberMonthlyUsage(db, c.id, periodMonth);
  const totalAccumulated = getMemberTotalAccumulatedUsage(db, c.id);
  const currentOutstanding = getMemberOutstandingExposure(db, c.id);

  const remainingMonthly = monthlyLimit > 0 ? Math.max(0, monthlyLimit - monthlyUsage) : 999999999;
  const remainingOutstanding = outstandingLimit > 0 ? Math.max(0, outstandingLimit - currentOutstanding) : 999999999;

  const masked = maskNik(c.nik);
  const canViewFullNik = userRole === 'owner' || userRole === 'office_hr' || userRole === 'admin';

  return {
    ...c,
    nik: canViewFullNik ? (c.nik || null) : masked,
    nik_masked: masked,
    has_nik: Boolean(c.nik && String(c.nik).trim().length > 0),
    is_member: c.is_member !== undefined ? (c.is_member === 1 ? 1 : 0) : 1,
    salary_deduction_enabled: c.salary_deduction_enabled !== undefined ? (c.salary_deduction_enabled === 1 ? 1 : 0) : 1,
    monthly_deduction_limit: monthlyLimit,
    outstanding_deduction_limit: outstandingLimit,
    current_monthly_usage: monthlyUsage,
    total_accumulated_deductions: totalAccumulated,
    current_outstanding: currentOutstanding,
    remaining_monthly_limit: remainingMonthly,
    remaining_outstanding_limit: remainingOutstanding,
    is_active: c.is_active !== 0 && (c.is_active as any) !== false ? 1 : 0,
    member_no: c.member_no || ('MBR-' + String(c.id).slice(-4)),
    employee_id: c.employee_id || '-',
    department: c.department || 'Umum',
  };
}

// Cleanup endpoint: delete all customers with null IDs - must be before /:id
router.delete('/admin/cleanup', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const result = db.prepare("DELETE FROM customers WHERE id IS NULL").run();
    res.json({ message: `Deleted ${result.changes} customers with null IDs` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    let query = 'SELECT c.*, COALESCE((SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id), 0) as visits_count, COALESCE((SELECT SUM(total) FROM orders o WHERE o.customer_id = c.id), 0) as total_spent FROM customers c WHERE 1=1';
    const params: any[] = [];

    if (req.query.include_inactive !== 'true' && req.query.include_archived !== 'true') {
      query += ' AND (c.is_active IS NULL OR c.is_active = 1)';
    }

    if (req.query.search) {
      const rawSearch = String(req.query.search).trim();
      const normalizedNikSearch = normalizeNik(rawSearch);
      const searchPattern = `%${rawSearch}%`;
      const nikPattern = normalizedNikSearch ? `%${normalizedNikSearch}%` : searchPattern;

      query += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.member_no LIKE ? OR c.employee_id LIKE ? OR (c.nik IS NOT NULL AND c.nik LIKE ?))';
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, nikPattern);

      query += ` ORDER BY
        CASE
          WHEN LOWER(TRIM(c.name)) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(c.nik, ''))) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(c.member_no, ''))) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(c.employee_id, ''))) = LOWER(TRIM(?)) THEN 0
          WHEN LOWER(c.name) LIKE LOWER(? || '%') OR LOWER(COALESCE(c.member_no, '')) LIKE LOWER(? || '%') OR LOWER(COALESCE(c.employee_id, '')) LIKE LOWER(? || '%') THEN 1
          WHEN LOWER(c.name) LIKE '%' || LOWER(?) || '%' THEN 2
          ELSE 3
        END,
        c.name ASC`;
      params.push(rawSearch, rawSearch, rawSearch, rawSearch, rawSearch, rawSearch, rawSearch, rawSearch);
    } else {
      query += ' ORDER BY c.name ASC';
    }

    if (req.query.per_page) {
      query += ` LIMIT ${parseInt(req.query.per_page as string)}`;
    }

    const userRole = (req as any).user?.role;
    const customers = db.prepare(query).all(...params) as any[];
    res.json({ data: customers.map((c) => formatCustomerResponse(c, userRole)) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/search', (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q || String(q).trim().length < 1) {
      return res.status(400).json({ error: 'Search query must not be empty' });
    }

    const db = getDatabase();
    const rawQ = String(q).trim();
    const normalizedNikQ = normalizeNik(rawQ);
    const searchTerm = `%${rawQ}%`;
    const nikTerm = normalizedNikQ ? `%${normalizedNikQ}%` : searchTerm;

    const customers = db.prepare(`
      SELECT * FROM customers
      WHERE (is_active IS NULL OR is_active = 1)
        AND (phone LIKE ? OR name LIKE ? OR email LIKE ? OR member_no LIKE ? OR employee_id LIKE ? OR (nik IS NOT NULL AND nik LIKE ?))
      ORDER BY
        CASE
          WHEN LOWER(TRIM(name)) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(nik, ''))) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(member_no, ''))) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(employee_id, ''))) = LOWER(TRIM(?)) THEN 0
          WHEN LOWER(name) LIKE LOWER(? || '%') OR LOWER(COALESCE(member_no, '')) LIKE LOWER(? || '%') OR LOWER(COALESCE(employee_id, '')) LIKE LOWER(? || '%') THEN 1
          WHEN LOWER(name) LIKE '%' || LOWER(?) || '%' THEN 2
          ELSE 3
        END,
        name ASC
      LIMIT 30
    `).all(
      searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, nikTerm,
      rawQ, rawQ, rawQ, rawQ,
      rawQ, rawQ, rawQ,
      rawQ
    ) as any[];

    const userRole = (req as any).user?.role;
    res.json({ customers: customers.map((c) => formatCustomerResponse(c, userRole)) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as any;
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const walletBalance = getWalletBalance(req.params.id);
    const loyaltyHistory = db.prepare(`
      SELECT * FROM loyalty_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(req.params.id);

    const recentOrders = db.prepare(`
      SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(req.params.id);

    const userRole = (req as any).user?.role;
    res.json({ customer: { ...formatCustomerResponse(customer, userRole), walletBalance, loyaltyHistory, recentOrders } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/wallet', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const customerId = req.params.id;
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const balance = getWalletBalance(customerId);
    const transactions = db.prepare(`
      SELECT * FROM loyalty_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(req.params.id);

    res.json({ balance, transactions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const {
      phone, name, email, address, notes, nik, member_no, employee_id, department,
      is_member, salary_deduction_enabled, monthly_deduction_limit, outstanding_deduction_limit
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const db = getDatabase();

    if (phone) {
      const existing = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      if (existing) {
        return res.status(400).json({ message: 'Customer with this phone already exists' });
      }
    }

    const cleanNik = nik ? normalizeNik(nik) : null;
    if (cleanNik) {
      const existingNik = db.prepare('SELECT id, name FROM customers WHERE nik = ?').get(cleanNik) as any;
      if (existingNik) {
        return res.status(400).json({ message: `NIK '${cleanNik}' sudah terdaftar pada anggota ${existingNik.name}` });
      }
    }

    const id = 'cust-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    db.prepare(`
      INSERT INTO customers (
        id, phone, name, email, address, notes, nik, member_no, employee_id, department,
        is_member, is_active, salary_deduction_enabled, monthly_deduction_limit, outstanding_deduction_limit,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(
      id,
      phone ? String(phone).trim() : null,
      String(name).trim(),
      email ? String(email).trim() : null,
      address ? String(address).trim() : null,
      notes ? String(notes).trim() : null,
      cleanNik,
      member_no ? String(member_no).trim() : null,
      employee_id ? String(employee_id).trim() : null,
      department ? String(department).trim() : 'Umum',
      is_member !== undefined ? (is_member ? 1 : 0) : 1,
      salary_deduction_enabled !== undefined ? (salary_deduction_enabled ? 1 : 0) : 1,
      Number(monthly_deduction_limit) || 0,
      Number(outstanding_deduction_limit) || 0,
      now(),
      now()
    );

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    res.status(201).json({ customer: formatCustomerResponse(customer) });
  } catch (error: any) {
    console.error('[Customer POST error]', error);
    res.status(500).json({ message: 'Failed to create customer: ' + error.message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const {
      phone, name, email, address, notes, country_code, nik, member_no, employee_id, department,
      is_member, salary_deduction_enabled, monthly_deduction_limit, outstanding_deduction_limit
    } = req.body;
    const db = getDatabase();

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as any;
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    let cleanNik = customer.nik;
    if (nik !== undefined) {
      cleanNik = nik && String(nik).trim() ? normalizeNik(nik) : null;
      if (cleanNik && cleanNik !== customer.nik) {
        const existingNik = db.prepare('SELECT id, name FROM customers WHERE nik = ? AND id != ?').get(cleanNik, req.params.id) as any;
        if (existingNik) {
          return res.status(400).json({ error: `NIK '${cleanNik}' sudah digunakan oleh anggota lain: ${existingNik.name}` });
        }
      }
    }

    db.prepare(`
      UPDATE customers SET
        phone = COALESCE(NULLIF(?, ''), phone),
        name = COALESCE(NULLIF(?, ''), name),
        email = COALESCE(NULLIF(?, ''), email),
        country_code = COALESCE(NULLIF(?, ''), country_code),
        address = COALESCE(NULLIF(?, ''), address),
        notes = COALESCE(NULLIF(?, ''), notes),
        nik = ?,
        member_no = COALESCE(NULLIF(?, ''), member_no),
        employee_id = COALESCE(NULLIF(?, ''), employee_id),
        department = COALESCE(NULLIF(?, ''), department),
        is_member = COALESCE(?, is_member),
        salary_deduction_enabled = COALESCE(?, salary_deduction_enabled),
        monthly_deduction_limit = COALESCE(?, monthly_deduction_limit),
        outstanding_deduction_limit = COALESCE(?, outstanding_deduction_limit),
        updated_at = ?
      WHERE id = ?
    `).run(
      phone, name, email, country_code, address, notes,
      cleanNik,
      member_no, employee_id, department,
      is_member !== undefined ? (is_member ? 1 : 0) : undefined,
      salary_deduction_enabled !== undefined ? (salary_deduction_enabled ? 1 : 0) : undefined,
      monthly_deduction_limit !== undefined ? Number(monthly_deduction_limit) : undefined,
      outstanding_deduction_limit !== undefined ? Number(outstanding_deduction_limit) : undefined,
      now(),
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    res.json({ customer: formatCustomerResponse(updated) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as any;
    if (!customer) {
      return res.status(404).json({ error: 'Customer / Member not found' });
    }

    const orderCount = (db.prepare('SELECT COUNT(*) as count FROM orders WHERE customer_id = ?').get(req.params.id) as any)?.count || 0;
    const deductionCount = (db.prepare('SELECT COUNT(*) as count FROM salary_deductions WHERE member_id = ?').get(req.params.id) as any)?.count || 0;

    const userRole = (req as any).user?.role;
    const userId = (req as any).user?.id;

    if (orderCount === 0 && deductionCount === 0) {
      db.prepare('DELETE FROM loyalty_ledger WHERE customer_id = ?').run(req.params.id);
      db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);

      createAuditLog(db, {
        actor_user_id: userId,
        actor_role: userRole,
        action: 'member.deleted',
        target_type: 'member',
        target_id: String(req.params.id),
        details: { name: customer.name, member_no: customer.member_no, mode: 'hard_delete' },
        ip_address: req.ip || null,
      });

      return res.json({ success: true, message: `Member ${customer.name} berhasil dihapus permanen` });
    }

    // Has transactions: archive/deactivate to preserve financial audit trail
    db.prepare(`
      UPDATE customers SET
        is_active = 0,
        salary_deduction_enabled = 0,
        updated_at = ?
      WHERE id = ?
    `).run(now(), req.params.id);

    createAuditLog(db, {
      actor_user_id: userId,
      actor_role: userRole,
      action: 'member.archived',
      target_type: 'member',
      target_id: String(req.params.id),
      details: { name: customer.name, member_no: customer.member_no, orders: orderCount, deductions: deductionCount, mode: 'soft_delete' },
      ip_address: req.ip || null,
    });

    return res.json({
      success: true,
      message: `Member ${customer.name} dinonaktifkan (arsip) karena memiliki ${orderCount} transaksi & ${deductionCount} bon tercatat.`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const customerRoutes = router;
