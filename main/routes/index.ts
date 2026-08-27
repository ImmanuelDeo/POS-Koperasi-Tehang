import { Express } from 'express';
import { authRoutes } from './auth';
import { categoryRoutes } from './categories';
import { productRoutes } from './products';
import { addonGroupRoutes } from './addon-groups';
import { orderRoutes } from './orders';
import { orderItemRoutes } from './order-items';
import { billRoutes } from './bills';
import { tableRoutes } from './tables';
import { kitchenStationRoutes } from './kitchen-stations';
import { kitchenRoutes } from './kitchen';
import { customerRoutes } from './customers';
import { memberRoutes } from './members';
import { stockMovementRoutes } from './stock-movements';
import { salaryDeductionRoutes } from './salary-deductions';
import { staffRoutes } from './staff';
import { settingsRoutes } from './settings';
import { reportRoutes } from './reports';
import { dashboardRoutes } from './dashboard';
import { kdsRoutes } from './kds';
import { kdsInfoRoutes } from './kds-info';
import { printerRoutes } from './printers';
import { databaseRoutes } from './database';
import { catalogCsvRoutes } from './catalog-csv';
import { memberCsvRoutes } from './member-csv';
import { getDatabase, now, parseItemJson } from '../db';
import { authenticateToken, requireRole, requireMethodRoles, AuthenticatedRequest } from '../middleware/auth';

