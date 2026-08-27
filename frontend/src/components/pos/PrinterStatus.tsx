'use client';

/**
 * PrinterStatus — toolbar button that shows printer connection state and
 * exposes connect / disconnect actions.
 *
 * Place it in the POS page header or sidebar header alongside other toolbar
 * icons.  Example:
 *
 *   <PrinterStatus currency={currency} />
 *
 * The `navigator.usb.requestDevice` picker is only opened on an explicit user
 * click, satisfying the browser's "transient user activation" requirement.
 */

import {
  Printer,
  PrinterCheck,
  PrinterX,
  Loader2,
  Unplug,
  ChevronDown,
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
import type { PrinterStatus } from '@/lib/printer/PrinterService';
import toast from 'react-hot-toast';
import { useI18n } from '@/hooks/useI18n';

const STATUS_CONFIG: Record<
  PrinterStatus,
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
    color: 'text-green-600',
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

  const {
    status, deviceInfo, lastError,
    connect, disconnect, clearError,
    printMethod, hardwarePrinter,
  } = usePrinterStore();
  const { t } = useI18n();

  const isHwOnline = hardwarePrinter ? Boolean(hardwarePrinter.is_online) : false;
  const effectiveStatus: PrinterStatus = hardwarePrinter
    ? (isHwOnline ? 'connected' : (hardwarePrinter.status === 'error' ? 'error' : 'disconnected'))
    : status;
  const cfg = STATUS_CONFIG[effectiveStatus];
  const Icon = cfg.Icon;

  const handleConnect = async () => {
    clearError();
    await usePrinterStore.getState().refreshHardwarePrinter();
    await connect();
    if (usePrinterStore.getState().status === 'connected') {
      toast.success(t('pos.printerConnected'));
    } else if (usePrinterStore.getState().lastError) {
      toast.error(usePrinterStore.getState().lastError!);
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    toast(t('pos.printerDisconnected'));
  };

  const isConnected = status === 'connected' || isHwOnline;
  const isConnecting = status === 'connecting';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`flex items-center gap-1.5 ${cfg.color} border-current/30`}
        >
          <Icon
            size={16}
            className={isConnecting ? 'animate-spin' : undefined}
          />
          <span className="hidden sm:inline text-xs font-medium truncate max-w-[150px]">
            {hardwarePrinter
              ? (isHwOnline ? hardwarePrinter.name : `${hardwarePrinter.name} (Offline)`)
              : t(cfg.labelKey)}
          </span>
          <ChevronDown size={12} className="text-gray-400" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-gray-500">
          {t('pos.printerSectionLabel')}
        </DropdownMenuLabel>

        {hardwarePrinter && (
          <div className="px-2 py-1.5 text-xs text-gray-500 border-b border-gray-100">
            <p className="font-medium text-gray-800 truncate flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isHwOnline ? 'bg-green-500' : 'bg-red-500'}`} />
              {hardwarePrinter.name}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Status: <span className={`font-semibold ${isHwOnline ? 'text-green-700' : 'text-red-600'}`}>
                {isHwOnline ? 'Terhubung (Online)' : 'Offline / Terputus'}
              </span>
            </p>
            {hardwarePrinter.message && !isHwOnline && (
              <p className="mt-1 text-[11px] text-amber-700 bg-amber-50 p-1 rounded border border-amber-200">
                {hardwarePrinter.message}
              </p>
            )}
            <p className="capitalize text-[11px] text-gray-400 mt-0.5">
              {hardwarePrinter.connection_type}
              {hardwarePrinter.connection_type === 'network' && hardwarePrinter.ip_address
                ? ` · ${hardwarePrinter.ip_address}${hardwarePrinter.port ? ':' + hardwarePrinter.port : ''}`
                : ''}
              {hardwarePrinter.paper_width ? ` · ${hardwarePrinter.paper_width}` : ''}
            </p>
          </div>
        )}

        {isConnected && deviceInfo && (
          <div className="px-2 py-1.5 text-xs text-gray-500 border-b border-gray-100">
            <p className="font-medium text-gray-700 truncate">
              {deviceInfo.productName ?? t('pos.printerUnknownDevice')}
            </p>
            <p>{deviceInfo.manufacturerName ?? `VID:${deviceInfo.vendorId.toString(16).toUpperCase()}`}</p>
          </div>
        )}

        {lastError && (
          <div className="px-2 py-1.5 text-xs text-red-600 bg-red-50 rounded mx-1 my-1">
            {lastError}
          </div>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => usePrinterStore.getState().refreshHardwarePrinter()}
          className="text-sm cursor-pointer"
        >
          <Printer size={14} className="mr-2" />
          Periksa Status Koneksi
        </DropdownMenuItem>

        {printMethod === 'escpos' && (
          <>
            {!isConnected && !isConnecting && (
              <DropdownMenuItem
                onClick={handleConnect}
                disabled={isConnecting}
                className="text-sm cursor-pointer"
              >
                <Printer size={14} className="mr-2" />
                {isConnecting ? t('pos.printerConnecting') : t('pos.printerConnectUsb')}
              </DropdownMenuItem>
            )}

            {isConnected && (
              <DropdownMenuItem
                onClick={handleDisconnect}
                className="text-sm cursor-pointer text-red-600 focus:text-red-600"
              >
                <Unplug size={14} className="mr-2" />
{t('pos.printerDisconnect')}
              </DropdownMenuItem>
            )}
          </>
        )}

        {printMethod === 'browser' && (
          <div className="px-2 py-1.5 text-xs text-gray-500">
            {t('pos.printerBrowserMode')}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
