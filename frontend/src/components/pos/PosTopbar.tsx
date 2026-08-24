'use client';

import PrinterStatus from './PrinterStatus';
import { Store, UserCheck, CreditCard } from 'lucide-react';

interface Props {
  tables?: any[];
  onShowTablePicker?: () => void;
}

export default function PosTopbar(_props: Props) {
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-white shrink-0 px-4 py-2.5 shadow-xs">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
            <Store size={18} />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-none">POS Kasir Koperasi</h1>
            <p className="text-[11px] text-gray-500 font-medium mt-0.5">Mode Toko / Counter Langsung</p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 pl-3 border-l border-gray-200">
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200 font-medium">
            <UserCheck size={13} className="text-emerald-600" />
            <kbd className="font-mono font-bold text-gray-800 bg-white px-1.5 py-0.5 rounded border border-gray-300 shadow-2xs">F2</kbd>
            <span>Pilih Member</span>
          </span>

          <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200 font-medium">
            <CreditCard size={13} className="text-blue-600" />
            <kbd className="font-mono font-bold text-gray-800 bg-white px-1.5 py-0.5 rounded border border-gray-300 shadow-2xs">F4</kbd>
            <span>Bayar / Checkout</span>
          </span>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        <PrinterStatus />
      </div>
    </div>
  );
}
