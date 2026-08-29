'use client';

import { useState } from 'react';
import {
  Printer,
  PrinterCheck,
  PrinterX,
  Loader2,
  ChevronDown,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePrinterStore, usePrinterStatusSync } from '@/hooks/usePrinter';
import type { PrinterStatus as PrinterStatusType } from '@/lib/printer/PrinterService';
import toast from 'react-hot-toast';
import { useI18n } from '@/hooks/useI18n';
import api from '@/lib/api';

const STATUS_CONFIG: Record<
  PrinterStatusType,
  { labelKey: string; color: string; Icon: React.ElementType }
> = {
  disconnected: {
    labelKey: 'pos.printerNoPrinter',
    color: 'text-gray-400',
    Icon: Printer,
  },
  connecting: {
    labelKey: 'pos.printerConnecting',
    color: 'text-amber-500',
    Icon: Loader2,
  },
  connected: {
    labelKey: 'pos.printerReady',
    color: 'text-emerald-600',
    Icon: PrinterCheck,
  },
  error: {
    labelKey: 'pos.printerError',
    color: 'text-red-500',
    Icon: PrinterX,
  },
};

export default function PrinterStatus() {
  usePrinterStatusSync();

  const [isTesting, setIsTesting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const {
    status,
    lastError,
    hardwarePrinter,
  } = usePrinterStore();
  const { t } = useI18n();

  const isHwOnline = hardwarePrinter ? Boolean(hardwarePrinter.is_online) : false;
  const effectiveStatus: PrinterStatusType = hardwarePrinter
    ? (isHwOnline ? 'connected' : (hardwarePrinter.status === 'error' ? 'error' : 'disconnected'))
    : status;
  const cfg = STATUS_CONFIG[effectiveStatus];
  const Icon = cfg.Icon;

  const handleCheckStatus = async () => {
    await usePrinterStore.getState().refreshHardwarePrinter();
    const updated = usePrinterStore.getState().hardwarePrinter;
    if (updated?.is_online) {
      toast.success(`Printer '${updated.name}' terhubung & siap digunakan!`);
    } else if (updated) {
      toast.error(updated.message || `Printer '${updated.name}' offline.`);
    } else {
      toast.error('Belum ada printer yang terdaftar.');
    }
  };

  const handleAutoConnect = async () => {
    setIsScanning(true);
    try {
      const res = await api.post('/printers/auto-connect');
      if (res.data.success) {
        await usePrinterStore.getState().refreshHardwarePrinter();
        toast.success(res.data.message || 'Printer berhasil dihubungkan!');
      } else {
        toast.error(res.data.message || 'Tidak ada printer yang terdeteksi.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Gagal mendeteksi printer.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleTestPrint = async () => {
    setIsTesting(true);
    try {
      const res = await api.post('/printers/test-default');
      if (res.data.success) {
        toast.success(res.data.message || 'Struk tes berhasil dikirim ke printer!');
      } else {
        toast.error(res.data.message || 'Cetak tes gagal.');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Gagal mengirim cetak tes ke printer.');
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`flex items-center gap-1.5 ${cfg.color} border-current/30 shadow-sm`}
        >
          <Icon
            size={16}
            className={isScanning || isTesting ? 'animate-spin' : undefined}
          />
          <span className="hidden sm:inline text-xs font-medium truncate max-w-[160px]">
            {hardwarePrinter
              ? (isHwOnline ? hardwarePrinter.name : `${hardwarePrinter.name} (Offline)`)
              : t(cfg.labelKey)}
          </span>
          <ChevronDown size={12} className="text-gray-400" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-gray-500 font-semibold">
          {t('pos.printerSectionLabel')}
        </DropdownMenuLabel>

        {hardwarePrinter && (
          <div className="px-2 py-2 text-xs text-gray-600 bg-gray-50 rounded mx-1 mb-1 border border-gray-100">
            <p className="font-semibold text-gray-900 truncate flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${isHwOnline ? 'bg-emerald-500 shadow-sm' : 'bg-red-500'}`} />
              {hardwarePrinter.name}
            </p>
            <p className="mt-1 text-[11px] text-gray-600">
              Status:{' '}
              <span className={`font-bold ${isHwOnline ? 'text-emerald-700' : 'text-red-600'}`}>
                {isHwOnline ? 'Siap & Terhubung' : 'Offline / Terputus'}
              </span>
            </p>
            {hardwarePrinter.message && (
              <p className={`mt-1 text-[11px] p-1 rounded border ${isHwOnline ? 'text-emerald-800 bg-emerald-50/70 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
                {hardwarePrinter.message}
              </p>
            )}
            <p className="capitalize text-[10px] text-gray-400 mt-1">
              Koneksi: {hardwarePrinter.connection_type.toUpperCase()} · Lebar: {hardwarePrinter.paper_width || '58mm'}
            </p>
          </div>
        )}

        {lastError && (
          <div className="px-2 py-1.5 text-xs text-red-600 bg-red-50 rounded mx-1 my-1">
            {lastError}
          </div>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={handleCheckStatus}
          className="text-xs cursor-pointer py-1.5"
        >
          <RefreshCw size={14} className="mr-2 text-gray-500" />
          Periksa Status Koneksi
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={handleAutoConnect}
          disabled={isScanning}
          className="text-xs cursor-pointer py-1.5"
        >
          <Printer size={14} className="mr-2 text-blue-600" />
          {isScanning ? 'Mendeteksi USB...' : 'Auto-Hubungkan Printer (Scan OS)'}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={handleTestPrint}
          disabled={isTesting}
          className="text-xs cursor-pointer py-1.5 font-medium text-emerald-700 focus:text-emerald-800"
        >
          <FileText size={14} className="mr-2 text-emerald-600" />
          {isTesting ? 'Mencetak...' : 'Cetak Struk Tes (58mm)'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
