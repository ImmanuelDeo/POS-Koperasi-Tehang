'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, User, X, Check, Building2, CreditCard, AlertCircle, RefreshCw, UserX } from 'lucide-react';
import api from '@/lib/api';
import type { CooperativeMember } from '@/lib/types';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

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

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setMembers([]);
      setError(null);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Debounced search
  const performSearch = useCallback(async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.get('/members/lookup', {
        params: { q: trimmed },
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

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      performSearch(val);
    }, 250);
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && members.length > 0) {
      const activeFirst = members.find((m) => m.is_active === 1);
      if (activeFirst) {
        onSelectMember(activeFirst);
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
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
              <h2 className="text-lg font-bold text-gray-900">Pilih Member Koperasi</h2>
              <p className="text-xs text-gray-500">Cari berdasarkan Nama, NIK Karyawan, No. Anggota, atau No. HP</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-gray-100 bg-white">
          <div className="relative">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={handleQueryChange}
              placeholder="Ketik minimal 2 karakter untuk mencari..."
              className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setMembers([]);
                  searchInputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Body / List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-[220px]">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
              <RefreshCw size={24} className="animate-spin text-emerald-600" />
              <p className="text-xs font-medium">Mencari data member...</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
              <AlertCircle size={18} className="shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && query.trim().length >= 2 && members.length === 0 && (
            <div className="text-center py-12 text-gray-400 space-y-1">
              <UserX size={36} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm font-semibold text-gray-600">Member tidak ditemukan</p>
              <p className="text-xs text-gray-400">Tidak ada data yang cocok dengan &quot;{query}&quot;</p>
            </div>
          )}

          {!loading && !error && query.trim().length < 2 && (
            <div className="text-center py-10 text-gray-400 space-y-2">
              <Search size={32} className="mx-auto text-gray-300" />
              <p className="text-xs text-gray-500">
                Silakan ketik nama karyawan, NIK, atau nomor anggota koperasi di kotak pencarian di atas.
              </p>
            </div>
          )}

          {!loading &&
            members.map((m) => {
              const isSelected = selectedMember?.id === m.id;
              const isActive = m.is_active === 1;
              const deductionEnabled = m.salary_deduction_enabled === 1;

              return (
                <div
                  key={m.id}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isSelected
                      ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20'
                      : isActive
                      ? 'border-gray-200 bg-white hover:border-emerald-300 hover:shadow-sm'
                      : 'border-gray-200 bg-gray-50 opacity-60'
                  }`}
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-gray-900 truncate">{m.name}</span>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-semibold border border-gray-200">
                        {m.member_no || 'No MBR'}
                      </span>
                      {m.employee_id && (
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium border border-blue-200">
                          NIK: {m.employee_id}
                        </span>
                      )}
                      {!isActive && (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                          Non-Aktif
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                      {m.department && (
                        <span className="flex items-center gap-1">
                          <Building2 size={13} className="text-gray-400" />
                          {m.department}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <CreditCard size={13} className="text-gray-400" />
                        Potong Gaji:{' '}
                        <strong className={deductionEnabled ? 'text-emerald-700 font-semibold' : 'text-gray-500'}>
                          {deductionEnabled ? 'Aktif' : 'Non-Aktif'}
                        </strong>
                      </span>
                      {deductionEnabled && (
                        <span className="text-gray-600">
                          Sisa Limit: <strong className="text-gray-900 font-semibold">{fmt(m.remaining_monthly_limit)}</strong>
                        </span>
                      )}
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
      </div>
    </div>
  );
}
