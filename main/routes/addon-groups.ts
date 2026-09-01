import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { randomUUID } from 'crypto';

const router = Router();

function formatRupiah(num: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);
}

function getGroupComponents(db: any, groupId: string) {
  return db.prepare(`
    SELECT a.*,
           p.name as product_name,
           p.barcode as product_barcode,
           p.sku as product_sku,
           p.price as product_unit_price,
           p.unit as product_unit,
           p.stock_quantity as product_stock_quantity,
           p.track_inventory as product_track_inventory,
           p.is_active as product_is_active
    FROM addons a
    LEFT JOIN products p ON a.product_id = p.id
    WHERE a.addon_group_id = ?
    ORDER BY a.sort_order, a.name
  `).all(groupId);
}

function computeGroupNormalPrice(addons: any[]): number {
  return addons.reduce((sum, item) => {
    const unitPrice = item.product_unit_price !== undefined && item.product_unit_price !== null
      ? Number(item.product_unit_price)
      : Number(item.price || 0);
    const qty = Number(item.quantity || 1);
    return sum + (unitPrice * qty);
  }, 0);
}

// ── GET /api/addon-groups/pos/active ──────────────────────────────────────────
// Returns active bundles configured for POS (show_in_pos = 1) and not expired
router.get('/pos/active', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const groups = db.prepare(`
      SELECT * FROM addon_groups
      WHERE show_in_pos = 1
        AND (is_active IS NULL OR is_active = 1)
        AND (is_forever = 1 OR promo_end_date IS NULL OR promo_end_date >= date('now', 'localtime'))
        AND (promo_start_date IS NULL OR promo_start_date <= date('now', 'localtime'))
      ORDER BY sort_order, name
    `).all();

    const groupsWithAddons = groups.map((group: any) => {
      const addons = getGroupComponents(db, group.id);
      const totalNormalPrice = computeGroupNormalPrice(addons);
      return {
        ...group,
        addons,
        total_normal_price: totalNormalPrice,
        is_bundle: true,
      };
    });

    res.json({ bundles: groupsWithAddons });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/addon-groups ───────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const groups = db.prepare('SELECT * FROM addon_groups ORDER BY sort_order, name').all();

    const groupsWithAddons = groups.map((group: any) => {
      const addons = getGroupComponents(db, group.id);
      const totalNormalPrice = computeGroupNormalPrice(addons);
      return {
        ...group,
        addons,
        total_normal_price: totalNormalPrice,
      };
    });

    res.json({ addon_groups: groupsWithAddons });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/addon-groups/:id ───────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Addon group not found' });
    }

    const addons = getGroupComponents(db, req.params.id);
    const totalNormalPrice = computeGroupNormalPrice(addons);
    res.json({
      addon_group: {
        ...group,
        addons,
        total_normal_price: totalNormalPrice,
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/addon-groups ──────────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const {
      name,
      category_name,
      description,
      promo_start_date,
      promo_end_date,
      is_forever,
      bundle_price,
      is_required,
      min_selection,
      max_selection,
      show_in_pos,
      sort_order,
      addons,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Nama paket / promo wajib diisi' });
    }

    const parsedBundlePrice = bundle_price !== undefined && bundle_price !== null && bundle_price !== ''
      ? Number(bundle_price)
      : null;

    if (parsedBundlePrice !== null && (isNaN(parsedBundlePrice) || parsedBundlePrice < 0)) {
      return res.status(400).json({ error: 'Harga paket harus berupa angka positif' });
    }

    const db = getDatabase();
    const groupId = randomUUID();
    db.prepare(`
      INSERT INTO addon_groups (
        id, name, category_name, description, promo_start_date, promo_end_date,
        is_forever, bundle_price, is_required, min_selection, max_selection, show_in_pos, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      groupId,
      name.trim(),
      category_name?.trim() || 'Paket Sembako',
      description?.trim() || null,
      promo_start_date || null,
      promo_end_date || null,
      is_forever !== undefined ? (is_forever ? 1 : 0) : 1,
      parsedBundlePrice,
      is_required ? 1 : 0,
      min_selection || 0,
      max_selection || 1,
      show_in_pos ? 1 : 0,
      sort_order || 0,
      now(),
      now()
    );

    // Insert addons if provided
    if (addons && Array.isArray(addons) && addons.length > 0) {
      const insertAddon = db.prepare(`
        INSERT INTO addons (id, addon_group_id, product_id, name, quantity, price, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      addons.forEach((addon: any, index: number) => {
        let pName = addon.name;
        if (addon.product_id) {
          const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(addon.product_id) as any;
          if (prod) pName = prod.name;
        }
        insertAddon.run(
          randomUUID(),
          groupId,
          addon.product_id || null,
          pName || 'Item Produk',
          Math.max(0.01, Number(addon.quantity) || 1),
          addon.price || 0,
          index,
          now(),
          now()
        );
      });
    }

    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(groupId);
    const groupAddons = getGroupComponents(db, groupId);
    const totalNormalPrice = computeGroupNormalPrice(groupAddons);

    let warning: string | undefined;
    if (parsedBundlePrice !== null && totalNormalPrice > 0 && parsedBundlePrice >= totalNormalPrice) {
      warning = `Harga paket (${formatRupiah(parsedBundlePrice)}) tidak lebih murah dari total harga normal produk komponen (${formatRupiah(totalNormalPrice)}).`;
    }

    res.status(201).json({
      addon_group: Object.assign({}, group, { addons: groupAddons, total_normal_price: totalNormalPrice }),
      warning,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── PUT /api/addon-groups/:id ───────────────────────────────────────────────
router.put('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Addon group not found' });
    }

    const {
      name,
      category_name,
      description,
      promo_start_date,
      promo_end_date,
      is_forever,
      bundle_price,
      is_required,
      min_selection,
      max_selection,
      show_in_pos,
      sort_order,
      is_active,
    } = req.body;

    const parsedBundlePrice = bundle_price !== undefined
      ? (bundle_price !== null && bundle_price !== '' ? Number(bundle_price) : null)
      : (group as any).bundle_price;

    if (parsedBundlePrice !== null && (isNaN(parsedBundlePrice) || parsedBundlePrice < 0)) {
      return res.status(400).json({ error: 'Harga paket harus berupa angka positif' });
    }

    db.prepare(`
      UPDATE addon_groups SET
        name = COALESCE(?, name),
        category_name = COALESCE(?, category_name),
        description = COALESCE(?, description),
        promo_start_date = ?,
        promo_end_date = ?,
        is_forever = COALESCE(?, is_forever),
        bundle_price = ?,
        is_required = COALESCE(?, is_required),
        min_selection = COALESCE(?, min_selection),
        max_selection = COALESCE(?, max_selection),
        show_in_pos = COALESCE(?, show_in_pos),
        sort_order = COALESCE(?, sort_order),
        is_active = COALESCE(?, is_active),
        updated_at = ?
      WHERE id = ?
    `).run(
      name !== undefined ? name.trim() : null,
      category_name !== undefined ? category_name.trim() : null,
      description !== undefined ? description.trim() : null,
      promo_start_date !== undefined ? promo_start_date : (group as any).promo_start_date,
      promo_end_date !== undefined ? promo_end_date : (group as any).promo_end_date,
      is_forever !== undefined ? (is_forever ? 1 : 0) : null,
      parsedBundlePrice,
      is_required !== undefined ? (is_required ? 1 : 0) : null,
      min_selection !== undefined ? min_selection : null,
      max_selection !== undefined ? max_selection : null,
      show_in_pos !== undefined ? (show_in_pos ? 1 : 0) : null,
      sort_order !== undefined ? sort_order : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      now(),
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
    const addons = getGroupComponents(db, req.params.id);
    const totalNormalPrice = computeGroupNormalPrice(addons);

    let warning: string | undefined;
    if (parsedBundlePrice !== null && totalNormalPrice > 0 && parsedBundlePrice >= totalNormalPrice) {
      warning = `Harga paket (${formatRupiah(parsedBundlePrice)}) tidak lebih murah dari total harga normal produk komponen (${formatRupiah(totalNormalPrice)}).`;
    }

    res.json({
      addon_group: Object.assign({}, updated, { addons, total_normal_price: totalNormalPrice }),
      warning,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── DELETE /api/addon-groups/:id ────────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.id);
    if (!group) {
      return res.status(404).json({ error: 'Addon group not found' });
    }

    db.prepare('DELETE FROM addons WHERE addon_group_id = ?').run(req.params.id);
    db.prepare('DELETE FROM addon_group_product WHERE addon_group_id = ?').run(req.params.id);
    db.prepare('DELETE FROM addon_groups WHERE id = ?').run(req.params.id);

    res.json({ message: 'Addon group deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/addon-groups/:groupId/addons ──────────────────────────────────
router.post('/:groupId/addons', (req: Request, res: Response) => {
  try {
    const { product_id, name, quantity, price, is_active, sort_order } = req.body;

    const db = getDatabase();
    const group = db.prepare('SELECT * FROM addon_groups WHERE id = ?').get(req.params.groupId);
    if (!group) {
      return res.status(404).json({ error: 'Addon group not found' });
    }

    let finalName = name;
    let prod: any = null;
    if (product_id) {
      prod = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(product_id);
      if (!prod) {
        return res.status(404).json({ error: 'Produk yang dipilih tidak ditemukan di database' });
      }
      finalName = prod.name;
    }

    if (!finalName || !finalName.trim()) {
      return res.status(400).json({ error: 'Nama produk isi paket wajib diisi' });
    }

    const safeQty = Math.max(0.01, Number(quantity) || 1);
    const safePrice = Number(price) || 0;
    const addonId = randomUUID();

    db.prepare(`
      INSERT INTO addons (id, addon_group_id, product_id, name, quantity, price, is_active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      addonId,
      req.params.groupId,
      product_id || null,
      finalName.trim(),
      safeQty,
      safePrice,
      is_active !== false ? 1 : 0,
      sort_order || 0,
      now(),
      now()
    );

    const addons = getGroupComponents(db, req.params.groupId);
    const totalNormalPrice = computeGroupNormalPrice(addons);
    const updatedAddon = addons.find((a: any) => a.id === addonId);

    res.status(201).json({ addon: updatedAddon, total_normal_price: totalNormalPrice });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── PUT /api/addon-groups/:groupId/addons/:addonId ──────────────────────────
router.put('/:groupId/addons/:addonId', (req: Request, res: Response) => {
  try {
    const { product_id, name, quantity, price, is_active, sort_order } = req.body;

    const db = getDatabase();
    const addon = db.prepare('SELECT * FROM addons WHERE id = ? AND addon_group_id = ?').get(req.params.addonId, req.params.groupId);
    if (!addon) {
      return res.status(404).json({ error: 'Addon not found' });
    }

    let finalName = name !== undefined ? name : (addon as any).name;
    if (product_id) {
      const prod = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(product_id) as any;
      if (!prod) {
        return res.status(404).json({ error: 'Produk yang dipilih tidak ditemukan' });
      }
      finalName = prod.name;
    }

    db.prepare(`
      UPDATE addons SET
        product_id = COALESCE(?, product_id),
        name = COALESCE(?, name),
        quantity = COALESCE(?, quantity),
        price = COALESCE(?, price),
        is_active = COALESCE(?, is_active),
        sort_order = COALESCE(?, sort_order),
        updated_at = ?
      WHERE id = ?
    `).run(
      product_id !== undefined ? product_id : null,
      finalName !== undefined ? finalName.trim() : null,
      quantity !== undefined ? Math.max(0.01, Number(quantity)) : null,
      price !== undefined ? Number(price) : null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      sort_order !== undefined ? sort_order : null,
      now(),
      req.params.addonId
    );

    const addons = getGroupComponents(db, req.params.groupId);
    const totalNormalPrice = computeGroupNormalPrice(addons);
    const updatedAddon = addons.find((a: any) => a.id === req.params.addonId);

    res.json({ addon: updatedAddon, total_normal_price: totalNormalPrice });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── DELETE /api/addon-groups/:groupId/addons/:addonId ───────────────────────
router.delete('/:groupId/addons/:addonId', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const addon = db.prepare('SELECT * FROM addons WHERE id = ? AND addon_group_id = ?').get(req.params.addonId, req.params.groupId);
    if (!addon) {
      return res.status(404).json({ error: 'Addon not found' });
    }

    db.prepare('DELETE FROM addons WHERE id = ?').run(req.params.addonId);
    res.json({ message: 'Item berhasil dihapus dari paket' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const addonGroupRoutes = router;
