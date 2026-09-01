import { create } from 'zustand';
import api from '@/lib/api';
import type { Category, Product } from '@/lib/types';
import { productCache } from '@/lib/lru-cache';

interface CatalogState {
  categories: Category[];
  selectedCategoryId: number | string | null;
  displayedProducts: Product[];
  categoryCache: Record<string, Product[]>;
  searchQuery: string;
  isSearching: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  lastFetchedAt: number | null;

  // Actions
  initCatalog: (force?: boolean) => Promise<void>;
  setSelectedCategory: (categoryId: number | string | null) => Promise<void>;
  setSearchQuery: (query: string) => void;
  searchProducts: (query: string, categoryId?: number | string | null) => Promise<void>;
  clearSearch: () => void;
  refreshCatalog: (silent?: boolean) => Promise<void>;
  updateProductStock: (productId: number | string, newStock: number) => void;
  patchProduct: (product: Product) => void;
  removeProduct: (productId: number | string) => void;
  invalidateCatalog: () => void;
}

const getCategoryKey = (catId: number | string | null) => (catId !== null && catId !== undefined ? `cat_${catId}` : 'all');

export const useCatalogStore = create<CatalogState>((set, get) => ({
  categories: [],
  selectedCategoryId: null,
  displayedProducts: [],
  categoryCache: {},
  searchQuery: '',
  isSearching: false,
  isLoading: false,
  isInitialized: false,
  lastFetchedAt: null,

  initCatalog: async (force = false) => {
    const { isInitialized, categoryCache, selectedCategoryId } = get();

    // If already initialized and not forced, do a silent background sync if needed
    if (isInitialized && !force) {
      const currentKey = getCategoryKey(selectedCategoryId);
      if (categoryCache[currentKey]?.length > 0) {
        // Data is already warm in memory! 0ms latency.
        return;
      }
    }

    if (!isInitialized) {
      set({ isLoading: true });
    }

    try {
      const [catRes, prodRes] = await Promise.all([
        api.get('/categories?active=1'),
        api.get('/products/search', { params: { limit: 30, active: true } }),
      ]);

      const categories: Category[] = catRes.data?.categories || [];
      const products: Product[] = prodRes.data?.products || [];

      // Warm up LRU cache
      for (const p of products) {
        productCache.set(String(p.id), p);
        if (p.barcode) productCache.set(String(p.barcode), p);
      }

      set((state) => ({
        categories,
        displayedProducts: state.searchQuery ? state.displayedProducts : products,
        categoryCache: {
          ...state.categoryCache,
          all: products,
        },
        isInitialized: true,
        isLoading: false,
        lastFetchedAt: Date.now(),
      }));
    } catch (err) {
      console.error('[CatalogStore] Failed to initialize catalog:', err);
      set({ isLoading: false });
    }
  },

  setSelectedCategory: async (categoryId: number | string | null) => {
    const { categoryCache } = get();
    const key = getCategoryKey(categoryId);

    // If already cached in memory, render immediately with 0ms latency
    const cached = categoryCache[key];
    if (cached && cached.length > 0) {
      set({
        selectedCategoryId: categoryId,
        searchQuery: '',
        isSearching: false,
        displayedProducts: cached,
        isLoading: false,
      });

      // Silent background refresh for this category
      try {
        const params: Record<string, any> = { limit: 30, active: true };
        if (categoryId) params.categoryId = String(categoryId);
        const res = await api.get('/products/search', { params });
        const freshProducts: Product[] = res.data?.products || [];

        for (const p of freshProducts) {
          productCache.set(String(p.id), p);
          if (p.barcode) productCache.set(String(p.barcode), p);
        }

        // Only update if user is still on this category and not searching
        if (get().selectedCategoryId === categoryId && !get().isSearching) {
          set((state) => ({
            displayedProducts: freshProducts,
            categoryCache: {
              ...state.categoryCache,
              [key]: freshProducts,
            },
          }));
        }
      } catch {
        // Silently keep cached data on background fetch failure
      }
      return;
    }

    // If not cached, fetch on-demand
    set({
      selectedCategoryId: categoryId,
      searchQuery: '',
      isSearching: false,
      isLoading: true,
    });

    try {
      const params: Record<string, any> = { limit: 30, active: true };
      if (categoryId) params.categoryId = String(categoryId);
      const res = await api.get('/products/search', { params });
      const products: Product[] = res.data?.products || [];

      for (const p of products) {
        productCache.set(String(p.id), p);
        if (p.barcode) productCache.set(String(p.barcode), p);
      }

      set((state) => ({
        displayedProducts: products,
        categoryCache: {
          ...state.categoryCache,
          [key]: products,
        },
        isLoading: false,
      }));
    } catch (err) {
      console.error('[CatalogStore] Failed to fetch category products:', err);
      set({ isLoading: false, displayedProducts: [] });
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  searchProducts: async (query: string, categoryId?: number | string | null) => {
    const trimmed = (query || '').trim();
    const effectiveCatId = categoryId !== undefined ? categoryId : get().selectedCategoryId;
    const catKey = getCategoryKey(effectiveCatId);

    if (!trimmed) {
      // Empty search -> restore cached category products instantly in 0ms
      const fallback = get().categoryCache[catKey] || get().categoryCache.all || [];
      set({
        searchQuery: '',
        isSearching: false,
        displayedProducts: fallback,
        isLoading: false,
      });
      return;
    }

    set({ searchQuery: query, isSearching: true, isLoading: true });

    try {
      const params: Record<string, any> = {
        q: trimmed,
        limit: 30,
        active: true,
      };
      if (effectiveCatId) {
        params.categoryId = String(effectiveCatId);
      }

      const res = await api.get('/products/search', { params });
      const items: Product[] = res.data?.products || [];

      // Warm up LRU cache
      for (const p of items) {
        productCache.set(String(p.id), p);
        if (p.barcode) productCache.set(String(p.barcode), p);
      }

      set({
        displayedProducts: items,
        isLoading: false,
      });
    } catch (err: any) {
      if (err.name !== 'CanceledError' && err.name !== 'AbortError') {
        console.error('[CatalogStore] Search failed:', err);
      }
      set({ isLoading: false });
    }
  },

  clearSearch: () => {
    const { selectedCategoryId, categoryCache } = get();
    const catKey = getCategoryKey(selectedCategoryId);
    const fallback = categoryCache[catKey] || categoryCache.all || [];
    set({
      searchQuery: '',
      isSearching: false,
      displayedProducts: fallback,
      isLoading: false,
    });
  },

  refreshCatalog: async (silent = false) => {
    if (!silent) set({ isLoading: true });

    try {
      const { selectedCategoryId, searchQuery } = get();
      const currentKey = getCategoryKey(selectedCategoryId);

      const [catRes, prodRes] = await Promise.all([
        api.get('/categories?active=1'),
        api.get('/products/search', {
          params: {
            limit: 30,
            active: true,
            ...(selectedCategoryId ? { categoryId: String(selectedCategoryId) } : {}),
            ...(searchQuery.trim() ? { q: searchQuery.trim() } : {}),
          },
        }),
      ]);

      const categories: Category[] = catRes.data?.categories || [];
      const freshProducts: Product[] = prodRes.data?.products || [];

      for (const p of freshProducts) {
        productCache.set(String(p.id), p);
        if (p.barcode) productCache.set(String(p.barcode), p);
      }

      set((state) => ({
        categories,
        displayedProducts: freshProducts,
        categoryCache: {
          ...state.categoryCache,
          [currentKey]: freshProducts,
        },
        isLoading: false,
        lastFetchedAt: Date.now(),
      }));
    } catch (err) {
      console.error('[CatalogStore] Failed to refresh catalog:', err);
      if (!silent) set({ isLoading: false });
    }
  },

  updateProductStock: (productId: number | string, newStock: number) => {
    const numId = Number(productId);
    const updateList = (list: Product[]) =>
      list.map((p) => (p.id === numId || String(p.id) === String(productId) ? { ...p, stock_quantity: newStock } : p));

    set((state) => {
      const updatedCache: Record<string, Product[]> = {};
      for (const [key, list] of Object.entries(state.categoryCache)) {
        updatedCache[key] = updateList(list);
      }

      return {
        displayedProducts: updateList(state.displayedProducts),
        categoryCache: updatedCache,
      };
    });
  },

  patchProduct: (product: Product) => {
    const numId = Number(product.id);
    const updateList = (list: Product[]) =>
      list.map((p) => (p.id === numId || String(p.id) === String(product.id) ? { ...p, ...product } : p));

    set((state) => {
      const updatedCache: Record<string, Product[]> = {};
      for (const [key, list] of Object.entries(state.categoryCache)) {
        updatedCache[key] = updateList(list);
      }

      return {
        displayedProducts: updateList(state.displayedProducts),
        categoryCache: updatedCache,
      };
    });
  },

  removeProduct: (productId: number | string) => {
    const idStr = String(productId);
    productCache.delete(idStr);

    const filterList = (list: Product[]) =>
      list.filter((p) => String(p.id) !== idStr);

    set((state) => {
      const updatedCache: Record<string, Product[]> = {};
      for (const [key, list] of Object.entries(state.categoryCache)) {
        updatedCache[key] = filterList(list);
      }

      return {
        displayedProducts: filterList(state.displayedProducts),
        categoryCache: updatedCache,
      };
    });
  },

  invalidateCatalog: () => {
    productCache.clear();
    set({
      categoryCache: {},
      isInitialized: false,
      searchQuery: '',
      isSearching: false,
    });
    get().initCatalog(true);
  },
}));
