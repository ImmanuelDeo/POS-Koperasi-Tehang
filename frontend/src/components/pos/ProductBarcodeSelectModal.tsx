'use client';

import React, { useEffect } from 'react';
import { Product } from '@/lib/types';
import { LABELS } from '@/lib/labels';
import { X, Check, Package } from 'lucide-react';

interface ProductBarcodeSelectModalProps {
  isOpen: boolean;
  barcode: string;
  products: Product[];
  onSelect: (product: Product) => void;
  onCancel: () => void;
}

export function ProductBarcodeSelectModal({
  isOpen,
  barcode,
  products,
  onSelect,
  onCancel,
}: ProductBarcodeSelectModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key >= '1' && e.key <= String(Math.min(9, products.length))) {
        const index = parseInt(e.key, 10) - 1;
        if (products[index]) {
          e.preventDefault();
          onSelect(products[index]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, products, onSelect, onCancel]);

  if (!isOpen || products.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[85vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-modal-title"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
          <div>
            <h3 id="barcode-modal-title" className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              {LABELS.product.multiple_match_title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Barcode: <span className="font-mono font-medium text-slate-700 dark:text-slate-300">{barcode}</span> ({products.length} produk terdaftar)
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            title="Batal (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Product Selection List */}
        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">
            {LABELS.product.multiple_match_desc}
          </p>

          {products.map((p, idx) => {
            const isOutOfStock = p.track_inventory && (p.stock_quantity ?? 0) <= 0;
            const keyShortcut = idx < 9 ? idx + 1 : null;

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                className={`w-full text-left p-3.5 rounded-lg border transition-all flex items-center justify-between gap-3 group ${
                  isOutOfStock
                    ? 'border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/40'
                    : 'border-slate-200 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 bg-white dark:bg-slate-800/80 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  {keyShortcut && (
                    <span className="flex-shrink-0 w-6 h-6 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono text-xs font-semibold flex items-center justify-center border border-slate-200 dark:border-slate-600 group-hover:border-emerald-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                      {keyShortcut}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 mt-0.5">
                      {p.category?.name && (
                        <span>{p.category.name}</span>
                      )}
                      <span>•</span>
                      <span>Satuan: <strong className="text-slate-700 dark:text-slate-300">{p.unit || 'pcs'}</strong></span>
                      <span>•</span>
                      <span>
                        Stok:{' '}
                        <strong className={isOutOfStock ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}>
                          {p.track_inventory ? p.stock_quantity ?? 0 : '∞'}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    Rp {Number(p.price || 0).toLocaleString('id-ID')}
                  </div>
                  {p.member_price !== undefined && p.member_price !== null && (
                    <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                      Anggota: Rp {Number(p.member_price).toLocaleString('id-ID')}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Tekan <kbd className="px-1.5 py-0.5 text-[10px] bg-slate-200 dark:bg-slate-700 rounded font-mono">1-9</kbd> untuk memilih cepat, atau <kbd className="px-1.5 py-0.5 text-[10px] bg-slate-200 dark:bg-slate-700 rounded font-mono">Esc</kbd> untuk batal.
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            {LABELS.actions.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
