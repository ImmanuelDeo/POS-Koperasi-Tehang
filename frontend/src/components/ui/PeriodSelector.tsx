'use client';

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, Check, X, Sparkles, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type PeriodType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'all';

export interface PeriodFilterState {
  period: PeriodType;
  date?: string;
  startDate?: string;
  endDate?: string;
}

interface Props {
  period: PeriodType;
  date?: string;
  startDate?: string;
  endDate?: string;
  activeLabel?: string;
  allowAll?: boolean;
  onChange: (newState: PeriodFilterState) => void;
  className?: string;
}

/** Get today's local date YYYY-MM-DD in Asia/Jakarta */
function getTodayLocal(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export default function PeriodSelector({
  period,
  date,
  startDate,
  endDate,
  activeLabel,
  allowAll = false,
  onChange,
  className = '',
}: Props) {
  const today = getTodayLocal();
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Custom range state
  const [customStart, setCustomStart] = useState(startDate || date || today);
  const [customEnd, setCustomEnd] = useState(endDate || date || today);
  const [customError, setCustomError] = useState<string | null>(null);

  // Keep local state in sync when external props change
  useEffect(() => {
    if (startDate) setCustomStart(startDate);
    if (endDate) setCustomEnd(endDate);
    if (date && !startDate && !endDate) {
      setCustomStart(date);
      setCustomEnd(date);
    }
  }, [startDate, endDate, date]);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleApplyCustom = () => {
    if (customStart > customEnd) {
      setCustomError('Tanggal awal tidak boleh lebih dari tanggal akhir');
      return;
    }
    setCustomError(null);
    setIsOpen(false);
    onChange({
      period: 'custom',
      startDate: customStart,
      endDate: customEnd,
    });
  };

  const handleCustomStartChange = (val: string) => {
    setCustomStart(val);
    if (val && customEnd && val <= customEnd) {
      setCustomError(null);
      // Auto-trigger filter immediately on date selection
      onChange({
        period: 'custom',
        startDate: val,
        endDate: customEnd,
      });
    } else if (val && customEnd && val > customEnd) {
      setCustomError('Tanggal awal tidak boleh lebih dari tanggal akhir');
    }
  };

  const handleCustomEndChange = (val: string) => {
    setCustomEnd(val);
    if (customStart && val && customStart <= val) {
      setCustomError(null);
      // Auto-trigger filter immediately on date selection
      onChange({
        period: 'custom',
        startDate: customStart,
        endDate: val,
      });
    } else if (customStart && val && customStart > val) {
      setCustomError('Tanggal awal tidak boleh lebih dari tanggal akhir');
    }
  };

  const handleQuickDateSelect = (selectedDate: string) => {
    setIsOpen(false);
    onChange({
      period: 'daily',
      date: selectedDate,
    });
  };

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className}`}>
      {/* ── Segmented Sliding Pill Selector ─────────────────────────────────── */}
      <div className="bg-gray-100/90 p-1 rounded-xl flex items-center border border-gray-200/80 shadow-inner">
        <button
          type="button"
          onClick={() => onChange({ period: 'daily', date: today })}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
            period === 'daily' && (!date || date === today)
              ? 'bg-white text-emerald-800 shadow-sm ring-1 ring-black/5'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Harian
        </button>

        <button
          type="button"
          onClick={() => onChange({ period: 'weekly', date: today })}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
            period === 'weekly'
              ? 'bg-white text-emerald-800 shadow-sm ring-1 ring-black/5'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Mingguan
        </button>

        <button
          type="button"
          onClick={() => onChange({ period: 'monthly', date: today })}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
            period === 'monthly'
              ? 'bg-white text-emerald-800 shadow-sm ring-1 ring-black/5'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Bulanan
        </button>

        <button
          type="button"
          onClick={() => onChange({ period: 'yearly', date: today })}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
            period === 'yearly'
              ? 'bg-white text-emerald-800 shadow-sm ring-1 ring-black/5'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Tahunan
        </button>

        {allowAll && (
          <button
            type="button"
            onClick={() => onChange({ period: 'all' })}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
              period === 'all'
                ? 'bg-white text-emerald-800 shadow-sm ring-1 ring-black/5'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Semua
          </button>
        )}
      </div>

      {/* ── Calendar Picker Button with Active Range Preview ──────────────── */}
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
            period === 'custom' || (period === 'daily' && date && date !== today)
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900 ring-2 ring-emerald-500/20'
              : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50/80 shadow-sm'
          }`}
          title="Pilih tanggal atau rentang kustom"
        >
          <Calendar size={14} className="text-emerald-700 shrink-0" />
          <span className="font-semibold text-gray-900 truncate max-w-[180px] sm:max-w-none">
            {activeLabel || (period === 'daily' ? 'Hari Ini' : 'Pilih Rentang')}
          </span>
          <ChevronDown size={13} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* ── Popover Dropdown ──────────────────────────────────────────────── */}
        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100">
              <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                <Calendar size={14} className="text-emerald-600" />
                Pilih Periode / Tanggal
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
              >
                <X size={14} />
              </button>
            </div>

            {/* Quick Single Date */}
            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Pilih Satu Hari (Otomatis Filter)
              </label>
              <input
                type="date"
                max={today}
                value={date || today}
                onChange={(e) => e.target.value && handleQuickDateSelect(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
              />
            </div>

            {/* Custom Date Range */}
            <div className="space-y-3 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Rentang Kustom (Custom Range)
                </label>
                <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded">
                  Otomatis Terapkan
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-gray-400 block mb-0.5">Dari:</span>
                  <input
                    type="date"
                    max={today}
                    value={customStart}
                    onChange={(e) => handleCustomStartChange(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block mb-0.5">Sampai:</span>
                  <input
                    type="date"
                    max={today}
                    value={customEnd}
                    onChange={(e) => handleCustomEndChange(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-gray-50/50"
                  />
                </div>
              </div>

              {customError && (
                <p className="text-[11px] text-red-600 font-medium">{customError}</p>
              )}

              <div className="flex items-center gap-2 pt-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyCustom}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold h-8 rounded-lg shadow-sm"
                >
                  <Check size={13} className="mr-1" /> Tutup & Terapkan
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsOpen(false);
                    onChange({ period: 'daily', date: today });
                  }}
                  className="text-xs text-gray-600 h-8 rounded-lg"
                >
                  Hari Ini
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
