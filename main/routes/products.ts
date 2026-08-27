import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, now } from '../db';
import { parseRupiahNumber } from '../services/cooperative';

const router = Router();

/**
 * Normalizes product record for API responses, ensuring:
 * 1. tags is always parsed into an array (never returning raw JSON string)
 * 2. prices are clean integer/numbers
 * 3. category and addon groups relations are populated safely
 */
export function formatProductResponse(product: any, db: any, catMap?: Map<string, any>) {
  if (!product) return null;
  let parsedTags: string[] = [];
  if (product.tags) {
    if (Array.isArray(product.tags)) {
      parsedTags = product.tags;
    } else if (typeof product.tags === 'string') {
      try {
        const parsed = JSON.parse(product.tags);
        parsedTags = Array.isArray(parsed) ? parsed : [];
      } catch {
        parsedTags = [];
      }
    }
  }

  const category = product.category_id
    ? (catMap ? catMap.get(product.category_id) || null : db.prepare('SELECT * FROM categories WHERE id = ?').get(product.category_id))
    : null;

  return {
    ...product,
    cost_price: product.cost !== undefined ? product.cost : product.cost_price,
    price: Math.round(Number(product.price) || 0),
    member_price: product.member_price != null ? Math.round(Number(product.member_price)) : null,
    tags: parsedTags,
    category,
    addon_groups: [],
  };
}

