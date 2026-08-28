/**
 * /api/staff  — Staff and User Account Management with Granular Section Access Grants.
 * All user records live in the `users` table.
 * Roles: owner | admin | manager | cashier | office_hr | office_inventory | waiter | chef
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, now } from '../db';
import { AuthenticatedRequest } from '../middleware/auth';
import { createAuditLog } from '../services/audit';

const router = Router();

export const ALL_AVAILABLE_PERMISSIONS = [
  'pos',
  'dashboard',
  'orders',
  'products',
  'addon_groups',
  'customers',
  'stock_movements',
  'salary_deductions',
  'reports',
  'whatsapp',
  'staff',
  'settings',
  'db_backup',
];

export function getDefaultPermissionsForRole(role: string): string[] {
  switch (role) {
    case 'owner':
      return [...ALL_AVAILABLE_PERMISSIONS];
    case 'admin':
    case 'manager':
      return ['pos', 'dashboard', 'orders', 'products', 'addon_groups', 'customers', 'reports', 'whatsapp', 'staff', 'salary_deductions', 'stock_movements'];
    case 'office_hr':
      return ['dashboard', 'customers', 'salary_deductions', 'reports'];
    case 'office_inventory':
      return ['products', 'stock_movements', 'reports'];
    case 'cashier':
    case 'waiter':
      return ['pos', 'orders', 'customers'];
    case 'chef':
      return ['pos', 'orders'];
    default:
      return ['pos'];
  }
}

function parseUserPermissions(permissionsRaw: any): string[] {
  if (Array.isArray(permissionsRaw)) return permissionsRaw;
  if (!permissionsRaw || typeof permissionsRaw !== 'string') return [];
  try {
    const parsed = JSON.parse(permissionsRaw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── List Staff ────────────────────────────────────────────────────────────────

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    let query = 'SELECT id, name, email, role, pin, permissions, is_active, created_at, updated_at FROM users WHERE 1=1';
    const params: any[] = [];

    if (req.query.role) {
      query += ' AND role = ?';
      params.push(req.query.role);
    }
    if (req.query.active === 'true') {
      query += ' AND is_active = 1';
    }
    if (req.query.active === 'false') {
      query += ' AND is_active = 0';
    }

    query += " ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3 ELSE 4 END, name";

    const rawStaff = db.prepare(query).all(...params) as any[];
    const staff = rawStaff.map((u) => ({
      ...u,
      pin_hash: u.pin,
      permissions: parseUserPermissions(u.permissions),
    }));

    res.json({ staff });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Get One Staff ─────────────────────────────────────────────────────────────

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const member = db.prepare(
      'SELECT id, name, email, role, pin, permissions, is_active, created_at, updated_at FROM users WHERE id = ?'
    ).get(req.params.id) as any;

    if (!member) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    const performance = db.prepare(`
      SELECT COUNT(*) as orders_served, COALESCE(SUM(total), 0) as total_sales
      FROM orders
      WHERE user_id = ? AND date(created_at) = date('now')
    `).get(req.params.id);

    res.json({
      staff: {
        ...member,
        permissions: parseUserPermissions(member.permissions),
        performance,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Create Staff ──────────────────────────────────────────────────────────────

router.post('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, password, role, pin, permissions } = req.body;

    if (!name || !password || !role) {
      return res.status(400).json({ error: 'name, password, and role are required' });
    }

    const validRoles = ['owner', 'admin', 'cashier', 'office_inventory', 'office_hr', 'manager', 'waiter', 'chef'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
    }

    const currentUser = req.user;
    if (role === 'owner' && currentUser && currentUser.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can create owner accounts' });
    }

    const db = getDatabase();

    if (email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, 10);

    const userPermissions = Array.isArray(permissions) && permissions.length > 0
      ? (role === 'owner' ? ALL_AVAILABLE_PERMISSIONS : permissions)
      : getDefaultPermissionsForRole(role);

    db.prepare(`
      INSERT INTO users (id, name, email, password, role, permissions, pin, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      name,
      email || null,
      hashedPassword,
      role,
      JSON.stringify(userPermissions),
      pin || null,
      now(),
      now()
    );

    createAuditLog(db, {
      actor_user_id: currentUser?.id,
      actor_role: currentUser?.role,
      action: 'staff.created',
      target_type: 'user',
      target_id: id,
      details: {
        name,
        role,
        permissions_count: userPermissions.length,
      },
    });

    const member = db.prepare(
      'SELECT id, name, email, role, pin, permissions, is_active, created_at, updated_at FROM users WHERE id = ?'
    ).get(id) as any;

    res.status(201).json({
      staff: {
        ...member,
        permissions: parseUserPermissions(member.permissions),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Update Staff & Access Grants ──────────────────────────────────────────────

router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, email, password, role, pin, permissions, is_active } = req.body;
    const db = getDatabase();

    const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!member) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    const currentUser = req.user;
    if (member.role === 'owner' && currentUser && currentUser.role !== 'owner' && currentUser.id !== member.id) {
      return res.status(403).json({ error: 'Only owners can modify owner accounts' });
    }

    if (role) {
      const validRoles = ['owner', 'admin', 'cashier', 'office_inventory', 'office_hr', 'manager', 'waiter', 'chef'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      }
      if (role === 'owner' && currentUser && currentUser.role !== 'owner') {
        return res.status(403).json({ error: 'Only owners can assign the owner role' });
      }
    }

    if (email && email !== member.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.params.id);
      if (existing) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    const hashedPassword = password ? bcrypt.hashSync(password, 10) : member.password;

    let updatedPermissionsJson = member.permissions;
    if (Array.isArray(permissions)) {
      const effectiveRole = role || member.role;
      const finalPerms = effectiveRole === 'owner' ? ALL_AVAILABLE_PERMISSIONS : permissions;
      updatedPermissionsJson = JSON.stringify(finalPerms);
    } else if (role && role !== member.role && (!permissions || permissions.length === 0)) {
      // Role changed without explicit permissions: use default permissions for new role
      updatedPermissionsJson = JSON.stringify(getDefaultPermissionsForRole(role));
    }

    db.prepare(`
      UPDATE users SET
        name        = COALESCE(?, name),
        email       = COALESCE(?, email),
        password    = ?,
        role        = COALESCE(?, role),
        permissions = ?,
        pin         = COALESCE(?, pin),
        is_active   = COALESCE(?, is_active),
        updated_at  = ?
      WHERE id = ?
    `).run(
      name || null,
      email || null,
      hashedPassword,
      role || null,
      updatedPermissionsJson,
      pin || null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      now(),
      req.params.id
    );

    createAuditLog(db, {
      actor_user_id: currentUser?.id,
      actor_role: currentUser?.role,
      action: 'staff.updated',
      target_type: 'user',
      target_id: req.params.id,
      details: {
        target_name: name || member.name,
        role: role || member.role,
        permissions_updated: Array.isArray(permissions),
      },
    });

    const updated = db.prepare(
      'SELECT id, name, email, role, pin, permissions, is_active, created_at, updated_at FROM users WHERE id = ?'
    ).get(req.params.id) as any;

    res.json({
      staff: {
        ...updated,
        permissions: parseUserPermissions(updated.permissions),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Delete Staff ──────────────────────────────────────────────────────────────

router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUser = req.user;
    if (currentUser && currentUser.role !== 'owner') {
      return res.status(403).json({ error: 'Only owners can delete user accounts' });
    }

    const db = getDatabase();
    const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!member) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    // Prevent deleting the last owner
    if (member.role === 'owner') {
      const ownerCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('owner') as any).c;
      if (ownerCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last owner account' });
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

    createAuditLog(db, {
      actor_user_id: currentUser?.id,
      actor_role: currentUser?.role,
      action: 'staff.deleted',
      target_type: 'user',
      target_id: req.params.id,
      details: { deleted_name: member.name, deleted_role: member.role },
    });

    res.json({ message: 'Staff member deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Activate / Deactivate ─────────────────────────────────────────────────────

router.post('/:id/deactivate', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!member) return res.status(404).json({ error: 'Staff member not found' });
    if (member.is_active === 0) return res.status(400).json({ error: 'Already deactivated' });

    db.prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), req.params.id);
    const updated = db.prepare(
      'SELECT id, name, email, role, pin, permissions, is_active, created_at, updated_at FROM users WHERE id = ?'
    ).get(req.params.id) as any;

    res.json({
      staff: {
        ...updated,
        permissions: parseUserPermissions(updated.permissions),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/reactivate', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!member) return res.status(404).json({ error: 'Staff member not found' });
    if (member.is_active === 1) return res.status(400).json({ error: 'Already active' });

    db.prepare('UPDATE users SET is_active = 1, updated_at = ? WHERE id = ?').run(now(), req.params.id);
    const updated = db.prepare(
      'SELECT id, name, email, role, pin, permissions, is_active, created_at, updated_at FROM users WHERE id = ?'
    ).get(req.params.id) as any;

    res.json({
      staff: {
        ...updated,
        permissions: parseUserPermissions(updated.permissions),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const staffRoutes = router;
