'use client';

import { useState, useEffect, useRef } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import {
  Plus,
  Search,
  X,
  Edit,
  Wallet,
  History,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  FileText,
  FileDown,
  Download,
  Trash2,
  Building2,
  UserCheck,
  ShieldCheck,
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  RefreshCw,
  CreditCard,
} from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';

import type { Customer } from '@/lib/types';
import { dialCodeFor, parsePhone } from '@/lib/phone';
import { useI18n } from '@/hooks/useI18n';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

interface CsvValidationRow {
  row_number: number;
  name: string;
  nik: string | null;
  nik_masked: string | null;
  employee_id: string | null;
  member_no: string | null;
  department: string;
  phone: string | null;
  email: string | null;
  monthly_deduction_limit: number;
  salary_deduction_enabled: number;
}

interface CsvValidationError {
  row_number: number;
  field: string;
  message: string;
  value?: string;
}

interface CsvValidationResponse {
  valid: boolean;
  total_rows: number;
  valid_count: number;
  error_count: number;
  rows: CsvValidationRow[];
  errors: CsvValidationError[];
}

export default function CustomersPage() {
  const { currentTenant } = useAuthStore();
  const { t } = useI18n();
  const fmt = useFormatCurrency();
  const defaultCountry = currentTenant?.country || 'ID';
  const dialCode = dialCodeFor(defaultCountry) || '+62';
  const searchParams = useSearchParams();
  const router = useRouter();
  const filter = searchParams.get('filter');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const [form, setForm] = useState({
    name: '',
    nik: '',
    member_no: '',
    employee_id: '',
    department: 'Produksi',
    phone: '',
    email: '',
    address: '',
    is_member: true,
    salary_deduction_enabled: true,
    monthly_deduction_limit: '0',
    outstanding_deduction_limit: '0',
    notes: '',
    country_code: dialCode,
  });

  // PDF & Excel Report Modal State
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportPeriodMonth, setReportPeriodMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [reportStatus, setReportStatus] = useState('all');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);

  // CSV Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvContent, setCsvContent] = useState<string>('');
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [validatingCsv, setValidatingCsv] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [csvValidationResult, setCsvValidationResult] = useState<CsvValidationResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);
  const [ledgerData, setLedgerData] = useState<{
    balance: number;
    transactions: { id: number; type: string; amount: number; description: string; created_at: string; expires_at?: string }[];
  } | null>(null);
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
    try {
      return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return d;
    }
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
  useEffect(() => {
    fetchCustomers();
  }, [search, filter, sortField, sortOrder]);

  const openAdd = () => {
    setEditingCustomer(null);
    setForm({
      name: '',
      nik: '',
      member_no: '',
      employee_id: '',
      department: 'Produksi',
      phone: '',
      email: '',
      address: '',
      is_member: true,
      salary_deduction_enabled: true,
      monthly_deduction_limit: '0',
      outstanding_deduction_limit: '0',
      notes: '',
      country_code: dialCode,
    });
    setShowForm(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setForm({
      name: c.name || '',
      nik: c.nik || c.nik_masked || '',
      member_no: c.member_no || '',
      employee_id: c.employee_id || '',
      department: c.department || 'Umum',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      is_member: c.is_member !== undefined ? Boolean(c.is_member) : true,
      salary_deduction_enabled: c.salary_deduction_enabled !== undefined ? Boolean(c.salary_deduction_enabled) : true,
      monthly_deduction_limit: String(c.monthly_deduction_limit ?? 0),
      outstanding_deduction_limit: String(c.outstanding_deduction_limit ?? 0),
      notes: c.notes || '',
      country_code: c.country_code || dialCode,
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
    } catch {
      toast.error('Gagal mengunduh laporan PDF potong gaji');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadRekapExcel = async () => {
    setDownloadingExcel(true);
    try {
      const res = await api.get('/reports/salary-deductions/xlsx', {
        params: {
          period_month: reportPeriodMonth,
          status: reportStatus,
        },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `laporan-rekap-potong-gaji-${reportPeriodMonth}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success('Laporan Excel (.xlsx) rekap berhasil diunduh');
      setShowReportModal(false);
    } catch {
      toast.error('Gagal mengunduh laporan Excel potong gaji');
    } finally {
      setDownloadingExcel(false);
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
    } catch {
      toast.error('Gagal mengunduh bon potong gaji anggota');
    }
  };

  const handleDownloadMemberExcel = async (c: Customer) => {
    try {
      const todayMonth = new Date().toISOString().slice(0, 7);
      const res = await api.get(`/reports/salary-deductions/members/${c.id}/xlsx`, {
        params: {
          period_month: todayMonth,
        },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const safeId = (c.member_no || c.employee_id || String(c.id)).replace(/[^a-zA-Z0-9_-]/g, '_');
      link.download = `bon-potong-gaji-${safeId}-${todayMonth}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success(`Bon Excel (.xlsx) untuk ${c.name} berhasil diunduh`);
    } catch {
      toast.error('Gagal mengunduh bon Excel anggota');
    }
  };

  const handleDeleteCustomer = async (c: Customer) => {
    const confirmed = window.confirm(
      `Apakah Anda yakin ingin menghapus data "${c.name}"?\n\nJika member ini telah memiliki riwayat transaksi atau bon potongan gaji, akun akan dinonaktifkan (arsip) agar pembukuan keuangan tetap valid.`
    );
    if (!confirmed) return;

    try {
      const res = await api.delete(`/customers/${c.id}`);
      toast.success(res.data?.message || 'Data member berhasil dihapus');
      fetchCustomers();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || 'Gagal menghapus data member';
      toast.error(errorMsg);
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
      name: form.name.trim(),
      nik: form.nik ? form.nik.trim() : null,
      member_no: form.member_no ? form.member_no.trim() : null,
      employee_id: form.employee_id ? form.employee_id.trim() : null,
      department: form.department ? form.department.trim() : 'Umum',
      phone: cleanPhone || null,
      email: form.email ? form.email.trim() : null,
      address: form.address ? form.address.trim() : null,
      is_member: form.is_member ? 1 : 0,
      salary_deduction_enabled: form.salary_deduction_enabled ? 1 : 0,
      monthly_deduction_limit: Number(form.monthly_deduction_limit) || 0,
      outstanding_deduction_limit: Number(form.outstanding_deduction_limit) || 0,
      notes: form.notes ? form.notes.trim() : null,
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

  // ── CSV Import Handlers ───────────────────────────────────────────────────
  const handleDownloadCsvTemplate = async () => {
    try {
      const res = await api.get('/members-csv/template', { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'template-impor-member-koperasi.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success('Template CSV anggota berhasil diunduh');
    } catch {
      toast.error('Gagal mengunduh template CSV');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      setCsvContent(content);
      await validateCsvFile(content);
    };
    reader.readAsText(file);
  };

  const validateCsvFile = async (content: string) => {
    setValidatingCsv(true);
    setCsvValidationResult(null);
    try {
      const { data } = await api.post('/members-csv/preview', { csv: content });
      setCsvValidationResult(data);
      if (!data.valid) {
        toast.error(`Ditemukan ${data.error_count} kesalahan dalam format CSV`);
      } else {
        toast.success(`${data.valid_count} data member siap diimpor`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal memvalidasi konten CSV');
    } finally {
      setValidatingCsv(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!csvContent || !csvValidationResult?.valid) return;
    setImportingCsv(true);
    try {
      const { data } = await api.post('/members-csv/import', { csv: csvContent });
      toast.success(data.message || 'Data member berhasil diimpor!');
      setShowImportModal(false);
      setCsvContent('');
      setCsvFileName('');
      setCsvValidationResult(null);
      fetchCustomers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mengimpor data member dari CSV');
    } finally {
      setImportingCsv(false);
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
      {/* ── Header Actions ──────────────────────────────────────────────────── */}
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
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={handleDownloadCsvTemplate}
            className="border-gray-200 text-gray-700 hover:bg-gray-50 text-xs h-9"
          >
            <Download size={14} className="mr-1.5 text-gray-500" /> Unduh Template CSV
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              setCsvContent('');
              setCsvFileName('');
              setCsvValidationResult(null);
              setShowImportModal(true);
            }}
            className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 text-xs h-9"
          >
            <Upload size={14} className="mr-1.5" /> Import CSV Member
          </Button>

          <Button
            variant="outline"
            onClick={() => setShowReportModal(true)}
            className="border-teal-600 text-teal-700 hover:bg-teal-50 text-xs h-9"
          >
            <FileText size={14} className="mr-1.5" /> Laporan Bon (PDF)
          </Button>

          <Button onClick={openAdd} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-9 font-semibold">
            <Plus size={14} className="mr-1" /> {t('customer.add')}
          </Button>
        </div>
      </div>

      {/* ── Search Bar ──────────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari berdasarkan NIK, Nama Anggota, No. Anggota, ID Karyawan, atau No. HP..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none text-sm"
        />
      </div>

      {/* ── Customers & Members Table ───────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-xs">
        <table className="w-full">
          <thead className="bg-gray-50/80 border-b border-gray-100">
            <tr>
              <th className="text-left p-4 text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('name')}>
                Anggota / Pelanggan <SortIcon field="name" />
              </th>
              <th className="text-left p-4 text-xs font-semibold text-gray-600 uppercase">
                Departemen
              </th>
              <th className="text-left p-4 text-xs font-semibold text-gray-600 uppercase">
                NIK / No. Anggota
              </th>
              <th className="text-left p-4 text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('phone')}>
                {t('customer.phone')} <SortIcon field="phone" />
              </th>
              <th className="text-left p-4 text-xs font-semibold text-gray-600 uppercase">
                Limit & Bon Gaji
              </th>
              <th className="text-center p-4 text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('visits')}>
                {t('customer.visits')} <SortIcon field="visits" />
              </th>
              <th className="text-right p-4 text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('spent')}>
                {t('customer.totalSpent')} <SortIcon field="spent" />
              </th>
              <th className="text-right p-4 text-xs font-semibold text-gray-600 uppercase cursor-pointer hover:bg-gray-100 group transition-colors" onClick={() => onSort('loyalty')}>
                {t('customer.loyaltyPoints')} <SortIcon field="loyalty" />
              </th>
              <th className="p-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {customers.map((c) => {
              const monthlyLimit = Number(c.monthly_deduction_limit || 0);
              const monthlyUsage = Number(c.current_monthly_usage || 0);
              const remainingLimit = monthlyLimit > 0 ? Math.max(0, monthlyLimit - monthlyUsage) : Infinity;

              return (
                <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">{c.name}</span>
                      {c.is_member ? (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                          Anggota
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                          Umum
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                      {c.employee_id && <span>ID: {c.employee_id}</span>}
                      {c.employee_id && c.email && <span>•</span>}
                      {c.email && <span>{c.email}</span>}
                    </div>
                  </td>

                  <td className="p-4">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                      <Building2 size={12} className="text-slate-500" />
                      {c.department || 'Umum'}
                    </span>
                  </td>

                  <td className="p-4">
                    <div className="flex flex-col gap-1">
                      {c.nik || c.nik_masked ? (
                        <span className="font-mono text-xs text-gray-900 bg-gray-100 px-2 py-0.5 rounded border border-gray-200 w-fit">
                          {c.nik || c.nik_masked}
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 w-fit">
                          NIK belum ada
                        </span>
                      )}
                      {c.member_no && (
                        <span className="font-mono text-[11px] text-emerald-800 font-medium">
                          No: {c.member_no}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="p-4 text-gray-600 font-mono text-xs">{c.phone || '—'}</td>

                  <td className="p-4">
                    {c.salary_deduction_enabled ? (
                      <div className="flex flex-col gap-1 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            Limit: {monthlyLimit > 0 ? fmt(monthlyLimit) : 'Bebas Limit'}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500">
                          Sisa: <strong className="text-emerald-800 font-semibold">{monthlyLimit > 0 ? fmt(remainingLimit) : 'Bebas'}</strong>
                          {monthlyUsage > 0 && <span> • Terpakai: {fmt(monthlyUsage)}</span>}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                        Bon Nonaktif
                      </span>
                    )}
                  </td>

                  <td className="p-4 text-center text-sm">{c.visits_count || 0}</td>
                  <td className="p-4 text-right font-medium">{fmt(Number(c.total_spent || 0))}</td>

                  <td className="p-4 text-right">
                    {Number(c.wallet_balance) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-purple-700 font-semibold text-xs">
                        <Wallet size={13} />
                        {Number(c.wallet_balance).toLocaleString()} {t('customer.ptsSuffix')}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>

                  <td className="p-4 text-right space-x-1 whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => handleDownloadMemberExcel(c)} title="Unduh Bon Potong Gaji Anggota (Excel .xlsx)">
                      <FileSpreadsheet size={14} className="text-emerald-700" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDownloadMemberPdf(c)} title="Unduh Bon Potong Gaji Anggota (PDF)">
                      <FileDown size={14} className="text-teal-700" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(c)} title={t('customer.edit')}>
                      <Edit size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openLedger(c)} title={t('customer.viewLedgerTitle')}>
                      <History size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteCustomer(c)}
                      title="Hapus Member"
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {customers.length === 0 && <p className="text-center text-gray-500 py-12">{t('customers.empty')}</p>}
      </div>

      {/* ── CSV Import Modal ────────────────────────────────────────────────── */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100">
            {/* Modal Header */}
            <div className="flex justify-between items-center pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Import Anggota dari File CSV</h2>
                  <p className="text-xs text-gray-500">
                    Unggah daftar karyawan/member koperasi secara massal (batch)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4">
              {/* File Dropzone */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50/80 rounded-2xl p-6 text-center cursor-pointer transition-colors"
              >
                <Upload size={28} className="mx-auto text-emerald-600 mb-2" />
                <p className="text-xs font-bold text-gray-800">
                  {csvFileName ? `File Terpilih: ${csvFileName}` : 'Klik untuk memilih file CSV anggota'}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  Mendukung separator koma (,) atau titik-koma (;)
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {/* Validation Status */}
              {validatingCsv && (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-500">
                  <RefreshCw size={16} className="animate-spin text-emerald-600" />
                  <span>Memeriksa format data CSV...</span>
                </div>
              )}

              {csvValidationResult && (
                <div className="space-y-3">
                  {/* Summary Bar */}
                  <div className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                    csvValidationResult.valid ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'
                  }`}>
                    <div className="flex items-center gap-2">
                      {csvValidationResult.valid ? (
                        <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle size={18} className="text-red-600 shrink-0" />
                      )}
                      <div>
                        <strong>{csvValidationResult.valid ? 'File CSV Valid & Siap Diimpor' : 'Terdapat Kesalahan Validasi'}</strong>
                        <p className="text-[11px] opacity-80">
                          Total {csvValidationResult.total_rows} baris • {csvValidationResult.valid_count} valid • {csvValidationResult.error_count} error
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Errors List (if any) */}
                  {csvValidationResult.errors.length > 0 && (
                    <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5 max-h-36 overflow-y-auto">
                      <p className="text-[11px] font-bold text-red-800 uppercase tracking-wider">Rincian Error:</p>
                      {csvValidationResult.errors.map((err, idx) => (
                        <p key={idx} className="text-xs text-red-700 flex items-start gap-1">
                          <span>•</span>
                          <span><strong>Baris {err.row_number} [{err.field}]:</strong> {err.message}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Preview Rows Table */}
                  {csvValidationResult.rows.length > 0 && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-700">
                        Pratinjau Data Calon Member ({csvValidationResult.rows.length} baris):
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-gray-50/80 border-b border-gray-100 text-gray-500">
                            <tr>
                              <th className="p-2">Nama</th>
                              <th className="p-2">NIK</th>
                              <th className="p-2">ID Karyawan</th>
                              <th className="p-2">Departemen</th>
                              <th className="p-2 text-right">Limit (Rp)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {csvValidationResult.rows.map((r, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="p-2 font-semibold text-gray-900">{r.name}</td>
                                <td className="p-2 font-mono text-gray-600">{r.nik_masked || r.nik || '—'}</td>
                                <td className="p-2 font-mono text-gray-600">{r.employee_id || '—'}</td>
                                <td className="p-2 text-gray-600">{r.department}</td>
                                <td className="p-2 text-right font-medium text-emerald-700">
                                  {r.monthly_deduction_limit > 0 ? fmt(r.monthly_deduction_limit) : 'Bebas'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadCsvTemplate}
                className="text-xs"
              >
                <Download size={13} className="mr-1 text-gray-500" /> Unduh Template CSV
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowImportModal(false)}
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!csvValidationResult?.valid || importingCsv}
                  onClick={handleExecuteImport}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 shadow-sm"
                >
                  {importingCsv && <RefreshCw size={13} className="animate-spin" />}
                  Eksekusi Impor ({csvValidationResult?.valid_count || 0} Member)
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF Report Generation Modal ─────────────────────────────────────── */}
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
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Periode Bulan Penggajian (YYYY-MM)
                </label>
                <input
                  type="month"
                  value={reportPeriodMonth}
                  onChange={(e) => setReportPeriodMonth(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Status Transaksi Bon
                </label>
                <select
                  value={reportStatus}
                  onChange={(e) => setReportStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-teal-500 text-sm bg-white"
                >
                  <option value="all">Semua Status (Pending + Dikonfirmasi)</option>
                  <option value="confirmed">Hanya Dikonfirmasi (Confirmed)</option>
                  <option value="pending">Hanya Menunggu (Pending)</option>
                </select>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 pt-3 border-t border-gray-100">
                <Button variant="outline" onClick={() => setShowReportModal(false)} className="sm:w-24">
                  Batal
                </Button>
                <Button
                  onClick={handleDownloadRekapExcel}
                  disabled={downloadingExcel || downloadingPdf}
                  className="flex-1 bg-green-700 hover:bg-green-800 text-white rounded-xl shadow-md flex items-center justify-center gap-2 font-semibold text-xs"
                >
                  <FileSpreadsheet size={15} />
                  {downloadingExcel ? 'Membuat Excel...' : 'Unduh Excel (.xlsx)'}
                </Button>
                <Button
                  onClick={handleDownloadRekapPdf}
                  disabled={downloadingPdf || downloadingExcel}
                  className="flex-1 bg-teal-700 hover:bg-teal-800 text-white rounded-xl shadow-md flex items-center justify-center gap-2 font-semibold text-xs"
                >
                  <Download size={15} />
                  {downloadingPdf ? 'Membuat PDF...' : 'Unduh PDF'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Loyalty Ledger Modal ────────────────────────────────────────────── */}
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
                <div className="flex items-center gap-6 px-6 py-4 bg-gray-50 border-b border-gray-100">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">{t('customers.totalBalance')}</p>
                    <p className="text-2xl font-bold text-gray-900">{ledgerData.balance} <span className="text-sm font-normal text-gray-500">{t('customer.ptsSuffix')}</span></p>
                  </div>
                </div>

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
                                {t.type === 'credit' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
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

      {/* ── Add / Edit Customer Modal ───────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100">
            <div className="flex justify-between items-center pb-3 mb-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {editingCustomer ? 'Edit Data Anggota Koperasi' : 'Tambah Anggota / Pelanggan Baru'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Formulir lengkap pendaftaran anggota & penentuan limit potong gaji
                </p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Nama Lengkap <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: Ahmad Wijaya"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Departemen / Divisi Kerja <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white"
                    required
                  >
                    <option value="Produksi">Produksi</option>
                    <option value="Keuangan & Akuntansi">Keuangan & Akuntansi</option>
                    <option value="Gudang & Logistik">Gudang & Logistik</option>
                    <option value="SDM & Umum (HR/GA)">SDM & Umum (HR/GA)</option>
                    <option value="Maintenance & Fabrikasi">Maintenance & Fabrikasi</option>
                    <option value="Pabrik Sawit & Lapangan">Pabrik Sawit & Lapangan</option>
                    <option value="Pengurus Koperasi">Pengurus Koperasi</option>
                    <option value="Umum">Umum / Lainnya</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    NIK (Nomor Induk Kependudukan KTP)
                  </label>
                  <input
                    type="text"
                    maxLength={16}
                    placeholder="16 Digit Angka KTP"
                    value={form.nik}
                    onChange={(e) => setForm({ ...form, nik: e.target.value.replace(/\D/g, '').slice(0, 16) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Format 16 digit angka (contoh: 3273010101900001)</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Nomor Anggota Koperasi (Member No)
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: MBR-001"
                    value={form.member_no}
                    onChange={(e) => setForm({ ...form, member_no: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Kode identifikasi kartu anggota</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    ID Karyawan (Employee ID)
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: EMP-101"
                    value={form.employee_id}
                    onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Nomor induk karyawan di perusahaan</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    No. Telepon / WhatsApp
                  </label>
                  <input
                    type="tel"
                    placeholder="Contoh: 081234567890"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                  />
                </div>
              </div>

              {/* ── Limit Potong Gaji Fields ───────────────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200/80">
                <div>
                  <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center gap-1">
                    <CreditCard size={13} className="text-emerald-700" />
                    Limit Potongan Gaji Bulanan (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    placeholder="0 = Bebas Limit"
                    value={form.monthly_deduction_limit}
                    onChange={(e) => setForm({ ...form, monthly_deduction_limit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white font-semibold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">*Isi 0 untuk Bebas Limit (tanpa batas nominal)</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center gap-1">
                    <CreditCard size={13} className="text-emerald-700" />
                    Limit Outstanding Berjalan (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    placeholder="0 = Bebas Limit"
                    value={form.outstanding_deduction_limit}
                    onChange={(e) => setForm({ ...form, outstanding_deduction_limit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white font-semibold"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">*Batas total tagihan yang belum lunas</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    placeholder="nama@email.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Alamat Domisili</label>
                  <input
                    type="text"
                    placeholder="Alamat tempat tinggal / mes"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Catatan Tambahan</label>
                <textarea
                  rows={2}
                  placeholder="Keterangan khusus karyawan atau anggota..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                />
              </div>

              <div className="p-3.5 bg-gray-50 border border-gray-200 rounded-xl space-y-2.5">
                <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                  <ShieldCheck size={15} className="text-emerald-700" />
                  Hak Transaksi & Otoritas Koperasi
                </div>

                <div className="flex flex-col sm:flex-row gap-4 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={form.is_member}
                      onChange={(e) => setForm({ ...form, is_member: e.target.checked })}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Status Anggota Koperasi Aktif</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={form.salary_deduction_enabled}
                      onChange={(e) => setForm({ ...form, salary_deduction_enabled: e.target.checked })}
                      className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span>Aktifkan Fasilitas Potong Gaji (Bon)</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Batal
                </Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5">
                  {editingCustomer ? 'Simpan Perubahan' : 'Tambah Anggota'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}