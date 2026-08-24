'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Package, Folder, Puzzle, FileSpreadsheet, Download, Upload, CheckCircle, AlertCircle, AlertTriangle, Search } from 'lucide-react';
import type { Product, Category, AddonGroup } from '@/lib/types';
import TagBadge, { tagLabel } from '@/components/pos/DietaryBadge';
import ImageUploader from '@/components/products/ImageUploader';
import { getCurrencySymbol, getCountryByCode } from '@/lib/countries';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useConfirm } from '@/hooks/use-confirm';
import { nameToColor } from '@/lib/image-utils';
import { useI18n } from '@/hooks/useI18n';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';

const PRESET_TAGS = [
  { key: 'veg', labelKey: 'pos.tagVeg' },
  { key: 'non_veg', labelKey: 'pos.tagNonVeg' },
  { key: 'vegan', labelKey: 'pos.tagVegan' },
  { key: 'egg', labelKey: 'pos.tagEgg' },
  { key: 'spicy', labelKey: 'pos.tagSpicy' },
  { key: 'contains_nuts', labelKey: 'pos.tagContainsNuts' },
  { key: 'gluten_free', labelKey: 'pos.tagGlutenFree' },
  { key: 'dairy_free', labelKey: 'pos.tagDairyFree' },
  { key: 'new_arrival', labelKey: 'pos.tagNewArrival' },
  { key: 'bestseller', labelKey: 'pos.tagBestseller' },
  { key: 'organic', labelKey: 'pos.tagOrganic' },
  { key: 'fragrance_free', labelKey: 'pos.tagFragranceFree' },
  { key: 'limited', labelKey: 'pos.tagLimited' },
];

