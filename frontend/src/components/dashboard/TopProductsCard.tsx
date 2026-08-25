'use client';

import { Trophy, ArrowRight, Package } from 'lucide-react';
import Link from 'next/link';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface TopProductItem {
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  revenue: number;
  order_count: number;
}

interface Props {
  data: TopProductItem[];
  className?: string;
}

export default function TopProductsCard({ data, className = '' }: Props) {
  const fmt = useFormatCurrency();

  const getRankBadge = (index: number) => {
    if (index === 0) return 'bg-amber-100 text-amber-800 border-amber-300 font-bold';
    if (index === 1) return 'bg-slate-100 text-slate-700 border-slate-300 font-bold';
    if (index === 2) return 'bg-orange-100 text-orange-800 border-orange-300 font-bold';
    return 'bg-gray-100 text-gray-600 border-gray-200 font-medium';
  };

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 p-5 shadow-xs flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-50 text-amber-700">
            <Trophy size={16} />
          </div>
          <h3 className="font-bold text-gray-900 text-sm">5 Produk Terlaris</h3>
        </div>
        <Link
          href="/products"
          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 transition-colors"
        >
          Katalog Produk <ArrowRight size={13} />
        </Link>
      </div>

      {data.length === 0 ? (
        <div className="py-10 text-center text-gray-400 text-xs">
          Belum ada produk terjual pada periode ini.
        </div>
      ) : (
        <div className="divide-y divide-gray-100/80 my-auto">
          {data.map((item, idx) => (
            <div
              key={item.product_id}
              className="flex items-center justify-between py-2.5 hover:bg-gray-50/60 px-2 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className={`w-6 h-6 rounded-lg text-xs flex items-center justify-center border shrink-0 ${getRankBadge(
                    idx
                  )}`}
                >
                  {idx + 1}
                </span>

                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">{item.product_name}</p>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1">
                    <Package size={11} className="text-gray-400" />
                    Terjual: <strong className="text-emerald-800 font-semibold">{item.quantity} {item.unit}</strong>
                    <span className="text-gray-300">•</span>
                    <span>{item.order_count} Transaksi</span>
                  </p>
                </div>
              </div>

              <div className="text-right shrink-0 pl-2">
                <p className="text-xs font-bold text-gray-900">{fmt(item.revenue)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
