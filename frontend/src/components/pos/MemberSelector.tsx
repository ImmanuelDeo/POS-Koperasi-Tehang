'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, User, X, Check, Building2, CreditCard, AlertCircle, RefreshCw, UserX, UserPlus, Plus } from 'lucide-react';
import api from '@/lib/api';
import type { CooperativeMember } from '@/lib/types';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectMember: (member: CooperativeMember) => void;
  onClearMember: () => void;
  selectedMember: CooperativeMember | null;
}

export default function MemberSelector({
  isOpen,
  onClose,
  onSelectMember,
  onClearMember,
  selectedMember,
}: Props) {
  const fmt = useFormatCurrency();
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<CooperativeMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quick Add Member Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingNewMember, setSavingNewMember] = useState(false);
  const [newMemberForm, setNewMemberForm] = useState({
    name: '',
    nik: '',
    employee_id: '',
    member_no: '',
    department: 'Produksi',
    phone: '',
    salary_deduction_enabled: true,
    monthly_deduction_limit: '',
  });

  // Debounced search
  const performSearch = useCallback(async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    setLoading(true);
    setError(null);

    try {
      const response = await api.get('/members/lookup', {
        params: trimmed ? { q: trimmed } : {},
      });
      const results: CooperativeMember[] = response.data?.members || [];
      setMembers(results);
    } catch (err: any) {
      console.error('[MemberSelector] Search failed:', err);
      setError(err.response?.data?.error || 'Gagal mencari data member');
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Focus input & load initial members on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setError(null);
      setShowAddForm(false);
      performSearch('');
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, performSearch]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(val);
    }, 200);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showAddForm) {
        setShowAddForm(false);
      } else {
        onClose();
      }
    } else if (e.key === 'Enter' && !showAddForm && members.length > 0) {
      const activeFirst = members.find((m) => m.is_active === 1);
      if (activeFirst) {
        onSelectMember(activeFirst);
        onClose();
      }
    }
  };

  const handleSaveNewMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberForm.name.trim()) {
      toast.error('Nama lengkap member wajib diisi');
      return;
    }
    setSavingNewMember(true);
    try {
      const { data } = await api.post('/members', {
        name: newMemberForm.name.trim(),
        nik: newMemberForm.nik.trim() || undefined,
        employee_id: newMemberForm.employee_id.trim() || undefined,
        member_no: newMemberForm.member_no.trim() || undefined,
        department: newMemberForm.department.trim() || undefined,
        phone: newMemberForm.phone.trim() || undefined,
        salary_deduction_enabled: newMemberForm.salary_deduction_enabled,
        monthly_deduction_limit: newMemberForm.monthly_deduction_limit ? Number(newMemberForm.monthly_deduction_limit) : 0,
      });
      toast.success(`Member ${data.member?.name || newMemberForm.name} berhasil didaftarkan!`);
      setShowAddForm(false);
      if (data.member) {
        onSelectMember(data.member);
      }
      onClose();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Gagal mendaftarkan member baru');
    } finally {
      setSavingNewMember(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-emerald-50 to-teal-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              <User size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {showAddForm ? 'Pendaftaran Member Baru' : 'Pilih Member Koperasi'}
              </h2>
              <p className="text-xs text-gray-500">
                {showAddForm
                  ? 'Isi data member baru untuk langsung ditambahkan ke kasir'
                  : 'Cari berdasarkan Nama, NIK Karyawan, No. Anggota, atau No. HP'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!showAddForm && (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <UserPlus size={14} />
                <span className="hidden sm:inline">+ Tambah Member</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {showAddForm ? (
          /* ── FAST ADD MEMBER FORM ─────────────────────────────────────────── */
          <form onSubmit={handleSaveNewMember} className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Nama Lengkap Member <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Budi Santoso"
                  value={newMemberForm.name}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  NIK KTP (16 Digit)
                </label>
                <input
                  type="text"
                  maxLength={16}
                  placeholder="16 digit angka..."
                  value={newMemberForm.nik}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, nik: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  NIK Karyawan (Employee ID)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: EMP-0012"
                  value={newMemberForm.employee_id}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, employee_id: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Departemen / Divisi
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Produksi, Gudang, HRD"
                  value={newMemberForm.department}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, department: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Nomor WhatsApp / HP
                </label>
                <input
                  type="text"
                  placeholder="Contoh: 08123456789"
                  value={newMemberForm.phone}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, phone: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Limit Potongan Gaji Bulanan (Rp)
                </label>
                <input
                  type="number"
                  placeholder="0 = Tanpa Limit"
                  value={newMemberForm.monthly_deduction_limit}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, monthly_deduction_limit: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
                />
              </div>

              <div className="flex items-center gap-2 pt-4">
                <input
                  type="checkbox"
                  id="sd_enabled"
                  checked={newMemberForm.salary_deduction_enabled}
                  onChange={(e) => setNewMemberForm({ ...newMemberForm, salary_deduction_enabled: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                />
                <label htmlFor="sd_enabled" className="text-xs font-medium text-gray-700 cursor-pointer">
                  Aktifkan fasilitas Potong Gaji (Bon)
                </label>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingNewMember}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors flex items-center gap-1.5"
              >
                {savingNewMember && <RefreshCw size={12} className="animate-spin" />}
                Simpan & Pilih Member
              </button>
            </div>
          </form>
        ) : (
          /* ── MEMBER SELECTION LIST ────────────────────────────────────────── */
          <>
            {/* Search Bar */}
            <div className="p-4 border-b border-gray-100 bg-white">
              <div className="relative">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={handleQueryChange}
                  placeholder="Cari NIK, Nama Anggota, No. Anggota, atau No. HP..."
                  className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
                />
                {query && (
                  <button
                    onClick={() => {
                      setQuery('');
                      performSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Quick Option: Pembeli Umum / Non-Member */}
            <div className="p-4 pb-0 bg-white">
              <button
                type="button"
                onClick={() => {
                  onClearMember();
                  onClose();
                }}
                className={`w-full p-3 rounded-xl border flex items-center justify-between transition-all ${
                  !selectedMember
                    ? 'bg-emerald-50/90 border-emerald-500 ring-2 ring-emerald-500/20'
                    : 'bg-gray-50/70 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
                    !selectedMember ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700'
                  }`}>
                    <User size={18} />
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900">Pembeli Umum (Non-Member)</p>
                      {!selectedMember && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                          Sedang Aktif
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">Harga standar retail, pembayaran tunai / QRIS / transfer bank</p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-emerald-700 bg-white px-2.5 py-1 rounded-lg border border-emerald-200 shadow-sm shrink-0">
                  Pilih Non-Member →
                </span>
              </button>
            </div>

            {/* Body / List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-[220px]">
              {loading && (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                  <RefreshCw size={24} className="animate-spin text-emerald-600" />
                  <p className="text-xs font-medium">Memuat data member...</p>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
                  <AlertCircle size={18} className="shrink-0 text-red-500" />
                  <span>{error}</span>
                </div>
              )}

              {!loading && !error && members.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <UserX size={36} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-semibold text-gray-600">Member tidak ditemukan</p>
                  <p className="text-xs text-gray-400 mt-1">Coba kata kunci pencarian lain atau daftarkan member baru</p>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition-colors"
                  >
                    <Plus size={13} /> Tambah Member Baru
                  </button>
                </div>
              )}

              {!loading &&
                members.map((m) => {
                  const isSelected = selectedMember?.id === m.id;
                  const isActive = m.is_active === 1;
                  const canDeduct = m.salary_deduction_enabled === 1;
                  const limit = Number(m.monthly_deduction_limit || 0);

                  return (
                    <div
                      key={m.id}
                      className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500'
                          : 'border-gray-200 bg-white hover:border-emerald-300 hover:shadow-xs'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-xs ${
                          isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {m.name.slice(0, 2).toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-gray-900 truncate">{m.name}</span>
                            {m.employee_id && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                NIK: {m.employee_id}
                              </span>
                            )}
                            {m.member_no && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                                Anggota: {m.member_no}
                              </span>
                            )}
                            {!isActive && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                                Nonaktif
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1 flex-wrap">
                            {m.department && (
                              <span className="flex items-center gap-1">
                                <Building2 size={12} className="text-gray-400" />
                                {m.department}
                              </span>
                            )}
                            {m.phone && <span>📱 {m.phone}</span>}
                            {canDeduct ? (
                              <span className="flex items-center gap-1 text-emerald-700 font-medium">
                                <CreditCard size={12} />
                                Bon Gaji: {limit > 0 ? fmt(limit) : 'Bebas Limit'}
                              </span>
                            ) : (
                              <span className="text-amber-700 font-medium">⚠️ Bon Gaji Nonaktif</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        {isSelected ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold shadow-sm">
                            <Check size={14} /> Terpilih
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={!isActive}
                            onClick={() => {
                              onSelectMember(m);
                              onClose();
                            }}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              isActive
                                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm active:scale-95'
                                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            Pilih Member
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Footer */}
            <div className="p-3.5 sm:p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  onClearMember();
                  onClose();
                }}
                className="text-xs font-semibold text-gray-600 hover:text-red-600 py-1.5 px-3 rounded-lg hover:bg-red-50 border border-gray-200 hover:border-red-200 transition-colors"
              >
                Pembeli Umum (Tanpa Member)
              </button>

              <button
                type="button"
                onClick={onClose}
                className="text-xs font-semibold text-gray-700 py-1.5 px-4 rounded-lg bg-white hover:bg-gray-100 border border-gray-200 transition-colors"
              >
                Tutup
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
