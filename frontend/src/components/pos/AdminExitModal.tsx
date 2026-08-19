'use client';

import { useState, useRef, useEffect } from 'react';
import { ShieldAlert, LogOut, Monitor, X, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AdminRecoveryAction, AdminKioskRecoveryResult } from '@/lib/types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminExitModal({ isOpen, onClose }: Props) {
  const [pin, setPin] = useState('');
  const [action, setAction] = useState<AdminRecoveryAction>('exit_kiosk');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setErrorMessage(null);
      setAction('exit_kiosk');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || pin.trim().length < 4) {
      setErrorMessage('PIN harus berupa 4–12 digit angka.');
      return;
    }

    if (!window.electronAPI?.adminKioskRecovery) {
      setErrorMessage('Fitur Electron recovery tidak tersedia pada browser.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const submittedPin = pin.trim();
    // Clear local state PIN immediately
    setPin('');

    try {
      const result: AdminKioskRecoveryResult = await window.electronAPI.adminKioskRecovery(
        submittedPin,
        action
      );

      if (result.success) {
        toast.success(result.message || 'Otorisasi Admin Berhasil');
        onClose();
      } else {
        setErrorMessage(result.error || 'PIN Admin tidak valid.');
        inputRef.current?.focus();
      }
    } catch {
      setErrorMessage('Terjadi kegagalan komunikasi sistem.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !loading) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-gray-900 via-slate-800 to-gray-900 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ShieldAlert size={22} />
            </div>
            <div>
              <h3 className="font-semibold text-base leading-tight">Admin Recovery</h3>
              <p className="text-xs text-gray-300">Otorisasi Keluar / Matikan Kiosk</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Action Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Pilih Aksi Pemulihan
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAction('exit_kiosk')}
                disabled={loading}
                className={`flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border text-sm font-medium transition-all ${
                  action === 'exit_kiosk'
                    ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 shadow-sm ring-2 ring-indigo-500/20'
                    : 'border-gray-200 bg-gray-50/60 text-gray-700 hover:bg-gray-100/80'
                }`}
              >
                <Monitor size={20} className={action === 'exit_kiosk' ? 'text-indigo-600' : 'text-gray-500'} />
                <span className="text-center text-xs">Exit Kiosk (Windowed)</span>
              </button>

              <button
                type="button"
                onClick={() => setAction('quit_app')}
                disabled={loading}
                className={`flex flex-col items-center justify-center gap-2 p-3.5 rounded-xl border text-sm font-medium transition-all ${
                  action === 'quit_app'
                    ? 'border-red-600 bg-red-50/70 text-red-700 shadow-sm ring-2 ring-red-500/20'
                    : 'border-gray-200 bg-gray-50/60 text-gray-700 hover:bg-gray-100/80'
                }`}
              >
                <LogOut size={20} className={action === 'quit_app' ? 'text-red-600' : 'text-gray-500'} />
                <span className="text-center text-xs">Tutup Aplikasi POS</span>
              </button>
            </div>
          </div>

          {/* PIN Input */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              PIN Admin / Owner
            </label>
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              maxLength={12}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="Masukkan PIN Admin"
              disabled={loading}
              className="w-full px-4 py-3 text-center text-xl tracking-[0.3em] font-mono border-2 border-gray-200 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:tracking-normal placeholder:font-sans placeholder:text-sm"
              autoComplete="off"
            />
          </div>

          {/* Error Notice */}
          {errorMessage && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs animate-in fade-in">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Submit and Cancel Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 text-gray-700 font-medium text-sm hover:bg-gray-100 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className={`flex-1 py-2.5 px-4 rounded-xl font-medium text-sm text-white shadow-md transition-all flex items-center justify-center gap-2 ${
                action === 'quit_app'
                  ? 'bg-red-600 hover:bg-red-700 disabled:bg-gray-300'
                  : 'bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300'
              }`}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <span>Konfirmasi</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
