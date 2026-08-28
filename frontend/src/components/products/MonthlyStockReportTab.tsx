'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import {
  FileSpreadsheet,
  Download,
  Calendar,
  Search,
  Filter,
  RefreshCw,
  Boxes,
  ArrowDownRight,
  ArrowUpRight,
  Package,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { Category } from '@/lib/types';

interface StockReportItem {
  product_id: string;
  product_name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  category_id: string | null;
  category_name: string | null;
  price: number;
  cost: number;
  current_stock: number;
  starting_stock: number;
  ending_stock: number;
  in_purchase: number;
  in_adjustment: number;
  in_opname: number;
  in_void: number;
  in_initial: number;
  total_in: number;
  out_sale: number;
  out_adjustment: number;
  out_opname: number;
  out_void: number;
  total_out: number;
  movement_count: number;
  stock_status: 'safe' | 'low' | 'out_of_stock';
}

interface StockReportSummary {
  total_products_tracked: number;
  total_starting_stock: number;
  total_in: number;
  total_out: number;
  total_ending_stock: number;
  breakdown_in: {
    purchase: number;
    adjustment: number;
    opname: number;
    void: number;
    initial: number;
  };
  breakdown_out: {
    sale: number;
    adjustment: number;
    opname: number;
    void: number;
  };
}

interface StockReportPeriod {
  year: number;
  month: number;
  monthStr: string;
  monthLabel: string;
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
  periodDescription: string;
  generatedAtWib: string;
}

