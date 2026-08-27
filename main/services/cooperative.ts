import Database from 'better-sqlite3';
import { now } from '../db';

/**
 * Flexible Rupiah number parser supporting:
 * - Pure numbers: 10000, 10000.00
 * - Indonesian thousand-dot strings: "10.000", "1.000.000", "25.500"
 * - Comma strings: "10,000", "1,000,000"
 * - Currency prefixes: "Rp 10.000", "Rp. 10.000", "IDR 10.000"
 * - Mixed dot-comma decimals: "10.000,00" or "10,000.00"
 */
export function parseRupiahNumber(value: any): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value);
  }
  if (typeof value !== 'string') return null;

  let str = value.trim().replace(/^(Rp|IDR|rp|idr)\.?\s*/i, '').trim();
  if (!str) return null;

  // Remove spaces
  str = str.replace(/\s+/g, '');

  if (str.includes('.') && str.includes(',')) {
    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');
    if (lastDot > lastComma) {
      // US style: 10,000.00
      str = str.replace(/,/g, '');
    } else {
      // Indo style: 10.000,00
      str = str.replace(/\./g, '').replace(',', '.');
    }
  } else if (str.includes('.')) {
    const dotCount = (str.match(/\./g) || []).length;
    if (dotCount > 1) {
      str = str.replace(/\./g, '');
    } else {
      const parts = str.split('.');
      if (parts[1].length === 3) {
        // e.g. "10.000" or "5.500" -> thousand separator
        str = str.replace(/\./g, '');
      } else if (parts[1].length === 2 && parts[1] === '00') {
        // e.g. "10000.00"
        str = parts[0];
      } else {
        const num = parseFloat(str);
        return isNaN(num) ? null : Math.round(num);
      }
    }
  } else if (str.includes(',')) {
    const commaCount = (str.match(/,/g) || []).length;
    if (commaCount > 1) {
      str = str.replace(/,/g, '');
    } else {
      const parts = str.split(',');
      if (parts[1].length === 3) {
        // e.g. "10,000" -> thousand separator
        str = str.replace(/,/g, '');
      } else if (parts[1].length <= 2) {
        // e.g. "10000,00" or "10,50"
        str = parts[0] + '.' + parts[1];
      } else {
        str = str.replace(/,/g, '');
      }
    }
  }

  const num = Number(str);
  if (isNaN(num) || !Number.isFinite(num)) return null;
  return Math.round(num);
}

/**
 * Validate and parse integer Rupiah amount.
 * Must be a finite, safe integer > 0 (or >= 0 if allowZero is true).
 */
export function parseIntegerRupiah(
  value: any,
  fieldName = 'Amount',
  allowZero = false
): { valid: boolean; value?: number; error?: string } {
  if (value === undefined || value === null || value === '') {
    return { valid: false, error: `${fieldName} is required` };
  }

  const parsed = parseRupiahNumber(value);
  if (parsed === null) {
    return { valid: false, error: `${fieldName} must be a valid integer Rupiah amount` };
  }

  if (!Number.isSafeInteger(parsed)) {
    return { valid: false, error: `${fieldName} exceeds maximum safe integer range` };
  }

  if (!allowZero && parsed <= 0) {
    return { valid: false, error: `${fieldName} must be greater than 0` };
  }

  if (allowZero && parsed < 0) {
    return { valid: false, error: `${fieldName} cannot be negative` };
  }

  return { valid: true, value: parsed };
}

/**
 * Get setting value from SQLite settings table.
 */
