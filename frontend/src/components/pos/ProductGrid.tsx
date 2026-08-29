'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, Package, X } from 'lucide-react';
import type { Category, Product } from '@/lib/types';
import { useCartStore } from '@/store/cart';
import { usePosSettingsStore } from '@/store/pos-settings';
import { useCatalogStore } from '@/store/catalog';
import { nameToColor } from '@/lib/image-utils';
import TagBadge from './DietaryBadge';
import api from '@/lib/api';
import { useI18n } from '@/hooks/useI18n';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; activeBg: string; activeText: string }> = {
  red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', activeBg: 'bg-red-500', activeText: 'text-white' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', activeBg: 'bg-orange-500', activeText: 'text-white' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', activeBg: 'bg-amber-500', activeText: 'text-white' },
  yellow: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', activeBg: 'bg-yellow-500', activeText: 'text-white' },
  lime: { bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-200', activeBg: 'bg-lime-500', activeText: 'text-white' },
  green: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', activeBg: 'bg-green-500', activeText: 'text-white' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', activeBg: 'bg-emerald-500', activeText: 'text-white' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', activeBg: 'bg-teal-500', activeText: 'text-white' },
  cyan: { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200', activeBg: 'bg-cyan-500', activeText: 'text-white' },
  sky: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', activeBg: 'bg-sky-500', activeText: 'text-white' },
  blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', activeBg: 'bg-blue-500', activeText: 'text-white' },
  indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', activeBg: 'bg-indigo-500', activeText: 'text-white' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', activeBg: 'bg-violet-500', activeText: 'text-white' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', activeBg: 'bg-purple-500', activeText: 'text-white' },
  fuchsia: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200', activeBg: 'bg-fuchsia-500', activeText: 'text-white' },
  pink: { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', activeBg: 'bg-pink-500', activeText: 'text-white' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', activeBg: 'bg-rose-500', activeText: 'text-white' },
};

function getCategoryColorClasses(color: string | null | undefined) {
  if (!color) return null;
  return CATEGORY_COLORS[color.toLowerCase()] || null;
}

interface Props {
  categories?: Category[];
  products?: Product[];
  selectedCategory?: number | null;
  setSelectedCategory?: (id: number | null) => void;
  search?: string;
  setSearch?: (s: string) => void;
  currency?: string;
  onProductClick: (product: Product) => void;
  sidebarOpen?: boolean;
}

export default function ProductGrid({
  onProductClick,
  sidebarOpen = true,
}: Props) {
  const cart = useCartStore();
  const { showProductImages } = usePosSettingsStore();
  const { t } = useI18n();
  const fmt = useFormatCurrency();

  // Connected directly to global Zustand catalog cache
  const categories = useCatalogStore((s) => s.categories);
  const selectedCategory = useCatalogStore((s) => s.selectedCategoryId);
  const setSelectedCategory = useCatalogStore((s) => s.setSelectedCategory);
  const displayedProducts = useCatalogStore((s) => s.displayedProducts);
  const loading = useCatalogStore((s) => s.isLoading);
  const searchQuery = useCatalogStore((s) => s.searchQuery);
  const searchProducts = useCatalogStore((s) => s.searchProducts);
  const clearSearch = useCatalogStore((s) => s.clearSearch);
  const isInitialized = useCatalogStore((s) => s.isInitialized);
  const initCatalog = useCatalogStore((s) => s.initCatalog);

  const [inputVal, setInputVal] = useState(searchQuery);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize catalog once if not yet initialized
  useEffect(() => {
    if (!isInitialized) {
      initCatalog();
    }
  }, [isInitialized, initCatalog]);

  // Keep local inputVal in sync if store clears search
  useEffect(() => {
    setInputVal(searchQuery);
  }, [searchQuery]);

  // Fast typing handler with debounced search
  const handleInputChange = (val: string) => {
    setInputVal(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!val.trim()) {
      clearSearch();
      return;
    }

    // Snappy 180ms debounce for typing
    debounceTimerRef.current = setTimeout(() => {
      searchProducts(val, selectedCategory);
    }, 180);
  };

  const handleClearSearch = () => {
    setInputVal('');
    clearSearch();
  };

  return (
    <div data-testid="pos-product-grid" className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
      {/* Search & Category Filter Header */}
      <div className="shrink-0 mb-3">
        <div className="relative mb-2">
          {loading ? (
            <Loader2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-600 animate-spin" />
          ) : (
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          )}
          <input
            type="text"
            value={inputVal}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const trimmed = inputVal.trim();
              if (!trimmed) return;
              if (displayedProducts.length > 0) {
                const exact = displayedProducts.find(
                  (p) => p.barcode === trimmed || (p.sku && p.sku.toLowerCase() === trimmed.toLowerCase())
                );
                onProductClick(exact || displayedProducts[0]);
                handleClearSearch();
              }
            }}
            placeholder={t('pos.searchProducts')}
            className="w-full pl-9 pr-9 py-2 bg-white border border-gray-200 rounded-xl focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 outline-none transition-all text-sm shadow-2xs"
          />
          {inputVal && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full hover:bg-gray-100 transition-colors"
              title="Hapus pencarian"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Categories Horizontal Pills Bar */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none items-center">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shadow-2xs ${
              !selectedCategory
                ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t('pos.allCategories')}
          </button>
          {categories
            .filter((cat) => cat.id != null)
            .map((cat) => {
              const colorClasses = getCategoryColorClasses(cat.color);
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all shadow-2xs ${
                    isSelected
                      ? colorClasses
                        ? `${colorClasses.activeBg} ${colorClasses.activeText} font-semibold shadow-sm`
                        : 'bg-emerald-600 text-white font-semibold shadow-sm'
                      : colorClasses
                        ? `${colorClasses.bg} ${colorClasses.text} border ${colorClasses.border} hover:opacity-80`
                        : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
        </div>

        <div className="text-[11px] text-gray-500 font-medium mt-1 px-1 flex items-center justify-between">
          <span>
            Menampilkan <strong className="text-gray-700">{displayedProducts.length}</strong> produk
            {selectedCategory ? ' dalam kategori terpilih' : ''}.
          </span>
          <span className="text-gray-400 hidden sm:inline">Scan barcode atau ketik nama untuk produk lainnya</span>
        </div>
      </div>

      {/* Product Cards Grid */}
      <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
        {displayedProducts.length === 0 && loading ? (
          /* Skeletons while initial network fetch is running */
          <div className={`grid gap-3 ${sidebarOpen ? 'grid-cols-4' : 'grid-cols-5'}`}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="rounded-xl p-2.5 border border-gray-100 bg-white animate-pulse">
                <div className="w-full aspect-square bg-gray-200 rounded-lg mb-2" />
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-1" />
                <div className="h-3 bg-gray-100 rounded w-1/2 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : displayedProducts.length === 0 ? (
          /* Friendly empty state */
          <div className="flex flex-col items-center justify-center h-64 text-center p-6 bg-white rounded-2xl border border-dashed border-gray-200 shadow-2xs">
            <Package className="w-12 h-12 text-gray-300 mb-2 stroke-[1.5]" />
            <p className="text-sm font-semibold text-gray-700">Tidak ada produk ditemukan</p>
            <p className="text-xs text-gray-400 mt-1 max-w-sm">
              {inputVal
                ? `Tidak ada produk dengan kata kunci "${inputVal}". Coba kata kunci lain atau scan barcode produk langsung.`
                : 'Belum ada produk aktif dalam kategori ini.'}
            </p>
            {inputVal && (
              <button
                onClick={handleClearSearch}
                className="mt-3 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors"
              >
                Reset Pencarian
              </button>
            )}
          </div>
        ) : (
          <div
            className={`grid gap-3 ${
              sidebarOpen ? 'grid-cols-4' : 'grid-cols-5'
            }`}
          >
            {displayedProducts.map((product) => {
              const inCartQty = cart.items
                .filter((i) => i.product.id === product.id)
                .reduce((sum, i) => sum + i.quantity, 0);

              const isTracked = product.track_inventory === 1 || (product.track_inventory as any) === true;
              const availableStock = isTracked
                ? Math.max(0, Number(product.stock_quantity || 0) - inCartQty)
                : Infinity;
              const isOutOfStock = isTracked && Number(product.stock_quantity || 0) <= 0;
              const isCartFull = isTracked && availableStock <= 0;

              return (
                <div
                  key={product.id}
                  data-testid="pos-product-card"
                  onClick={() => {
                    if (isCartFull) return;
                    onProductClick(product);
                  }}
                  className={`rounded-xl p-2.5 border transition-all text-left relative group overflow-hidden ${
                    isCartFull
                      ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed select-none'
                      : 'bg-white border-gray-100 hover:border-emerald-600/40 hover:shadow-md cursor-pointer'
                  }`}
                >
                  {isTracked && (
                    <>
                      {isOutOfStock ? (
                        <span className="absolute top-2 left-2 bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded-full z-10 shadow-xs border border-red-200 pointer-events-none">
                          {t('pos.outOfStock')}
                        </span>
                      ) : isCartFull ? (
                        <span className="absolute top-2 left-2 bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full z-10 shadow-xs border border-amber-300 pointer-events-none">
                          Stok Maks. di Keranjang
                        </span>
                      ) : product.stock_quantity <= (product.low_stock_threshold || 0) ? (
                        <span className="absolute top-2 left-2 bg-orange-100 text-orange-700 text-[10px] font-bold px-2 py-0.5 rounded-full z-10 shadow-xs border border-orange-200 pointer-events-none">
                          {t('pos.lowStock')}
                        </span>
                      ) : null}
                    </>
                  )}
                  {inCartQty > 0 && (
                    <span className="absolute top-0 right-0 bg-emerald-600 text-white text-xs w-6 h-6 rounded-bl-lg flex items-center justify-center font-bold z-10 shadow-2xs">
                      {inCartQty}
                    </span>
                  )}

                  {showProductImages && (
                    <div className="w-full aspect-square rounded-lg mb-3 relative overflow-hidden">
                      {/* Always-visible background tile — no flash when image loads */}
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ backgroundColor: nameToColor(product.name) }}
                      >
                        <span className="text-2xl font-bold text-white/80">
                          {product.name.substring(0, 2).toUpperCase()}
                        </span>
                      </div>

                      {/* Image overlays the tile when available */}
                      {product.has_image && (
                        <img
                          src={`${api.defaults.baseURL}/products/${product.id}/image?t=${product.updated_at ? new Date(product.updated_at).getTime() : 0}`}
                          alt={product.name}
                          className="absolute inset-0 w-full h-full object-cover rounded-lg"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}

                      {Array.isArray(product.tags) && product.tags.length > 0 && (
                        <span className="absolute bottom-1.5 right-1.5 z-10">
                          <TagBadge tag={product.tags[0]} />
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-1 mb-1">
                    <h3 className="font-semibold text-gray-900 text-sm line-clamp-2 leading-snug flex-1">
                      {product.name}
                    </h3>
                    {product.unit && (
                      <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                        /{product.unit}
                      </span>
                    )}
                  </div>

                  {/* Stock information if tracked */}
                  {isTracked && (
                    <p className="text-[11px] text-gray-500 mb-1">
                      Stok:{' '}
                      <span
                        className={`font-semibold ${
                          product.stock_quantity <= 0
                            ? 'text-red-600'
                            : product.stock_quantity <= (product.low_stock_threshold || 5)
                              ? 'text-amber-600'
                              : 'text-gray-700'
                        }`}
                      >
                        {product.stock_quantity} {product.unit || 'pcs'}
                      </span>
                    </p>
                  )}

                  {/* Pricing layout */}
                  <div className="mt-1 pt-1 border-t border-gray-100">
                    <p className="text-emerald-600 font-bold text-sm">
                      {fmt(Number(product.price))}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