export default function MonthlyStockReportTab() {
  // Current month string YYYY-MM
  const getDefaultMonthStr = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };

  const [month, setMonth] = useState<string>(getDefaultMonthStr());
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [committedSearch, setCommittedSearch] = useState<string>('');
  const [hideZeroBalance, setHideZeroBalance] = useState<boolean>(true); // default true (include_zero_balance = false)

  const [page, setPage] = useState<number>(1);
  const [perPage] = useState<number>(50);

  const [loading, setLoading] = useState<boolean>(true);
  const [exportingPdf, setExportingPdf] = useState<boolean>(false);
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  const [period, setPeriod] = useState<StockReportPeriod | null>(null);
  const [summary, setSummary] = useState<StockReportSummary | null>(null);
  const [items, setItems] = useState<StockReportItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    per_page: 50,
    total_records: 0,
    total_pages: 1,
  });

  const [showLargeExportWarning, setShowLargeExportWarning] = useState<boolean>(false);

  // Load Categories on mount
  useEffect(() => {
    api
      .get('/categories')
      .then((res) => {
        setCategories(res.data?.categories || res.data || []);
      })
      .catch(() => {});
  }, []);

  const fetchReportData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/stock-movements/monthly', {
        params: {
          month,
          category_id: selectedCategory || undefined,
          search: committedSearch || undefined,
          include_zero_balance: !hideZeroBalance,
          page,
          per_page: perPage,
        },
      });

      setPeriod(res.data?.period || null);
      setSummary(res.data?.summary || null);
      setItems(res.data?.items || []);
      setPagination(
        res.data?.pagination || {
          page: 1,
          per_page: perPage,
          total_records: 0,
          total_pages: 1,
        }
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Gagal memuat laporan stok');
    } finally {
      setLoading(false);
    }
  }, [month, selectedCategory, committedSearch, hideZeroBalance, page, perPage]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setCommittedSearch(search.trim());
  };

  const handleSetCurrentMonth = () => {
    setMonth(getDefaultMonthStr());
    setPage(1);
  };

  const handleSetPrevMonth = () => {
    const [y, m] = month.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevY = prevDate.getFullYear();
    const prevM = String(prevDate.getMonth() + 1).padStart(2, '0');
    setMonth(`${prevY}-${prevM}`);
    setPage(1);
  };

  // Download PDF Handler
  const handleDownloadPdf = async () => {
    setExportingPdf(true);
    try {
      const res = await api.get('/reports/stock-movements/monthly/pdf', {
        params: {
          month,
          category_id: selectedCategory || undefined,
          search: committedSearch || undefined,
          include_zero_balance: !hideZeroBalance,
        },
        responseType: 'blob',
      });

      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-stok-${month}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Dokumen PDF berhasil diunduh');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Gagal mengunduh dokumen PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  // Download CSV Handler
  const handleDownloadCsv = async () => {
    // If include_zero_balance is active and total records are huge, prompt explicit confirmation
    if (!hideZeroBalance && pagination.total_records > 5000 && !showLargeExportWarning) {
      setShowLargeExportWarning(true);
      return;
    }

    setExportingCsv(true);
    setShowLargeExportWarning(false);
    try {
      const res = await api.get('/reports/stock-movements/monthly/csv', {
        params: {
          month,
          category_id: selectedCategory || undefined,
          search: committedSearch || undefined,
          include_zero_balance: !hideZeroBalance,
        },
        responseType: 'blob',
      });

      const blob = new Blob([res.data], { type: 'text/csv; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-stok-${month}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Spreadsheet CSV berhasil diunduh');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Gagal mengunduh file CSV');
    } finally {
      setExportingCsv(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Filter Bar & Actions ────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Month & Preset Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex items-center">
              <Calendar size={16} className="absolute left-3 text-slate-400 pointer-events-none" />
              <input
                type="month"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setPage(1);
                }}
                className="pl-9 pr-3 py-2 text-sm font-semibold border border-slate-300 rounded-xl bg-slate-50 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all cursor-pointer"
              />
            </div>
            <button
              type="button"
              onClick={handleSetCurrentMonth}
              className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all ${
                month === getDefaultMonthStr()
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              Bulan Ini
            </button>
            <button
              type="button"
              onClick={handleSetPrevMonth}
              className="px-3 py-2 text-xs font-medium rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-all"
            >
              Bulan Lalu
            </button>
          </div>

          {/* Category, Search, and Export Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Category Dropdown */}
            <div className="relative">
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setPage(1);
                }}
                className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-xl bg-slate-50 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all cursor-pointer min-w-[150px]"
              >
                <option value="">Semua Kategori</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Input */}
            <form onSubmit={handleSearchSubmit} className="relative flex items-center">
              <Search size={14} className="absolute left-3 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Cari produk / barcode..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-xl bg-slate-50 hover:bg-white focus:bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all w-48 sm:w-60"
              />
            </form>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchReportData}
              disabled={loading}
              className="px-3 py-2 rounded-xl text-slate-600 hover:text-emerald-700 hover:border-emerald-500"
              title="Segarkan Data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </Button>

            {/* Download PDF Button */}
            <Button
              type="button"
              onClick={handleDownloadPdf}
              disabled={exportingPdf || loading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-3.5 py-2 rounded-xl shadow-sm flex items-center gap-1.5 transition-all"
            >
              {exportingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>Cetak / PDF</span>
            </Button>

            {/* Download CSV Button */}
            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={exportingCsv || loading}
              className="border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-all"
            >
              {exportingCsv ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} className="text-emerald-600" />}
              <span>Unduh CSV</span>
            </Button>
          </div>
        </div>

        {/* Toggle Filter: Sembunyikan produk tanpa mutasi dan saldo nol */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideZeroBalance}
              onChange={(e) => {
                setHideZeroBalance(e.target.checked);
                setPage(1);
              }}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
            />
            <span className="font-medium text-slate-700">
              Sembunyikan produk tanpa mutasi dan saldo nol (Default Aktif)
            </span>
          </label>

          {period && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>{period.periodDescription}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── KPI Summary Cards ───────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Products */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Package size={22} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Item Terdata</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">
                {summary.total_products_tracked.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Stok Awal: {summary.total_starting_stock.toLocaleString('id-ID')}
              </p>
            </div>
          </div>

          {/* Card 2: Total Inflows */}
          <div className="bg-white rounded-2xl p-4 border border-emerald-100 shadow-sm flex items-center gap-3.5 bg-emerald-50/20">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <ArrowDownRight size={22} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">Total Masuk</p>
              </div>
              <p className="text-xl font-bold text-emerald-700 mt-0.5">
                +{summary.total_in.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-emerald-600/80 mt-0.5 truncate" title={`Restock: ${summary.breakdown_in.purchase}, Opname: ${summary.breakdown_in.opname}, Adj: ${summary.breakdown_in.adjustment}, Void: ${summary.breakdown_in.void}`}>
                Restock: {summary.breakdown_in.purchase} | Adj/Opn: {summary.breakdown_in.adjustment + summary.breakdown_in.opname}
              </p>
            </div>
          </div>

          {/* Card 3: Total Outflows */}
          <div className="bg-white rounded-2xl p-4 border border-red-100 shadow-sm flex items-center gap-3.5 bg-red-50/20">
            <div className="w-11 h-11 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
              <ArrowUpRight size={22} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-red-800 uppercase tracking-wider">Total Keluar</p>
              <p className="text-xl font-bold text-red-700 mt-0.5">
                -{summary.total_out.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-red-600/80 mt-0.5 truncate" title={`Penjualan: ${summary.breakdown_out.sale}, Opname: ${summary.breakdown_out.opname}, Adj: ${summary.breakdown_out.adjustment}`}>
                Penjualan: {summary.breakdown_out.sale} | Adj/Opn: {summary.breakdown_out.adjustment + summary.breakdown_out.opname}
              </p>
            </div>
          </div>

          {/* Card 4: Total Ending Stock */}
          <div className="bg-white rounded-2xl p-4 border border-blue-100 shadow-sm flex items-center gap-3.5 bg-blue-50/20">
            <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Boxes size={22} />
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-800 uppercase tracking-wider">Saldo Akhir</p>
              <p className="text-xl font-bold text-blue-700 mt-0.5">
                {summary.total_ending_stock.toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-blue-600/80 mt-0.5">
                {period?.isCurrentMonth ? 'Posisi Real-time' : 'Posisi Akhir Periode'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation Modal for Massive CSV Export ────────────────────── */}
      {showLargeExportWarning && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-amber-600 mb-3">
              <AlertCircle size={24} />
              <h3 className="text-base font-bold text-slate-900">Konfirmasi Ekspor CSV Lengkap</h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Anda akan mengunduh seluruh data katalog termasuk produk tanpa pergerakan (
              <strong className="text-slate-900">{pagination.total_records.toLocaleString('id-ID')} baris produk</strong>).
              Proses pembuatan berkas mungkin memerlukan beberapa detik.
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLargeExportWarning(false)}
                className="rounded-xl"
              >
                Batal
              </Button>
              <Button
                size="sm"
                onClick={handleDownloadCsv}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl"
              >
                Lanjutkan Unduh CSV
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Table Section ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-3 text-center w-12">No</th>
                <th className="py-3.5 px-3">Kode / Barcode</th>
                <th className="py-3.5 px-3">Nama Produk</th>
                <th className="py-3.5 px-2 text-center w-16">Satuan</th>
                <th className="py-3.5 px-3">Kategori</th>
                <th className="py-3.5 px-3 text-right">Stok Awal</th>
                <th className="py-3.5 px-3 text-right text-emerald-700 bg-emerald-50/30">Masuk (+)</th>
                <th className="py-3.5 px-3 text-right text-red-700 bg-red-50/30">Keluar (-)</th>
                <th className="py-3.5 px-3 text-right font-bold text-slate-900 bg-blue-50/30">Saldo Akhir</th>
                <th className="py-3.5 px-3 text-center w-24">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2.5">
                      <Loader2 size={28} className="animate-spin text-emerald-600" />
                      <span className="text-xs font-medium">Menghitung rekonsiliasi mutasi stok...</span>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <FileSpreadsheet size={32} className="text-slate-300" />
                      <p className="text-sm font-semibold text-slate-600">Tidak ada data mutasi stok</p>
                      <p className="text-xs text-slate-400 max-w-sm">
                        Tidak ditemukan pergerakan barang pada periode dan filter yang dipilih. Coba nonaktifkan filter sembunyikan saldo nol.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item, idx) => {
                  const rowNumber = (pagination.page - 1) * pagination.per_page + idx + 1;
                  return (
                    <tr key={item.product_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 text-center text-slate-400 font-medium">{rowNumber}</td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-600">
                        {item.barcode || item.sku || '—'}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900 max-w-xs truncate" title={item.product_name}>
                          {item.product_name}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center text-slate-500 font-medium">
                        <span className="px-2 py-0.5 bg-slate-100 rounded text-[11px] font-mono">
                          {item.unit}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-500 font-medium">
                        {item.category_name || '—'}
                      </td>
                      <td className="py-3 px-3 text-right font-medium text-slate-700">
                        {item.starting_stock.toLocaleString('id-ID')}
                      </td>
                      <td
                        className="py-3 px-3 text-right font-semibold text-emerald-600 bg-emerald-50/20 group relative cursor-help"
                        title={`Restock: ${item.in_purchase}, Inisial: ${item.in_initial}, Opname (+): ${item.in_opname}, Adj (+): ${item.in_adjustment}, Void (+): ${item.in_void}`}
                      >
                        {item.total_in > 0 ? `+${item.total_in.toLocaleString('id-ID')}` : '0'}
                      </td>
                      <td
                        className="py-3 px-3 text-right font-semibold text-red-600 bg-red-50/20 group relative cursor-help"
                        title={`Penjualan: ${item.out_sale}, Opname (-): ${item.out_opname}, Adj (-): ${item.out_adjustment}, Void (-): ${item.out_void}`}
                      >
                        {item.total_out > 0 ? `-${item.total_out.toLocaleString('id-ID')}` : '0'}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900 bg-blue-50/20">
                        {item.ending_stock.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {item.stock_status === 'out_of_stock' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                            Habis
                          </span>
                        ) : item.stock_status === 'low' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                            Menipis
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                            Aman
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination Footer ───────────────────────────────────────────── */}
        {!loading && pagination.total_pages > 1 && (
          <div className="p-4 border-t border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div>
              Menampilkan{' '}
              <span className="font-semibold text-slate-800">
                {(pagination.page - 1) * pagination.per_page + 1}
              </span>{' '}
              sampai{' '}
              <span className="font-semibold text-slate-800">
                {Math.min(pagination.page * pagination.per_page, pagination.total_records)}
              </span>{' '}
              dari <span className="font-semibold text-slate-800">{pagination.total_records.toLocaleString('id-ID')}</span> produk
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pagination.page <= 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="px-3 py-1 font-medium text-slate-700">
                Halaman {pagination.page} dari {pagination.total_pages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
                disabled={pagination.page >= pagination.total_pages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
