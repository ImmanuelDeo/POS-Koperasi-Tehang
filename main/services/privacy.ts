/**
 * Privacy and NIK Normalization, Validation, and Masking Utilities
 * POS Koperasi Tehang
 */

/**
 * Normalizes a raw NIK input by stripping spaces, dots, and hyphens.
 * Returns digit-only string or null if empty.
 */
export function normalizeNik(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim().replace(/[\s.-]/g, '');
  return str.length > 0 ? str : null;
}

/**
 * Validates a normalized or raw NIK.
 * Rules:
 * 1. Must be all digits.
 * 2. Must be exactly 16 digits.
 * 3. Cannot be all identical digits (e.g. 0000000000000000, 1111111111111111).
 * 4. Cannot be generic sequential placeholder '1234567890123456'.
 */
export function validateNik(
  nik: string | null | undefined,
  isRequired: boolean = true
): { valid: boolean; error?: string; normalized: string | null } {
  const normalized = normalizeNik(nik);

  if (!normalized) {
    if (isRequired) {
      return { valid: false, error: 'NIK wajib diisi tepat 16 digit angka', normalized: null };
    }
    return { valid: true, normalized: null };
  }

  // Must be pure digits
  if (!/^\d+$/.test(normalized)) {
    return { valid: false, error: 'NIK hanya boleh berisi angka', normalized };
  }

  // Must be exactly 16 digits
  if (normalized.length !== 16) {
    return { valid: false, error: 'NIK harus tepat 16 digit angka', normalized };
  }

  // Reject all identical digits (e.g. 0000000000000000, 9999999999999999)
  if (/^(\d)\1{15}$/.test(normalized)) {
    return { valid: false, error: 'NIK tidak valid (format angka berulang tidak diperbolehkan)', normalized };
  }

  // Reject common dummy sequential placeholder
  if (normalized === '1234567890123456' || normalized === '0123456789012345') {
    return { valid: false, error: 'NIK tidak valid (nomor placeholder tidak diperbolehkan)', normalized };
  }

  return { valid: true, normalized };
}

/**
 * Masks an NIK for safe display across cashier POS UI and standard views.
 * Rule: Shows the first 8 digits visible for identity crosscheck against member ID/KTP,
 * and masks the remaining digits with asterisks (*).
 * Example (16 digits): '3273010101900001' -> '32730101********'
 */
export function maskNik(nik: string | null | undefined): string | null {
  if (!nik) return null;
  const clean = String(nik).trim();
  if (clean.length === 0) return null;

  if (clean.length >= 8) {
    const visiblePrefix = clean.slice(0, 8);
    const maskedSuffix = '*'.repeat(Math.max(4, clean.length - 8));
    return `${visiblePrefix}${maskedSuffix}`;
  }

  // Fallback masking for non-standard lengths < 8
  const keep = Math.min(4, Math.floor(clean.length / 2));
  return `${clean.slice(0, keep)}${'*'.repeat(Math.max(4, clean.length - keep))}`;
}

/**
 * Recursively sanitizes an object or value so that any raw NIK property is masked
 * before serialization into audit logs or public views.
 */
export function sanitizeAuditDetails(details: any): any {
  if (!details || typeof details !== 'object') {
    return details;
  }

  if (Array.isArray(details)) {
    return details.map((item) => sanitizeAuditDetails(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'nik' || lowerKey === 'nik_raw' || lowerKey === 'national_id') {
      sanitized['nik_masked'] = maskNik(value as string);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditDetails(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
