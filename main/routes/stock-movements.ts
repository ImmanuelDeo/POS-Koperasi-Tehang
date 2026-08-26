import { Router, Request, Response } from 'express';
import { getDatabase } from '../db';
import { executeStockMovement, executeBulkStockMovement, parseIntegerRupiah } from '../services/cooperative';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// ── GET /api/stock-movements ──────────────────────────────────────────────────
// Query immutable audit ledger of stock movements

router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { product_id, movement_type, from_date, to_date, page = '1', per_page = '50' } = req.query;

    let query = `
      SELECT
        sm.id, sm.product_id, sm.movement_type, sm.quantity,
        sm.balance_before, sm.balance_after, sm.unit_cost,
        sm.reference_type, sm.reference_id, sm.notes,
        sm.created_by, sm.created_at,
        p.name as product_name, p.barcode as product_barcode, p.unit as product_unit,
        u.name as created_by_name
      FROM stock_movements sm
      LEFT JOIN products p ON sm.product_id = p.id
      LEFT JOIN users u ON sm.created_by = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (product_id) {
      query += ' AND sm.product_id = ?';
      params.push(product_id);
    }

    if (movement_type) {
      query += ' AND sm.movement_type = ?';
      params.push(movement_type);
    }

    if (from_date) {
      query += ' AND sm.created_at >= ?';
      params.push(from_date);
    }

    if (to_date) {
      query += ' AND sm.created_at <= ?';
      params.push(to_date);
    }

    // Total count
    const countSql = `SELECT COUNT(*) as total FROM stock_movements sm WHERE 1=1` +
      (product_id ? ' AND sm.product_id = ?' : '') +
      (movement_type ? ' AND sm.movement_type = ?' : '') +
      (from_date ? ' AND sm.created_at >= ?' : '') +
      (to_date ? ' AND sm.created_at <= ?' : '');

    const totalCount = (db.prepare(countSql).get(...params) as any)?.total || 0;

    query += ' ORDER BY sm.created_at DESC';

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(per_page), 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    query += ` LIMIT ${limitNum} OFFSET ${offset}`;

    const movements = db.prepare(query).all(...params);

    res.json({
      movements,
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

// ── POST /api/stock-movements/restock ─────────────────────────────────────────
// Restock purchased goods (movement_type: 'purchase')

router.post('/restock', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { product_id, quantity, unit_cost, reference_id, notes } = req.body;

    if (!product_id) {
      return res.status(422).json({ error: 'product_id is required' });
    }

    const qtyNum = Number(quantity);
    if (isNaN(qtyNum) || !Number.isFinite(qtyNum) || qtyNum <= 0) {
      return res.status(422).json({ error: 'Restock quantity must be a positive number greater than 0' });
    }

    let parsedUnitCost = 0;
    if (unit_cost !== undefined && unit_cost !== null) {
      const parsed = parseIntegerRupiah(unit_cost, 'Unit cost', true);
      if (!parsed.valid) return res.status(422).json({ error: parsed.error });
      parsedUnitCost = parsed.value!;
    }

    const db = getDatabase();
    const product = db.prepare('SELECT id, name, track_inventory FROM products WHERE id = ?').get(product_id) as any;
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.track_inventory !== 1) {
      return res.status(422).json({ error: `Product '${product.name}' does not have inventory tracking enabled` });
    }

    // Execute atomic stock movement inside transaction
    const executeTx = db.transaction(() => {
      return executeStockMovement(db, {
        productId: product_id,
        movementType: 'purchase',
        quantityChange: qtyNum,
        unitCost: parsedUnitCost,
        referenceType: 'purchase_restock',
        referenceId: reference_id ? String(reference_id).slice(0, 100) : undefined,
        notes: notes ? String(notes).slice(0, 500) : undefined,
        createdBy: req.user!.id,
      });
    });

    const result = executeTx();
    if (!result.success) {
      return res.status(422).json({ error: result.error });
    }

    const updatedProduct = db.prepare('SELECT id, name, stock_quantity, track_inventory FROM products WHERE id = ?').get(product_id);
    res.status(201).json({
      message: 'Stock restocked successfully',
      movement: {
        product_id,
        movement_type: 'purchase',
        quantity: qtyNum,
        balance_before: result.balanceBefore,
        balance_after: result.balanceAfter,
      },
      product: updatedProduct,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/stock-movements/adjust ──────────────────────────────────────────
// Stock adjustment or opname reconciliation (movement_type: 'adjustment' | 'opname')

router.post('/adjust', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { product_id, quantity, movement_type = 'adjustment', reference_id, notes } = req.body;

    if (!product_id) {
      return res.status(422).json({ error: 'product_id is required' });
    }

    if (!['adjustment', 'opname'].includes(movement_type)) {
      return res.status(422).json({ error: "movement_type must be either 'adjustment' or 'opname'" });
    }

    const qtyNum = Number(quantity);
    if (isNaN(qtyNum) || !Number.isFinite(qtyNum) || qtyNum === 0) {
      return res.status(422).json({ error: 'Adjustment quantity must be a non-zero number (positive or negative change)' });
    }

    const db = getDatabase();
    const product = db.prepare('SELECT id, name, track_inventory FROM products WHERE id = ?').get(product_id) as any;
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (product.track_inventory !== 1) {
      return res.status(422).json({ error: `Product '${product.name}' does not have inventory tracking enabled` });
    }

    // Execute atomic adjustment inside transaction
    const executeTx = db.transaction(() => {
      return executeStockMovement(db, {
        productId: product_id,
        movementType: movement_type as 'adjustment' | 'opname',
        quantityChange: qtyNum,
        referenceType: `manual_${movement_type}`,
        referenceId: reference_id ? String(reference_id).slice(0, 100) : undefined,
        notes: notes ? String(notes).slice(0, 500) : undefined,
        createdBy: req.user!.id,
      });
    });

    const result = executeTx();
    if (!result.success) {
      return res.status(422).json({ error: result.error });
    }

    const updatedProduct = db.prepare('SELECT id, name, stock_quantity, track_inventory FROM products WHERE id = ?').get(product_id);
    res.status(201).json({
      message: `Stock ${movement_type} recorded successfully`,
      movement: {
        product_id,
        movement_type,
        quantity: qtyNum,
        balance_before: result.balanceBefore,
        balance_after: result.balanceAfter,
      },
      product: updatedProduct,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/stock-movements/bulk ───────────────────────────────────────────
// Process atomic batch of stock receiving, adjustment, or stock opname
router.post('/bulk', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const userId = req.user?.id || 'system';
    const userRole = req.user?.role || 'admin';

    const result = executeBulkStockMovement(db, req.body, userId, userRole);

    if (!result.success) {
      if (result.status_code === 409) {
        return res.status(409).json({
          error: result.error,
          conflict_item: result.conflict_item,
        });
      }
      return res.status(result.status_code || 422).json({
        error: result.error,
      });
    }

    return res.status(201).json({
      message: `Batch mutasi stok (${result.mode}) berhasil diproses`,
      batch_id: result.batch_id,
      mode: result.mode,
      batch_reference: result.batch_reference,
      total_items: result.total_items,
      total_quantity_in: result.total_quantity_in,
      total_quantity_out: result.total_quantity_out,
      updated_products: result.updated_products,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Gagal memproses batch mutasi stok.' });
  }
});

export const stockMovementRoutes = router;