export function getSettingValue(db: Database.Database, key: string, defaultValue = ''): string {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Get the business timezone from settings (default: Asia/Jakarta).
 */
export function getBusinessTimezone(db: Database.Database): string {
  const tz = getSettingValue(db, 'timezone', 'Asia/Jakarta');
  return tz || 'Asia/Jakarta';
}

/**
 * Get current business calendar date string (YYYY-MM-DD) in the business timezone.
 */
export function getBusinessDateString(db: Database.Database, date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tz = getBusinessTimezone(db);

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(d); // Returns YYYY-MM-DD
  } catch {
    // Fallback if timezone string is invalid
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Compare whether two timestamps represent the same calendar day in the business timezone.
 */
export function isSameBusinessDay(db: Database.Database, date1: Date | string, date2: Date | string): boolean {
  return getBusinessDateString(db, date1) === getBusinessDateString(db, date2);
}

/**
 * Calculate the payroll period (YYYY-MM) based on cutoff day and business timezone.
 * With cutoff 25:
 * - 2026-07-26 to 2026-08-25 = 2026-08
 * - 2026-08-26 to 2026-09-25 = 2026-09
 */
export function calculatePayrollPeriod(db: Database.Database, date: Date | string = new Date()): string {
  const dateStr = getBusinessDateString(db, date); // YYYY-MM-DD
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Cutoff day from settings (range 1-31, default 25)
  const cutoffSetting = getSettingValue(db, 'salary_deduction_cutoff_day', '25');
  let cutoffDay = parseInt(cutoffSetting, 10);
  if (isNaN(cutoffDay) || cutoffDay < 1 || cutoffDay > 31) {
    cutoffDay = 25;
  }

  // If day > cutoffDay, transactions belong to the next payroll cycle month
  if (day > cutoffDay) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  const formattedMonth = String(month).padStart(2, '0');
  return `${year}-${formattedMonth}`;
}

/**
 * Calculate monthly salary deduction usage (pending + confirmed) for a given member and period.
 */
export function getMemberMonthlyUsage(db: Database.Database, memberId: string, periodMonth: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM salary_deductions
    WHERE member_id = ? AND period_month = ? AND status IN ('pending', 'confirmed')
  `).get(memberId, periodMonth) as { total: number };

  return row ? row.total : 0;
}

/**
 * Calculate total accumulated salary deductions (pending + confirmed) across all periods for a given member.
 */
export function getMemberTotalAccumulatedUsage(db: Database.Database, memberId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM salary_deductions
    WHERE member_id = ? AND status IN ('pending', 'confirmed')
  `).get(memberId) as { total: number };

  return row ? row.total : 0;
}

/**
 * Calculate outstanding exposure (pending + rejected) for a given member.
 */
export function getMemberOutstandingExposure(db: Database.Database, memberId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM salary_deductions
    WHERE member_id = ? AND status IN ('pending', 'rejected')
  `).get(memberId) as { total: number };

  return row ? row.total : 0;
}

/**
 * Validate member limits for a new salary deduction.
 * Returns error message if invalid, or null if valid.
 */
export function validateMemberSalaryDeductionLimits(
  db: Database.Database,
  member: {
    id: string;
    name?: string;
    is_member?: number | boolean;
    is_active?: number | boolean;
    salary_deduction_enabled?: number | boolean;
    monthly_deduction_limit?: number;
    outstanding_deduction_limit?: number;
  },
  requestedAmount: number,
  periodMonth: string
): {
  allowed: boolean;
  error?: string;
  remainingMonthly: number;
  remainingOutstanding: number;
  monthlyLimit: number;
  currentMonthlyUsage: number;
  totalAccumulatedUsage: number;
} {
  if (member.is_active === 0 || (member.is_active as any) === false) {
    return {
      allowed: false,
      error: 'Akun member ini berstatus non-aktif',
      remainingMonthly: 0,
      remainingOutstanding: 0,
      monthlyLimit: 0,
      currentMonthlyUsage: 0,
      totalAccumulatedUsage: 0,
    };
  }

  if (member.is_member === 0 || (member.is_member as any) === false) {
    return {
      allowed: false,
      error: 'Pelanggan bukan anggota terdaftar koperasi. Fasilitas potong gaji hanya berlaku untuk member.',
      remainingMonthly: 0,
      remainingOutstanding: 0,
      monthlyLimit: 0,
      currentMonthlyUsage: 0,
      totalAccumulatedUsage: 0,
    };
  }

  if (member.salary_deduction_enabled === 0 || (member.salary_deduction_enabled as any) === false) {
    return {
      allowed: false,
      error: 'Fasilitas potong gaji (bon) dinonaktifkan untuk member ini',
      remainingMonthly: 0,
      remainingOutstanding: 0,
      monthlyLimit: 0,
      currentMonthlyUsage: 0,
      totalAccumulatedUsage: 0,
    };
  }

  const monthlyLimit = Number(member.monthly_deduction_limit || 0);
  const outstandingLimit = Number(member.outstanding_deduction_limit || 0);

  const currentMonthlyUsage = getMemberMonthlyUsage(db, member.id, periodMonth);
  const totalAccumulatedUsage = getMemberTotalAccumulatedUsage(db, member.id);
  const currentOutstanding = getMemberOutstandingExposure(db, member.id);

  const remainingMonthly = monthlyLimit > 0 ? Math.max(0, monthlyLimit - currentMonthlyUsage) : 999999999;
  const remainingOutstanding = outstandingLimit > 0 ? Math.max(0, outstandingLimit - currentOutstanding) : 999999999;

  // Monthly limit validation
  if (monthlyLimit > 0 && currentMonthlyUsage + requestedAmount > monthlyLimit) {
    return {
      allowed: false,
      error: `Limit potong gaji bulanan (${periodMonth}) tidak mencukupi. Limit: Rp ${monthlyLimit.toLocaleString('id-ID')}, Terpakai: Rp ${currentMonthlyUsage.toLocaleString('id-ID')}, Sisa: Rp ${remainingMonthly.toLocaleString('id-ID')}, Permintaan: Rp ${requestedAmount.toLocaleString('id-ID')}`,
      remainingMonthly,
      remainingOutstanding,
      monthlyLimit,
      currentMonthlyUsage,
      totalAccumulatedUsage,
    };
  }

  // Outstanding limit validation
  if (outstandingLimit > 0 && currentOutstanding + requestedAmount > outstandingLimit) {
    return {
      allowed: false,
      error: `Limit outstanding berjalan tidak mencukupi. Limit: Rp ${outstandingLimit.toLocaleString('id-ID')}, Sisa: Rp ${remainingOutstanding.toLocaleString('id-ID')}, Permintaan: Rp ${requestedAmount.toLocaleString('id-ID')}`,
      remainingMonthly,
      remainingOutstanding,
      monthlyLimit,
      currentMonthlyUsage,
      totalAccumulatedUsage,
    };
  }

  return {
    allowed: true,
    remainingMonthly,
    remainingOutstanding,
    monthlyLimit,
    currentMonthlyUsage,
    totalAccumulatedUsage,
  };
}

/**
 * Generate a unique, audit-friendly deduction number.
 */
export function generateDeductionNumber(billNumber: string, attempt = 1): string {
  const cleanBillNo = billNumber ? billNumber.replace(/^BILL-?/i, '') : Date.now().toString();
  if (attempt <= 1) {
    return `SD-${cleanBillNo}`;
  }
  return `SD-${cleanBillNo}-${attempt}`;
}

export interface StockMovementParams {
  productId: string;
  movementType: 'initial' | 'purchase' | 'adjustment' | 'opname' | 'sale' | 'void';
  quantityChange: number; // positive or negative
  unitCost?: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdBy: string;
}

/**
 * Record a stock movement atomically and update product stock quantity.
 * Must be called within an active SQLite transaction.
 */
export function executeStockMovement(
  db: Database.Database,
  params: StockMovementParams
): { success: boolean; balanceBefore: number; balanceAfter: number; error?: string } {
  const { productId, movementType, quantityChange, unitCost = 0, referenceType, referenceId, notes, createdBy } = params;

  const product = db.prepare('SELECT id, name, stock_quantity, track_inventory FROM products WHERE id = ?').get(productId) as any;
  if (!product) {
    return { success: false, balanceBefore: 0, balanceAfter: 0, error: `Product not found: ${productId}` };
  }

  if (product.track_inventory !== 1) {
    return { success: false, balanceBefore: 0, balanceAfter: 0, error: `Inventory tracking is disabled for product: ${product.name}` };
  }

  const allowNegativeSetting = getSettingValue(db, 'allow_negative_stock', 'false') === 'true';
  const balanceBefore = Number(product.stock_quantity || 0);
  const roundedQtyChange = Math.round(quantityChange * 1000) / 1000;
  const balanceAfter = Math.round((balanceBefore + roundedQtyChange) * 1000) / 1000;

  if (balanceAfter < 0 && !allowNegativeSetting) {
    return {
      success: false,
      balanceBefore,
      balanceAfter,
      error: `Insufficient stock for product '${product.name}'. Current: ${balanceBefore}, Requested change: ${roundedQtyChange}, Resulting stock would be negative (${balanceAfter}).`,
    };
  }

  // Update product stock quantity
  db.prepare('UPDATE products SET stock_quantity = ?, updated_at = ? WHERE id = ?').run(balanceAfter, now(), productId);

  // Insert into stock_movements ledger (SQLite autoincrements integer ID)
  const validUnitCost = Math.max(0, Math.round(unitCost || 0));

  db.prepare(`
    INSERT INTO stock_movements (
      product_id, movement_type, quantity,
      balance_before, balance_after, unit_cost,
      reference_type, reference_id, notes,
      created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    productId,
    movementType,
    roundedQtyChange,
    balanceBefore,
    balanceAfter,
    validUnitCost,
    referenceType || null,
    referenceId || null,
    notes ? String(notes).slice(0, 500) : null,
    createdBy,
    now()
  );

  return { success: true, balanceBefore, balanceAfter };
}

// ── BULK STOCK MANAGEMENT & STOCK OPNAME ────────────────────────────────────

export interface BulkStockItemPayload {
  product_id: string;
  expected_stock?: number;
  quantity_input: number;
  unit_cost?: number;
  reason?: string;
}

export interface BulkStockMovementPayload {
  mode: 'receive' | 'adjust' | 'stock_opname';
  batch_reference?: string;
  notes?: string;
  idempotency_key?: string;
  items: BulkStockItemPayload[];
}

export interface BulkStockMovementResult {
  success: boolean;
  status_code: number;
  error?: string;
  conflict_item?: {
    product_id: string;
    product_name: string;
    expected_stock: number;
    actual_stock: number;
  };
  batch_id?: string;
  mode?: string;
  batch_reference?: string;
  total_items?: number;
  total_quantity_in?: number;
  total_quantity_out?: number;
  updated_products?: Array<{
    id: string;
    name: string;
    stock_before: number;
    stock_after: number;
    unit: string;
  }>;
}

// Simple in-memory LRU idempotency cache (TTL: 10 mins)
const idempotencyCache = new Map<string, { timestamp: number; result: BulkStockMovementResult }>();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function cleanIdempotencyCache() {
  const nowMs = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (nowMs - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}

/**
 * Execute bulk stock movements (Receiving, Adjustment, or Stock Opname) atomically.
 * Ensures All-or-Nothing database transaction with concurrency conflict detection.
 */
export function executeBulkStockMovement(
  db: Database.Database,
  payload: BulkStockMovementPayload,
  userId: string,
  userRole: string
): BulkStockMovementResult {
  cleanIdempotencyCache();

  // 1. Validate idempotency key if supplied
  const idemKey = payload.idempotency_key ? String(payload.idempotency_key).trim() : null;
  if (idemKey && idempotencyCache.has(idemKey)) {
    return idempotencyCache.get(idemKey)!.result;
  }

  // 2. Validate payload structure
  if (!payload || !['receive', 'adjust', 'stock_opname'].includes(payload.mode)) {
    return {
      success: false,
      status_code: 422,
      error: "Mode batch tidak valid. Mode yang didukung: 'receive', 'adjust', 'stock_opname'.",
    };
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return {
      success: false,
      status_code: 422,
      error: 'Daftar produk tidak boleh kosong.',
    };
  }

  if (payload.items.length > 500) {
    return {
      success: false,
      status_code: 422,
      error: 'Jumlah produk per batch maksimal 500 item.',
    };
  }

  // 3. Generate unique Batch ID
  const prefix = payload.mode === 'receive' ? 'STK-REC' : payload.mode === 'adjust' ? 'STK-ADJ' : 'STK-OPN';
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randSuffix = Math.floor(1000 + Math.random() * 9000);
  const batchId = `${prefix}-${dateStr}-${randSuffix}`;

  // 4. Atomic Transaction Execution
  try {
    const tx = db.transaction(() => {
      const seenProductIds = new Set<string>();
      const updatedProducts: Array<{ id: string; name: string; stock_before: number; stock_after: number; unit: string }> = [];
      let totalQtyIn = 0;
      let totalQtyOut = 0;

      for (let i = 0; i < payload.items.length; i++) {
        const item = payload.items[i];
        const rowIdx = i + 1;

        if (!item.product_id) {
          throw { status: 422, message: `Baris #${rowIdx}: product_id wajib diisi.` };
        }

        if (seenProductIds.has(item.product_id)) {
          throw { status: 422, message: `Baris #${rowIdx}: Produk terduplikasi dalam batch.` };
        }
        seenProductIds.add(item.product_id);

        const product = db.prepare(`
          SELECT id, name, sku, barcode, unit, allow_decimal, track_inventory, stock_quantity, cost
          FROM products
          WHERE id = ? AND deleted_at IS NULL
        `).get(item.product_id) as any;

        if (!product) {
          throw { status: 404, message: `Baris #${rowIdx}: Produk tidak ditemukan atau telah dihapus.` };
        }

        if (product.track_inventory !== 1) {
          throw { status: 422, message: `Baris #${rowIdx}: Produk '${product.name}' tidak mengaktifkan pelacakan stok.` };
        }

        const inputQty = Number(item.quantity_input);
        if (isNaN(inputQty) || !Number.isFinite(inputQty)) {
          throw { status: 422, message: `Baris #${rowIdx}: Kuantitas input '${item.quantity_input}' untuk '${product.name}' tidak valid.` };
        }

        // Validate decimal precision against product.allow_decimal
        if (product.allow_decimal !== 1 && inputQty % 1 !== 0) {
          throw {
            status: 422,
            message: `Baris #${rowIdx}: Produk '${product.name}' tidak mendukung kuantitas desimal (${inputQty}). Ubah allow_decimal produk menjadi 1 jika ingin desimal.`,
          };
        }

        const currentStock = Number(product.stock_quantity || 0);

        // Concurrency Conflict Check: If expected_stock provided, ensure it matches current DB stock
        if (item.expected_stock !== undefined && item.expected_stock !== null) {
          const expStock = Number(item.expected_stock);
          if (Math.abs(expStock - currentStock) > 0.0001) {
            throw {
              status: 409,
              message: `Konflik stok pada '${product.name}'. Stok saat ini (${currentStock}) berbeda dari stok saat draft dibuat (${expStock}). Silakan muat ulang stok terkini.`,
              conflict: {
                product_id: product.id,
                product_name: product.name,
                expected_stock: expStock,
                actual_stock: currentStock,
              },
            };
          }
        }

        // Calculate quantityChange and movementType
        let quantityChange = 0;
        let movementType: 'initial' | 'purchase' | 'adjustment' | 'opname' | 'sale' | 'void' = 'adjustment';
        const itemReason = (item.reason || payload.notes || '').trim();

        if (payload.mode === 'receive') {
          if (inputQty <= 0) {
            throw { status: 422, message: `Baris #${rowIdx}: Kuantitas terima stok untuk '${product.name}' harus lebih besar dari 0.` };
          }
          quantityChange = inputQty;
          movementType = 'purchase';
          totalQtyIn += quantityChange;
        } else if (payload.mode === 'adjust') {
          if (inputQty === 0) {
            throw { status: 422, message: `Baris #${rowIdx}: Nilai penyesuaian untuk '${product.name}' tidak boleh 0.` };
          }
          if (!itemReason) {
            throw { status: 422, message: `Baris #${rowIdx}: Alasan penyesuaian wajib diisi untuk '${product.name}'.` };
          }
          quantityChange = inputQty;
          movementType = 'adjustment';
          if (quantityChange > 0) totalQtyIn += quantityChange;
          else totalQtyOut += Math.abs(quantityChange);
        } else if (payload.mode === 'stock_opname') {
          if (inputQty < 0) {
            throw { status: 422, message: `Baris #${rowIdx}: Jumlah fisik aktual untuk '${product.name}' tidak boleh negatif.` };
          }
          quantityChange = Math.round((inputQty - currentStock) * 1000) / 1000;
          movementType = 'opname';
          if (quantityChange !== 0 && !itemReason) {
            throw { status: 422, message: `Baris #${rowIdx}: Alasan selisih opname (${quantityChange > 0 ? '+' : ''}${quantityChange}) wajib diisi untuk '${product.name}'.` };
          }
          if (quantityChange > 0) totalQtyIn += quantityChange;
          else totalQtyOut += Math.abs(quantityChange);
        }

        // If opname difference is 0, we still record that it was verified if needed or skip movement
        if (payload.mode === 'stock_opname' && quantityChange === 0) {
          updatedProducts.push({
            id: product.id,
            name: product.name,
            stock_before: currentStock,
            stock_after: currentStock,
            unit: product.unit || 'pcs',
          });
          continue;
        }

        // Execute stock movement
        const unitCostVal = item.unit_cost !== undefined ? Number(item.unit_cost) : (product.cost || 0);
        const moveRes = executeStockMovement(db, {
          productId: product.id,
          movementType,
          quantityChange,
          unitCost: unitCostVal,
          referenceType: 'bulk_stock_management',
          referenceId: batchId,
          notes: itemReason ? `${itemReason}${payload.batch_reference ? ` (Ref: ${payload.batch_reference})` : ''}` : (payload.batch_reference ? `Ref: ${payload.batch_reference}` : undefined),
          createdBy: userId,
        });

        if (!moveRes.success) {
          throw { status: 422, message: `Baris #${rowIdx} '${product.name}': ${moveRes.error}` };
        }

        updatedProducts.push({
          id: product.id,
          name: product.name,
          stock_before: moveRes.balanceBefore,
          stock_after: moveRes.balanceAfter,
          unit: product.unit || 'pcs',
        });
      }

      // Record Audit Log entry
      db.prepare(`
        INSERT INTO audit_logs (
          actor_user_id, actor_role, action, target_type, target_id, details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        userRole,
        'stock.bulk_adjustment',
        'stock_batch',
        batchId,
        JSON.stringify({
          batch_id: batchId,
          mode: payload.mode,
          batch_reference: payload.batch_reference || null,
          notes: payload.notes || null,
          total_items: payload.items.length,
          total_quantity_in: Math.round(totalQtyIn * 1000) / 1000,
          total_quantity_out: Math.round(totalQtyOut * 1000) / 1000,
          product_ids: payload.items.map((i) => i.product_id),
        }),
        now()
      );

      return {
        success: true,
        status_code: 201,
        batch_id: batchId,
        mode: payload.mode,
        batch_reference: payload.batch_reference || undefined,
        total_items: payload.items.length,
        total_quantity_in: Math.round(totalQtyIn * 1000) / 1000,
        total_quantity_out: Math.round(totalQtyOut * 1000) / 1000,
        updated_products: updatedProducts,
      };
    });

    const result = tx();
    if (idemKey) {
      idempotencyCache.set(idemKey, { timestamp: Date.now(), result });
    }
    return result;
  } catch (err: any) {
    if (err && typeof err === 'object' && err.status) {
      return {
        success: false,
        status_code: err.status,
        error: err.message,
        conflict_item: err.conflict,
      };
    }
    return {
      success: false,
      status_code: 500,
      error: err instanceof Error ? err.message : 'Gagal memproses batch mutasi stok.',
    };
  }
}
