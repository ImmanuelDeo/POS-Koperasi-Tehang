'use client';

import { useState, useRef } from 'react';
import {
  Package,
  Search,
  Barcode,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Truck,
  Scale,
  ClipboardCheck,
  Loader2,
  XCircle,
} from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import type { Product } from '@/lib/types';

export type BulkMode = 'receive' | 'adjust' | 'stock_opname';

export interface DraftStockItem {
  product_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  allow_decimal: boolean;
  system_stock: number;
  quantity_input: string; // kept as string for controlled typing
  unit_cost: string; // Rupiah cost
  reason: string;
}

interface BulkStockWorkspaceProps {
  products: Product[];
  onSuccess?: () => void;
}

const REASON_PRESETS = [
  'Stok Sesuai Fisik',
  'Barang Rusak / Kadaluarsa',
  'Barang Hilang / Selisih Fisik',
  'Koreksi Salah Input Kasir',
  'Bonus / Sample Supplier',
  'Retur Pembelian / Supplier',
  'Penerimaan Barang Supplier',
  'Lainnya (Ketik Manual)',
];

export default function BulkStockWorkspace({ products, onSuccess }: BulkStockWorkspaceProps) {
  const fmt = useFormatCurrency();
  const [mode, setMode] = useState<BulkMode>('stock_opname');
  const [draftItems, setDraftItems] = useState<DraftStockItem[]>([]);
  const [batchReference, setBatchReference] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);

  // Confirmation Modal state
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictError, setConflictError] = useState<{
    product_id: string;
    product_name: string;
    expected_stock: number;
    actual_stock: number;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── BARCODE SCANNER HOOK (Zero-Click HID Keyboard Listener) ────────────────
  useBarcodeScanner((scannedCode) => {
    handleBarcodeScanned(scannedCode);
  });

  const handleBarcodeScanned = async (code: string) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    // 1. Check if product is already in the draft list
    const existingIndex = draftItems.findIndex(
      (item) => item.barcode === cleanCode || item.sku === cleanCode
    );

    if (existingIndex >= 0) {
      const existing = draftItems[existingIndex];
      setHighlightedRowId(existing.product_id);
      toast.success(`Produk "${existing.name}" sudah ada di daftar (Baris #${existingIndex + 1})`, {
        icon: 'ℹ️',
        duration: 3000,
      });

      // Auto-focus input for that row
      setTimeout(() => {
        const inputEl = rowInputRefs.current[existing.product_id];
        if (inputEl) {
          inputEl.focus();
          inputEl.select();
        }
      }, 100);
      return;
    }

    // 2. Lookup product from backend or existing products array
    try {
      let matchedProd = products.find(
        (p) => p.barcode === cleanCode || p.sku === cleanCode
      );

      if (!matchedProd) {
        const { data } = await api.get('/products/lookup-barcode', {
          params: { code: cleanCode },
        });
        matchedProd = data.product;
      }

      if (!matchedProd) {
        toast.error(`Barcode "${cleanCode}" tidak terdaftar di sistem.`);
        return;
      }

      addProductToDraft(matchedProd);
    } catch (err: any) {
      const msg = err.response?.data?.error || `Gagal mencari barcode "${cleanCode}".`;
      toast.error(msg);
    }
  };

  const addProductToDraft = (product: Product) => {
    // Check if already in draft
    const alreadyExists = draftItems.some((i) => i.product_id === String(product.id));
    if (alreadyExists) {
      setHighlightedRowId(String(product.id));
      toast.success(`Produk "${product.name}" sudah ada di daftar draft.`);
      setTimeout(() => {
        rowInputRefs.current[String(product.id)]?.focus();
      }, 100);
      return;
    }

    const currentStock = Number(product.stock_quantity || 0);
    const initialInput =
      mode === 'receive'
        ? '1'
        : mode === 'adjust'
        ? '1'
        : String(currentStock); // in opname, default to current stock for convenience

    const defaultReason =
      mode === 'receive'
        ? 'Penerimaan Barang Supplier'
        : mode === 'adjust'
        ? 'Koreksi Salah Input Kasir'
        : 'Stok Sesuai Fisik';

    const newItem: DraftStockItem = {
      product_id: String(product.id),
      name: product.name,
      sku: product.sku || null,
      barcode: product.barcode || null,
      unit: product.unit || 'pcs',
      allow_decimal: Boolean(product.allow_decimal),
      system_stock: currentStock,
      quantity_input: initialInput,
      unit_cost: product.cost_price ? String(Math.round(Number(product.cost_price))) : '0',
      reason: defaultReason,
    };

    setDraftItems((prev) => [newItem, ...prev]);
    setSearchQuery('');
    setSearchResults([]);
    setHighlightedRowId(newItem.product_id);

    toast.success(`Ditambahkan: ${product.name}`, { duration: 2000 });

    // Focus newly added row input
    setTimeout(() => {
      rowInputRefs.current[newItem.product_id]?.focus();
      rowInputRefs.current[newItem.product_id]?.select();
    }, 150);
  };

  // Search input handler
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const q = query.toLowerCase().trim();
    const filtered = products
      .filter(
        (p) =>
          p.is_active !== false &&
          (p.name.toLowerCase().includes(q) ||
            (p.barcode && p.barcode.toLowerCase().includes(q)) ||
            (p.sku && p.sku.toLowerCase().includes(q)))
      )
      .slice(0, 8);

    setSearchResults(filtered);
  };

  // Update item field
  const updateDraftItem = (productId: string, field: keyof DraftStockItem, value: any) => {
    setDraftItems((prev) =>
      prev.map((item) => {
        if (item.product_id !== productId) return item;
        return { ...item, [field]: value };
      })
    );
  };

  // Remove item from draft
  const removeDraftItem = (productId: string) => {
    setDraftItems((prev) => prev.filter((i) => i.product_id !== productId));
  };

  // Calculate delta and new stock for an item
  const calculateItemDelta = (item: DraftStockItem): { delta: number; newStock: number; isValid: boolean } => {
    const rawVal = parseFloat(item.quantity_input.replace(/,/g, '.'));
    if (isNaN(rawVal) || !Number.isFinite(rawVal)) {
      return { delta: 0, newStock: item.system_stock, isValid: false };
    }

    let delta = 0;
    let newStock = item.system_stock;

    if (mode === 'receive') {
      delta = rawVal;
      newStock = item.system_stock + rawVal;
    } else if (mode === 'adjust') {
      delta = rawVal;
      newStock = item.system_stock + rawVal;
    } else if (mode === 'stock_opname') {
      newStock = rawVal;
      delta = rawVal - item.system_stock;
    }

    delta = Math.round(delta * 1000) / 1000;
    newStock = Math.round(newStock * 1000) / 1000;

    return { delta, newStock, isValid: true };
  };

  // Summaries
  const totalItemsCount = draftItems.length;
  let totalQtyIn = 0;
  let totalQtyOut = 0;
  let discrepancyRowsCount = 0;

  draftItems.forEach((item) => {
    const { delta, isValid } = calculateItemDelta(item);
    if (!isValid) return;
    if (delta > 0) totalQtyIn += delta;
    if (delta < 0) totalQtyOut += Math.abs(delta);
    if (delta !== 0) discrepancyRowsCount++;
  });

  // Mode change handler
  const handleModeChange = (newMode: BulkMode) => {
    if (newMode === mode) return;
    setMode(newMode);

    // Adjust existing draft inputs to match new mode
    setDraftItems((prev) =>
      prev.map((item) => {
        if (newMode === 'receive') {
          return {
            ...item,
            quantity_input: '1',
            reason: 'Penerimaan Barang Supplier',
          };
        } else if (newMode === 'adjust') {
          return {
            ...item,
            quantity_input: '1',
            reason: 'Koreksi Salah Input Kasir',
          };
        } else {
          // stock_opname
          return {
            ...item,
            quantity_input: String(item.system_stock),
            reason: 'Stok Sesuai Fisik',
          };
        }
      })
    );
  };

  // Validate before opening confirmation modal
  const handleOpenPreview = () => {
    if (draftItems.length === 0) {
      toast.error('Daftar produk masih kosong.');
      return;
    }

    for (let i = 0; i < draftItems.length; i++) {
      const item = draftItems[i];
      const { delta, isValid, newStock } = calculateItemDelta(item);

      if (!isValid) {
        toast.error(`Baris #${i + 1} (${item.name}): Kuantitas input tidak valid.`);
        rowInputRefs.current[item.product_id]?.focus();
        return;
      }

      if (!item.allow_decimal && delta % 1 !== 0) {
        toast.error(`Baris #${i + 1} (${item.name}): Satuan ${item.unit} tidak mendukung angka desimal.`);
        rowInputRefs.current[item.product_id]?.focus();
        return;
      }

      if (mode === 'receive' && delta <= 0) {
        toast.error(`Baris #${i + 1} (${item.name}): Kuantitas masuk harus lebih dari 0.`);
        rowInputRefs.current[item.product_id]?.focus();
        return;
      }

      if (mode === 'adjust' && delta === 0) {
        toast.error(`Baris #${i + 1} (${item.name}): Nilai penyesuaian tidak boleh 0.`);
        rowInputRefs.current[item.product_id]?.focus();
        return;
      }

      if (mode === 'stock_opname' && newStock < 0) {
        toast.error(`Baris #${i + 1} (${item.name}): Jumlah fisik tidak boleh negatif.`);
        rowInputRefs.current[item.product_id]?.focus();
        return;
      }

      if (mode === 'adjust' && !item.reason.trim() && !batchNotes.trim()) {
        toast.error(`Baris #${i + 1} (${item.name}): Alasan penyesuaian wajib diisi.`);
        return;
      }

      if (mode === 'stock_opname' && delta !== 0 && !item.reason.trim() && !batchNotes.trim()) {
        toast.error(`Baris #${i + 1} (${item.name}): Alasan selisih opname wajib diisi.`);
        return;
      }
    }

    setConflictError(null);
    setShowConfirmModal(true);
  };

  // Submit batch to backend
  const handleSubmitBatch = async () => {
    setIsSubmitting(true);
    setConflictError(null);

    try {
      const payloadItems = draftItems.map((item) => {
        const val = parseFloat(item.quantity_input.replace(/,/g, '.'));
        const costVal = parseFloat(item.unit_cost) || 0;
        return {
          product_id: item.product_id,
          expected_stock: item.system_stock,
          quantity_input: val,
          unit_cost: costVal > 0 ? costVal : undefined,
          reason: item.reason.trim() || undefined,
        };
      });

      const idempotencyKey = `IDEM-STK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const res = await api.post('/stock-movements/bulk', {
        mode,
        batch_reference: batchReference.trim() || undefined,
        notes: batchNotes.trim() || undefined,
        idempotency_key: idempotencyKey,
        items: payloadItems,
      });

      toast.success(res.data?.message || 'Batch mutasi stok berhasil diproses!', {
        duration: 5000,
        icon: '🎉',
      });

      setShowConfirmModal(false);
      setDraftItems([]);
      setBatchReference('');
      setBatchNotes('');

      if (onSuccess) onSuccess();
    } catch (err: any) {
      if (err.response?.status === 409 && err.response?.data?.conflict_item) {
        setConflictError(err.response.data.conflict_item);
        toast.error(err.response.data.error || 'Terjadi konflik stok terkini.', { duration: 6000 });
      } else {
        const msg = err.response?.data?.error || err.message || 'Gagal memproses batch stok.';
        toast.error(msg, { duration: 5000 });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reload current DB stock into draft after a conflict
  const handleRefreshStockInDraft = async () => {
    try {
      const { data } = await api.get('/products');
      const latestProds: Product[] = data.products || [];

      setDraftItems((prev) =>
        prev.map((item) => {
          const fresh = latestProds.find((p) => String(p.id) === item.product_id);
          if (fresh) {
            return { ...item, system_stock: Number(fresh.stock_quantity || 0) };
          }
          return item;
        })
      );

      setConflictError(null);
      toast.success('Stok sistem berhasil diperbarui dengan data terkini!');
    } catch {
      toast.error('Gagal memuat ulang data stok.');
    }
  };

  return (
    <div className="space-y-6">
      {/* ── TOP CONTROLS & MODE SELECTOR ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Package className="text-emerald-600" size={22} />
              Workspace Manajemen Stok & Opname
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Penerimaan stok massal, penyesuaian stok, dan rekonsiliasi opname fisik dengan scanner Blueprint BP-LITE X2D
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 bg-gray-100/90 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => handleModeChange('receive')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                mode === 'receive'
                  ? 'bg-white text-emerald-700 shadow-xs ring-1 ring-black/5'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Truck size={14} />
              1. Terima Stok
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('adjust')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                mode === 'adjust'
                  ? 'bg-white text-emerald-700 shadow-xs ring-1 ring-black/5'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Scale size={14} />
              2. Penyesuaian
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('stock_opname')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                mode === 'stock_opname'
                  ? 'bg-white text-emerald-700 shadow-xs ring-1 ring-black/5'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <ClipboardCheck size={14} />
              3. Stock Opname
            </button>
          </div>
        </div>

        {/* Search & Scanner Input Bar */}
        <div className="pt-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-8 relative">
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Scan barcode dengan scanner HID, atau cari nama / SKU produk..."
                className="w-full pl-10 pr-24 py-2.5 text-xs bg-gray-50/60 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md font-medium">
                <Barcode size={13} />
                <span>Scanner Siap</span>
              </div>
            </div>

            {/* Live Search Auto-Suggest Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl z-30 max-h-60 overflow-y-auto divide-y divide-gray-100 animate-in fade-in zoom-in-95 duration-100">
                {searchResults.map((prod) => (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => addProductToDraft(prod)}
                    className="w-full px-4 py-2.5 text-left hover:bg-emerald-50/50 flex items-center justify-between transition-colors group"
                  >
                    <div>
                      <p className="text-xs font-bold text-gray-900 group-hover:text-emerald-700">{prod.name}</p>
                      <p className="text-[11px] text-gray-400">
                        {prod.barcode ? `Barcode: ${prod.barcode}` : `SKU: ${prod.sku || '-'}`} • Stok Sistem: {prod.stock_quantity || 0} {prod.unit || 'pcs'}
                      </p>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 group-hover:bg-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
                      <Plus size={12} /> Tambah
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-4 flex items-center gap-2">
            <input
              type="text"
              value={batchReference}
              onChange={(e) => setBatchReference(e.target.value)}
              placeholder="No. Surat Jalan / Referensi (Opsional)"
              className="w-full px-3 py-2.5 text-xs bg-gray-50/60 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Mode Instruction Banner */}
        <div className="mt-3.5 p-3 rounded-xl bg-emerald-50/60 border border-emerald-100/80 flex items-start gap-2.5 text-xs text-emerald-800">
          {mode === 'receive' && (
            <>
              <Truck size={16} className="shrink-0 mt-0.5 text-emerald-600" />
              <div>
                <strong>Mode Penerimaan Stok (Restock):</strong> Tambahkan barang masuk dari supplier. Kuantitas input akan <strong>menambah (+)</strong> stok sistem.
              </div>
            </>
          )}
          {mode === 'adjust' && (
            <>
              <Scale size={16} className="shrink-0 mt-0.5 text-emerald-600" />
              <div>
                <strong>Mode Penyesuaian Stok:</strong> Masukkan nilai positif (+5) untuk menambah atau negatif (-2) untuk mengurangi stok rusak/hilang. <strong>Alasan wajib diisi</strong>.
              </div>
            </>
          )}
          {mode === 'stock_opname' && (
            <>
              <ClipboardCheck size={16} className="shrink-0 mt-0.5 text-emerald-600" />
              <div>
                <strong>Mode Stock Opname Fisik:</strong> Masukkan jumlah fisik aktual yang ada di rak toko. Sistem akan otomatis menghitung selisih (Fisik - Sistem). <strong>Alasan wajib diisi bila terdapat selisih</strong>.
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── DRAFT ITEMS TABLE ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-900 uppercase tracking-wider">
              Daftar Draft Mutasi ({draftItems.length} Produk)
            </span>
            {draftItems.length > 0 && (
              <span className="text-[11px] bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full font-semibold">
                {discrepancyRowsCount} baris berselisih
              </span>
            )}
          </div>
          {draftItems.length > 0 && (
            <button
              type="button"
              onClick={() => setDraftItems([])}
              className="text-xs text-red-600 hover:text-red-700 font-semibold flex items-center gap-1 hover:underline"
            >
              <Trash2 size={13} /> Kosongkan Draft
            </button>
          )}
        </div>

        {draftItems.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gray-100 flex items-center justify-center text-gray-400 mb-3">
              <Barcode size={28} />
            </div>
            <h3 className="text-sm font-bold text-gray-800">Draft Mutasi Masih Kosong</h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
              Gunakan barcode scanner Blueprint BP-LITE X2D atau ketik nama produk pada pencarian di atas untuk memasukkan barang ke draft.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/40 text-gray-500 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-3 w-10 text-center">#</th>
                  <th className="py-3 px-3 min-w-[180px]">Nama Produk</th>
                  <th className="py-3 px-2 w-20 text-center">Satuan</th>
                  <th className="py-3 px-3 w-24 text-right">Stok Sistem</th>
                  <th className="py-3 px-3 w-32 text-center">
                    {mode === 'receive' ? 'Kuantitas Masuk (+)' : mode === 'adjust' ? 'Penyesuaian (±)' : 'Jumlah Fisik Rak'}
                  </th>
                  <th className="py-3 px-3 w-28 text-right">Selisih (Δ)</th>
                  <th className="py-3 px-3 w-28 text-right">Stok Baru</th>
                  {mode === 'receive' && <th className="py-3 px-3 w-32">HPP Beli (Rp)</th>}
                  <th className="py-3 px-3 min-w-[200px]">Alasan / Keterangan</th>
                  <th className="py-3 px-2 w-10 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {draftItems.map((item, index) => {
                  const { delta, newStock, isValid } = calculateItemDelta(item);
                  const isHighlighted = highlightedRowId === item.product_id;

                  return (
                    <tr
                      key={item.product_id}
                      className={`hover:bg-gray-50/80 transition-colors ${
                        isHighlighted ? 'bg-emerald-50/60 ring-2 ring-emerald-500/50' : ''
                      }`}
                    >
                      <td className="py-3 px-3 text-center text-gray-400 font-medium text-[11px]">
                        {index + 1}
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-bold text-gray-900 leading-snug">{item.name}</p>
                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                          {item.barcode ? `BC: ${item.barcode}` : `SKU: ${item.sku || '-'}`}
                        </p>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="text-[11px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-md">
                          {item.unit}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-gray-700">
                        {item.system_stock} {item.unit}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <input
                          ref={(el) => {
                            rowInputRefs.current[item.product_id] = el;
                          }}
                          type="number"
                          step={item.allow_decimal ? '0.01' : '1'}
                          value={item.quantity_input}
                          onChange={(e) => updateDraftItem(item.product_id, 'quantity_input', e.target.value)}
                          className={`w-24 text-center py-1.5 px-2 text-xs font-black border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                            !isValid
                              ? 'border-red-400 bg-red-50 text-red-700'
                              : delta !== 0
                              ? 'border-emerald-300 bg-emerald-50/40 text-emerald-900 font-bold'
                              : 'border-gray-200 bg-white text-gray-900'
                          }`}
                        />
                      </td>
                      <td className="py-3 px-3 text-right">
                        {delta > 0 ? (
                          <span className="inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                            +{delta} {item.unit}
                          </span>
                        ) : delta < 0 ? (
                          <span className="inline-flex items-center text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-md">
                            {delta} {item.unit}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 font-medium">0 {item.unit}</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-gray-900">
                        <span className={newStock < 0 ? 'text-red-600 font-bold' : ''}>
                          {newStock} {item.unit}
                        </span>
                      </td>
                      {mode === 'receive' && (
                        <td className="py-3 px-3">
                          <input
                            type="number"
                            min={0}
                            value={item.unit_cost}
                            onChange={(e) => updateDraftItem(item.product_id, 'unit_cost', e.target.value)}
                            placeholder="0"
                            className="w-28 py-1.5 px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-right font-mono"
                          />
                        </td>
                      )}
                      <td className="py-3 px-3">
                        <div className="space-y-1">
                          <select
                            value={REASON_PRESETS.includes(item.reason) ? item.reason : 'Lainnya (Ketik Manual)'}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val !== 'Lainnya (Ketik Manual)') {
                                updateDraftItem(item.product_id, 'reason', val);
                              }
                            }}
                            className="w-full text-[11px] py-1 px-2 border border-gray-200 rounded-lg bg-gray-50/70 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          >
                            {REASON_PRESETS.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            maxLength={100}
                            value={item.reason}
                            onChange={(e) => updateDraftItem(item.product_id, 'reason', e.target.value)}
                            placeholder="Catatan / keterangan baris..."
                            className="w-full text-[11px] py-1 px-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-gray-300"
                          />
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeDraftItem(item.product_id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Hapus dari draft"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Batch Notes & Footer Action Bar */}
        {draftItems.length > 0 && (
          <div className="p-5 border-t border-gray-100 bg-gray-50/70 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Catatan Umum Batch (Opsional)
              </label>
              <input
                type="text"
                maxLength={200}
                value={batchNotes}
                onChange={(e) => setBatchNotes(e.target.value)}
                placeholder="Contoh: Penerimaan beras gudang timur, opname rutin tanggal 25"
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-gray-200/60">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div>
                  <span className="text-gray-500 font-medium">Total Item: </span>
                  <strong className="text-gray-900">{totalItemsCount} Produk</strong>
                </div>
                <div>
                  <span className="text-gray-500 font-medium">Total Masuk: </span>
                  <strong className="text-emerald-700">+{totalQtyIn} unit</strong>
                </div>
                <div>
                  <span className="text-gray-500 font-medium">Total Keluar: </span>
                  <strong className="text-red-600">-{totalQtyOut} unit</strong>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraftItems([])}
                >
                  Batal
                </Button>
                <Button
                  size="sm"
                  onClick={handleOpenPreview}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 shadow-xs"
                >
                  <ClipboardCheck size={14} className="mr-1.5" />
                  Preview & Simpan Batch
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── CONFIRMATION & PREVIEW MODAL ─────────────────────────────────── */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <ClipboardCheck className="text-emerald-600" size={18} />
                  Konfirmasi Batch Mutasi Stok (
                  {mode === 'receive' ? 'Penerimaan' : mode === 'adjust' ? 'Penyesuaian' : 'Stock Opname'})
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Tinjau seluruh baris perubahan sebelum memposting ke ledger mutasi database
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-200/60"
              >
                <XCircle size={18} />
              </button>
            </div>

            {/* Conflict Alert if any */}
            {conflictError && (
              <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-start justify-between gap-3 text-xs text-red-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Konflik Stok Terkini Terdeteksi!</p>
                    <p className="text-[11px] text-red-700 mt-0.5">
                      Produk <strong>{conflictError.product_name}</strong> memiliki stok aktual <strong>{conflictError.actual_stock}</strong> di database (berbeda dari {conflictError.expected_stock} saat draft dibuat).
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshStockInDraft}
                  className="px-2.5 py-1 text-xs font-bold text-red-700 bg-red-100 hover:bg-red-200 rounded-lg shrink-0 flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Muat Ulang Stok
                </button>
              </div>
            )}

            {/* Modal Body: Summary & Item List */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <div className="grid grid-cols-3 gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200/70 text-center">
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Jumlah Produk</p>
                  <p className="text-lg font-black text-gray-900">{totalItemsCount}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Total Masuk</p>
                  <p className="text-lg font-black text-emerald-700">+{totalQtyIn}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase">Total Keluar</p>
                  <p className="text-lg font-black text-red-600">-{totalQtyOut}</p>
                </div>
              </div>

              {batchReference && (
                <p className="text-xs text-gray-600">
                  <strong>No. Referensi:</strong> {batchReference}
                </p>
              )}
              {batchNotes && (
                <p className="text-xs text-gray-600">
                  <strong>Catatan:</strong> {batchNotes}
                </p>
              )}

              {/* Items breakdown */}
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-200">
                    <tr>
                      <th className="py-2 px-3">Produk</th>
                      <th className="py-2 px-3 text-center">Sebelum</th>
                      <th className="py-2 px-3 text-center">Selisih</th>
                      <th className="py-2 px-3 text-center">Sesudah</th>
                      <th className="py-2 px-3">Alasan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {draftItems.map((item) => {
                      const { delta, newStock } = calculateItemDelta(item);
                      return (
                        <tr key={item.product_id} className="hover:bg-gray-50">
                          <td className="py-2 px-3 font-semibold text-gray-900">{item.name}</td>
                          <td className="py-2 px-3 text-center text-gray-500">
                            {item.system_stock} {item.unit}
                          </td>
                          <td className="py-2 px-3 text-center font-bold">
                            {delta > 0 ? (
                              <span className="text-emerald-700">+{delta}</span>
                            ) : delta < 0 ? (
                              <span className="text-red-600">{delta}</span>
                            ) : (
                              <span className="text-gray-400">0</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center font-black text-gray-900">
                            {newStock} {item.unit}
                          </td>
                          <td className="py-2 px-3 text-gray-500 text-[11px] truncate max-w-[140px]">
                            {item.reason || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirmModal(false)}
                disabled={isSubmitting}
              >
                Batal
              </Button>
              <Button
                size="sm"
                onClick={handleSubmitBatch}
                disabled={isSubmitting || Boolean(conflictError)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 shadow-xs"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                    Menyimpan...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} className="mr-1.5" />
                    Posting Mutasi Stok
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
