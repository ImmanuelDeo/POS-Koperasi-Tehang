'use client';

import { useState, useMemo } from 'react';
import {
  X,
  CreditCard,
  Banknote,
  User,
  UserCheck,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Coins,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/store/cart';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import toast from 'react-hot-toast';

export interface PrepaidPayment {
  method: string;
  amount: number;
  notes?: string;
}

export interface PrepaidDiscount {
  type: 'percentage' | 'amount';
  value: number;
  reason?: string;
  override_pin?: string;
}

interface Props {
  currency?: string;
  onClose: () => void;
  onConfirm: (
    payments: PrepaidPayment[],
    walletAmount: number,
    discount: PrepaidDiscount | null,
    notes?: string
  ) => void;
  onOpenMemberSelector?: () => void;
}

export default function PrepaidCheckoutModal({
  onClose,
  onConfirm,
  onOpenMemberSelector,
}: Props) {
  const cart = useCartStore();
  const fmt = useFormatCurrency();
  const member = cart.member;
  const totalAmount = Math.round(cart.subtotal());

  const [activeTab, setActiveTab] = useState<'cash' | 'salary_deduction'>('cash');
  const [cashTendered, setCashTendered] = useState<string>(String(totalAmount));
  const [deductionNotes, setDeductionNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  // ── Salary Deduction Eligibility (Unlimited with Accumulated Usage Info) ──
  const isMemberSelected = !!member;
  const isMemberActive = member?.is_active === 1;
  const isDeductionEnabled = member?.salary_deduction_enabled === 1;
  const totalMonthlyAccumulation = member?.current_monthly_usage ?? 0;
  const newEstimatedAccumulation = totalMonthlyAccumulation + totalAmount;

  const isDeductionEligible =
    isMemberSelected &&
    isMemberActive &&
    isDeductionEnabled &&
    totalAmount > 0;

  const deductionIneligibilityReason = useMemo(() => {
    if (!isMemberSelected) return 'Pilih member koperasi terlebih dahulu';
    if (!isMemberActive) return 'Akun member ini berstatus non-aktif';
    if (!isDeductionEnabled) return 'Fasilitas potong gaji dinonaktifkan untuk member ini';
    if (totalAmount <= 0) return 'Total belanja harus lebih dari 0';
    return null;
  }, [
    isMemberSelected,
    isMemberActive,
    isDeductionEnabled,
    totalAmount,
  ]);

  // ── Cash Calculations ─────────────────────────────────────────────────────
  const numericTendered = parseFloat(cashTendered.replace(/\D/g, '')) || 0;
  const cashChange = Math.max(0, numericTendered - totalAmount);
  const isCashSufficient = numericTendered >= totalAmount;

  const quickCashOptions = useMemo(() => {
    const opts = [totalAmount];
    const standardDenominations = [10000, 20000, 50000, 100000, 200000, 500000];
    for (const d of standardDenominations) {
      if (d > totalAmount && !opts.includes(d)) {
        opts.push(d);
      }
    }
    // Round up to next 10k or 50k
    const next10k = Math.ceil(totalAmount / 10000) * 10000;
    const next50k = Math.ceil(totalAmount / 50000) * 50000;
    if (next10k > totalAmount && !opts.includes(next10k)) opts.push(next10k);
    if (next50k > totalAmount && !opts.includes(next50k)) opts.push(next50k);
    return opts.sort((a, b) => a - b).slice(0, 5);
  }, [totalAmount]);

  // ── Confirm Actions ───────────────────────────────────────────────────────
  const handleConfirmCash = () => {
    if (processing) return;
    if (!isCashSufficient) {
      toast.error('Jumlah uang tunai yang diterima kurang dari total tagihan');
      return;
    }
    setProcessing(true);
    onConfirm(
      [{ method: 'cash', amount: totalAmount }],
      0,
      null,
      cart.orderNotes || undefined
    );
  };

  const handleConfirmSalaryDeduction = () => {
    if (processing) return;
    if (!isDeductionEligible) {
      toast.error(deductionIneligibilityReason || 'Member tidak memenuhi syarat potong gaji');
      return;
    }
    setProcessing(true);
    onConfirm(
      [{ method: 'salary_deduction', amount: totalAmount }],
      0,
      null,
      deductionNotes.trim() || cart.orderNotes || undefined
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={() => !processing && onClose()}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 bg-gray-50/70">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-gray-900">Pembayaran Tagihan</h2>
            <p className="text-xs text-gray-500">
              {cart.items.length} jenis barang ({cart.itemCount()} item)
            </p>
          </div>
          <button
            type="button"
            disabled={processing}
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors border border-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* Total Tagihan Box */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-4 text-white shadow-md">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Total yang Harus Dibayar
            </p>
            <p className="text-3xl sm:text-4xl font-black mt-1 text-emerald-400 tracking-tight">
              {fmt(totalAmount)}
            </p>

            <div className="mt-3 pt-2.5 border-t border-slate-700/80 flex items-center justify-between text-xs">
              <span className="text-slate-300 flex items-center gap-1.5 truncate">
                <User size={13} className="text-slate-400" />
                {member ? (
                  <strong className="text-white font-semibold">
                    {member.name} ({member.member_no})
                  </strong>
                ) : (
                  <span className="text-slate-300">Pembeli Umum (Non-Member)</span>
                )}
              </span>
              {member && (
                <span className="text-emerald-400 font-medium text-[11px]">
                  Akumulasi Bon: {fmt(totalMonthlyAccumulation)}
                </span>
              )}
            </div>
          </div>

          {/* Payment Method Selector Tabs */}
          <div className="flex rounded-xl bg-gray-100 p-1 gap-1">
            <button
              type="button"
              disabled={processing}
              onClick={() => setActiveTab('cash')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'cash'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Banknote size={16} className={activeTab === 'cash' ? 'text-emerald-600' : 'text-gray-400'} />
              Tunai (Cash)
            </button>

            <button
              type="button"
              disabled={processing}
              onClick={() => setActiveTab('salary_deduction')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'salary_deduction'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <CreditCard
                size={16}
                className={activeTab === 'salary_deduction' ? 'text-emerald-600' : 'text-gray-400'}
              />
              Potong Gaji
              {member && isDeductionEligible && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </button>
          </div>

          {/* ── TAB 1: TUNAI (CASH) ────────────────────────────────────────── */}
          {activeTab === 'cash' && (
            <div className="space-y-3.5 animate-in fade-in-50 duration-150">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Uang Tunai Diterima (Rp)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    disabled={processing}
                    value={numericTendered ? numericTendered.toLocaleString('id-ID') : ''}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setCashTendered(raw);
                    }}
                    placeholder="0"
                    className="w-full pl-4 pr-4 py-2.5 text-lg font-bold text-gray-900 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                  />
                </div>
              </div>

              {/* Quick Cash Buttons */}
              <div className="flex gap-1.5 flex-wrap">
                {quickCashOptions.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={processing}
                    onClick={() => setCashTendered(String(opt))}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                      numericTendered === opt
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {opt === totalAmount ? 'Uang Pas' : fmt(opt)}
                  </button>
                ))}
              </div>

              {/* Kembalian Display */}
              <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
                  <Coins size={15} className="text-gray-400" />
                  Kembalian:
                </span>
                <span
                  className={`text-lg font-black ${
                    numericTendered < totalAmount ? 'text-gray-400' : 'text-emerald-700'
                  }`}
                >
                  {fmt(cashChange)}
                </span>
              </div>
            </div>
          )}

          {/* ── TAB 2: POTONG GAJI (SALARY DEDUCTION) ──────────────────────── */}
          {activeTab === 'salary_deduction' && (
            <div className="space-y-3 animate-in fade-in-50 duration-150">
              {member ? (
                <div className="space-y-3">
                  {/* Member Details */}
                  <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">
                          <UserCheck size={14} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900">{member.name}</p>
                          <p className="text-[10px] text-gray-500">
                            {member.member_no} • NIK: {member.employee_id || '-'}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-gray-600 border border-emerald-200 flex items-center gap-1">
                        <Building2 size={11} /> {member.department || 'Umum'}
                      </span>
                    </div>

                    <div className="pt-2 border-t border-emerald-200/60 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[10px] text-gray-500 block">Akumulasi Bon Bulan Ini</span>
                        <strong className="text-emerald-950 font-bold">{fmt(totalMonthlyAccumulation)}</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-500 block">Akumulasi Setelah Transaksi</span>
                        <strong className="text-emerald-700 font-bold">
                          {fmt(newEstimatedAccumulation)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Eligibility Status Alert */}
                  {isDeductionEligible ? (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
                      <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                      <span>Bebas limit • Transaksi dicatat langsung ke akumulasi potong gaji.</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                      <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-semibold">Tidak Dapat Menggunakan Potong Gaji:</strong>
                        <span>{deductionIneligibilityReason}</span>
                      </div>
                    </div>
                  )}

                  {/* Deduction Notes */}
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                      Catatan Potong Gaji (Opsional)
                    </label>
                    <input
                      type="text"
                      disabled={processing}
                      value={deductionNotes}
                      onChange={(e) => setDeductionNotes(e.target.value.slice(0, 100))}
                      placeholder="Contoh: Belanja sembako bulanan..."
                      maxLength={100}
                      className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    />
                  </div>
                </div>
              ) : (
                /* No Member Selected State */
                <div className="text-center py-6 px-4 rounded-xl bg-gray-50 border border-dashed border-gray-300 space-y-3">
                  <User size={32} className="mx-auto text-gray-300" />
                  <div>
                    <p className="text-xs font-bold text-gray-800">Member Belum Dipilih</p>
                    <p className="text-[11px] text-gray-500 max-w-[260px] mx-auto mt-0.5">
                      Metode Potong Gaji memerlukan identitas member koperasi yang sah.
                    </p>
                  </div>
                  {onOpenMemberSelector && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onOpenMemberSelector}
                      className="text-xs font-semibold bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                    >
                      + Pilih Member Koperasi (F2)
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={processing}
            onClick={onClose}
            className="flex-1 h-11 text-xs font-semibold text-gray-600"
          >
            Batal
          </Button>

          {activeTab === 'cash' ? (
            <Button
              type="button"
              disabled={processing || !isCashSufficient}
              onClick={handleConfirmCash}
              className="flex-[2] h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-md active:scale-98 transition-all"
            >
              {processing ? 'Memproses Transaksi...' : `Bayar Tunai (${fmt(totalAmount)})`}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={processing || !isDeductionEligible}
              onClick={handleConfirmSalaryDeduction}
              className={`flex-[2] h-11 font-bold text-xs sm:text-sm shadow-md active:scale-98 transition-all ${
                isDeductionEligible
                  ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {processing ? 'Memproses Potong Gaji...' : `Proses Potong Gaji (${fmt(totalAmount)})`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
