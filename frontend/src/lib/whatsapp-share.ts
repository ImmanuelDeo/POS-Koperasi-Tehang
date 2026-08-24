/**
 * whatsapp-share.ts
 *
 * Generate WhatsApp share links and messages for bills.
 * Formats full itemized order details, date/time in WIB, and payment method for POS Koperasi Tehang.
 */

import type { Bill, Tenant, Customer } from '@/lib/types';
import api from './api';
import toast from 'react-hot-toast';

export interface WhatsAppShareOptions {
  /** Points earned from this bill (cashback) */
  pointsEarned?: number;
  /** Current wallet balance */
  walletBalance?: number;
  /** Business phone for WhatsApp business account */
  businessPhone?: string;
}

export function formatWhatsAppDateTimeWIB(iso?: string | Date | null): string {
  try {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return new Date().toLocaleDateString('id-ID') + ' WIB';
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    let day = '', month = '', year = '', hour = '', minute = '';
    for (const p of parts) {
      if (p.type === 'day') day = p.value.padStart(2, '0');
      if (p.type === 'month') month = p.value.padStart(2, '0');
      if (p.type === 'year') year = p.value;
      if (p.type === 'hour') hour = p.value.padStart(2, '0');
      if (p.type === 'minute') minute = p.value.padStart(2, '0');
    }
    return `${day}/${month}/${year} ${hour}:${minute} WIB`;
  } catch {
    return new Date().toLocaleDateString('id-ID') + ' WIB';
  }
}

export function formatCurrencyRp(value: number | string | null | undefined): string {
  const num = typeof value === 'number' ? value : parseFloat(String(value || 0));
  const safe = isNaN(num) ? 0 : Math.round(num);
  return 'Rp ' + safe.toLocaleString('id-ID');
}

/**
 * Generate full itemized WhatsApp message text.
 */
export function getWhatsAppMessage(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency' | 'country'>,
  opts: WhatsAppShareOptions = {}
): string {
  const bizName = tenant.business_name || 'POS Koperasi Tehang';
  const orderCreatedAt = bill.order?.created_at || bill.created_at || new Date().toISOString();
  const dateTimeStr = formatWhatsAppDateTimeWIB(orderCreatedAt);
  const items = bill.order?.items || (bill as any).items || [];

  const lines: string[] = [];

  lines.push(`*${bizName.toUpperCase()}*`);
  lines.push(`--------------------------------`);
  lines.push(`*No. Struk :* ${bill.bill_number}`);
  if (bill.order?.order_number) {
    lines.push(`*No. Order :* ${bill.order.order_number}`);
  }
  lines.push(`*Waktu     :* ${dateTimeStr}`);

  // Customer / Member info
  const customerName = (bill.order as any)?.customer?.name || (bill as any).customer?.name;
  const customerNik =
    (bill.order as any)?.customer?.nik_masked ||
    (bill.order as any)?.customer?.nik ||
    (bill as any).customer?.nik_masked ||
    (bill as any).customer?.nik;
  if (customerName) {
    lines.push(`*Anggota   :* ${customerName}${customerNik ? ` (NIK: ${customerNik})` : ''}`);
  }

  // Itemized product details
  if (items.length > 0) {
    lines.push(`--------------------------------`);
    lines.push(`*DETAIL PEMBELIAN:*`);
    for (const item of items) {
      const name = item.product_name || item.name || 'Produk';
      const qty = item.quantity || 1;
      const unit = item.unit || 'pcs';
      const unitPrice = Number(item.unit_price || item.price || 0);
      const subtotal = Number(item.subtotal || item.total || qty * unitPrice);

      lines.push(`• *${name}*`);
      lines.push(`  ${qty} ${unit} x ${formatCurrencyRp(unitPrice)} = ${formatCurrencyRp(subtotal)}`);
    }
  }

  // Totals & Pricing
  lines.push(`--------------------------------`);
  const subtotalVal = Number(bill.subtotal || bill.total || 0);
  const discountVal = Number(bill.discount_amount || 0);
  const totalVal = Number(bill.total || 0);

  if (discountVal > 0) {
    lines.push(`*Subtotal  :* ${formatCurrencyRp(subtotalVal)}`);
    lines.push(`*Diskon    :* -${formatCurrencyRp(discountVal)}`);
  }
  lines.push(`*TOTAL     :* *${formatCurrencyRp(totalVal)}*`);

  // Payment Method
  const isSalaryDeduction =
    (bill as any).payment_method === 'salary_deduction' ||
    ((bill as any).payments && (bill as any).payments.some((p: any) => p.method === 'salary_deduction'));
  const paymentMethodLabel = isSalaryDeduction ? 'Potong Gaji (Bon)' : 'Tunai';
  lines.push(`*Metode    :* ${paymentMethodLabel}`);

  if (opts.pointsEarned && opts.pointsEarned > 0) {
    lines.push(`*Poin      :* +${opts.pointsEarned} poin`);
  }

  lines.push(`--------------------------------`);
  lines.push(`Terima kasih telah berbelanja di ${bizName}!`);
  lines.push(`_Simpan pesan ini sebagai bukti transaksi yang sah._`);

  return lines.join('\n');
}

