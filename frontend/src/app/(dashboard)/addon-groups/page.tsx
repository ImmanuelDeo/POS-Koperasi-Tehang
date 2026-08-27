'use client';

import { useState, useEffect, useMemo } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/hooks/useI18n';
import toast from 'react-hot-toast';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  Layers,
  Calendar,
  Clock,
  Sparkles,
  Tag,
  CheckCircle2,
  AlertCircle,
  Package,
} from 'lucide-react';
import type { AddonGroup, Addon } from '@/lib/types';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useConfirm } from '@/hooks/use-confirm';

interface ExtendedAddonGroup extends AddonGroup {
  category_name?: string | null;
  promo_start_date?: string | null;
  promo_end_date?: string | null;
  is_forever?: number | boolean | null;
  bundle_price?: number | null;
}

export default function AddonGroupsPage() {
  const { t } = useI18n();
  const [groups, setGroups] = useState<ExtendedAddonGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, ConfirmDialog } = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ExtendedAddonGroup | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<number | string | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');

  // Form State
  const [form, setForm] = useState({
    name: '',
    category_name: 'Paket Sembako',
    description: '',
    is_forever: true,
    promo_start_date: '',
    promo_end_date: '',
    bundle_price: '',
    is_required: false,
    allow_multiple_quantities: false,
    min_selection: '1',
    max_selection: '5',
  });

  // Addon form (inline)
  const [addonForm, setAddonForm] = useState({ name: '', price: '0' });
  const [addingAddonTo, setAddingAddonTo] = useState<number | string | null>(null);
  const [editingAddon, setEditingAddon] = useState<{ groupId: number | string; addon: Addon } | null>(null);

  const fmt = useFormatCurrency();

  const extractErrorMessage = (err: unknown, fallback: string) => {
    const error = err as { response?: { data?: { error?: string; errors?: Record<string, string[]> } } };
    if (error.response?.data?.error) return error.response.data.error;
    return error.response?.data?.errors ? Object.values(error.response.data.errors)[0]?.[0] : fallback;
  };

  const fetchGroups = async () => {
    try {
      const { data } = await api.get('/addon-groups');
      setGroups(data.addon_groups || []);
    } catch {
      toast.error('Gagal memuat data paket & promo');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchGroups();
  }, []);

  const resetForm = () => {
    setForm({
      name: '',
      category_name: 'Paket Sembako',
      description: '',
      is_forever: true,
      promo_start_date: '',
      promo_end_date: '',
      bundle_price: '',
      is_required: false,
      allow_multiple_quantities: false,
      min_selection: '1',
      max_selection: '5',
    });
    setEditingGroup(null);
    setShowForm(false);
  };

  const openEdit = (group: ExtendedAddonGroup) => {
    setEditingGroup(group);
    setForm({
      name: group.name,
      category_name: group.category_name || 'Paket Sembako',
      description: group.description || '',
      is_forever: group.is_forever === 1 || group.is_forever === true || (!group.promo_start_date && !group.promo_end_date),
      promo_start_date: group.promo_start_date ? group.promo_start_date.slice(0, 10) : '',
      promo_end_date: group.promo_end_date ? group.promo_end_date.slice(0, 10) : '',
      bundle_price: group.bundle_price !== null && group.bundle_price !== undefined ? String(group.bundle_price) : '',
      is_required: Boolean(group.is_required),
      allow_multiple_quantities: Boolean(group.allow_multiple_quantities),
      min_selection: String(group.min_selection || 0),
      max_selection: String(group.max_selection || 1),
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const minVal = Number(form.min_selection) || 0;
    const maxVal = Number(form.max_selection) || 1;
    if (minVal > maxVal) {
      toast.error('Jumlah minimal pilihan tidak boleh melebihi maksimal pilihan');
      return;
    }

    if (!form.is_forever && form.promo_start_date && form.promo_end_date) {
      if (new Date(form.promo_start_date) > new Date(form.promo_end_date)) {
        toast.error('Tanggal mulai promo tidak boleh melewati tanggal selesai promo');
        return;
      }
    }

    try {
      const payload = {
        name: form.name.trim(),
        category_name: form.category_name.trim() || 'Paket Sembako',
        description: form.description.trim() || null,
        is_forever: form.is_forever ? 1 : 0,
        promo_start_date: form.is_forever ? null : (form.promo_start_date || null),
        promo_end_date: form.is_forever ? null : (form.promo_end_date || null),
        bundle_price: form.bundle_price ? Number(form.bundle_price) : null,
        is_required: form.is_required ? 1 : 0,
        allow_multiple_quantities: form.allow_multiple_quantities ? 1 : 0,
        min_selection: minVal,
        max_selection: maxVal,
      };

      if (editingGroup) {
        await api.put(`/addon-groups/${editingGroup.id}`, payload);
        toast.success('Paket / Promo berhasil diperbarui');
      } else {
        await api.post('/addon-groups', payload);
        toast.success('Paket / Promo baru berhasil dibuat');
      }
      resetForm();
      fetchGroups();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Gagal menyimpan data paket/promo'));
    }
  };

  const handleDeleteGroup = async (id: number | string) => {
    if (!await confirm('Apakah Anda yakin ingin menghapus paket promo ini?', { destructive: true, confirmLabel: 'Hapus Paket' })) return;
    try {
      await api.delete(`/addon-groups/${id}`);
      toast.success('Paket promo berhasil dihapus');
      fetchGroups();
    } catch {
      toast.error('Gagal menghapus paket promo');
    }
  };

  // Addon Item CRUD
  const handleAddAddon = async (groupId: number | string) => {
    if (!addonForm.name.trim()) return;
    try {
      await api.post(`/addon-groups/${groupId}/addons`, {
        name: addonForm.name.trim(),
        price: Number(addonForm.price) || 0,
      });
      toast.success('Item produk berhasil ditambahkan ke paket');
      setAddonForm({ name: '', price: '0' });
      setAddingAddonTo(null);
      fetchGroups();
    } catch {
      toast.error('Gagal menambahkan item produk');
    }
  };

  const handleUpdateAddon = async () => {
    if (!editingAddon || !addonForm.name.trim()) return;
    try {
      await api.put(`/addon-groups/${editingAddon.groupId}/addons/${editingAddon.addon.id}`, {
        name: addonForm.name.trim(),
        price: Number(addonForm.price) || 0,
      });
      toast.success('Item produk berhasil diperbarui');
      setAddonForm({ name: '', price: '0' });
      setEditingAddon(null);
      fetchGroups();
    } catch {
      toast.error('Gagal memperbarui item produk');
    }
  };

  const handleDeleteAddon = async (groupId: number | string, addonId: number | string) => {
    if (!await confirm('Hapus item produk ini dari paket?', { destructive: true, confirmLabel: 'Hapus Item' })) return;
    try {
      await api.delete(`/addon-groups/${groupId}/addons/${addonId}`);
      toast.success('Item berhasil dihapus');
      fetchGroups();
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err, 'Gagal menghapus item'));
    }
  };

  // Categories list for filter
  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      if (g.category_name) set.add(g.category_name);
    }
    return Array.from(set);
  }, [groups]);

  const filteredGroups = useMemo(() => {
    if (selectedCategoryFilter === 'all') return groups;
    return groups.filter((g) => (g.category_name || 'Paket Sembako') === selectedCategoryFilter);
  }, [groups, selectedCategoryFilter]);

  const getPromoStatusBadge = (group: ExtendedAddonGroup) => {
    const isForever = group.is_forever === 1 || group.is_forever === true || (!group.promo_start_date && !group.promo_end_date);
    if (isForever) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          <Sparkles size={12} className="text-emerald-600" />
          Berlaku Selamanya
        </span>
      );
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const start = group.promo_start_date ? group.promo_start_date.slice(0, 10) : null;
    const end = group.promo_end_date ? group.promo_end_date.slice(0, 10) : null;

    if (end && todayStr > end) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
          <Clock size={12} className="text-red-500" />
          Kedaluwarsa ({end})
        </span>
      );
    }

    if (start && todayStr < start) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
          <Calendar size={12} className="text-amber-500" />
          Akan Datang (Mulai {start})
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
        <CheckCircle2 size={12} className="text-teal-600" />
        Promo Aktif {end ? `(s/d ${end})` : ''}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gradient-to-r from-emerald-900 to-slate-900 p-6 rounded-2xl text-white shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Layers size={20} />
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white">
              Paket Produk, Bundling & Promo Sembako
            </h1>
          </div>
          <p className="text-xs text-slate-300 max-w-xl">
            Kelola paket sembako murah (contoh: Beras + Bumbu Dapur/Minyak), paket hemat bundling, serta atur masa aktif promo berjangka maupun selamanya.
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm shadow-md shrink-0"
        >
          <Plus size={16} className="mr-1.5" /> + Buat Paket Promo Baru
        </Button>
      </div>

      {/* Category Filter Pills */}
      {categoriesList.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedCategoryFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              selectedCategoryFilter === 'all'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            Semua Paket ({groups.length})
          </button>
          {categoriesList.map((cat) => {
            const count = groups.filter((g) => g.category_name === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                  selectedCategoryFilter === cat
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Groups List */}
      <div className="space-y-3.5">
        {filteredGroups.map((group) => {
          const isExpanded = expandedGroup === group.id;
          const itemsCount = group.addons?.length || 0;

          return (
            <div
              key={group.id}
              className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden transition-all hover:border-emerald-200"
            >
              {/* Card Header */}
              <div className="flex items-center justify-between p-4 sm:p-5">
                <button
                  type="button"
                  onClick={() => setExpandedGroup(isExpanded ? null : group.id)}
                  className="flex items-start gap-3.5 flex-1 text-left min-w-0"
                >
                  <div className="mt-1 text-gray-400">
                    {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                  </div>
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-gray-900 truncate">
                        {group.name}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 flex items-center gap-1">
                        <Tag size={11} className="text-slate-500" />
                        {group.category_name || 'Paket Sembako'}
                      </span>
                      {getPromoStatusBadge(group)}
                      <span className="text-xs text-gray-400 font-medium">
                        ({itemsCount} pilihan produk)
                      </span>
                    </div>

                    {group.description && (
                      <p className="text-xs text-gray-600 line-clamp-1">{group.description}</p>
                    )}

                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>
                        Pilihan kasir: <strong className="text-gray-700">{group.min_selection || 0} s/d {group.max_selection || 1} item</strong>
                      </span>
                      {group.bundle_price !== null && group.bundle_price !== undefined && (
                        <span>
                          • Harga Paket: <strong className="text-emerald-700">{fmt(Number(group.bundle_price))}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-1.5 shrink-0 ml-3">
                  <button
                    type="button"
                    onClick={() => openEdit(group)}
                    title="Edit Paket / Promo"
                    className="p-2 text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors"
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteGroup(group.id)}
                    title="Hapus Paket"
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>

              {/* Expanded: Isi Produk dalam Paket */}
              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50/50 p-4 sm:p-5 pt-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                      Daftar Produk / Isi Paket Bundling
                    </p>
                    <span className="text-[11px] text-gray-400">
                      {itemsCount} item tersedia dalam paket ini
                    </span>
                  </div>

                  <div className="space-y-2">
                    {group.addons?.map((addon) => (
                      <div
                        key={addon.id}
                        className="flex items-center justify-between py-2 px-3.5 bg-white border border-gray-200 rounded-xl shadow-xs"
                      >
                        {editingAddon?.addon.id === addon.id ? (
                          <div className="flex items-end gap-2 flex-1">
                            <label className="flex-1">
                              <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Nama Produk</span>
                              <input
                                type="text"
                                value={addonForm.name}
                                onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })}
                                className="w-full px-2.5 py-1 text-sm border border-gray-300 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </label>
                            <label className="w-28">
                              <span className="block text-[11px] font-medium text-gray-500 mb-0.5">Biaya Tambahan</span>
                              <input
                                type="number"
                                value={addonForm.price}
                                onChange={(e) => setAddonForm({ ...addonForm, price: e.target.value })}
                                className="w-full px-2.5 py-1 text-sm border border-gray-300 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={handleUpdateAddon}
                              className="px-3 py-1 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700"
                            >
                              Simpan
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAddon(null);
                                setAddonForm({ name: '', price: '0' });
                              }}
                              className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500" />
                              <span className="text-sm font-semibold text-gray-800">{addon.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                {Number(addon.price) === 0 ? 'Termasuk di Paket (Rp 0)' : `+ ${fmt(Number(addon.price))}`}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAddon({ groupId: group.id, addon });
                                  setAddonForm({ name: addon.name, price: String(addon.price) });
                                }}
                                className="p-1.5 text-gray-400 hover:text-emerald-700 rounded-lg hover:bg-gray-100"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAddon(group.id, addon.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Add Product to Bundle */}
                  {addingAddonTo === group.id ? (
                    <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2.5">
                      <p className="text-xs font-bold text-emerald-900">Tambah Produk ke Paket Ini</p>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
                        <label className="flex-1">
                          <span className="block text-[11px] font-medium text-gray-600 mb-0.5">Nama Produk Isi Paket</span>
                          <input
                            type="text"
                            placeholder="Contoh: Beras Premium 5kg / Minyak Goreng 2L"
                            value={addonForm.name}
                            onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })}
                            className="w-full px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </label>
                        <label className="w-full sm:w-32">
                          <span className="block text-[11px] font-medium text-gray-600 mb-0.5">Biaya Tambahan (Rp)</span>
                          <input
                            type="number"
                            placeholder="0"
                            value={addonForm.price}
                            onChange={(e) => setAddonForm({ ...addonForm, price: e.target.value })}
                            className="w-full px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </label>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleAddAddon(group.id)}
                            className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg hover:bg-emerald-700 shadow-sm"
                          >
                            Tambahkan
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddingAddonTo(null);
                              setAddonForm({ name: '', price: '0' });
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingAddonTo(group.id);
                        setAddonForm({ name: '', price: '0' });
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-white hover:bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-200 shadow-2xs transition-colors"
                    >
                      <Plus size={14} /> + Tambah Pilihan Produk Isi Paket
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredGroups.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-gray-300 space-y-3">
            <Package size={40} className="mx-auto text-gray-300" />
            <div>
              <p className="text-base font-bold text-gray-800">Belum Ada Paket / Promo</p>
              <p className="text-xs text-gray-400 max-w-sm mx-auto mt-1">
                Buat paket sembako murah, bundling beras + minyak + bumbu dapur, atau promo diskon berjangka sekarang.
              </p>
            </div>
            <Button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              <Plus size={15} className="mr-1" /> Buat Paket Promo Pertama
            </Button>
          </div>
        )}
      </div>

      {/* Package / Promo Modal Form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg shadow-2xl border border-gray-100 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  <Layers size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    {editingGroup ? 'Edit Paket & Promo' : 'Buat Paket & Promo Baru'}
                  </h2>
                  <p className="text-[11px] text-gray-400">Atur rincian bundling sembako dan masa berlaku promo</p>
                </div>
              </div>
              <button
                type="button"
                onClick={resetForm}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              {/* Nama Paket */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Nama Paket / Promo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Contoh: Paket Sembako Berkah / Promo Dapur Murah"
                  className="w-full px-3.5 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                  required
                />
              </div>

              {/* Kategori Paket */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Kategori Paket / Bundling
                </label>
                <input
                  type="text"
                  value={form.category_name}
                  onChange={(e) => setForm({ ...form, category_name: e.target.value })}
                  placeholder="Contoh: Paket Sembako / Promo Bulanan / Bundling Dapur"
                  className="w-full px-3.5 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                />
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {['Paket Sembako', 'Promo Mingguan', 'Bundling Dapur', 'Paket Ramadhan'].map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setForm({ ...form, category_name: sug })}
                      className="text-[10px] font-semibold px-2 py-0.5 bg-gray-100 hover:bg-emerald-50 hover:text-emerald-700 rounded-md text-gray-600 transition-colors"
                    >
                      + {sug}
                    </button>
                  ))}
                </div>
              </div>

              {/* Deskripsi Promo */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Deskripsi / Keterangan Promo
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Contoh: Termasuk Beras 5kg, Minyak Goreng 2L, dan Gula 1kg"
                  className="w-full px-3.5 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                />
              </div>

              {/* Masa Berlaku Promo */}
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-gray-900">Masa Berlaku Promo</p>
                    <p className="text-[11px] text-gray-500">Pilih apakah paket ini berlaku permanen atau berjangka</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, is_forever: !form.is_forever })}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                      form.is_forever
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white border border-gray-300 text-gray-700'
                    }`}
                  >
                    {form.is_forever ? 'Selamanya (Permanen)' : 'Batas Tanggal'}
                  </button>
                </div>

                {!form.is_forever && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-200 animate-in fade-in-50 duration-150">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Tanggal Mulai</label>
                      <input
                        type="date"
                        value={form.promo_start_date}
                        onChange={(e) => setForm({ ...form, promo_start_date: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
                        required={!form.is_forever}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">Tanggal Selesai</label>
                      <input
                        type="date"
                        value={form.promo_end_date}
                        onChange={(e) => setForm({ ...form, promo_end_date: e.target.value })}
                        className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500"
                        required={!form.is_forever}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Ketentuan Jumlah Pilihan Kasir */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Min. Pilihan Produk</label>
                  <input
                    type="number"
                    min="0"
                    value={form.min_selection}
                    onChange={(e) => setForm({ ...form, min_selection: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-gray-400">0 = Opsional / bebas</span>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Maks. Pilihan Produk</label>
                  <input
                    type="number"
                    min="1"
                    value={form.max_selection}
                    onChange={(e) => setForm({ ...form, max_selection: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-gray-400">Batas maks item dipilih</span>
                </div>
              </div>

              <div className="pt-2">
                <Button type="submit" className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md">
                  {editingGroup ? 'Perbarui Paket Promo' : 'Simpan & Buat Paket Promo'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
