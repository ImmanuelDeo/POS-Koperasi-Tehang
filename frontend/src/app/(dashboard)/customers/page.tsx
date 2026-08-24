'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';


import toast from 'react-hot-toast';
import { Plus, Search, X, Edit, Wallet, History, TrendingUp, TrendingDown, AlertCircle, FileText, FileDown, Download } from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';

import type { Customer } from '@/lib/types';
import { countryName } from '@/lib/countries';
import { dialCodeFor, parsePhone } from '@/lib/phone';
import { useI18n } from '@/hooks/useI18n';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';


export default function CustomersPage() {
  const { currentTenant } = useAuthStore();
  const { t } = useI18n();
  const fmt = useFormatCurrency();
  const defaultCountry = currentTenant?.country || 'IN';
  const dialCode = dialCodeFor(defaultCountry) || '+91';
  const searchParams = useSearchParams();
  const router = useRouter();
  const filter = searchParams.get('filter');
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc'|'desc'>('asc');
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const [form, setForm] = useState({ name: '', nik: '', phone: '', email: '', country_code: dialCode });

  // PDF Report Modal State
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportPeriodMonth, setReportPeriodMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [reportStatus, setReportStatus] = useState('all');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);
  const [ledgerData, setLedgerData] = useState<{ balance: number; transactions: { id: number; type: string; amount: number; description: string; created_at: string; expires_at?: string }[] } | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const openLedger = async (c: Customer) => {
    setLedgerCustomer(c);
    setLedgerData(null);
    setLedgerLoading(true);
    try {
      const { data } = await api.get(`/customers/${c.id}/wallet`);
      setLedgerData(data);
    } catch {
      toast.error(t('customer.ledgerLoadFailed'));
    } finally {
      setLedgerLoading(false);
    }
  };

  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return d; }
  };

  const fetchCustomers = async () => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (filter) params.filter = filter;
      if (sortField) params.sort = sortField;
      if (sortOrder) params.order = sortOrder;
      const { data } = await api.get('/customers', { params });
      setCustomers(data.data || []);
    } catch {
      toast.error(t('customer.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

   
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchCustomers(); }, [search, filter, sortField, sortOrder]);

  const openAdd = () => {
    setEditingCustomer(null);
    setForm({ name: '', nik: '', phone: '', email: '', country_code: dialCode });
    setShowForm(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setForm({
      name: c.name,
      nik: c.nik || c.nik_masked || '',
      phone: c.phone || '',
      email: c.email || '',
      country_code: c.country_code || dialCode
    });
    setShowForm(true);
  };

  const handleDownloadRekapPdf = async () => {
    setDownloadingPdf(true);
    try {
      const res = await api.get('/reports/salary-deductions/pdf', {
        params: {
          period_month: reportPeriodMonth,
          status: reportStatus,
        },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `laporan-rekap-potong-gaji-${reportPeriodMonth}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success('Laporan PDF rekap berhasil diunduh');
      setShowReportModal(false);
    } catch (err: any) {
      toast.error('Gagal mengunduh laporan PDF potong gaji');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadMemberPdf = async (c: Customer) => {
    try {
      const todayMonth = new Date().toISOString().slice(0, 7);
      const res = await api.get(`/reports/salary-deductions/members/${c.id}/pdf`, {
        params: {
          period_month: todayMonth,
        },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const safeId = (c.member_no || c.employee_id || String(c.id)).replace(/[^a-zA-Z0-9_-]/g, '_');
      link.download = `bon-potong-gaji-${safeId}-${todayMonth}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success(`Bon PDF untuk ${c.name} berhasil diunduh`);
    } catch (err: any) {
      toast.error('Gagal mengunduh bon potong gaji anggota');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    let cleanPhone = form.phone.trim();
    let phoneCountry = dialCode;

    if (cleanPhone) {
      const parsed = parsePhone(cleanPhone, defaultCountry);
      if (parsed) {
        cleanPhone = parsed.e164;
        phoneCountry = parsed.countryCode;
      }
    }

    const payload = {
      ...form,
      phone: cleanPhone || null,
      country_code: phoneCountry,
    };

    try {
      if (editingCustomer) {
        await api.put(`/customers/${editingCustomer.id}`, payload);
        toast.success(t('customer.updated'));
      } else {
        await api.post('/customers', payload);
        toast.success(t('customer.added'));
      }
      setShowForm(false);
      fetchCustomers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string; message?: string } } };
      toast.error(error.response?.data?.error || error.response?.data?.message || t('customer.saveFailed'));
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <span className="text-gray-300 w-3 inline-block ml-1 opacity-0 group-hover:opacity-100 transition-opacity">↕</span>;
    return sortOrder === 'asc' ? <TrendingUp size={12} className="inline ml-1 text-gray-500" /> : <TrendingDown size={12} className="inline ml-1 text-gray-500" />;
  };

  const onSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder(field === 'name' ? 'asc' : 'desc');
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-900">{t('nav.customers')}</h1>
          {filter === 'invalid_phones' && (
            <span className="bg-red-100 text-red-800 text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5">
              <AlertCircle size={14} /> Action Required
              <button onClick={() => router.push('/customers')} className="ml-1 text-red-500 hover:text-red-700">
                <X size={12} />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowReportModal(true)}
            className="border-teal-600 text-teal-700 hover:bg-teal-50"
          >
            <FileText size={16} className="mr-1.5" /> Laporan Potong Gaji (PDF)
          </Button>
          <Button onClick={openAdd}><Plus size={16} className="mr-1" /> {t('customer.add')}</Button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari berdasarkan NIK, Nama, atau No. Telepon..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand outline-none"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('name')}>
                {t('customers.columnCustomer')} <SortIcon field="name" />
              </th>
              <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase">
                NIK
              </th>
              <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('phone')}>
                {t('customer.phone')} <SortIcon field="phone" />
              </th>
              <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('last_visit')}>
                Last Visit <SortIcon field="last_visit" />
              </th>
              <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('visits')}>
                {t('customer.visits')} <SortIcon field="visits" />
              </th>
              <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('spent')}>
                {t('customer.totalSpent')} <SortIcon field="spent" />
              </th>
              <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('loyalty')}>
                {t('customer.loyaltyPoints')} <SortIcon field="loyalty" />
              </th>
              <th className="p-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="p-4">
                  <div className="font-semibold text-gray-900">{c.name}</div>
                  {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                </td>
                <td className="p-4">
                  {c.nik || c.nik_masked ? (
                    <span className="font-mono text-xs text-gray-900 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                      {c.nik || c.nik_masked}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      NIK belum dilengkapi
                    </span>
                  )}
                </td>
                <td className="p-4 text-gray-600 font-mono text-sm">{c.phone || '—'}</td>
                <td className="p-4 text-center text-sm text-gray-500 whitespace-nowrap">
                  {c.last_visit_at ? fmtDate(c.last_visit_at) : '—'}
                </td>
                <td className="p-4 text-center text-sm">{c.visits_count || 0}</td>
                <td className="p-4 text-right font-medium">{fmt(Number(c.total_spent || 0))}</td>
                <td className="p-4 text-right">
                  {Number(c.wallet_balance) > 0 ? (
                    <span className="inline-flex items-center gap-1 text-purple-700 font-semibold text-sm">
                      <Wallet size={13} />
                      {Number(c.wallet_balance).toLocaleString()} {t('customer.ptsSuffix')}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </td>
                <td className="p-4 text-right space-x-1 whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => handleDownloadMemberPdf(c)} title="Unduh Bon Potong Gaji Anggota (PDF)">
                    <FileDown size={14} className="text-teal-700" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(c)} title={t('customer.edit')}>
                    <Edit size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openLedger(c)} title={t('customer.viewLedgerTitle')}>
                    <History size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && <p className="text-center text-gray-500 py-12">{t('customers.empty')}</p>}
      </div>

      {/* PDF Report Generation Modal */}
      {showReportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl border border-gray-100">
            <div className="flex justify-between items-center mb-5 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-bold">
                  <FileText size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Laporan Potong Gaji (PDF)</h2>
                  <p className="text-xs text-gray-500">Ekspor rekapitulasi transaksi koperasi</p>
                </div>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Periode Bulan Laporan
                </label>
                <input
                  type="month"
                  value={reportPeriodMonth}
                  onChange={(e) => setReportPeriodMonth(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white text-sm font-medium transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  Filter Status Transaksi
                </label>
                <select
                  value={reportStatus}
                  onChange={(e) => setReportStatus(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white text-sm font-medium transition-all"
                >
                  <option value="all">Semua Status Transaksi</option>
                  <option value="confirmed">Disetujui HR (Confirmed)</option>
                  <option value="pending">Menunggu HR (Pending)</option>
                  <option value="rejected">Ditolak HR (Rejected)</option>
                  <option value="cancelled">Dibatalkan Kasir (Cancelled)</option>
                </select>
              </div>

              <div className="p-3 bg-teal-50/60 rounded-xl border border-teal-100 text-[11px] text-teal-800 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-600 inline-block" /> Keamanan & Privasi Data:
                </p>
                <p className="text-teal-700">
                  Nomor Induk Kependudukan (NIK) anggota akan otomatis disensor (masked) pada dokumen PDF untuk mematuhi regulasi privasi.
                </p>
              </div>

              <div className="pt-2 flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowReportModal(false)}
                  className="flex-1 rounded-xl"
                  disabled={downloadingPdf}
                >
                  Batal
                </Button>
                <Button
                  onClick={handleDownloadRekapPdf}
                  disabled={downloadingPdf}
                  className="flex-1 bg-teal-700 hover:bg-teal-800 text-white rounded-xl shadow-md flex items-center justify-center gap-2"
                >
                  <Download size={15} />
                  {downloadingPdf ? 'Membuat PDF...' : 'Unduh Laporan PDF'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loyalty Ledger Modal */}
      {ledgerCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{t('customers.loyaltyLedger')}</h2>
                <p className="text-sm text-gray-500">{ledgerCustomer.name}</p>
              </div>
              <button onClick={() => setLedgerCustomer(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            {ledgerLoading ? (
              <div className="flex-1 flex items-center justify-center py-12 text-gray-400">{t('customer.loadingLedger')}</div>
            ) : ledgerData ? (
              <>
                {/* Summary row */}
                <div className="flex items-center gap-6 px-6 py-4 bg-gray-50 border-b border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">{t('customers.totalBalance')}</p>
                    <p className="text-2xl font-bold text-gray-900">{ledgerData.balance} <span className="text-sm font-normal text-gray-500">{t('customer.ptsSuffix')}</span></p>
                  </div>
                </div>

                {/* Ledger table */}
                <div className="flex-1 overflow-y-auto">
                  {ledgerData.transactions.length === 0 ? (
                    <p className="text-center text-gray-400 py-12">{t('customers.noTransactions')}</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">{t('customers.columnDate')}</th>
                          <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">{t('customers.columnDescription')}</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">{t('customers.columnPoints')}</th>
                          <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">{t('customers.columnExpires')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {ledgerData.transactions.map((t: { id: number; type: string; amount: number; description: string; created_at: string; expires_at?: string }) => (
                          <tr key={t.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtDate(t.created_at)}</td>
                            <td className="px-4 py-3 text-gray-700">{t.description || '—'}</td>
                            <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1 ${
                                t.type === 'credit' ? 'text-green-600' : 'text-red-500'
                              }`}>
                                {t.type === 'credit'
                                  ? <TrendingUp size={12} />
                                  : <TrendingDown size={12} />}
                                {t.type === 'credit' ? '+' : '-'}{t.amount}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-gray-400 whitespace-nowrap">
                              {t.expires_at ? fmtDate(t.expires_at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editingCustomer ? t('customer.edit') : t('customer.add')}</h2>
              <button onClick={() => setShowForm(false)}><X size={20} className="text-gray-400" /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Nama Anggota / Pelanggan *</label>
                <input
                  type="text"
                  placeholder={t('customer.name')}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  NIK (Nomor Induk Kependudukan)
                </label>
                <input
                  type="text"
                  maxLength={16}
                  placeholder="16 Digit Angka"
                  value={form.nik}
                  onChange={(e) => setForm({ ...form, nik: e.target.value.replace(/\D/g, '').slice(0, 16) })}
                  className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand font-mono text-sm"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  {editingCustomer
                    ? 'Kosongkan jika NIK belum tersedia pada data lama'
                    : 'Format 16 digit angka (contoh: 3273010101900001)'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">No. Telepon / WhatsApp (Opsional)</label>
                <div className="flex items-stretch gap-2">
                  <input
                    type="tel"
                    placeholder={dialCode ? `${dialCode} ${t('customer.phone')}` : t('customer.phone')}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="flex-1 px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Email (Opsional)</label>
                <input
                  type="email"
                  placeholder={t('customer.email')}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-brand text-sm"
                />
              </div>

              <Button type="submit" className="w-full">{editingCustomer ? t('customer.update') : t('customer.add')}</Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}