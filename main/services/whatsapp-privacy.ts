/**
 * WhatsApp Privacy & Normalization Service
 * POS Koperasi Tehang
 *
 * Implements E.164 phone normalization, phone masking, and strict
 * privacy-by-design payload sanitization (blocking NIK, salary, payment data).
 */

export interface E164PhoneResult {
  valid: boolean;
  e164: string | null;
  raw: string;
  error?: string;
}

/**
 * Normalize an input phone number into canonical international E.164 format (+628...).
 * Handles Indonesian common formats: '0812...', '628...', '+628...', '0812-3456-7890'.
 */
export function normalizeE164Phone(rawPhone?: string | null, countryCode = '+62'): E164PhoneResult {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, e164: null, raw: '', error: 'phone_empty' };
  }

  const cleaned = rawPhone.trim();
  // Strip non-digit except leading plus
  let digits = cleaned.replace(/[^\d+]/g, '');

  if (!digits || digits === '+') {
    return { valid: false, e164: null, raw: cleaned, error: 'phone_no_digits' };
  }

  // Remove duplicate plus signs
  if (digits.startsWith('+')) {
    digits = '+' + digits.replace(/\+/g, '');
  }

  let formatted = digits;

  // Handle leading zero (e.g. 08123456789)
  if (formatted.startsWith('0')) {
    const dialCodeDigits = countryCode.replace(/\D/g, '') || '62';
    formatted = `+${dialCodeDigits}${formatted.slice(1)}`;
  } else if (!formatted.startsWith('+')) {
    // Missing plus: if starts with 62... -> +62..., else prepend dialCode
    if (formatted.startsWith('62')) {
      formatted = `+${formatted}`;
    } else {
      const dialCodeDigits = countryCode.replace(/\D/g, '') || '62';
      formatted = `+${dialCodeDigits}${formatted}`;
    }
  }

  // Validate E.164 standard length (10 to 16 characters including '+')
  const totalDigits = formatted.replace(/\D/g, '').length;
  if (totalDigits < 9 || totalDigits > 15) {
    return { valid: false, e164: null, raw: cleaned, error: 'phone_length_invalid' };
  }

  return {
    valid: true,
    e164: formatted,
    raw: cleaned,
  };
}

/**
 * Mask phone number for safe display in logs, UI summaries, and audit records.
 * Example: '+6281234567890' -> '+62 812-****-7890'
 */
export function maskPhoneE164(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') return '***';
  const clean = phone.trim();
  if (clean.length < 8) return '***';

  const prefix = clean.slice(0, 6);
  const suffix = clean.slice(-4);
  return `${prefix}-****-${suffix}`;
}

/**
 * Sensitive parameter keys that MUST NEVER be included in WhatsApp marketing campaigns.
 */
export const FORBIDDEN_VARIABLE_KEYS = new Set([
  'nik',
  'nik_masked',
  'employee_id',
  'member_id',
  'salary',
  'gaji',
  'potong_gaji',
  'limit',
  'plafon',
  'saldo',
  'outstanding',
  'bill_id',
  'order_id',
  'token',
  'pin',
  'password',
  'auth',
]);

/**
 * Allowed safe variable placeholders for cooperative promotion templates.
 */
export const ALLOWED_VARIABLE_KEYS = new Set([
  'business_name',
  'recipient_name',
  'promo_title',
  'promo_description',
  'promo_code',
  'valid_until',
  'store_address',
  'store_phone',
  'unsubscribe_instruction',
]);

/**
 * Validate and sanitize template variable inputs against forbidden data leakage.
 */
export function sanitizeTemplateVariables(variables: Record<string, any>): {
  valid: boolean;
  sanitized: Record<string, string>;
  rejectedKeys: string[];
} {
  const sanitized: Record<string, string> = {};
  const rejectedKeys: string[] = [];

  for (const [key, val] of Object.entries(variables)) {
    const lowerKey = key.toLowerCase().trim();

    if (FORBIDDEN_VARIABLE_KEYS.has(lowerKey)) {
      rejectedKeys.push(key);
      continue;
    }

    if (typeof val === 'string' || typeof val === 'number') {
      const strVal = String(val).trim();
      // Additional safety check: reject if string contains 16-digit NIK pattern
      if (/^\d{16}$/.test(strVal)) {
        rejectedKeys.push(`${key} (resembling 16-digit NIK)`);
        continue;
      }
      sanitized[key] = strVal;
    }
  }

  return {
    valid: rejectedKeys.length === 0,
    sanitized,
    rejectedKeys,
  };
}
