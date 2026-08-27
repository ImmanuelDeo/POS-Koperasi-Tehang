'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  History,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  FileSpreadsheet,
  Calendar,
  Loader2,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface StockMovementEntry {
  id: number;
  product_id: string;
  movement_type: string;
  quantity: number;
  balance_before: number;
  balance_after: number;
  unit_cost: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  product_name: string | null;
  product_barcode: string | null;
  product_unit: string | null;
  created_by_name: string | null;
}

export default function StockHistoryTable() {
  const fmt = useFormatCurrency();
  const [movements, setMovements] = useState<StockMovementEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [movementTypeFilter, setMovementTypeFilter] = useState('');
  const [fromDateFilter, setFromDateFilter] = useState('');
  const [toDateFilter, setToDateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const fetchHistory = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(targetPage),
        per_page: '25',
      };

      if (movementTypeFilter) params.movement_type = movementTypeFilter;
      if (fromDateFilter) params.from_date = fromDateFilter;
      if (toDateFilter) params.to_date = toDateFilter;

      const { data } = await api.get('/stock-movements', { params });
      let list: StockMovementEntry[] = data.movements || [];

      // Local search filtering on product name / barcode / reference if search query present
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        list = list.filter(
          (m) =>
            (m.product_name && m.product_name.toLowerCase().includes(q)) ||
            (m.product_barcode && m.product_barcode.toLowerCase().includes(q)) ||
            (m.reference_id && m.reference_id.toLowerCase().includes(q)) ||
            (m.notes && m.notes.toLowerCase().includes(q))
        );
      }

      setMovements(list);
      setPage(data.pagination?.page || targetPage);
      setTotalPages(data.pagination?.total_pages || 1);
      setTotalCount(data.pagination?.total || list.length);
    } catch (err: any) {
      toast.error('Gagal memuat riwayat mutasi stok.');
    } finally {
      setLoading(false);
    }
  }, [movementTypeFilter, fromDateFilter, toDateFilter, searchQuery]);

  useEffect(() => {
    fetchHistory(1);
  }, [fetchHistory]);

  const formatDateTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch {
      return isoString;
    }
  };

  const getMovementTypeBadge = (type: string) => {
    switch (type) {
      case 'purchase':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            Terima Stok (Beli)
          </span>
        );
      case 'sale':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Penjualan Kasir
          </span>
        );
      case 'adjustment':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
            Penyesuaian
          </span>
        );
      case 'opname':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            Stock Opname
          </span>
        );
      case 'void':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
            Pembatalan (Void)
          </span>
        );
      case 'initial':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-200">
            Stok Awal
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-50 text-gray-600 border border-gray-200">
            {type}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* ── FILTER HEADER ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <History className="text-emerald-600" size={18} />
              Buku Besar Ledger Mutasi Stok
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Pencatatan mutasi stok otomatis, permanen, dan tidak dapat dimanipulasi
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchHistory(page)}
            disabled={loading}
            className="text-xs font-semibold self-start sm:self-auto"
          >
            <RefreshCw size={13} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Muat Ulang
          </Button>
        </div>

        {/* Filters Bar */}
        <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">Pencarian</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari produk / referensi..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">Jenis Mutasi</label>
            <select
              value={movementTypeFilter}
              onChange={(e) => setMovementTypeFilter(e.target.value)}
              className="w-full py-1.5 px-2.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Semua Jenis Mutasi</option>
              <option value="purchase">Terima Stok (Beli)</option>
              <option value="sale">Penjualan Kasir</option>
              <option value="adjustment">Penyesuaian</option>
              <option value="opname">Stock Opname</option>
              <option value="void">Pembatalan (Void)</option>
              <option value="initial">Stok Awal</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">Dari Tanggal</label>
            <input
              type="date"
              value={fromDateFilter}
              onChange={(e) => setFromDateFilter(e.target.value)}
              className="w-full py-1.5 px-2.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-600 mb-1">Sampai Tanggal</label>
            <input
              type="date"
              value={toDateFilter}
              onChange={(e) => setToDateFilter(e.target.value)}
              className="w-full py-1.5 px-2.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Quick Date Range Pills */}
        <div className="pt-2.5 flex items-center gap-1.5 flex-wrap text-xs border-t border-gray-100 mt-2.5">
          <span className="text-[11px] font-semibold text-gray-500 mr-1">Filter Cepat:</span>
          <button
            type="button"
            onClick={() => {
              const t = new Date().toISOString().slice(0, 10);
              setFromDateFilter(t);
              setToDateFilter(t);
            }}
            className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 font-semibold text-gray-600 transition-colors"
          >
            Hari Ini
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const past7 = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
              setFromDateFilter(past7);
              setToDateFilter(now.toISOString().slice(0, 10));
            }}
            className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 font-semibold text-gray-600 transition-colors"
          >
            7 Hari Terakhir
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              setFromDateFilter(`${year}-${month}-01`);
              setToDateFilter(now.toISOString().slice(0, 10));
            }}
            className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 font-semibold text-gray-600 transition-colors"
          >
            Bulan Ini
          </button>
          {(fromDateFilter || toDateFilter || movementTypeFilter || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setFromDateFilter('');
                setToDateFilter('');
                setMovementTypeFilter('');
                setSearchQuery('');
              }}
              className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-semibold transition-colors ml-auto"
            >
              Reset Filter
            </button>
          )}
        </div>
      </div>

      {/* ── MOVEMENTS TABLE ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <Loader2 size={24} className="animate-spin text-emerald-600 mx-auto mb-2" />
            <p className="text-xs text-gray-500">Memuat riwayat mutasi stok...</p>
          </div>
        ) : movements.length === 0 ? (
          <div className="py-16 text-center">
            <History size={28} className="text-gray-300 mx-auto mb-2" />
            <p className="text-xs font-bold text-gray-700">Belum Ada Riwayat Mutasi</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Belum ada pencatatan pergerakan stok sesuai filter yang dipilih
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-gray-500 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3">Waktu</th>
                  <th className="py-3 px-3">Produk</th>
                  <th className="py-3 px-3 text-center">Jenis Mutasi</th>
                  <th className="py-3 px-3 text-right">Jumlah (Δ)</th>
                  <th className="py-3 px-3 text-center">Sebelum → Sesudah</th>
                  <th className="py-3 px-3">No. Referensi / Batch</th>
                  <th className="py-3 px-3">Keterangan / Alasan</th>
                  <th className="py-3 px-3">Petugas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {movements.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="py-2.5 px-3 whitespace-nowrap text-gray-500 font-mono text-[11px]">
                      {formatDateTime(m.created_at)}
                    </td>
                    <td className="py-2.5 px-3">
                      <p className="font-bold text-gray-900">{m.product_name || `Produk #${m.product_id}`}</p>
                      {m.product_barcode && (
                        <p className="text-[10px] text-gray-400 font-mono">BC: {m.product_barcode}</p>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {getMovementTypeBadge(m.movement_type)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-black">
                      {m.quantity > 0 ? (
                        <span className="text-emerald-700">+{m.quantity} {m.product_unit || 'pcs'}</span>
                      ) : m.quantity < 0 ? (
                        <span className="text-red-600">{m.quantity} {m.product_unit || 'pcs'}</span>
                      ) : (
                        <span className="text-gray-400">0 {m.product_unit || 'pcs'}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-center whitespace-nowrap font-mono text-[11px]">
                      <span className="text-gray-500">{m.balance_before}</span>
                      <span className="text-gray-300 mx-1.5">→</span>
                      <span className="font-bold text-gray-900">{m.balance_after}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-gray-700">
                      {m.reference_id ? (
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-800">
                          {m.reference_id}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-gray-600 text-[11px] max-w-xs truncate">
                      {m.notes || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-[11px] whitespace-nowrap">
                      {m.created_by_name || m.created_by}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/60">
            <span className="text-xs text-gray-500">
              Halaman <strong>{page}</strong> dari <strong>{totalPages}</strong> ({totalCount} total mutasi)
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchHistory(page - 1)}
                disabled={page <= 1 || loading}
                className="h-8 text-xs px-2.5"
              >
                <ChevronLeft size={14} className="mr-1" /> Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchHistory(page + 1)}
                disabled={page >= totalPages || loading}
                className="h-8 text-xs px-2.5"
              >
                Selanjutnya <ChevronRight size={14} className="ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
