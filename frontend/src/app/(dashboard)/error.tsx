'use client';

import { useEffect } from 'react';
import { RefreshCw, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Dashboard Error Boundary Caught]:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-4">
        <AlertTriangle size={28} />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Halaman Mengalami Kendala</h2>
      <p className="text-sm text-gray-600 max-w-md mb-6 font-mono text-xs bg-gray-50 p-3 rounded-lg border border-gray-200 break-words">
        {error?.message || 'Terjadi kesalahan saat memuat komponen pada halaman ini.'}
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => reset()}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-brand text-white rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
        >
          <RefreshCw size={15} /> Coba Muat Ulang
        </button>
        <Link
          href="/pos"
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={15} /> Kembali ke Kasir
        </Link>
      </div>
    </div>
  );
}
