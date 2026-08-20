/**
 * Compatibility module for POS Koperasi (defaulting to Indonesia / IDR).
 * Provides country definitions, currency formatting, and tenant helpers.
 */

export interface Country {
  code: string;
  name: string;
  currency: string;
  symbol: string;
  locale: string;
  timezone: string;
  taxIdLabel: string;
  phoneCode: string;
}

export const DEFAULT_COUNTRY_PROFILE: Country = {
  code: 'ID',
  name: 'Indonesia',
  currency: 'IDR',
  symbol: 'Rp',
  locale: 'id-ID',
  timezone: 'Asia/Jakarta',
  taxIdLabel: 'NPWP',
  phoneCode: '+62',
};

export const COUNTRIES: Country[] = [
  DEFAULT_COUNTRY_PROFILE,
  {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    symbol: '₹',
    locale: 'en-IN',
    timezone: 'Asia/Kolkata',
    taxIdLabel: 'GSTIN',
    phoneCode: '+91',
  },
  {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    symbol: '$',
    locale: 'en-US',
    timezone: 'America/New_York',
    taxIdLabel: 'EIN',
    phoneCode: '+1',
  },
  {
    code: 'SG',
    name: 'Singapore',
    currency: 'SGD',
    symbol: 'S$',
    locale: 'en-SG',
    timezone: 'Asia/Singapore',
    taxIdLabel: 'UEN',
    phoneCode: '+65',
  },
  {
    code: 'MY',
    name: 'Malaysia',
    currency: 'MYR',
    symbol: 'RM',
    locale: 'ms-MY',
    timezone: 'Asia/Kuala_Lumpur',
    taxIdLabel: 'SST',
    phoneCode: '+60',
  },
];

/**
 * Find country profile by country code.
 * Case-insensitive, trims whitespace. Returns DEFAULT_COUNTRY_PROFILE for unknown or empty input.
 */
export function getCountryByCode(code?: string | null): Country {
  if (!code || typeof code !== 'string') {
    return DEFAULT_COUNTRY_PROFILE;
  }
  const clean = code.trim().toUpperCase();
  if (!clean) {
    return DEFAULT_COUNTRY_PROFILE;
  }
  const match = COUNTRIES.find((c) => c.code === clean);
  return match || DEFAULT_COUNTRY_PROFILE;
}

/**
 * Return country name for a given code.
 * Falls back to DEFAULT_COUNTRY_PROFILE.name ('Indonesia') if unknown.
 */
export function countryName(code?: string | null): string {
  const profile = getCountryByCode(code);
  return profile.name;
}

/**
 * Return currency symbol for a currency code.
 * Returns 'Rp' for IDR, '₹' for INR, etc.
 * For unknown 3-letter currency codes returns the code uppercase; otherwise 'Rp'.
 */
export function getCurrencySymbol(currency?: string | null, locale?: string | null): string {
  if (!currency || typeof currency !== 'string') {
    return DEFAULT_COUNTRY_PROFILE.symbol;
  }
  const upper = currency.trim().toUpperCase();
  if (upper === 'IDR') return 'Rp';
  if (upper === 'INR') return '₹';
  if (upper === 'USD') return '$';
  if (upper === 'SGD') return 'S$';
  if (upper === 'MYR') return 'RM';

  const matched = COUNTRIES.find((c) => c.currency === upper);
  if (matched) return matched.symbol;

  try {
    const formatter = new Intl.NumberFormat(locale || 'id-ID', {
      style: 'currency',
      currency: upper,
    });
    const parts = formatter.formatToParts(0);
    const sym = parts.find((p) => p.type === 'currency');
    if (sym && sym.value) return sym.value;
  } catch {
    // Fall through to regex check
  }

  if (/^[A-Z]{3}$/.test(upper)) {
    return upper;
  }
  return DEFAULT_COUNTRY_PROFILE.symbol;
}

/**
 * Format a number as currency string.
 * Defensively normalizes amount, rounds IDR without decimals, and handles errors safely.
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  currency?: string | null,
  locale?: string | null
): string {
  let num = Number(amount);
  if (!Number.isFinite(num)) {
    num = 0;
  }

  const curr = (currency && typeof currency === 'string' && currency.trim().toUpperCase()) || 'IDR';
  const loc = (locale && typeof locale === 'string' && locale.trim()) || 'id-ID';
  const isIdr = curr === 'IDR';

  if (isIdr) {
    num = Math.round(num);
  }

  try {
    return new Intl.NumberFormat(loc, {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: isIdr ? 0 : 2,
      maximumFractionDigits: isIdr ? 0 : 2,
    }).format(num);
  } catch {
    const symbol = getCurrencySymbol(curr, loc);
    return `${symbol} ${num}`;
  }
}

/**
 * Format a number as currency for a tenant or country object.
 * Defensively extracts country and currency configurations.
 */
export function formatCurrencyForTenant(
  amount: number | string | null | undefined,
  tenantOrCountry?: unknown,
  currencyParam?: string | null
): string {
  let countryCode: string | undefined;
  let currencyCode: string | undefined;
  let localeCode: string | undefined;

  if (typeof tenantOrCountry === 'string') {
    countryCode = tenantOrCountry;
    currencyCode = currencyParam || undefined;
  } else if (tenantOrCountry && typeof tenantOrCountry === 'object') {
    const t = tenantOrCountry as Record<string, unknown>;
    if (typeof t.country === 'string') countryCode = t.country;
    else if (typeof t.country_code === 'string') countryCode = t.country_code;
    else if (typeof t.code === 'string') countryCode = t.code;

    if (typeof t.currency === 'string') currencyCode = t.currency;
    else if (typeof t.currency_code === 'string') currencyCode = t.currency_code;

    if (typeof t.locale === 'string') localeCode = t.locale;
  }

  if (currencyParam && typeof currencyParam === 'string') {
    currencyCode = currencyParam;
  }

  const profile = getCountryByCode(countryCode);
  const finalCurrency = currencyCode || profile.currency;
  const finalLocale = localeCode || profile.locale;

  return formatCurrency(amount, finalCurrency, finalLocale);
}
