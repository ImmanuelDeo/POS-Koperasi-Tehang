import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, now } from '../db';
import {
  parseIntegerRupiah,
  calculatePayrollPeriod,
  getMemberMonthlyUsage,
  getMemberOutstandingExposure,
} from '../services/cooperative';
import { normalizeNik, validateNik, maskNik } from '../services/privacy';
import { createAuditLog } from '../services/audit';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// ── GET /api/members/lookup ───────────────────────────────────────────────────
// Fast lookup endpoint for POS Cashier and HR (MUST be registered before /:id)
// Strictly returns NIK masked for cashier and general views.

router.get('/lookup', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { q } = req.query;
    const db = getDatabase();
    const periodMonth = calculatePayrollPeriod(db);

    let rows: any[];
    if (!q || String(q).trim().length === 0) {
      rows = db.prepare(`
        SELECT
          id, nik, member_no, employee_id, name, department, phone,
          is_active, is_member, salary_deduction_enabled,
          monthly_deduction_limit, outstanding_deduction_limit
        FROM customers
        ORDER BY is_active DESC, is_member DESC, name ASC
        LIMIT 30
      `).all() as any[];
    } else {
      const rawQ = String(q).trim();
      const normalizedQ = normalizeNik(rawQ);
      const searchPattern = `%${rawQ}%`;
      const nikPattern = normalizedQ ? `%${normalizedQ}%` : searchPattern;

      rows = db.prepare(`
        SELECT
          id, nik, member_no, employee_id, name, department, phone,
          is_active, is_member, salary_deduction_enabled,
          monthly_deduction_limit, outstanding_deduction_limit
        FROM customers
        WHERE name LIKE ? OR member_no LIKE ? OR employee_id LIKE ? OR phone LIKE ? OR (nik IS NOT NULL AND nik LIKE ?)
        ORDER BY is_active DESC, is_member DESC, name ASC
        LIMIT 30
      `).all(searchPattern, searchPattern, searchPattern, searchPattern, nikPattern) as any[];
    }

    const userRole = req.user?.role;
    const canViewFullNik = userRole === 'owner' || userRole === 'office_hr';

    const sanitizedMembers = rows.map((member) => {
      const monthlyLimit = member.monthly_deduction_limit ?? 0;
      const outstandingLimit = member.outstanding_deduction_limit ?? 0;

      const monthlyUsage = getMemberMonthlyUsage(db, member.id, periodMonth);
      const currentOutstanding = getMemberOutstandingExposure(db, member.id);

      const remainingMonthly = Math.max(0, monthlyLimit - monthlyUsage);
      const remainingOutstanding = Math.max(0, outstandingLimit - currentOutstanding);

      const masked = maskNik(member.nik);

      return {
        id: member.id,
        nik: canViewFullNik ? (member.nik || masked) : masked,
        nik_masked: masked,
        has_nik: Boolean(member.nik && String(member.nik).trim().length > 0),
        member_no: member.member_no || (member.is_member ? 'MBR-' + String(member.id).slice(-4) : '-'),
        employee_id: member.employee_id || '-',
        name: member.name,
        department: member.department || 'Umum',
        phone: member.phone || '',
        is_active: member.is_active ?? 1,
        is_member: member.is_member ?? 1,
        salary_deduction_enabled: member.salary_deduction_enabled ?? 1,
        monthly_deduction_limit: monthlyLimit,
        outstanding_deduction_limit: outstandingLimit,
        current_monthly_usage: monthlyUsage,
        current_outstanding: currentOutstanding,
        remaining_monthly_limit: remainingMonthly,
        remaining_outstanding_limit: remainingOutstanding,
      };
    });

    res.json({ members: sanitizedMembers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/members ──────────────────────────────────────────────────────────
// Full member directory for Office HR and Admin (Masked projections)

router.get('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const { q, department, is_active, salary_deduction_enabled, page = '1', per_page = '50' } = req.query;

    let query = 'SELECT * FROM customers WHERE is_member = 1';
    const params: any[] = [];

    if (q && String(q).trim().length > 0) {
      const rawQ = String(q).trim();
      const normalizedQ = normalizeNik(rawQ);
      const term = `%${rawQ}%`;
      const nikTerm = normalizedQ ? `%${normalizedQ}%` : term;

      query += ' AND (name LIKE ? OR member_no LIKE ? OR employee_id LIKE ? OR phone LIKE ? OR email LIKE ? OR (nik IS NOT NULL AND nik LIKE ?))';
      params.push(term, term, term, term, term, nikTerm);
    }

    if (department) {
      query += ' AND department = ?';
      params.push(department);
    }

    if (is_active !== undefined) {
      query += ' AND is_active = ?';
      params.push(is_active === '1' || is_active === 'true' ? 1 : 0);
    }

    if (salary_deduction_enabled !== undefined) {
      query += ' AND salary_deduction_enabled = ?';
      params.push(salary_deduction_enabled === '1' || salary_deduction_enabled === 'true' ? 1 : 0);
    }

    // Count total
    const countSql = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const totalCount = (db.prepare(countSql).get(...params) as any)?.total || 0;

    query += ' ORDER BY name ASC';

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(per_page), 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    query += ` LIMIT ${limitNum} OFFSET ${offset}`;

    const members = db.prepare(query).all(...params) as any[];
    const periodMonth = calculatePayrollPeriod(db);

    const userRole = req.user?.role;
    const canViewFullNik = userRole === 'owner' || userRole === 'office_hr';

    const enrichedMembers = members.map((member) => {
      const monthlyUsage = getMemberMonthlyUsage(db, member.id, periodMonth);
      const currentOutstanding = getMemberOutstandingExposure(db, member.id);
      const monthlyLimit = member.monthly_deduction_limit ?? 0;
      const outstandingLimit = member.outstanding_deduction_limit ?? 0;
      const masked = maskNik(member.nik);

      return {
        ...member,
        nik: canViewFullNik ? (member.nik || masked) : masked,
        nik_masked: masked,
        has_nik: Boolean(member.nik && String(member.nik).trim().length > 0),
        current_monthly_usage: monthlyUsage,
        current_outstanding: currentOutstanding,
        remaining_monthly_limit: Math.max(0, monthlyLimit - monthlyUsage),
        remaining_outstanding_limit: Math.max(0, outstandingLimit - currentOutstanding),
      };
    });

    res.json({
      members: enrichedMembers,
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

// ── GET /api/members/:id ──────────────────────────────────────────────────────
// Detail endpoint. Full NIK only exposed to Owner and Office HR (Logged in Audit Log).

router.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const member = db.prepare('SELECT * FROM customers WHERE id = ? AND is_member = 1').get(req.params.id) as any;

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const periodMonth = calculatePayrollPeriod(db);
    const monthlyUsage = getMemberMonthlyUsage(db, member.id, periodMonth);
    const currentOutstanding = getMemberOutstandingExposure(db, member.id);
    const monthlyLimit = member.monthly_deduction_limit ?? 0;
    const outstandingLimit = member.outstanding_deduction_limit ?? 0;

    const userRole = req.user?.role;
    const canViewFullNik = userRole === 'owner' || userRole === 'office_hr';
    const masked = maskNik(member.nik);

    if (canViewFullNik && member.nik) {
      createAuditLog(db, {
        actor_user_id: req.user?.id,
        actor_role: req.user?.role,
        action: 'member.nik.viewed_full',
        target_type: 'member',
        target_id: member.id,
        details: { member_id: member.id, member_no: member.member_no, nik_masked: masked },
        ip_address: req.ip || null,
      });
    }

    res.json({
      member: {
        ...member,
        nik: canViewFullNik ? member.nik : masked,
        nik_masked: masked,
        has_nik: Boolean(member.nik && String(member.nik).trim().length > 0),
        current_monthly_usage: monthlyUsage,
        current_outstanding: currentOutstanding,
        remaining_monthly_limit: Math.max(0, monthlyLimit - monthlyUsage),
        remaining_outstanding_limit: Math.max(0, outstandingLimit - currentOutstanding),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/members ─────────────────────────────────────────────────────────
// Create new member with mandatory 16-digit NIK

router.post('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      nik,
      name,
      member_no,
      employee_id,
      department,
      phone,
      email,
      address,
      salary_deduction_enabled,
      monthly_deduction_limit,
      outstanding_deduction_limit,
      notes,
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(422).json({ error: 'Nama anggota wajib diisi' });
    }

    // 1. Validate NIK (Mandatory for new members)
    const nikCheck = validateNik(nik, true);
    if (!nikCheck.valid) {
      return res.status(422).json({ error: nikCheck.error });
    }
    const cleanNik = nikCheck.normalized;

    const cleanMemberNo = member_no && typeof member_no === 'string' && member_no.trim().length > 0 ? member_no.trim() : null;
    const cleanEmployeeId = employee_id && typeof employee_id === 'string' && employee_id.trim().length > 0 ? employee_id.trim() : null;

    let parsedMonthlyLimit = 0;
    if (monthly_deduction_limit !== undefined && monthly_deduction_limit !== null) {
      const parsed = parseIntegerRupiah(monthly_deduction_limit, 'Limit potongan gaji bulanan', true);
      if (!parsed.valid) return res.status(422).json({ error: parsed.error });
      parsedMonthlyLimit = parsed.value!;
    }

    let parsedOutstandingLimit = 0;
    if (outstanding_deduction_limit !== undefined && outstanding_deduction_limit !== null) {
      const parsed = parseIntegerRupiah(outstanding_deduction_limit, 'Limit outstanding berjalan', true);
      if (!parsed.valid) return res.status(422).json({ error: parsed.error });
      parsedOutstandingLimit = parsed.value!;
    }

    const db = getDatabase();

    // 2. Check duplicate NIK (Safe error without leaking other member identity)
    if (cleanNik) {
      const existingNik = db.prepare('SELECT id FROM customers WHERE nik = ?').get(cleanNik) as any;
      if (existingNik) {
        return res.status(409).json({ error: 'NIK sudah terdaftar pada sistem koperasi' });
      }
    }

    // Check unique constraints for member_no and employee_id
    if (cleanMemberNo) {
      const existingNo = db.prepare('SELECT id, name FROM customers WHERE member_no = ?').get(cleanMemberNo) as any;
      if (existingNo) {
        return res.status(409).json({ error: `Nomor anggota '${cleanMemberNo}' sudah digunakan` });
      }
    }

    if (cleanEmployeeId) {
      const existingEmp = db.prepare('SELECT id, name FROM customers WHERE employee_id = ?').get(cleanEmployeeId) as any;
      if (existingEmp) {
        return res.status(409).json({ error: `NIK Karyawan (Employee ID) '${cleanEmployeeId}' sudah digunakan` });
      }
    }

    const id = uuidv4();
    const deductionEnabled = salary_deduction_enabled === false || salary_deduction_enabled === 0 || salary_deduction_enabled === '0' ? 0 : 1;

    db.prepare(`
      INSERT INTO customers (
        id, nik, name, phone, email, address, notes,
        is_member, member_no, employee_id, department,
        salary_deduction_enabled, monthly_deduction_limit, outstanding_deduction_limit,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      cleanNik,
      name.trim(),
      phone ? String(phone).trim() : null,
      email ? String(email).trim() : null,
      address ? String(address).trim() : null,
      notes ? String(notes).trim() : null,
      cleanMemberNo,
      cleanEmployeeId,
      department ? String(department).trim() : null,
      deductionEnabled,
      parsedMonthlyLimit,
      parsedOutstandingLimit,
      now(),
      now()
    );

    // Audit logs (No raw NIK stored)
    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'member.created',
      target_type: 'member',
      target_id: id,
      details: { member_id: id, member_no: cleanMemberNo, name: name.trim(), nik_masked: maskNik(cleanNik) },
      ip_address: req.ip || null,
    });

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'member.nik.created',
      target_type: 'member',
      target_id: id,
      details: { member_id: id, nik_masked: maskNik(cleanNik) },
      ip_address: req.ip || null,
    });

    const created = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any;
    res.status(201).json({
      member: {
        ...created,
        nik: maskNik(created.nik),
        nik_masked: maskNik(created.nik),
        has_nik: true,
      },
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Terjadi konflik data unik (NIK, No. Anggota, atau Employee ID sudah digunakan)' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ── PUT /api/members/:id ──────────────────────────────────────────────────────
// Update member data. Legacy members without NIK can be updated with or without NIK.

router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      nik,
      name,
      member_no,
      employee_id,
      department,
      phone,
      email,
      address,
      salary_deduction_enabled,
      monthly_deduction_limit,
      outstanding_deduction_limit,
      is_active,
      notes,
    } = req.body;

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM customers WHERE id = ? AND is_member = 1').get(req.params.id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Member not found' });
    }

    let cleanNik = existing.nik;
    let nikChanged = false;

    if (nik !== undefined && nik !== null && String(nik).trim().length > 0) {
      const nikCheck = validateNik(nik, true);
      if (!nikCheck.valid) {
        return res.status(422).json({ error: nikCheck.error });
      }
      cleanNik = nikCheck.normalized;

      if (cleanNik !== existing.nik) {
        const dupNik = db.prepare('SELECT id FROM customers WHERE nik = ? AND id != ?').get(cleanNik, req.params.id) as any;
        if (dupNik) {
          return res.status(409).json({ error: 'NIK sudah terdaftar pada sistem koperasi' });
        }
        nikChanged = true;
      }
    }

    const cleanMemberNo = member_no !== undefined
      ? (typeof member_no === 'string' && member_no.trim().length > 0 ? member_no.trim() : null)
      : existing.member_no;

    const cleanEmployeeId = employee_id !== undefined
      ? (typeof employee_id === 'string' && employee_id.trim().length > 0 ? employee_id.trim() : null)
      : existing.employee_id;

    if (cleanMemberNo && cleanMemberNo !== existing.member_no) {
      const dup = db.prepare('SELECT id, name FROM customers WHERE member_no = ? AND id != ?').get(cleanMemberNo, req.params.id) as any;
      if (dup) {
        return res.status(409).json({ error: `Nomor anggota '${cleanMemberNo}' sudah digunakan` });
      }
    }

    if (cleanEmployeeId && cleanEmployeeId !== existing.employee_id) {
      const dup = db.prepare('SELECT id, name FROM customers WHERE employee_id = ? AND id != ?').get(cleanEmployeeId, req.params.id) as any;
      if (dup) {
        return res.status(409).json({ error: `NIK Karyawan '${cleanEmployeeId}' sudah digunakan` });
      }
    }

    let parsedMonthlyLimit = existing.monthly_deduction_limit;
    if (monthly_deduction_limit !== undefined && monthly_deduction_limit !== null) {
      const parsed = parseIntegerRupiah(monthly_deduction_limit, 'Limit potongan gaji bulanan', true);
      if (!parsed.valid) return res.status(422).json({ error: parsed.error });
      parsedMonthlyLimit = parsed.value!;
    }

    let parsedOutstandingLimit = existing.outstanding_deduction_limit;
    if (outstanding_deduction_limit !== undefined && outstanding_deduction_limit !== null) {
      const parsed = parseIntegerRupiah(outstanding_deduction_limit, 'Limit outstanding berjalan', true);
      if (!parsed.valid) return res.status(422).json({ error: parsed.error });
      parsedOutstandingLimit = parsed.value!;
    }

    const deductionEnabled = salary_deduction_enabled !== undefined
      ? (salary_deduction_enabled === false || salary_deduction_enabled === 0 || salary_deduction_enabled === '0' ? 0 : 1)
      : existing.salary_deduction_enabled;

    const activeStatus = is_active !== undefined
      ? (is_active === false || is_active === 0 || is_active === '0' ? 0 : 1)
      : existing.is_active;

    db.prepare(`
      UPDATE customers SET
        nik = ?,
        name = COALESCE(?, name),
        member_no = ?,
        employee_id = ?,
        department = COALESCE(?, department),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        notes = COALESCE(?, notes),
        salary_deduction_enabled = ?,
        monthly_deduction_limit = ?,
        outstanding_deduction_limit = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      cleanNik,
      name !== undefined ? name.trim() : null,
      cleanMemberNo,
      cleanEmployeeId,
      department !== undefined ? department?.trim() || null : null,
      phone !== undefined ? phone?.trim() || null : null,
      email !== undefined ? email?.trim() || null : null,
      address !== undefined ? address?.trim() || null : null,
      notes !== undefined ? notes?.trim() || null : null,
      deductionEnabled,
      parsedMonthlyLimit,
      parsedOutstandingLimit,
      activeStatus,
      now(),
      req.params.id
    );

    // Audit logs
    if (nikChanged) {
      createAuditLog(db, {
        actor_user_id: req.user?.id,
        actor_role: req.user?.role,
        action: 'member.nik.updated',
        target_type: 'member',
        target_id: req.params.id,
        details: { member_id: req.params.id, nik_masked: maskNik(cleanNik) },
        ip_address: req.ip || null,
      });
    }

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'member.updated',
      target_type: 'member',
      target_id: req.params.id,
      details: { member_id: req.params.id, name: name !== undefined ? name.trim() : existing.name },
      ip_address: req.ip || null,
    });

    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) as any;
    res.json({
      member: {
        ...updated,
        nik: maskNik(updated.nik),
        nik_masked: maskNik(updated.nik),
        has_nik: Boolean(updated.nik && String(updated.nik).trim().length > 0),
      },
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Terjadi konflik data unik (NIK, No. Anggota, atau Employee ID sudah digunakan)' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ── PATCH /api/members/:id/limit ──────────────────────────────────────────────
// Specific endpoint to adjust member limits (Office HR / Owner only)

router.patch('/:id/limit', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { monthly_deduction_limit, outstanding_deduction_limit, salary_deduction_enabled } = req.body;

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM customers WHERE id = ? AND is_member = 1').get(req.params.id) as any;
    if (!existing) {
      return res.status(404).json({ error: 'Member not found' });
    }

    let parsedMonthlyLimit = existing.monthly_deduction_limit;
    if (monthly_deduction_limit !== undefined && monthly_deduction_limit !== null) {
      const parsed = parseIntegerRupiah(monthly_deduction_limit, 'Limit potongan gaji bulanan', true);
      if (!parsed.valid) return res.status(422).json({ error: parsed.error });
      parsedMonthlyLimit = parsed.value!;
    }

    let parsedOutstandingLimit = existing.outstanding_deduction_limit;
    if (outstanding_deduction_limit !== undefined && outstanding_deduction_limit !== null) {
      const parsed = parseIntegerRupiah(outstanding_deduction_limit, 'Limit outstanding berjalan', true);
      if (!parsed.valid) return res.status(422).json({ error: parsed.error });
      parsedOutstandingLimit = parsed.value!;
    }

    const deductionEnabled = salary_deduction_enabled !== undefined
      ? (salary_deduction_enabled === false || salary_deduction_enabled === 0 || salary_deduction_enabled === '0' ? 0 : 1)
      : existing.salary_deduction_enabled;

    db.prepare(`
      UPDATE customers SET
        salary_deduction_enabled = ?,
        monthly_deduction_limit = ?,
        outstanding_deduction_limit = ?,
        updated_at = ?
      WHERE id = ?
    `).run(deductionEnabled, parsedMonthlyLimit, parsedOutstandingLimit, now(), req.params.id);

    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    res.json({ member: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const memberRoutes = router;