export function registerRoutes(app: Express): void {
  // ── Public Auth routes (with internal public/protected routing) ───────────
  app.use('/api/auth', authRoutes);

  // ── POS Koperasi: Catalog CSV Import & Template ───────────────────────────
  app.use(
    '/api/catalog-csv',
    authenticateToken,
    requireRole(['owner', 'admin', 'office_inventory']),
    catalogCsvRoutes
  );

  // ── POS Koperasi: Member / Customer CSV Import & Template ─────────────────
  app.use(
    '/api/members-csv',
    authenticateToken,
    requireRole(['owner', 'admin', 'office_hr', 'cashier']),
    memberCsvRoutes
  );
  app.use(
    '/api/customers-csv',
    authenticateToken,
    requireRole(['owner', 'admin', 'office_hr', 'cashier']),
    memberCsvRoutes
  );

  // ── Resource routes (Strictly Authenticated & Role Protected) ─────────────
  app.use(
    '/api/categories',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin', 'cashier', 'office_inventory'],
      POST: ['owner', 'admin', 'office_inventory'],
      PUT: ['owner', 'admin', 'office_inventory'],
      DELETE: ['owner', 'admin', 'office_inventory'],
    }),
    categoryRoutes
  );

  app.use(
    '/api/products',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin', 'cashier', 'office_inventory'],
      POST: ['owner', 'admin', 'office_inventory'],
      PUT: ['owner', 'admin', 'office_inventory'],
      DELETE: ['owner', 'admin', 'office_inventory'],
    }),
    productRoutes
  );

  app.use(
    '/api/addon-groups',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin', 'cashier', 'office_inventory'],
      POST: ['owner', 'admin', 'office_inventory'],
      PUT: ['owner', 'admin', 'office_inventory'],
      DELETE: ['owner', 'admin', 'office_inventory'],
    }),
    addonGroupRoutes
  );

  // ── POS Koperasi: Stock Movements & Inventory Ledger ───────────────────────
  app.use(
    '/api/stock-movements',
    authenticateToken,
    requireRole(['owner', 'admin', 'office_inventory']),
    stockMovementRoutes
  );

  // ── POS Koperasi: Salary Deductions Management ─────────────────────────────
  app.use(
    '/api/salary-deductions',
    authenticateToken,
    (req: AuthenticatedRequest, res, next) => {
      const user = req.user!;
      if (user.role === 'owner') return next();

      const effectiveRoles = [user.role];
      if (user.role === 'manager') effectiveRoles.push('admin');
      if (user.role === 'waiter') effectiveRoles.push('cashier');

      const isAdmin = effectiveRoles.includes('admin');
      const isHR = effectiveRoles.includes('office_hr');
      const isCashier = effectiveRoles.includes('cashier');

      // GET: Admin and Office HR can list deductions
      if (req.method === 'GET') {
        if (isAdmin || isHR) return next();
        return res.status(403).json({ error: `Forbidden: Role '${user.role}' cannot view salary deductions list` });
      }

      // POST: Confirm and Reject (Office HR only); Cancel (Cashier and Admin)
      if (req.method === 'POST') {
        if (req.path.endsWith('/confirm') || req.path.endsWith('/reject')) {
          if (isHR) return next();
          return res.status(403).json({ error: `Forbidden: Only Office HR or Owner can confirm or reject salary deductions` });
        }

        if (req.path.endsWith('/cancel')) {
          if (isAdmin || isCashier) return next();
          return res.status(403).json({ error: `Forbidden: Role '${user.role}' cannot cancel salary deductions` });
        }
      }

      return res.status(403).json({ error: `Forbidden: Role '${user.role}' is not authorized for salary deductions` });
    },
    salaryDeductionRoutes
  );

  app.use(
    '/api/orders',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin', 'cashier', 'office_hr'],
      POST: ['owner', 'admin', 'cashier'],
      PUT: ['owner', 'admin', 'cashier'],
      PATCH: ['owner', 'admin', 'cashier'],
      DELETE: ['owner'],
    }),
    orderRoutes
  );

  app.use('/api/order-items', authenticateToken, requireRole(['owner', 'admin', 'cashier']), orderItemRoutes);
  app.use('/api/kitchen', authenticateToken, requireRole(['owner', 'admin', 'chef']), kitchenRoutes);

  app.use(
    '/api/bills',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin', 'cashier', 'office_hr'],
      POST: ['owner', 'admin', 'cashier'],
      PUT: ['owner', 'admin', 'cashier'],
      PATCH: ['owner', 'admin', 'cashier'],
      DELETE: ['owner', 'admin', 'cashier'],
    }),
    billRoutes
  );

  app.use('/api/tables', authenticateToken, requireRole(['owner', 'admin', 'cashier']), tableRoutes);
  app.use('/api/kitchen-stations', authenticateToken, requireRole(['owner', 'admin']), kitchenStationRoutes);

  app.use(
    '/api/customers',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin', 'office_hr', 'cashier'],
      POST: ['owner', 'admin', 'office_hr', 'cashier'],
      PUT: ['owner', 'admin', 'office_hr', 'cashier'],
      PATCH: ['owner', 'admin', 'office_hr', 'cashier'],
      DELETE: ['owner', 'admin', 'office_hr', 'cashier'],
    }),
    customerRoutes
  );

  // ── POS Koperasi: Members Directory & Cashier Lookup ───────────────────────
  app.use(
    '/api/members',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin', 'office_hr', 'cashier'],
      POST: ['owner', 'admin', 'office_hr', 'cashier'],
      PUT: ['owner', 'admin', 'office_hr', 'cashier'],
      PATCH: ['owner', 'admin', 'office_hr', 'cashier'],
      DELETE: ['owner', 'admin', 'office_hr', 'cashier'],
    }),
    memberRoutes
  );

  // Dual-mounted users / staff management
  app.use(
    '/api/staff',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin'],
      POST: ['owner', 'admin'],
      PUT: ['owner', 'admin'],
      DELETE: ['owner'],
    }),
    staffRoutes
  );

  app.use(
    '/api/users',
    authenticateToken,
    requireMethodRoles({
      GET: ['owner', 'admin'],
      POST: ['owner', 'admin'],
      PUT: ['owner', 'admin'],
      DELETE: ['owner'],
    }),
    staffRoutes
  );

  // Settings are restricted to owner and admin only
  app.use(
    '/api/settings',
    authenticateToken,
    requireRole(['owner', 'admin']),
    settingsRoutes
  );

  app.use('/api/reports', authenticateToken, requireRole(['owner', 'admin', 'cashier']), reportRoutes);
  app.use(
    '/api/dashboard',
    authenticateToken,
    requireRole(['owner', 'admin', 'office_hr', 'manager', 'cashier']),
    dashboardRoutes
  );
  app.use('/api/kds', authenticateToken, requireRole(['owner', 'admin', 'chef']), kdsRoutes);
  app.use('/api/kds-info', authenticateToken, requireRole(['owner', 'admin', 'chef']), kdsInfoRoutes);

  // Printer routes: owner, admin, manager, and cashier have full printer settings & print access
  app.use(
    '/api/printers',
    authenticateToken,
    requireRole(['owner', 'admin', 'manager', 'cashier', 'waiter']),
    printerRoutes
  );

  // Database backups, exports & maintenance are STRICTLY owner-only
  app.use('/api/db', authenticateToken, requireRole(['owner']), databaseRoutes);

  // Tax preview
  app.post('/api/tax/preview', authenticateToken, requireRole(['owner', 'admin', 'cashier']), async (req, res) => {
    const { calculateTaxPreview } = await import('../services/tax');
    calculateTaxPreview(req, res);
  });

  // Mobile pairing code
  app.get('/api/mobile/pairing-code', authenticateToken, requireRole(['owner', 'admin']), (_req, res) => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.json({
      pairing_code: today,
      rotated_at: new Date().toISOString(),
    });
  });

  // Customer search endpoint
  app.get('/api/customers-search', authenticateToken, requireRole(['owner', 'admin', 'office_hr', 'cashier']), (req, res) => {
    try {
      const { q } = req.query;
      if (!q || String(q).length < 2) {
        return res.json([]);
      }

      const db = getDatabase();
      const searchTerm = `%${q}%`;

      const customers = db.prepare(`
        SELECT * FROM customers
        WHERE phone LIKE ? OR name LIKE ? OR email LIKE ?
        ORDER BY name LIMIT 20
      `).all(searchTerm, searchTerm, searchTerm);

      res.json(customers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // CRM lookup endpoint
  app.get('/api/crm/lookup', authenticateToken, requireRole(['owner', 'admin', 'office_hr', 'cashier']), (req, res) => {
    try {
      const { phone } = req.query;
      if (!phone) {
        return res.status(400).json({ error: 'Phone number required' });
      }

      const db = getDatabase();
      const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);

      if (customer) {
        res.json({ found: true, customer });
      } else {
        res.json({ found: false, customer: null });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel order item
  app.patch('/api/orders/:orderId/items/:itemId/cancel', authenticateToken, requireRole(['owner', 'admin', 'cashier']), (req: AuthenticatedRequest, res) => {
    try {
      const { orderId, itemId } = req.params;
      const db = getDatabase();
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId) as any;
      if (!item) {
        return res.status(404).json({ error: 'Item not found in this order' });
      }

      // Soft delete - mark as cancelled
      db.prepare("UPDATE order_items SET status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(now(), itemId);

      // Recalculate order totals excluding cancelled items
      const activeItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'")
        .all(orderId) as any[];
      let subtotal = 0;
      let totalTax = 0;
      for (const i of activeItems) {
        subtotal += i.subtotal || 0;
        totalTax += i.tax_amount || 0;
      }
      const preRoundTotal = subtotal + totalTax + (order.packaging_charge || 0);
      const roundOff = Math.round(preRoundTotal) - preRoundTotal;
      const total = Math.round(preRoundTotal) + roundOff;

      db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, totalTax, total, roundOff, now(), orderId);

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(parseItemJson);

      res.json({ order: { ...updatedOrder, items } });
    } catch (error: any) {
      console.error('[Orders] Cancel item error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Restore cancelled order item
  app.patch('/api/orders/:orderId/items/:itemId/restore', authenticateToken, requireRole(['owner', 'admin', 'cashier']), (req: AuthenticatedRequest, res) => {
    try {
      const { orderId, itemId } = req.params;
      const db = getDatabase();
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(itemId, orderId) as any;
      if (!item) {
        return res.status(404).json({ error: 'Item not found in this order' });
      }

      // Restore - mark as pending
      db.prepare("UPDATE order_items SET status = 'pending', updated_at = ? WHERE id = ?")
        .run(now(), itemId);

      // Recalculate order totals
      const activeItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'")
        .all(orderId) as any[];
      let subtotal = 0;
      let totalTax = 0;
      for (const i of activeItems) {
        subtotal += i.subtotal || 0;
        totalTax += i.tax_amount || 0;
      }
      const preRoundTotal = subtotal + totalTax + (order.packaging_charge || 0);
      const roundOff = Math.round(preRoundTotal) - preRoundTotal;
      const total = Math.round(preRoundTotal) + roundOff;

      db.prepare(`
        UPDATE orders SET subtotal = ?, tax_amount = ?, total = ?, round_off = ?, updated_at = ? WHERE id = ?
      `).run(subtotal, totalTax, total, roundOff, now(), orderId);

      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as any;
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).map(parseItemJson);

      res.json({ order: { ...updatedOrder, items } });
    } catch (error: any) {
      console.error('[Orders] Restore item error:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