export interface CursorPayload {
  sort: string;
  lastName: string;
  lastId: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursorStr: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.lastName === 'string' && typeof parsed.lastId === 'string') {
      return {
        sort: parsed.sort || 'name',
        lastName: parsed.lastName,
        lastId: parsed.lastId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── GET /api/products (Keyset Cursor Pagination) ─────────────────────────────
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 100);
    const cursorParam = req.query.cursor as string | undefined;
    const includeTotal = req.query.include_total === 'true' || !cursorParam;

    let query = 'SELECT * FROM products WHERE deleted_at IS NULL';
    const params: any[] = [];

    if (req.query.category_id) {
      query += ' AND category_id = ?';
      params.push(req.query.category_id);
    }
    if (req.query.active === 'true' || req.query.active === '1') {
      query += ' AND is_active = 1';
    }
    if (req.query.low_stock === 'true') {
      query += ' AND track_inventory = 1 AND stock_quantity <= low_stock_threshold';
    }

    // Keyset pagination cursor based on (name ASC, id ASC)
    if (cursorParam) {
      const decoded = decodeCursor(cursorParam);
      if (decoded) {
        query += ' AND (name > ? OR (name = ? AND id > ?))';
        params.push(decoded.lastName, decoded.lastName, decoded.lastId);
      }
    }

    query += ' ORDER BY name ASC, id ASC LIMIT ?';
    params.push(limit + 1);

    const categories = db.prepare('SELECT * FROM categories').all();
    const catMap = new Map<string, any>(categories.map((c: any) => [c.id, c]));

    const rawRows = db.prepare(query).all(...params) as any[];
    const hasMore = rawRows.length > limit;
    const items = hasMore ? rawRows.slice(0, limit) : rawRows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor({
        sort: 'name',
        lastName: lastItem.name,
        lastId: lastItem.id,
      });
    }

    let totalCount: number | undefined = undefined;
    if (includeTotal) {
      let countQuery = 'SELECT COUNT(*) as count FROM products WHERE deleted_at IS NULL';
      const countParams: any[] = [];
      if (req.query.category_id) {
        countQuery += ' AND category_id = ?';
        countParams.push(req.query.category_id);
      }
      if (req.query.active === 'true' || req.query.active === '1') {
        countQuery += ' AND is_active = 1';
        countParams.push(1);
      }
      if (req.query.low_stock === 'true') {
        countQuery += ' AND track_inventory = 1 AND stock_quantity <= low_stock_threshold';
      }
      const countRow = db.prepare(countQuery).get(...countParams) as { count: number };
      totalCount = countRow?.count || 0;
    }

    const productsWithRelations = items.map((product: any) => formatProductResponse(product, db, catMap));

    res.json({
      products: productsWithRelations,
      next_cursor: nextCursor,
      has_more: hasMore,
      total_count: totalCount,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/products/search (Server-Side Debounced Search) ────────────────────
router.get('/search', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
    const activeOnly = req.query.active !== 'false' && req.query.active !== '0';
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 30, 1), 50);

    let query = `
      SELECT id, category_id, name, description, unit, allow_decimal, price, member_price,
             cost, sku, barcode, is_active, stock_quantity, low_stock_threshold,
             track_inventory, image_url, tags, updated_at
      FROM products
      WHERE deleted_at IS NULL
    `;
    const params: any[] = [];

    if (activeOnly) {
      query += ' AND is_active = 1';
    }

    if (categoryId) {
      query += ' AND category_id = ?';
      params.push(categoryId);
    }

    if (q) {
      const cleanQ = q.trim();
      const words = cleanQ.split(/\s+/).filter(Boolean);

      if (words.length <= 1) {
        query += ' AND (barcode = ? OR sku = ? OR name LIKE ? OR description LIKE ?)';
        params.push(cleanQ, cleanQ, `%${cleanQ}%`, `%${cleanQ}%`);
      } else {
        // Multi-word keyword search: all keywords must match in the product fields
        // Example: "paseo aloe" matches "PASEO BOX ALOE VERA 100'S"
        // Example: "indomie goreng" matches "INDOMIE MI INSTAN GORENG SPESIAL"
        const wordClauses = words.map(() => '(name LIKE ? OR description LIKE ? OR sku LIKE ? OR barcode LIKE ?)').join(' AND ');
        query += ` AND (barcode = ? OR sku = ? OR (${wordClauses}))`;
        params.push(cleanQ, cleanQ);
        for (const w of words) {
          params.push(`%${w}%`, `%${w}%`, `%${w}%`, `%${w}%`);
        }
      }
    }

    query += ' ORDER BY name ASC, id ASC LIMIT ?';
    params.push(limit);

    const categories = db.prepare('SELECT * FROM categories').all();
    const catMap = new Map<string, any>(categories.map((c: any) => [c.id, c]));

    const products = db.prepare(query).all(...params) as any[];
    const formatted = products.map((p) => formatProductResponse(p, db, catMap));

    res.json({
      products: formatted,
      count: formatted.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/products/stock-snapshot ─────────────────────────────────────────
// Returns live stock numbers for specific IDs without transferring entire catalog
router.post('/stock-snapshot', (req: Request, res: Response) => {
  try {
    const { product_ids } = req.body;
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      return res.json({ stocks: [] });
    }

    const cleanIds = product_ids.slice(0, 500).map(String);
    const db = getDatabase();

    const placeholders = cleanIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, name, barcode, sku, price, member_price, stock_quantity, track_inventory, is_active
      FROM products
      WHERE id IN (${placeholders}) AND deleted_at IS NULL
    `).all(...cleanIds) as any[];

    res.json({ stocks: rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/products/lookup-barcode ─────────────────────────────────────────
// Exact-match barcode lookup for POS Scanner and Stock Flow (registered before /:id)
router.get('/lookup-barcode', (req: Request, res: Response) => {
  try {
    const { code } = req.query;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Parameter barcode "code" wajib diisi' });
    }

    const cleanCode = code.trim();
    if (cleanCode.length < 1 || cleanCode.length > 128) {
      return res.status(400).json({ error: 'Panjang barcode tidak valid (1 - 128 karakter)' });
    }

    if (/[\x00-\x1F\x7F]/.test(cleanCode)) {
      return res.status(400).json({ error: 'Barcode memuat karakter kontrol tidak valid' });
    }

    const db = getDatabase();

    // 1. Exact match on barcode prioritized
    let matchingProducts = db.prepare(`
      SELECT * FROM products
      WHERE deleted_at IS NULL AND barcode = ?
    `).all(cleanCode) as any[];

    // 2. Fallback to SKU exact match if not matched by barcode
    if (matchingProducts.length === 0) {
      matchingProducts = db.prepare(`
        SELECT * FROM products
        WHERE deleted_at IS NULL AND sku = ?
      `).all(cleanCode) as any[];
    }

    if (matchingProducts.length === 0) {
      return res.status(404).json({ error: 'Produk belum terdaftar' });
    }

    if (matchingProducts.length > 1) {
      return res.status(409).json({ error: 'Barcode/SKU ambigu atau duplikat. Hubungi admin.' });
    }

    const product = matchingProducts[0];

    if (product.is_active === 0) {
      return res.status(422).json({ error: 'Produk tidak aktif', product: formatProductResponse(product, db) });
    }

    res.json({ product: formatProductResponse(product, db) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ product: formatProductResponse(product, db) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const {
      category_id, name, sku, barcode, description, price, cost_price,
      tax_type, tax_rate, track_inventory, stock_quantity,
      low_stock_threshold, is_active, image_url, sort_order, cb_percent, tags, addon_group_ids,
      unit, allow_decimal, member_price, min_reorder_qty
    } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    const db = getDatabase();

    const parsedPrice = parseRupiahNumber(price);
    if (parsedPrice === null) {
      return res.status(400).json({ error: 'Harga produk harus berupa nominal yang valid' });
    }

    const parsedCostPrice = parseRupiahNumber(cost_price) || 0;

    let cleanBarcode: string | null = null;
    if (barcode !== undefined && barcode !== null) {
      const str = String(barcode).trim();
      if (str.length > 0) {
        if (str.length > 128 || /[\x00-\x1F\x7F]/.test(str)) {
          return res.status(422).json({ error: 'Format barcode tidak valid (maksimal 128 karakter, tanpa karakter kontrol)' });
        }
        const existing = db.prepare('SELECT id FROM products WHERE barcode = ? AND deleted_at IS NULL').get(str) as any;
        if (existing) {
          return res.status(409).json({ error: 'Barcode sudah digunakan oleh produk lain.' });
        }
        cleanBarcode = str;
      }
    }

    const id = uuidv4();

    let parsedMemberPrice: number | null = null;
    if (member_price !== undefined && member_price !== null && member_price !== '') {
      parsedMemberPrice = parseRupiahNumber(member_price);
    }

    const parsedMinReorderQty = min_reorder_qty !== undefined && !isNaN(Number(min_reorder_qty))
      ? Math.max(0, Number(min_reorder_qty))
      : 0;

    const parsedTags = Array.isArray(tags) ? tags : typeof tags === 'string' ? [tags] : [];

    const result = db.prepare(`
      INSERT INTO products (id, category_id, name, sku, barcode, description, price, cost,
        tax_type, tax_rate, track_inventory, stock_quantity, low_stock_threshold,
        is_active, image_url, sort_order, cb_percent, tags,
        unit, allow_decimal, member_price, min_reorder_qty,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, category_id || null, name, sku || null, cleanBarcode, description || null, parsedPrice, parsedCostPrice,
      'none', 0,
      track_inventory ? 1 : 0, stock_quantity || 0, low_stock_threshold || 0,
      is_active !== false ? 1 : 0, image_url || null,
      sort_order || 0, cb_percent || 0, JSON.stringify(parsedTags),
      unit ? String(unit).trim() : 'pcs',
      allow_decimal ? 1 : 0,
      parsedMemberPrice,
      parsedMinReorderQty,
      now(), now()
    );

    if (addon_group_ids && addon_group_ids.length > 0) {
      const insertAgp = db.prepare('INSERT INTO addon_group_product (addon_group_id, product_id) VALUES (?, ?)');
      for (const agId of addon_group_ids) {
        insertAgp.run(agId, id);
      }
    }

    // Auto-record initial stock movement in ledger for full auditability
    if (track_inventory && Number(stock_quantity) > 0) {
      const initQty = Math.max(0, Math.round(Number(stock_quantity)));
      db.prepare(`
        INSERT INTO stock_movements (
          product_id, movement_type, quantity,
          balance_before, balance_after, unit_cost,
          reference_type, reference_id, notes,
          created_by, created_at
        ) VALUES (?, 'in', ?, 0, ?, ?, 'initial_stock', ?, ?, ?, ?)
      `).run(
        id,
        initQty,
        initQty,
        parsedCostPrice,
        `INIT-${id.slice(0, 8)}`,
        'Stok Awal Produk Baru (Manual Input)',
        (req as any).user?.id || 'system',
        now()
      );
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.status(201).json({ product: formatProductResponse(product, db) });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Barcode sudah digunakan oleh produk lain.' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as any;
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const {
      category_id, name, sku, barcode, description, price, cost_price,
      tax_type, tax_rate, track_inventory, stock_quantity,
      low_stock_threshold, is_active, image_url, sort_order, cb_percent, tags, addon_group_ids,
      unit, allow_decimal, member_price, min_reorder_qty
    } = req.body;

    let cleanBarcode = product.barcode;
    if (barcode !== undefined) {
      if (barcode === null || String(barcode).trim().length === 0) {
        cleanBarcode = null;
      } else {
        const str = String(barcode).trim();
        if (str.length > 128 || /[\x00-\x1F\x7F]/.test(str)) {
          return res.status(422).json({ error: 'Format barcode tidak valid (maksimal 128 karakter, tanpa karakter kontrol)' });
        }
        if (str !== product.barcode) {
          const existing = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ? AND deleted_at IS NULL').get(str, req.params.id) as any;
          if (existing) {
            return res.status(409).json({ error: 'Barcode sudah digunakan oleh produk lain.' });
          }
        }
        cleanBarcode = str;
      }
    }

    let parsedPrice = product.price;
    if (price !== undefined) {
      const p = parseRupiahNumber(price);
      if (p !== null) parsedPrice = p;
    }

    let parsedCostPrice = product.cost;
    if (cost_price !== undefined) {
      parsedCostPrice = parseRupiahNumber(cost_price);
    }

    let parsedMemberPrice = product.member_price;
    if (member_price !== undefined) {
      if (member_price === null || member_price === '') {
        parsedMemberPrice = null;
      } else {
        parsedMemberPrice = parseRupiahNumber(member_price);
      }
    }

    let parsedMinReorderQty = product.min_reorder_qty;
    if (min_reorder_qty !== undefined) {
      const parsed = Number(min_reorder_qty);
      if (!isNaN(parsed) && parsed >= 0) parsedMinReorderQty = parsed;
    }

    let parsedTagsJson = undefined;
    if (tags !== undefined) {
      const tagArr = Array.isArray(tags) ? tags : typeof tags === 'string' ? [tags] : [];
      parsedTagsJson = JSON.stringify(tagArr);
    }

    // Auto-record stock movement if stock quantity changed during edit
    if (track_inventory && stock_quantity !== undefined && stock_quantity !== null) {
      const newStock = Math.max(0, Math.round(Number(stock_quantity)));
      const oldStock = Math.max(0, Math.round(Number(product.stock_quantity || 0)));
      const diff = newStock - oldStock;
      if (diff !== 0) {
        db.prepare(`
          INSERT INTO stock_movements (
            product_id, movement_type, quantity,
            balance_before, balance_after, unit_cost,
            reference_type, reference_id, notes,
            created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'manual_adjustment', ?, ?, ?, ?)
        `).run(
          req.params.id,
          diff > 0 ? 'in' : 'out',
          Math.abs(diff),
          oldStock,
          newStock,
          parsedCostPrice || 0,
          `ADJ-${Date.now()}`,
          diff > 0 ? `Penambahan stok manual (+${diff})` : `Pengurangan stok manual (${diff})`,
          (req as any).user?.id || 'system',
          now()
        );
      }
    }

    db.prepare(`
      UPDATE products SET category_id = COALESCE(?, category_id), name = COALESCE(?, name),
        sku = COALESCE(?, sku), barcode = ?, description = COALESCE(?, description), price = COALESCE(?, price),
        cost = COALESCE(?, cost),
        tax_type = 'none', tax_rate = 0,
        track_inventory = COALESCE(?, track_inventory),
        stock_quantity = COALESCE(?, stock_quantity), low_stock_threshold = COALESCE(?, low_stock_threshold),
        is_active = COALESCE(?, is_active),
        image_url = COALESCE(?, image_url),
        sort_order = COALESCE(?, sort_order),
        cb_percent = COALESCE(?, cb_percent),
        tags = COALESCE(?, tags),
        unit = COALESCE(?, unit),
        allow_decimal = COALESCE(?, allow_decimal),
        member_price = ?,
        min_reorder_qty = COALESCE(?, min_reorder_qty),
        updated_at = ?
      WHERE id = ?
    `).run(
      category_id, name, sku, cleanBarcode, description, parsedPrice, parsedCostPrice,
      track_inventory !== undefined ? (track_inventory ? 1 : 0) : null,
      stock_quantity, low_stock_threshold,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      image_url, sort_order, cb_percent,
      parsedTagsJson !== undefined ? parsedTagsJson : null,
      unit, allow_decimal !== undefined ? (allow_decimal ? 1 : 0) : null,
      parsedMemberPrice,
      parsedMinReorderQty,
      now(),
      req.params.id
    );

    if (addon_group_ids && Array.isArray(addon_group_ids)) {
      db.prepare('DELETE FROM addon_group_product WHERE product_id = ?').run(req.params.id);
      const insertAgp = db.prepare('INSERT INTO addon_group_product (addon_group_id, product_id) VALUES (?, ?)');
      for (const agId of addon_group_ids) {
        insertAgp.run(agId, req.params.id);
      }
    }

    const updatedProduct = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json({ product: formatProductResponse(updatedProduct, db) });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Barcode sudah digunakan oleh produk lain.' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    db.prepare('UPDATE products SET deleted_at = ? WHERE id = ?').run(now(), req.params.id);
    res.json({ message: 'Product deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/stock', (req: Request, res: Response) => {
  try {
    const { action, quantity } = req.body;

    if (!action || quantity === undefined) {
      return res.status(400).json({ error: 'Action and quantity are required' });
    }

    if (!['set', 'increase', 'decrease'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use: set, increase, decrease' });
    }

    const db = getDatabase();
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    let newQuantity = 0;
    switch (action) {
      case 'set':
        newQuantity = quantity;
        break;
      case 'increase':
        newQuantity = (product as any).stock_quantity + quantity;
        break;
      case 'decrease':
        newQuantity = (product as any).stock_quantity - quantity;
        if (newQuantity < 0) {
          return res.status(400).json({ error: 'Insufficient stock' });
        }
        break;
    }

    db.prepare('UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?').run(newQuantity, now(), req.params.id);
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json({ product: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const productRoutes = router;