const CATEGORY_COLORS = [
  { key: '', labelKey: 'products.colorNone', bg: 'bg-gray-100', text: 'text-gray-600' },
  { key: 'red', labelKey: 'products.colorRed', bg: 'bg-red-100', text: 'text-red-700' },
  { key: 'orange', labelKey: 'products.colorOrange', bg: 'bg-orange-100', text: 'text-orange-700' },
  { key: 'amber', labelKey: 'products.colorAmber', bg: 'bg-amber-100', text: 'text-amber-700' },
  { key: 'yellow', labelKey: 'products.colorYellow', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  { key: 'lime', labelKey: 'products.colorLime', bg: 'bg-lime-100', text: 'text-lime-700' },
  { key: 'green', labelKey: 'products.colorGreen', bg: 'bg-green-100', text: 'text-green-700' },
  { key: 'emerald', labelKey: 'products.colorEmerald', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { key: 'teal', labelKey: 'products.colorTeal', bg: 'bg-teal-100', text: 'text-teal-700' },
  { key: 'cyan', labelKey: 'products.colorCyan', bg: 'bg-cyan-100', text: 'text-cyan-700' },
  { key: 'sky', labelKey: 'products.colorSky', bg: 'bg-sky-100', text: 'text-sky-700' },
  { key: 'blue', labelKey: 'products.colorBlue', bg: 'bg-blue-100', text: 'text-blue-700' },
  { key: 'indigo', labelKey: 'products.colorIndigo', bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { key: 'violet', labelKey: 'products.colorViolet', bg: 'bg-violet-100', text: 'text-violet-700' },
  { key: 'purple', labelKey: 'products.colorPurple', bg: 'bg-purple-100', text: 'text-purple-700' },
  { key: 'fuchsia', labelKey: 'products.colorFuchsia', bg: 'bg-fuchsia-100', text: 'text-fuchsia-700' },
  { key: 'pink', labelKey: 'products.colorPink', bg: 'bg-pink-100', text: 'text-pink-700' },
  { key: 'rose', labelKey: 'products.colorRose', bg: 'bg-rose-100', text: 'text-rose-700' },
];

function parseRupiahInput(val: any): number {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return Math.round(val);
  const clean = String(val).replace(/^(Rp|IDR|rp|idr)\.?\s*/i, '').replace(/\./g, '').replace(/,/g, '').trim();
  const n = Number(clean);
  return isNaN(n) ? 0 : Math.round(n);
}

function parseTagsArray(tags: any): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

type TabType = 'products' | 'categories' | 'addons';

export default function ProductsPage() {
  const { t } = useI18n();
  const { currentTenant } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const [editingAddonGroup, setEditingAddonGroup] = useState<AddonGroup | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', color: '', is_active: true });
  const [addonForm, setAddonForm] = useState({ name: '', description: '', is_required: false, allow_multiple_quantities: false, min_selection: 0, max_selection: 10 });
  const [showAddonModal, setShowAddonModal] = useState(false);

  const [addonList, setAddonList] = useState<{ id?: number | string; name: string; price: number; is_active?: boolean }[]>([]);
  const [form, setForm] = useState({
    name: '', category_id: '', price: '', cost_price: '', cb_percent: '0', sku: '', barcode: '',
    tax_type: 'none', tax_rate: '0', description: '',
    track_inventory: false, stock_quantity: '0', low_stock_threshold: '5', is_active: true,
    tags: [] as string[],
    customTag: '',
    addon_group_ids: [] as (number | string)[],
    image_url: null as string | null,
  });
  const [imageTouched, setImageTouched] = useState(false);

  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvType, setCsvType] = useState<'categories' | 'products' | 'addons'>('products');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvFileText, setCsvFileText] = useState<string>('');
  const [csvPreview, setCsvPreview] = useState<any | null>(null);
  const [csvValidating, setCsvValidating] = useState(false);
  const [csvResult, setCsvResult] = useState<Record<string, unknown> | null>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [catDeleteModal, setCatDeleteModal] = useState<{ open: boolean; id: number | null; name: string; productCount: number }>({ open: false, id: null, name: '', productCount: 0 });
  const [catReassignTo, setCatReassignTo] = useState<string>('');

  const currency = getCurrencySymbol(currentTenant?.currency || 'IDR', getCountryByCode(currentTenant?.country ?? 'ID')?.locale);
  const fmt = useFormatCurrency();
  const isRestaurant = (currentTenant?.business_type ?? 'restaurant') === 'restaurant';
  const isOwnerOrManager = currentTenant?.role === 'owner' || currentTenant?.role === 'manager';

  // ── 2D/1D Barcode Scanner Integration (Zero-Click Auto-Fill) ──────────────
  useBarcodeScanner(
    (code) => {
      const trimmed = code.trim();
      if (!trimmed) return;

      if (showForm) {
        // Modal Add/Edit Product is open: auto-fill the barcode field
        setForm((prev) => ({ ...prev, barcode: trimmed }));
        toast.success(`✓ Barcode [${trimmed}] berhasil dipindai ke formulir!`, {
          id: 'barcode-scan-toast',
          duration: 3000,
          icon: '🏷️',
        });
      } else if (activeTab === 'products') {
        // Modal is closed: filter/search products list
        setSearchQuery(trimmed);
        toast.success(`Filter barcode: ${trimmed}`, { id: 'barcode-filter-toast', duration: 2000 });
      }
    },
    {
      enabled: true,
      targetInputId: showForm ? 'product-barcode-input' : undefined,
      interceptEditable: true,
    }
  );

  const fetchData = async () => {
    try {
      const requests: Promise<{ data: Record<string, unknown> }>[] = [
        api.get('/products'),
        api.get('/categories'),
      ];
      if (isRestaurant) requests.push(api.get('/addon-groups'));
      const [prodRes, catRes, agRes] = await Promise.all(requests);
      setProducts((prodRes.data.products as Product[]) || []);
      setCategories((catRes.data.categories as Category[]) || []);
      if (agRes) setAddonGroups((agRes.data.addon_groups as AddonGroup[]) || []);
    } catch {
      toast.error(t('products.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const openCsvModal = (type: 'categories' | 'products' | 'addons' = 'products') => {
    setCsvType(type);
    setCsvFile(null);
    setCsvFileText('');
    setCsvPreview(null);
    setCsvResult(null);
    setShowCsvModal(true);
  };

  const downloadCsvTemplate = async () => {
    try {
      const res = await api.get('/catalog-csv/template', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'katalog-produk-koperasi-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Gagal mengunduh template CSV');
    }
  };

  const handleCsvFileSelect = async (file: File | null) => {
    setCsvFile(file);
    setCsvPreview(null);
    setCsvResult(null);
    if (!file) {
      setCsvFileText('');
      return;
    }

    setCsvValidating(true);
    try {
      const text = await file.text();
      setCsvFileText(text);
      const res = await api.post('/catalog-csv/preview', { csv: text });
      setCsvPreview(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Gagal memvalidasi CSV';
      toast.error(msg);
    } finally {
      setCsvValidating(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!csvFileText) return;
    setCsvUploading(true);
    try {
      const res = await api.post('/catalog-csv/import', { csv: csvFileText });
      setCsvResult(res.data?.result || res.data);
      toast.success(res.data?.message || 'Impor katalog berhasil');
      fetchData();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Gagal mengimpor katalog';
      toast.error(msg);
    } finally {
      setCsvUploading(false);
    }
  };

  const resetForm = () => {
    setForm({
      name: '', category_id: '', price: '', cost_price: '', cb_percent: '0', sku: '', barcode: '',
      tax_type: 'none', tax_rate: '0', description: '',
      track_inventory: false, stock_quantity: '0', low_stock_threshold: '5', is_active: true,
      tags: [], customTag: '', addon_group_ids: [], image_url: null,
    });
    setImageTouched(false);
    setEditingProduct(null);
    setShowForm(false);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    const safeTags = parseTagsArray(product.tags);
    setForm({
      name: product.name || '',
      category_id: product.category_id != null ? String(product.category_id) : '',
      price: String(product.price ?? ''),
      cost_price: String(product.cost_price ?? ''),
      cb_percent: String(product.cb_percent ?? 0),
      sku: product.sku || '',
      barcode: product.barcode || '',
      tax_type: 'none',
      tax_rate: '0',
      description: product.description || '',
      track_inventory: Boolean(product.track_inventory),
      stock_quantity: String(product.stock_quantity ?? '0'),
      low_stock_threshold: String(product.low_stock_threshold ?? '5'),
      is_active: Boolean(product.is_active),
      tags: safeTags,
      customTag: '',
      addon_group_ids: product.addon_groups?.map((g) => g.id) || [],
      image_url: product.has_image ? 'EXISTING' : null,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsedPrice = parseRupiahInput(form.price);
      const parsedCost = form.cost_price ? parseRupiahInput(form.cost_price) : null;
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        category_id: form.category_id || null,
        price: parsedPrice,
        cost_price: parsedCost,
        cb_percent: Number(form.cb_percent) || 0,
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        tax_type: 'none',
        tax_rate: 0,
        description: form.description?.trim() || null,
        track_inventory: form.track_inventory,
        stock_quantity: Number(form.stock_quantity) || 0,
        low_stock_threshold: Number(form.low_stock_threshold) || 0,
        is_active: form.is_active,
        tags: form.tags && form.tags.length > 0 ? form.tags : null,
        addon_group_ids: form.addon_group_ids || [],
      };

      // Only include image_url when the user actually touched the image field
      // (avoids sending 50KB payloads when the image wasn't changed)
      if (imageTouched) {
        payload.image_url = form.image_url; // Can be a data URI or null (to clear)
      }

      if (editingProduct) {
        await api.put(`/products/${editingProduct.id}`, payload);
        toast.success(t('products.updated'));
      } else {
        await api.post('/products', payload);
        toast.success(t('products.created'));
      }
      resetForm();
      fetchData();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { errors?: Record<string, string[]>; error?: string } } };
      const firstError = error.response?.data?.errors
        ? Object.values(error.response.data.errors)[0]?.[0]
        : error.response?.data?.error || t('products.failedToSave');
      toast.error(firstError);
    }
  };

  const handleDelete = async (id: number) => {
    if (!await confirm(t('products.deleteConfirm'), { destructive: true, confirmLabel: t('common.delete') })) return;
    try {
      await api.delete(`/products/${id}`);
      toast.success(t('products.deleted'));
      fetchData();
    } catch {
      toast.error(t('common.failedToDelete'));
    }
  };

  const resetCategoryForm = () => {
    setCategoryForm({ name: '', description: '', color: '', is_active: true });
    setEditingCategory(null);
    setShowForm(false);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCategoryForm({ name: cat.name, description: cat.description || '', color: cat.color || '', is_active: cat.is_active });
    setShowForm(true);
  };

  const handleCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { name: categoryForm.name, description: categoryForm.description || null, color: categoryForm.color || null, is_active: categoryForm.is_active };
      if (editingCategory) {
        await api.put(`/categories/${editingCategory.id}`, payload);
        toast.success(t('products.categoryUpdated'));
      } else {
        await api.post('/categories', payload);
        toast.success(t('products.categoryCreated'));
      }
      resetCategoryForm();
      fetchData();
    } catch (err) {
      console.error('[Category] Save error:', err);
      toast.error(t('products.failedToSaveCategory'));
    }
  };

  const handleCategoryDelete = async (id: number, name: string) => {
    const productCount = products.filter(p => p.category_id === id).length;
    if (productCount > 0) {
      setCatReassignTo('');
      setCatDeleteModal({ open: true, id, name, productCount });
      return;
    }

    try {
      await api.delete(`/categories/${id}`);
      toast.success(t('products.categoryDeleted'));
      fetchData();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string; productCount?: number } } };
      if (e?.response?.status === 400 && e?.response?.data?.productCount) {
        setCatReassignTo('');
        setCatDeleteModal({ open: true, id, name, productCount: e.response.data.productCount });
      } else {
        toast.error(e?.response?.data?.error || t('common.failedToDelete'));
      }
    }
  };

  const handleCategoryReassignDelete = async () => {
    if (!catDeleteModal.id || !catReassignTo) return;
    try {
      await api.delete(`/categories/${catDeleteModal.id}?action=reassign&reassign_to=${catReassignTo}`);
      toast.success(t('products.reassignAndDelete'));
      setCatDeleteModal({ open: false, id: null, name: '', productCount: 0 });
      fetchData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error || t('common.failedToDelete'));
    }
  };

  const handleCategoryForceDelete = async () => {
    if (!catDeleteModal.id) return;
    try {
      await api.delete(`/categories/${catDeleteModal.id}?action=delete_all`);
      toast.success(t('products.categoryAndProductsDeleted'));
      setCatDeleteModal({ open: false, id: null, name: '', productCount: 0 });
      fetchData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error || t('common.failedToDelete'));
    }
  };

  const resetAddonForm = () => {
    setAddonForm({ name: '', description: '', is_required: false, allow_multiple_quantities: false, min_selection: 0, max_selection: 10 });
    setEditingAddonGroup(null);
    setShowAddonModal(false);
    setAddonList([]);
  };

  const openEditAddonGroup = (group: AddonGroup) => {
    setEditingAddonGroup(group);
    setAddonForm({ name: group.name, description: group.description || '', is_required: Boolean(group.is_required), allow_multiple_quantities: Boolean(group.allow_multiple_quantities), min_selection: group.min_selection, max_selection: group.max_selection });
    setAddonList(group.addons?.map((a) => ({ id: a.id, name: a.name, price: a.price, is_active: Boolean(a.is_active) })) || []);
    setShowAddonModal(true);
  };

  const handleAddonGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { name: addonForm.name, description: addonForm.description || null, is_required: addonForm.is_required, allow_multiple_quantities: addonForm.allow_multiple_quantities, min_selection: addonForm.min_selection, max_selection: addonForm.max_selection, addons: addonList };
      if (editingAddonGroup) {
        await api.put(`/addon-groups/${editingAddonGroup.id}`, payload);
        toast.success(t('products.addonGroupUpdated'));
      } else {
        await api.post('/addon-groups', payload);
        toast.success(t('products.addonGroupCreated'));
      }
      resetAddonForm();
      fetchData();
    } catch { toast.error(t('products.failedToSaveAddonGroup')); }
  };

  const handleAddonGroupDelete = async (id: number | string) => {
    if (!await confirm(t('products.deleteAddonGroupConfirm'), { destructive: true, confirmLabel: t('common.delete') })) return;
    try {
      await api.delete(`/addon-groups/${id}`);
      toast.success(t('products.addonGroupDeleted'));
      fetchData();
    } catch { toast.error(t('common.failedToDelete')); }
  };

  const addAddonItem = () => setAddonList((prev) => [...prev, { name: '', price: 0 }]);
  const updateAddonItem = (idx: number, field: string, value: string | number) => setAddonList((prev) => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  const removeAddonItem = (idx: number) => setAddonList((prev) => prev.filter((_, i) => i !== idx));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('products.title')}</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b">
        <button onClick={() => setActiveTab('products')} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === 'products' ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Package size={16} /> {t('products.tabProducts')}
        </button>
        <button onClick={() => setActiveTab('categories')} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === 'categories' ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Folder size={16} /> {t('products.tabCategories')}
        </button>
        {isRestaurant && (
          <button onClick={() => setActiveTab('addons')} className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${activeTab === 'addons' ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <Puzzle size={16} /> {t('products.tabAddonGroups')}
          </button>
        )}
      </div>

      {activeTab === 'products' && (
        <>
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama, SKU, atau scan barcode produk..."
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand outline-none"
              />
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" onClick={() => openCsvModal('products')}>
                <FileSpreadsheet size={16} className="mr-1" /> CSV
              </Button>
              <Button onClick={() => { resetForm(); setShowForm(true); }}>
                <Plus size={16} className="mr-1" /> {t('products.addProduct')}
              </Button>
            </div>
          </div>

      {/* Product Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnProduct')}</th>
              <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnCategory')}</th>
              <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">Add-ons</th>
              <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnPrice')}</th>
              <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnStock')}</th>
              <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnStatus')}</th>
              <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products
              .filter((product) => {
                if (!searchQuery.trim()) return true;
                const q = searchQuery.toLowerCase().trim();
                return (
                  (product.name && product.name.toLowerCase().includes(q)) ||
                  (product.sku && product.sku.toLowerCase().includes(q)) ||
                  (product.barcode && product.barcode.toLowerCase().includes(q))
                );
              })
              .map((product) => {
              const parentCat = categories.find((c) => String(c.id) === String(product.category_id || product.category?.id));
              const isCategoryInactive = Boolean(parentCat && !parentCat.is_active);
              const safeTags = parseTagsArray(product.tags);
              return (
              <tr key={product.id} className="hover:bg-gray-50">
                <td className="p-4 max-w-[220px]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 relative flex items-center justify-center">
                      <div
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ backgroundColor: nameToColor(product.name || 'P') }}
                      >
                        <span className="text-sm font-bold text-white/80">
                          {(product.name || 'P').substring(0, 2).toUpperCase()}
                        </span>
                      </div>
                      {product.has_image && (
                        <img 
                          src={`${api.defaults.baseURL}/products/${product.id}/image?t=${product.updated_at ? new Date(product.updated_at).getTime() : 0}`}
                          alt="" 
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{product.name}</p>
                      {product.sku && <p className="text-xs text-gray-400 mt-0.5">{t('products.skuLabel', { sku: product.sku })}</p>}
                      {product.barcode && <p className="text-xs text-gray-400 mt-0.5 font-mono">{t('products.barcodeLabel', { barcode: product.barcode })}</p>}
                      {safeTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {safeTags.map((tag: string) => <TagBadge key={tag} tag={tag} />)}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="p-4 text-sm text-gray-600">
                  <div className="flex flex-col gap-0.5">
                    <span>{product.category?.name || parentCat?.name || '—'}</span>
                    {isCategoryInactive && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 w-fit" title="Parent category is inactive; product is hidden on POS">
                        <AlertTriangle size={11} className="shrink-0" /> Category Inactive
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-4 text-center">
                  {product.addon_groups && product.addon_groups.length > 0 ? (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {product.addon_groups.length} {product.addon_groups.length === 1 ? 'group' : 'groups'}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </td>
                <td className="p-4 text-right">
                  <p className="font-medium">{fmt(Number(product.price || 0))}</p>
                  {product.cost_price != null && product.cost_price > 0 && <p className="text-xs text-gray-400">Cost: {fmt(Number(product.cost_price))}</p>}
                </td>
                <td className="p-4 text-center">
                  {product.track_inventory ? (
                    <span className={`text-sm font-medium ${(product.stock_quantity ?? 0) <= (product.low_stock_threshold || 0) ? 'text-red-600' : 'text-gray-900'}`}>
                      {(product.stock_quantity ?? 0) <= 0 ? t('pos.outOfStock') : product.stock_quantity}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </td>
                <td className="p-4 text-center">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    product.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {product.is_active ? t('common.active') : t('common.inactive')}
                  </span>
                  {product.is_active && isCategoryInactive && (
                    <span className="text-[10px] text-amber-600 font-medium block mt-1">(Hidden on POS)</span>
                  )}
                </td>
                <td className="p-4 text-right">
                  <div className="flex gap-2 justify-end">
                    {isOwnerOrManager && (
                      <>
                        <button onClick={() => openEdit(product)} className="p-1.5 text-gray-400 hover:text-brand">
                          <Pencil size={16} />
                        </button>
                        <button onClick={() => handleDelete(product.id)} className="p-1.5 text-gray-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {products.length === 0 && (
          <p className="text-center text-gray-500 py-12">{t('products.empty')}</p>
        )}
      </div>

      {/* Product Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-6 border-b border-gray-100 shrink-0">
              <h2 className="text-lg font-bold">{editingProduct ? t('products.editProductTitle') : t('products.addProductTitle')}</h2>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldName')}<span className="text-red-500 ml-1">*</span></label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldImage')}</label>
                <ImageUploader
                  value={form.image_url}
                  onChange={(val) => {
                    setForm({ ...form, image_url: val });
                    setImageTouched(true);
                  }}
                  productId={editingProduct?.id ? String(editingProduct.id) : undefined}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldCategory')}<span className="text-red-500 ml-1">*</span></label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" required>
                    <option value="">{t('products.selectPlaceholder')}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldSku')}</label>
                  <input type="text" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center justify-between">
                  <span>{t('products.fieldBarcode')}</span>
                  <span className="text-[11px] font-normal text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    ⚡ Auto-Scan 2D Scanner Ready
                  </span>
                </label>
                <input
                  id="product-barcode-input"
                  data-barcode-scan="true"
                  type="text"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  placeholder={t('products.fieldBarcodePlaceholder')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none font-mono text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">{t('products.fieldBarcodeHint')}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.priceLabel', { currency })}<span className="text-red-500 ml-1">*</span></label>
                  <input type="text" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                    placeholder="10000"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldCostPrice')}</label>
                  <input type="text" inputMode="numeric" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                    placeholder="8000"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.cashbackLabel')}</label>
                <input type="number" step="0.1" min="0" max="100" value={form.cb_percent} onChange={(e) => setForm({ ...form, cb_percent: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" />
                <p className="text-xs text-gray-400 mt-1">{t('products.cashbackHint')}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('products.fieldTags')}</label>
                {/* Selected tags */}
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 bg-brand/10 text-brand rounded-lg text-xs font-medium">
                        {t(tagLabel(tag))}
                        <button type="button" onClick={() => setForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }))} className="hover:text-red-500">
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {/* Preset tag chips */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PRESET_TAGS.filter((pt) => !form.tags.includes(pt.key)).map((pt) => (
                    <button
                      key={pt.key}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, tags: [...prev.tags, pt.key] }))}
                      className="px-2 py-1 text-xs border border-gray-200 rounded-lg text-gray-600 hover:border-brand hover:text-brand transition-colors"
                    >
                      + {t(pt.labelKey)}
                    </button>
                  ))}
                </div>
                {/* Custom tag input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.customTag}
                    onChange={(e) => setForm((prev) => ({ ...prev, customTag: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        const val = form.customTag.trim().toLowerCase().replace(/\s+/g, '_');
                        if (val && !form.tags.includes(val)) {
                          setForm((prev) => ({ ...prev, tags: [...prev.tags, val], customTag: '' }));
                        }
                      }
                    }}
                    placeholder={t('products.tagPlaceholder')}
                    className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = form.customTag.trim().toLowerCase().replace(/\s+/g, '_');
                      if (val && !form.tags.includes(val)) {
                        setForm((prev) => ({ ...prev, tags: [...prev.tags, val], customTag: '' }));
                      }
                    }}
                    className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-600"
                  >
                    {t('common.add')}
                  </button>
                </div>
              </div>
              {isRestaurant && addonGroups.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('products.fieldAddonGroups')}</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    {addonGroups.map((group) => {
                      const isChecked = form.addon_group_ids.includes(group.id);
                      return (
                        <div key={group.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`addon-group-${group.id}`}
                            checked={isChecked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setForm((prev) => ({
                                ...prev,
                                addon_group_ids: checked
                                  ? [...prev.addon_group_ids, group.id]
                                  : prev.addon_group_ids.filter((id) => id !== group.id),
                              }));
                            }}
                            className="rounded border-gray-300 text-brand focus:ring-brand"
                          />
                          <label htmlFor={`addon-group-${group.id}`} className="flex items-center gap-2 cursor-pointer select-none">
                            <span className="text-sm text-gray-700">{group.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${group.is_required ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                              {group.is_required ? t('products.required') : t('products.optional')}
                            </span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.track_inventory} onChange={(e) => setForm({ ...form, track_inventory: e.target.checked })}
                    className="rounded border-gray-300 text-brand focus:ring-brand" />
                  <span className="text-sm text-gray-700">{t('products.fieldTrackInventory')}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="rounded border-gray-300 text-brand focus:ring-brand" />
                  <span className="text-sm text-gray-700">{t('products.fieldActive')}</span>
                </label>
              </div>
              {!!form.track_inventory && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldStock')}<span className="text-red-500 ml-1">*</span></label>
                    <input type="number" min="0" value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldLowStockThreshold')}</label>
                    <input type="number" min="0" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" required />
                  </div>
                </div>
              )}
              <Button type="submit" className="w-full">
                {editingProduct ? t('products.updateProduct') : t('products.createProduct')}
              </Button>
            </form>
            </div>
          </div>
        </div>
      )}
        </>
      )}

      {activeTab === 'categories' && (
        <>
          <div className="flex justify-end gap-2 mb-4">
            <Button variant="outline" onClick={() => openCsvModal('categories')}>
              <FileSpreadsheet size={16} className="mr-1" /> CSV
            </Button>
            <Button onClick={() => { resetCategoryForm(); setShowForm(true); }}>
              <Plus size={16} className="mr-1" /> {t('products.addCategory')}
            </Button>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase">{t('products.categoryName')}</th>
                  <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase">{t('products.categoryColor')}</th>
                  <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnStatus')}</th>
                  <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categories.map((cat) => {
                  const colorObj = CATEGORY_COLORS.find((c) => c.key === cat.color);
                  return (
                    <tr key={cat.id} className="hover:bg-gray-50">
                      <td className="p-4 font-medium text-gray-900">{cat.name}</td>
                      <td className="p-4">
                        {colorObj ? (
                          <span className={`inline-flex px-2 py-1 rounded-lg text-xs font-medium ${colorObj.bg} ${colorObj.text}`}>{t(colorObj.labelKey)}</span>
                        ) : <span className="text-gray-400 text-sm">—</span>}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${cat.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                          {cat.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex gap-2 justify-end">
                          {isOwnerOrManager && (
                            <>
                              <button onClick={() => openEditCategory(cat)} className="p-1.5 text-gray-400 hover:text-brand"><Pencil size={16} /></button>
                              <button onClick={() => handleCategoryDelete(cat.id, cat.name)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {categories.length === 0 && <p className="text-center text-gray-500 py-12">{t('products.categoryEmpty')}</p>}
          </div>

          {showForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white rounded-2xl p-6 w-full max-w-md">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold">{editingCategory ? t('products.editCategoryTitle') : t('products.addCategoryTitle')}</h2>
                  <button onClick={resetCategoryForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                </div>
                <form onSubmit={handleCategorySubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldName')}<span className="text-red-500 ml-1">*</span></label>
                    <input type="text" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.categoryDescription')}</label>
                    <textarea value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" rows={2} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('products.colorLabel')}</label>
                    <div className="flex flex-wrap gap-2">
                      {CATEGORY_COLORS.map((c) => (
                        <button type="button" key={c.key} onClick={() => setCategoryForm({ ...categoryForm, color: c.key })} className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 ${c.key === categoryForm.color ? 'border-brand' : 'border-transparent'} ${c.bg} ${c.text}`}>{t(c.labelKey)}</button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={categoryForm.is_active} onChange={(e) => setCategoryForm({ ...categoryForm, is_active: e.target.checked })} className="rounded border-gray-300 text-brand focus:ring-brand" />
                    <span className="text-sm text-gray-700">{t('products.fieldActive')}</span>
                  </label>
                  <Button type="submit" className="w-full">{editingCategory ? t('common.update') : t('common.create')}</Button>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'addons' && isRestaurant && (
        <>
          <div className="flex justify-end gap-2 mb-4">
            <Button variant="outline" onClick={() => openCsvModal('addons')}>
              <FileSpreadsheet size={16} className="mr-1" /> CSV
            </Button>
            <Button onClick={() => { resetAddonForm(); setShowAddonModal(true); }}>
              <Plus size={16} className="mr-1" /> {t('products.addAddonGroup')}
            </Button>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-4 text-xs font-medium text-gray-500 uppercase">{t('products.categoryName')}</th>
                  <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnRequired')}</th>
                  <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnSelection')}</th>
                  <th className="text-center p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnAddons')}</th>
                  <th className="text-right p-4 text-xs font-medium text-gray-500 uppercase">{t('products.columnActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {addonGroups.map((group) => (
                  <tr key={group.id} className="hover:bg-gray-50">
                    <td className="p-4 font-medium text-gray-900">{group.name}</td>
                    <td className="p-4 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${group.is_required ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{group.is_required ? t('common.yes') : t('common.no')}</span>
                    </td>
                    <td className="p-4 text-center text-sm text-gray-600">{t('products.addonSelectionRange', { min: group.min_selection, max: group.max_selection })}</td>
                    <td className="p-4 text-center text-sm text-gray-600">{group.addons?.length || 0}</td>
                    <td className="p-4 text-right">
                      <div className="flex gap-2 justify-end">
                        {isOwnerOrManager && (
                          <>
                            <button onClick={() => openEditAddonGroup(group)} className="p-1.5 text-gray-400 hover:text-brand"><Pencil size={16} /></button>
                            <button onClick={() => handleAddonGroupDelete(group.id)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {addonGroups.length === 0 && <p className="text-center text-gray-500 py-12">{t('products.addonEmpty')}</p>}
          </div>

          {showAddonModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
                <div className="flex justify-between items-center p-6 border-b border-gray-100 shrink-0">
                  <h2 className="text-lg font-bold">{editingAddonGroup ? t('products.editAddonGroupTitle') : t('products.addAddonGroupTitle')}</h2>
                  <button onClick={resetAddonForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                  <form onSubmit={handleAddonGroupSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.fieldName')}<span className="text-red-500 ml-1">*</span></label>
                    <input type="text" value={addonForm.name} onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.categoryDescription')}</label>
                    <input type="text" value={addonForm.description} onChange={(e) => setAddonForm({ ...addonForm, description: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.addonMin')}</label>
                      <input type="number" min="0" value={addonForm.min_selection} onChange={(e) => setAddonForm({ ...addonForm, min_selection: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.addonMax')}</label>
                      <input type="number" min="0" value={addonForm.max_selection} onChange={(e) => setAddonForm({ ...addonForm, max_selection: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={addonForm.is_required} onChange={(e) => setAddonForm({ ...addonForm, is_required: e.target.checked })} className="rounded border-gray-300 text-brand focus:ring-brand" />
                    <span className="text-sm text-gray-700">{t('products.addonRequired')}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={addonForm.allow_multiple_quantities} onChange={(e) => setAddonForm({ ...addonForm, allow_multiple_quantities: e.target.checked })} className="rounded border-gray-300 text-brand focus:ring-brand" />
                    <span className="text-sm text-gray-700">Allow multiple quantities per add-on</span>
                  </label>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">{t('products.addonAddons')}</label>
                      <button type="button" onClick={addAddonItem} className="text-xs text-brand hover:underline">{t('products.addAddonInline')}</button>
                    </div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_6rem_1.5rem] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                        <span>{t('products.nameLabel')}</span>
                        <span>{t('products.columnPrice')}</span>
                        <span aria-hidden="true" />
                      </div>
                      {addonList.map((addon, idx) => (
                        <div key={idx} className="grid grid-cols-[minmax(0,1fr)_6rem_1.5rem] gap-2 items-center">
                          <input type="text" value={addon.name} onChange={(e) => updateAddonItem(idx, 'name', e.target.value)} placeholder={t('common.namePlaceholder')} className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" />
                          <input type="number" step="0.01" value={addon.price} onChange={(e) => updateAddonItem(idx, 'price', Number(e.target.value))} placeholder={t('common.pricePlaceholder')} aria-label={t('products.columnPrice')} className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none" />
                          <button type="button" onClick={() => removeAddonItem(idx)} className="text-gray-400 hover:text-red-500"><X size={16} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button type="submit" className="w-full">{editingAddonGroup ? t('common.update') : t('common.create')}</Button>
                </form>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {showCsvModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center pb-4 border-b border-gray-100 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Impor Katalog Produk CSV
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Impor batch data produk sembako, barcode scanner, harga, dan stok awal
                </p>
              </div>
              <button onClick={() => setShowCsvModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 py-4 overflow-y-auto flex-1">
              {/* Download section */}
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-emerald-900">Unduh Template CSV</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Format resmi berisi contoh barcode, harga umum, harga member, dan stok awal.
                  </p>
                </div>
                <button
                  onClick={downloadCsvTemplate}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium shadow-sm transition-colors shrink-0"
                >
                  <Download size={14} /> Download Template
                </button>
              </div>

              {/* Upload section */}
              <div className="space-y-2">
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 hover:border-brand/50 transition-colors bg-white">
                  <Upload size={22} className="text-gray-400 mb-1" />
                  <span className="text-sm font-medium text-gray-700">
                    {csvFile ? csvFile.name : 'Pilih atau Tarik File CSV ke Sini'}
                  </span>
                  <span className="text-xs text-gray-400 mt-0.5">Mendukung file .csv UTF-8 hingga 1.000 baris</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => handleCsvFileSelect(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>

              {/* Validating indicator */}
              {csvValidating && (
                <div className="flex items-center justify-center py-6 text-sm text-gray-500 gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-brand border-t-transparent" />
                  Memvalidasi isi file CSV & memeriksa duplikat barcode...
                </div>
              )}

              {/* Preview Cards */}
              {csvPreview && !csvValidating && (
                <div className="space-y-3">
                  {/* Summary Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                    <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                      <p className="text-[11px] text-gray-500 uppercase font-medium">Total Baris</p>
                      <p className="text-base font-bold text-gray-900">{csvPreview.total_rows}</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                      <p className="text-[11px] text-emerald-700 uppercase font-medium">Valid</p>
                      <p className="text-base font-bold text-emerald-800">{csvPreview.valid_rows_count}</p>
                    </div>
                    <div className={`p-2.5 rounded-lg border ${csvPreview.error_rows_count > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                      <p className={`text-[11px] uppercase font-medium ${csvPreview.error_rows_count > 0 ? 'text-red-700' : 'text-gray-500'}`}>Error</p>
                      <p className={`text-base font-bold ${csvPreview.error_rows_count > 0 ? 'text-red-800' : 'text-gray-900'}`}>{csvPreview.error_rows_count}</p>
                    </div>
                    <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-100">
                      <p className="text-[11px] text-blue-700 uppercase font-medium">Kategori Baru</p>
                      <p className="text-base font-bold text-blue-800">{csvPreview.new_categories?.length || 0}</p>
                    </div>
                  </div>

                  {/* Stock summary badge */}
                  {csvPreview.total_initial_stock_items > 0 && (
                    <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 flex justify-between items-center">
                      <span>📦 <strong className="font-semibold">{csvPreview.total_initial_stock_items} produk</strong> memiliki stok awal</span>
                      <span>Total Nilai HPP Stok: <strong className="font-semibold text-slate-900">{fmt(csvPreview.total_initial_stock_value)}</strong></span>
                    </div>
                  )}

                  {/* Categories notice */}
                  {Array.isArray(csvPreview.new_categories) && csvPreview.new_categories.length > 0 && (
                    <div className="px-3 py-2 bg-blue-50/70 border border-blue-100 rounded-lg text-xs text-blue-800">
                      ✨ Kategori baru otomatis dibuat: <span className="font-semibold">{csvPreview.new_categories.join(', ')}</span>
                    </div>
                  )}

                  {/* Errors List */}
                  {Array.isArray(csvPreview.errors) && csvPreview.errors.length > 0 && (
                    <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-red-800 font-semibold text-xs">
                        <AlertCircle size={15} className="text-red-600 shrink-0" />
                        <span>Validasi Gagal — Harap perbaiki {csvPreview.errors.length} baris error berikut:</span>
                      </div>
                      <div className="max-h-40 overflow-y-auto divide-y divide-red-100 text-xs">
                        {csvPreview.errors.map((err: any, idx: number) => (
                          <div key={idx} className="py-1.5 flex items-start gap-2 text-red-700">
                            <span className="font-mono bg-red-100 text-red-800 px-1.5 py-0.5 rounded text-[11px] font-bold shrink-0">
                              Baris {err.row}
                            </span>
                            <span>
                              {err.barcode && <strong className="font-mono">[{err.barcode}] </strong>}
                              {err.name && <span>{err.name}: </span>}
                              {err.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Success Result */}
                  {csvResult && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                      <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                        <CheckCircle size={18} className="text-emerald-600" />
                        <span>Impor Katalog Berhasil!</span>
                      </div>
                      <div className="text-xs text-emerald-800 space-y-1">
                        <p>✓ <strong>{String(csvResult.created_products_count ?? 0)} produk</strong> berhasil ditambahkan ke katalog.</p>
                        {Number(csvResult.created_categories_count ?? 0) > 0 && (
                          <p>✓ <strong>{String(csvResult.created_categories_count)} kategori baru</strong> berhasil dibuat.</p>
                        )}
                        {Number(csvResult.initial_stock_items_count ?? 0) > 0 && (
                          <p>✓ <strong>{String(csvResult.initial_stock_items_count)} mutasi stok awal</strong> dicatat di buku besar mutasi.</p>
                        )}
                        <p className="text-emerald-700 font-mono text-[11px] pt-1">Batch ID: {String(csvResult.batch_id)}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="pt-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
              <Button variant="outline" onClick={() => setShowCsvModal(false)}>
                {csvResult ? 'Tutup' : 'Batal'}
              </Button>
              {csvPreview && csvPreview.valid && !csvResult && (
                <Button
                  onClick={handleExecuteImport}
                  disabled={csvUploading}
                  className="bg-brand hover:bg-brand/90 text-white"
                >
                  {csvUploading ? 'Mengimpor...' : `Konfirmasi & Impor ${csvPreview.valid_rows_count} Produk`}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {catDeleteModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">{t('products.deleteCategoryTitle')}</h2>
              <button onClick={() => setCatDeleteModal({ open: false, id: null, name: '', productCount: 0 })} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-700 mb-5">
              {t('products.deleteCategoryBody', { name: catDeleteModal.name, count: catDeleteModal.productCount })}
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('products.moveProductsTo')}</label>
                <select
                  value={catReassignTo}
                  onChange={(e) => setCatReassignTo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand outline-none"
                >
                  <option value="">{t('products.selectCategoryPlaceholder')}</option>
                  {categories
                    .filter((c) => c.name.toLowerCase() === 'uncategorized' && c.id !== catDeleteModal.id)
                    .map((c) => <option key={c.id} value={String(c.id)}>{t('products.defaultCategoryTag', { name: c.name })}</option>)}
                  {categories
                    .filter((c) => c.name.toLowerCase() !== 'uncategorized' && c.id !== catDeleteModal.id)
                    .map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
              <Button onClick={handleCategoryReassignDelete} disabled={!catReassignTo} className="w-full">
                {t('products.moveAndDelete')}
              </Button>
              <div className="relative flex items-center">
                <div className="flex-grow border-t border-gray-200" />
                <span className="mx-3 text-xs text-gray-400">{t('common.or')}</span>
                <div className="flex-grow border-t border-gray-200" />
              </div>
              <button
                onClick={handleCategoryForceDelete}
                className="w-full px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                {t('products.deleteCategoryAndProducts')}
              </button>
            </div>
          </div>
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
