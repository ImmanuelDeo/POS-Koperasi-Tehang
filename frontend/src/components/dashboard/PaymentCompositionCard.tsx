'use client';

import { Wallet, CreditCard, Banknote, HelpCircle } from 'lucide-react';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface PaymentMethodItem {
  method: string;
  label: string;
  count: number;
  total: number;
  percentage: number;
}

interface Props {
  data: PaymentMethodItem[];
  className?: string;
}

export default function PaymentCompositionCard({ data, className = '' }: Props) {
  const fmt = useFormatCurrency();
  const totalAmount = data.reduce((sum, item) => sum + item.total, 0);

  const getMethodIcon = (method: string) => {
    if (method === 'salary_deduction') return CreditCard;
    if (method === 'cash') return Banknote;
    if (method === 'wallet') return Wallet;
    return HelpCircle;
  };

  const getMethodColor = (method: string) => {
    if (method === 'salary_deduction') return 'bg-emerald-500';
    if (method === 'cash') return 'bg-blue-500';
    if (method === 'wallet') return 'bg-amber-500';
    return 'bg-gray-400';
  };

  const getMethodBadgeBg = (method: string) => {
    if (method === 'salary_deduction') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    if (method === 'cash') return 'bg-blue-50 text-blue-800 border-blue-200';
    return 'bg-gray-50 text-gray-700 border-gray-200';
  };

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 p-5 shadow-xs flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
            <Wallet size={16} />
          </div>
          <h3 className="font-bold text-gray-900 text-sm">Komposisi Pembayaran</h3>
        </div>
        <span className="text-xs font-semibold text-gray-500">
          Total: <strong className="text-gray-900">{fmt(totalAmount)}</strong>
        </span>
      </div>

      {data.length === 0 ? (
        <div className="py-10 text-center text-gray-400 text-xs">
          Belum ada data pembayaran pada periode ini.
        </div>
      ) : (
        <div className="space-y-4 my-auto">
          {/* Multi-segment Progress Bar */}
          <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
            {data.map((item) => {
              if (item.percentage <= 0) return null;
              return (
                <div
                  key={item.method}
                  style={{ width: `${item.percentage}%` }}
                  className={`${getMethodColor(item.method)} transition-all duration-300 relative group`}
                  title={`${item.label}: ${item.percentage}%`}
                />
              );
            })}
          </div>

          {/* List Breakdown */}
          <div className="space-y-3 pt-1">
            {data.map((item) => {
              const Icon = getMethodIcon(item.method);
              return (
                <div
                  key={item.method}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50/70 border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`p-1.5 rounded-lg border ${getMethodBadgeBg(item.method)} shrink-0`}>
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">{item.label}</p>
                      <p className="text-[11px] text-gray-400">
                        {item.count} Transaksi ({item.percentage}%)
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-gray-900">{fmt(item.total)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
