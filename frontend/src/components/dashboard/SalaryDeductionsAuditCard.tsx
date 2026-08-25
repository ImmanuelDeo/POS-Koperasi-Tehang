'use client';

import { FileSpreadsheet, Clock, CheckCircle2, XCircle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface SalaryDeductionsStatusAudit {
  pending: { count: number; total: number };
  confirmed: { count: number; total: number };
  rejected: { count: number; total: number };
  cancelled: { count: number; total: number };
}

interface Props {
  data: SalaryDeductionsStatusAudit;
  className?: string;
}

export default function SalaryDeductionsAuditCard({ data, className = '' }: Props) {
  const fmt = useFormatCurrency();

  const totalDeductions =
    (data.pending?.count || 0) +
    (data.confirmed?.count || 0) +
    (data.rejected?.count || 0) +
    (data.cancelled?.count || 0);

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 p-5 shadow-xs flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-50 text-blue-700">
            <FileSpreadsheet size={16} />
          </div>
          <h3 className="font-bold text-gray-900 text-sm">Status Potong Gaji (Payroll Audit)</h3>
        </div>
        <Link
          href="/salary-deductions"
          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 transition-colors"
        >
          Kelola Potong Gaji <ArrowRight size={13} />
        </Link>
      </div>

      {totalDeductions === 0 ? (
        <div className="py-10 text-center text-gray-400 text-xs">
          Tidak ada transaksi potong gaji pada periode ini.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-auto">
          {/* Pending Card */}
          <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-100 text-amber-800 shrink-0">
                <Clock size={14} />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-amber-900">Menunggu Verifikasi HR</p>
                <p className="text-xs font-bold text-amber-950 mt-0.5">{fmt(data.pending?.total || 0)}</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-200/70 text-amber-900">
              {data.pending?.count || 0} Trx
            </span>
          </div>

          {/* Confirmed Card */}
          <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 shrink-0">
                <CheckCircle2 size={14} />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-emerald-900">Terkonfirmasi Payroll</p>
                <p className="text-xs font-bold text-emerald-950 mt-0.5">{fmt(data.confirmed?.total || 0)}</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-200/70 text-emerald-900">
              {data.confirmed?.count || 0} Trx
            </span>
          </div>

          {/* Rejected Card */}
          {(data.rejected?.count || 0) > 0 && (
            <div className="p-3 rounded-xl bg-red-50/60 border border-red-200/80 flex items-center justify-between col-span-1 sm:col-span-2">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-red-100 text-red-800 shrink-0">
                  <XCircle size={14} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-red-900">Ditolak HR</p>
                  <p className="text-xs font-bold text-red-950 mt-0.5">{fmt(data.rejected?.total || 0)}</p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-200/70 text-red-900">
                {data.rejected?.count || 0} Trx
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
