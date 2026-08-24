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
  _db: Database.Database,
  member: {
    id: string;
    is_member?: number | boolean;
    is_active?: number | boolean;
    salary_deduction_enabled?: number | boolean;
    monthly_deduction_limit?: number;
    outstanding_deduction_limit?: number;
  },
  _requestedAmount: number,
  _periodMonth: string
): { allowed: boolean; error?: string; remainingMonthly?: number; remainingOutstanding?: number } {
  if (member.is_active === 0 || (member.is_active as any) === false) {
    return { allowed: false, error: 'Akun member ini berstatus non-aktif' };
  }

  // Koperasi Policy: Potong gaji is a universal privilege for ALL members with NO limit
  return { allowed: true, remainingMonthly: 999999999, remainingOutstanding: 999999999 };
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
