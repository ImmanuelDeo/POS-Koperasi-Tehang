'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  X,
  CreditCard,
  Banknote,
  QrCode,
  Building,
  User,
  UserCheck,
  Building2,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/store/cart';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import api from '@/lib/api';
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

  const [activeTab, setActiveTab] = useState<'cash' | 'salary_deduction' | 'qris' | 'transfer'>('cash');
  const [cashTendered, setCashTendered] = useState<string>(String(totalAmount));
  const [deductionNotes, setDeductionNotes] = useState('');
  const [qrisTransactionId, setQrisTransactionId] = useState('');
  const [transferReferenceNo, setTransferReferenceNo] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const [paymentSettings, setPaymentSettings] = useState({
    qris_merchant_name: 'Koperasi Karyawan Tehang',
    qris_image_url: '',
    bank_name: 'Bank BCA',
    bank_account_number: '1234567890',
    bank_account_holder: 'Koperasi Tehang',
  });

  useEffect(() => {
    api.get('/settings').then((res) => {
      const data = res.data?.settings || {};
      setPaymentSettings({
        qris_merchant_name: data.qris_merchant_name || 'Koperasi Karyawan Tehang',
        qris_image_url: data.qris_image_url || '',
        bank_name: data.bank_name || 'Bank BCA',
        bank_account_number: data.bank_account_number || '1234567890',
        bank_account_holder: data.bank_account_holder || 'Koperasi Tehang',
      });
    }).catch(() => {});
  }, []);

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast.success(`${fieldName} berhasil disalin!`, { duration: 1500 });
    setTimeout(() => setCopiedField(null), 2000);
  };

  // ── Salary Deduction Eligibility & Limits ──────────────────────────────────
  const isMemberSelected = !!member;
  const isMemberActive = member ? member.is_active !== 0 && (member.is_active as any) !== false : false;
  const isSalaryDeductionEnabled = member ? (member.salary_deduction_enabled === 1 || (member.salary_deduction_enabled as any) === true) : false;
  const monthlyLimit = Number(member?.monthly_deduction_limit || 0);
  const totalMonthlyAccumulation = Number(member?.current_monthly_usage || 0);
  const totalHistoricalAccumulation = Number(member?.total_accumulated_deductions || 0);
  const remainingLimit = monthlyLimit > 0 ? Math.max(0, monthlyLimit - totalMonthlyAccumulation) : Infinity;
  const newEstimatedAccumulation = totalMonthlyAccumulation + totalAmount;
  const isOverLimit = monthlyLimit > 0 && totalAmount > remainingLimit;

  const isDeductionEligible =
    isMemberSelected &&
    isMemberActive &&
    isSalaryDeductionEnabled &&
    !isOverLimit &&
    totalAmount > 0;

  const deductionIneligibilityReason = useMemo(() => {
    if (!isMemberSelected) return 'Pilih member koperasi terlebih dahulu';
    if (!isMemberActive) return 'Akun member ini berstatus non-aktif';
    if (!isSalaryDeductionEnabled) return 'Fasilitas potong gaji (bon) dinonaktifkan untuk member ini';
    if (isOverLimit) {
      return `Total tagihan (${fmt(totalAmount)}) melebihi sisa limit potong gaji bulan ini (${fmt(remainingLimit)}). Limit: ${fmt(monthlyLimit)}, Terpakai: ${fmt(totalMonthlyAccumulation)}.`;
    }
    if (totalAmount <= 0) return 'Total belanja harus lebih dari 0';
    return null;
  }, [
    isMemberSelected,
    isMemberActive,
    isSalaryDeductionEnabled,
    isOverLimit,
    totalAmount,
    remainingLimit,
    monthlyLimit,
    totalMonthlyAccumulation,
    fmt,
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

  const handleConfirmQris = () => {
    if (processing) return;
    setProcessing(true);
    const notesParts = [];
    if (qrisTransactionId.trim()) notesParts.push(`Ref QRIS: ${qrisTransactionId.trim()}`);
    if (cart.orderNotes) notesParts.push(cart.orderNotes);

    onConfirm(
      [{ method: 'qris', amount: totalAmount, notes: qrisTransactionId.trim() || undefined }],
      0,
      null,
      notesParts.join(' • ') || undefined
    );
  };

  const handleConfirmTransfer = () => {
    if (processing) return;
    setProcessing(true);
    const notesParts = [];
    if (transferReferenceNo.trim()) notesParts.push(`Ref Trf: ${transferReferenceNo.trim()}`);
    if (cart.orderNotes) notesParts.push(cart.orderNotes);

    onConfirm(
      [{ method: 'transfer', amount: totalAmount, notes: transferReferenceNo.trim() || undefined }],
      0,
      null,
      notesParts.join(' • ') || undefined
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 animate-in fade-in duration-150"
      onClick={() => !processing && onClose()}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
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
          <div className="grid grid-cols-4 rounded-xl bg-gray-100 p-1 gap-1">
            <button
              type="button"
              disabled={processing}
              onClick={() => setActiveTab('cash')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'cash'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Banknote size={15} className={activeTab === 'cash' ? 'text-emerald-600' : 'text-gray-400'} />
              <span className="truncate">Tunai</span>
            </button>

            <button
              type="button"
              disabled={processing}
              onClick={() => setActiveTab('salary_deduction')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'salary_deduction'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <CreditCard
                size={15}
                className={activeTab === 'salary_deduction' ? 'text-emerald-600' : 'text-gray-400'}
              />
              <span className="truncate">Bon Gaji</span>
            </button>

            <button
              type="button"
              disabled={processing}
              onClick={() => setActiveTab('qris')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'qris'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <QrCode size={15} className={activeTab === 'qris' ? 'text-emerald-600' : 'text-gray-400'} />
              <span className="truncate">QRIS</span>
            </button>

            <button
              type="button"
              disabled={processing}
              onClick={() => setActiveTab('transfer')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'transfer'
                  ? 'bg-white text-emerald-800 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Building size={15} className={activeTab === 'transfer' ? 'text-emerald-600' : 'text-gray-400'} />
              <span className="truncate">Transfer</span>
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
                  {/* Member Details & Limit Breakdown */}
                  <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200/80 space-y-2.5">
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

                    <div className="pt-2 border-t border-emerald-200/60 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] text-gray-500 block">Limit Bulanan</span>
                        <strong className="text-gray-900 font-bold text-xs">
                          {monthlyLimit > 0 ? fmt(monthlyLimit) : 'Bebas Limit'}
                        </strong>
                      </div>
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] text-gray-500 block">Terpakai Bulan Ini</span>
                        <strong className="text-amber-800 font-bold text-xs">
                          {fmt(totalMonthlyAccumulation)}
                        </strong>
                      </div>
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] text-gray-500 block">Sisa Limit Tersedia</span>
                        <strong className={`font-bold text-xs ${isOverLimit ? 'text-red-600' : 'text-emerald-700'}`}>
                          {monthlyLimit > 0 ? fmt(remainingLimit) : 'Bebas Limit'}
                        </strong>
                      </div>
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] text-gray-500 block">Total Riwayat Bon</span>
                        <strong className="text-slate-800 font-bold text-xs">
                          {fmt(totalHistoricalAccumulation)}
                        </strong>
                      </div>
                    </div>

                    <div className="pt-1 text-[11px] text-emerald-900 flex justify-between items-center">
                      <span>Estimasi akumulasi setelah transaksi:</span>
                      <strong className="text-emerald-800 font-bold">{fmt(newEstimatedAccumulation)}</strong>
                    </div>
                  </div>

                  {/* Eligibility Status Alert */}
                  {isDeductionEligible ? (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
                      <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                      <span>
                        {monthlyLimit > 0
                          ? `Limit mencukupi • Sisa limit setelah transaksi: ${fmt(Math.max(0, remainingLimit - totalAmount))}`
                          : 'Bebas limit • Transaksi dicatat langsung ke buku bon / potong gaji.'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 text-xs">
                      <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
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
          {/* ── TAB 3: QRIS (NON-TUNAI) ────────────────────────────────────── */}
          {activeTab === 'qris' && (
            <div className="space-y-3.5 animate-in fade-in-50 duration-150">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-50 via-teal-50 to-white border border-emerald-200 text-center space-y-3">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="px-2 py-0.5 rounded bg-emerald-600 text-white font-black text-xs tracking-wider">
                    QRIS
                  </span>
                  <span className="text-xs font-bold text-gray-800">
                    {paymentSettings.qris_merchant_name}
                  </span>
                </div>

                {/* QR Display / Placeholder */}
                <div className="w-44 h-44 mx-auto bg-white p-2.5 rounded-xl border-2 border-emerald-500/40 shadow-inner flex flex-col items-center justify-center relative group">
                  {paymentSettings.qris_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={paymentSettings.qris_image_url}
                      alt="QRIS Koperasi"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center p-2">
                      <QrCode size={90} className="text-emerald-700 mx-auto" />
                      <p className="text-[10px] font-bold text-gray-700 mt-1 uppercase tracking-tight">
                        Scan QRIS Koperasi
                      </p>
                      <p className="text-[9px] text-gray-400">Siap Dipindai Pembeli</p>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-bold text-emerald-900">
                    Nominal Tagihan: {fmt(totalAmount)}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Mendukung BCA, Mandiri, BRI, BNI, GoPay, OVO, ShopeePay, DANA & m-Banking.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                  ID Transaksi / No. Referensi QRIS (Opsional)
                </label>
                <input
                  type="text"
                  disabled={processing}
                  value={qrisTransactionId}
                  onChange={(e) => setQrisTransactionId(e.target.value.slice(0, 50))}
                  placeholder="Contoh: QRIS-982341..."
                  maxLength={50}
                  className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                />
              </div>
            </div>
          )}

          {/* ── TAB 4: TRANSFER BANK ────────────────────────────────────────── */}
          {activeTab === 'transfer' && (
            <div className="space-y-3.5 animate-in fade-in-50 duration-150">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50 via-slate-50 to-white border border-blue-200 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-blue-100">
                  <div className="flex items-center gap-2">
                    <Building className="text-blue-600" size={18} />
                    <span className="text-xs font-bold text-gray-900">
                      Rekening Tujuan Koperasi
                    </span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                    {paymentSettings.bank_name}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="p-2.5 bg-white rounded-xl border border-blue-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-400 font-medium">Nomor Rekening</p>
                      <p className="text-base font-mono font-black text-gray-900 tracking-wider">
                        {paymentSettings.bank_account_number}
                      </p>
                      <p className="text-[11px] text-gray-600 font-medium">
                        a.n. {paymentSettings.bank_account_holder}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(paymentSettings.bank_account_number, 'Nomor Rekening')}
                      className="h-8 px-2.5 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
                    >
                      {copiedField === 'Nomor Rekening' ? (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <Check size={13} /> Disalin
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Copy size={13} /> Salin
                        </span>
                      )}
                    </Button>
                  </div>

                  <div className="p-2 bg-blue-50/70 rounded-lg flex items-center justify-between text-xs">
                    <span className="text-gray-600">Nominal Transfer:</span>
                    <strong className="text-blue-950 font-bold">{fmt(totalAmount)}</strong>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                  Nama Pengirim / No. Referensi Transfer (Opsional)
                </label>
                <input
                  type="text"
                  disabled={processing}
                  value={transferReferenceNo}
                  onChange={(e) => setTransferReferenceNo(e.target.value.slice(0, 50))}
                  placeholder="Contoh: Budi Santoso / TRF-83921..."
                  maxLength={50}
                  className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                />
              </div>
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

          {activeTab === 'cash' && (
            <Button
              type="button"
              disabled={processing || !isCashSufficient}
              onClick={handleConfirmCash}
              className="flex-[2] h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-md active:scale-98 transition-all"
            >
              {processing ? 'Memproses Transaksi...' : `Bayar Tunai (${fmt(totalAmount)})`}
            </Button>
          )}

          {activeTab === 'salary_deduction' && (
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

          {activeTab === 'qris' && (
            <Button
              type="button"
              disabled={processing}
              onClick={handleConfirmQris}
              className="flex-[2] h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs sm:text-sm shadow-md active:scale-98 transition-all"
            >
              {processing ? 'Memproses Pembayaran QRIS...' : `Konfirmasi QRIS (${fmt(totalAmount)})`}
            </Button>
          )}

          {activeTab === 'transfer' && (
            <Button
              type="button"
              disabled={processing}
              onClick={handleConfirmTransfer}
              className="flex-[2] h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs sm:text-sm shadow-md active:scale-98 transition-all"
            >
              {processing ? 'Memproses Transfer...' : `Konfirmasi Transfer (${fmt(totalAmount)})`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