/**
 * Generate a wa.me URL for sharing bill details via WhatsApp.
 */
export function getWhatsAppShareUrl(
  bill: Bill,
  tenant: Pick<Tenant, 'business_name' | 'currency' | 'country'>,
  customer: Pick<Customer, 'phone' | 'country_code'> | null,
  opts: WhatsAppShareOptions = {}
): string {
  const message = getWhatsAppMessage(bill, tenant, opts);

  // Determine phone number to send to
  const rawPhone = customer?.phone || '';
  let phone = rawPhone.replace(/\D/g, '');
  if (phone.startsWith('0')) {
    phone = '62' + phone.slice(1);
  }

  const waPhone = opts.businessPhone?.replace(/\D/g, '') || '';
  const targetPhone = waPhone || phone;

  return `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * Open WhatsApp share in a new window/tab.
 */
export function shareBillViaWhatsApp(
  bill: Bill,
  customerInfo: Pick<Customer, 'phone' | 'country_code'> | null,
  tenant: Pick<Tenant, 'business_name' | 'currency' | 'country'>,
  opts: WhatsAppShareOptions = {}
): void {
  const url = getWhatsAppShareUrl(bill, tenant, customerInfo, opts);
  window.open(url, '_blank');
}

/**
 * Send a paid bill receipt through Flo's connected WhatsApp session.
 */
export async function sendBillViaFlo(
  bill: Bill,
  customerPhone: string,
  _currency: string,
  t: (key: string, params?: Record<string, string | number>) => string,
  tenant?: Pick<Tenant, 'business_name' | 'currency' | 'country'>
): Promise<void> {
  const message = getWhatsAppMessage(
    bill,
    tenant || { business_name: 'POS Koperasi Tehang', currency: 'Rp', country: 'ID' }
  );
  let phone = customerPhone.replace(/\D/g, '');
  if (phone.startsWith('0')) {
    phone = '62' + phone.slice(1);
  }

  try {
    const { data } = await api.post('/whatsapp/send', {
      bill_id: bill.id,
      phone_e164: phone.startsWith('+') ? phone : `+${phone}`,
      body: message,
    });
    if (data?.ok) toast.success(t('whatsapp.send.success'));
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string; reason?: string } } };
    const reason = axiosErr?.response?.data?.reason;
    const msg = axiosErr?.response?.data?.error ?? t('whatsapp.send.failed');
    if (reason === 'not_connected') {
      toast.error(t('whatsapp.send.error.notConnected'));
    } else if (reason === 'not_on_whatsapp') {
      toast.error(t('whatsapp.send.error.notOnWhatsapp'));
    } else if (reason === 'blocked') {
      toast.error(t('whatsapp.send.error.blocked'));
    } else if (reason === 'rate_limited') {
      toast.error(msg || t('whatsapp.send.error.rateLimited'));
    } else {
      toast.error(msg);
    }
  }
}
