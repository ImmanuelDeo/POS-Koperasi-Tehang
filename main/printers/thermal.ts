import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getDatabase, now } from '../db';
import { maskNik } from '../services/privacy';

export interface PrinterInfo {
  name: string;
  make: string;
  model: string;
  connectionType: 'usb' | 'network' | 'bluetooth';
  deviceUri: string;
  driver?: string;
  status: 'idle' | 'printing' | 'offline';
  isDefault: boolean;
  ipAddress?: string;
  port?: number;
  paperWidth?: string;
}

let defaultPrinter: any = null;

// ── Reusable Formatting Helpers for 58mm (32 Columns Font A) ────────────────

export function formatCurrencyRp(amount: number | string | null | undefined): string {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount || 0));
  const safe = isNaN(num) ? 0 : Math.round(num);
  return 'Rp ' + safe.toLocaleString('id-ID');
}

export function formatDateTimeWIB(value?: string | Date | null): string {
  try {
    const d = value ? new Date(value) : new Date();
    if (isNaN(d.getTime())) return new Date().toLocaleString('id-ID') + ' WIB';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes} WIB`;
  } catch {
    return new Date().toLocaleDateString('id-ID') + ' WIB';
  }
}

export function centerText(text: string, width: number = 32): string {
  const clean = String(text || '').trim();
  if (clean.length >= width) return clean.slice(0, width);
  const leftPad = Math.floor((width - clean.length) / 2);
  const rightPad = width - clean.length - leftPad;
  return ' '.repeat(leftPad) + clean + ' '.repeat(rightPad);
}

export function leftRight(left: string, right: string, width: number = 32): string {
  const l = String(left || '');
  const r = String(right || '');
  const spaceNeeded = width - l.length - r.length;
  if (spaceNeeded >= 1) {
    return l + ' '.repeat(spaceNeeded) + r;
  }
  const maxL = Math.max(0, width - r.length - 1);
  return l.slice(0, maxL) + ' ' + r;
}

export function wrapText(text: string, width: number = 32): string[] {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= width) return [clean];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (word.length > width) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      let remaining = word;
      while (remaining.length > width) {
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      currentLine = remaining;
    } else if ((currentLine + (currentLine ? ' ' : '') + word).length <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

export function formatItem2Lines(
  name: string,
  qty: number | string,
  unit: string | null | undefined,
  unitPrice: number | string,
  lineTotal: number | string,
  width: number = 32
): string[] {
  const result: string[] = [];
  const wrappedNames = wrapText(name, width);
  for (const line of wrappedNames) {
    result.push(line);
  }

  const cleanUnit = unit && String(unit).trim() ? String(unit).trim() : 'pcs';
  const qtyStr = typeof qty === 'number' && Number.isInteger(qty) ? String(qty) : String(qty);
  const leftSide = `  ${qtyStr} ${cleanUnit} x ${formatCurrencyRp(unitPrice)}`;
  const rightSide = formatCurrencyRp(lineTotal);

  result.push(leftRight(leftSide, rightSide, width));
  return result;
}

export function maskNikEightPrefix(nik: string | null | undefined): string | null {
  return maskNik(nik);
}

// ── Printer Detection (Windows, macOS, Linux) ───────────────────────────────

export async function detectConnectedPrinters(): Promise<PrinterInfo[]> {
  if (process.platform === 'win32') {
    return detectWindowsPrinters();
  }
  if (process.platform === 'darwin') {
    return detectMacOSPrinters();
  }
  if (process.platform === 'linux') {
    return detectLinuxPrinters();
  }
  return [];
}

export function detectWindowsPrinters(): PrinterInfo[] {
  const printers: PrinterInfo[] = [];

  try {
    const psCmd = `Get-CimInstance Win32_Printer | Select-Object Name, Default, PrinterStatus, DriverName, PortName | ConvertTo-Json -Compress`;
    const output = execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, {
      encoding: 'utf8',
      timeout: 6000,
    }).trim();

    if (output) {
      const parsed = JSON.parse(output);
      const list = Array.isArray(parsed) ? parsed : [parsed];

      for (const p of list) {
        if (!p || !p.Name) continue;
        const name = String(p.Name).trim();
        const isDefault = Boolean(p.Default);
        const driver = String(p.DriverName || '');
        const port = String(p.PortName || '');

        const isBluetooth = port.toLowerCase().includes('bth') || name.toLowerCase().includes('bluetooth');
        const isNetwork = port.toLowerCase().includes('tcp') || port.includes('.') || port.toLowerCase().includes('ipp');
        const connectionType: 'usb' | 'network' | 'bluetooth' = isBluetooth ? 'bluetooth' : isNetwork ? 'network' : 'usb';

        const makeModel = detectWindowsMakeModel(name, driver);

        printers.push({
          name,
          make: makeModel.make,
          model: makeModel.model,
          connectionType,
          deviceUri: name,
          driver,
          status: 'idle',
          isDefault,
        });
      }
    }
  } catch (err: any) {
    console.log('[Printer] PowerShell printer detection fallback:', err?.message || err);
  }

  try {
    const pnpCmd = `Get-PnpDevice -Class 'Printer','PrintQueue','USB' -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*ECO58*' -or $_.FriendlyName -like '*HaoYin*' -or $_.FriendlyName -like '*Blueprint*' } | Select-Object FriendlyName, InstanceId | ConvertTo-Json -Compress`;
    const pnpOutput = execSync(`powershell -NoProfile -NonInteractive -Command "${pnpCmd}"`, {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    if (pnpOutput) {
      const parsedPnp = JSON.parse(pnpOutput);
      const pnpList = Array.isArray(parsedPnp) ? parsedPnp : [parsedPnp];
      for (const dev of pnpList) {
        if (!dev || !dev.FriendlyName) continue;
        const fName = String(dev.FriendlyName).trim();
        const exists = printers.some(p => p.name.toLowerCase() === fName.toLowerCase() || p.name.toLowerCase().includes('eco-58'));
        if (!exists) {
          printers.push({
            name: fName,
            make: 'Blueprint',
            model: 'ECO-58D Thermal (Perangkat USB Terdeteksi)',
            connectionType: 'usb',
            deviceUri: dev.InstanceId || fName,
            driver: 'USB PnP Device',
            status: 'idle',
            isDefault: printers.length === 0,
          });
        }
      }
    }
  } catch {}

  return printers;
}

export interface ScannerInfo {
  name: string;
  hwid: string;
  vendorId: string;
  productId: string;
  status: string;
  isConnected: boolean;
}

export async function detectConnectedScanners(): Promise<ScannerInfo[]> {
  if (process.platform !== 'win32') {
    return [];
  }
  try {
    const psCmd = `Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like '*34EB*' -or $_.FriendlyName -like '*Barcode*' -or $_.FriendlyName -like '*Scanner*' } | Select-Object FriendlyName, InstanceId, Status | ConvertTo-Json -Compress`;
    const output = execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();

    if (output) {
      const parsed = JSON.parse(output);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((item: any) => ({
        name: item.FriendlyName || '2D Barcode Scanner',
        hwid: item.InstanceId || 'USB\\VID_34EB&PID_1502',
        vendorId: '0x34EB',
        productId: '0x1502',
        status: item.Status || 'OK',
        isConnected: true,
      }));
    }
  } catch {}

  return [];
}

function detectWindowsMakeModel(name: string, driver: string): { make: string; model: string } {
  let make = 'Blueprint';
  let model = 'Blueprint ECO-58D';

  const lower = (name + ' ' + driver).toLowerCase();

  if (lower.includes('blueprint') || lower.includes('eco-58') || lower.includes('eco58') || lower.includes('eco 58')) {
    make = 'Blueprint';
    model = 'Blueprint ECO-58D';
  } else if (lower.includes('epson') || lower.includes('tm-')) {
    make = 'Epson';
    model = 'TM Series';
  } else if (lower.includes('xprinter')) {
    make = 'Xprinter';
    model = lower.includes('80') ? 'Xprinter 80mm' : 'Xprinter 58mm';
  } else if (lower.includes('58') || lower.includes('thermal')) {
    make = 'Generic';
    model = '58mm Thermal Printer';
  } else if (lower.includes('80')) {
    make = 'Generic';
    model = '80mm Thermal Printer';
  } else {
    make = 'Windows Printer';
    model = name;
  }

  return { make, model };
}

async function detectMacOSPrinters(): Promise<PrinterInfo[]> {
  const printers: PrinterInfo[] = [];
  try {
    const lpStatOutput = execSync('lpstat -v 2>/dev/null', { encoding: 'utf8' });
    const lines = lpStatOutput.split('\n');
    for (const line of lines) {
      const match = line.match(/device for (\S+):\s*(.+)/);
      if (match) {
        const name = match[1];
        const uri = match[2].trim();
        printers.push({
          name,
          make: 'Blueprint',
          model: 'ECO-58D Thermal',
          connectionType: 'usb',
          deviceUri: uri,
          status: 'idle',
          isDefault: false,
        });
      }
    }
  } catch {}
  return printers;
}

function detectLinuxPrinters(): PrinterInfo[] {
  const printers: PrinterInfo[] = [];
  try {
    const output = execSync('lpstat -v 2>/dev/null', { encoding: 'utf8' });
    const lines = output.split('\n');
    for (const line of lines) {
      const match = line.match(/device for (\S+):\s*(.+)/);
      if (match) {
        printers.push({
          name: match[1],
          make: 'Blueprint',
          model: 'ECO-58D Thermal',
          connectionType: 'usb',
          deviceUri: match[2].trim(),
          status: 'idle',
          isDefault: false,
        });
      }
    }
  } catch {}
  return printers;
}

// ── ESC/POS Low-Level Byte Builder (Blueprint ECO-58D Compatible) ────────────

export function buildEscPosKoperasi(lines: string[]): Buffer {
  const buf: number[] = [];

  const resetAllStyles = () => {
    buf.push(0x1B, 0x45, 0x00);
    buf.push(0x1B, 0x21, 0x00);
    buf.push(0x1B, 0x61, 0x00);
  };

  for (let line of lines) {
    if (line.includes('{INIT}')) {
      buf.push(0x1B, 0x40);
      resetAllStyles();
      continue;
    }

    if (line.includes('{FEED_5}')) {
      buf.push(0x1B, 0x64, 0x05);
      continue;
    }

    if (line.includes('{FEED_3}')) {
      buf.push(0x1B, 0x64, 0x03);
      continue;
    }

    if (line.includes('{CUT}')) {
      buf.push(0x1B, 0x64, 0x05);
      continue;
    }

    const isBold = line.includes('{BOLD}');
    const isDoubleHeight = line.includes('{DOUBLE_HEIGHT}');
    const isDoubleWidth = line.includes('{DOUBLE_WIDTH}');
    const isCenter = line.startsWith('{CENTER}') && line.includes('{/CENTER}');
    const isRight = line.startsWith('{RIGHT}') && line.includes('{/RIGHT}');

    line = line
      .replace(/\{CENTER\}/g, '')
      .replace(/\{\/CENTER\}/g, '')
      .replace(/\{RIGHT\}/g, '')
      .replace(/\{\/RIGHT\}/g, '')
      .replace(/\{BOLD\}/g, '')
      .replace(/\{\/BOLD\}/g, '')
      .replace(/\{DOUBLE_HEIGHT\}/g, '')
      .replace(/\{\/DOUBLE_HEIGHT\}/g, '')
      .replace(/\{DOUBLE_WIDTH\}/g, '')
      .replace(/\{\/DOUBLE_WIDTH\}/g, '');

    const alignCode = isCenter ? 0x01 : isRight ? 0x02 : 0x00;
    buf.push(0x1B, 0x61, alignCode);

    let fontMode = 0;
    if (isDoubleHeight) fontMode |= 0x10;
    if (isDoubleWidth) fontMode |= 0x20;
    if (isBold) fontMode |= 0x08;
    buf.push(0x1B, 0x21, fontMode);

    if (isBold) {
      buf.push(0x1B, 0x45, 0x01);
    } else {
      buf.push(0x1B, 0x45, 0x00);
    }

    buf.push(...Buffer.from(line, 'utf8'));
    buf.push(0x0A);
  }

  return Buffer.from(buf);
}

// ── Koperasi 58mm Struk Generator (Non-PPN, Indonesian Standard) ─────────────

export function generateKoperasiReceipt(
  order: any,
  bill: any,
  items: any[],
  customer: any,
  cashierUser: any,
  settings: Record<string, string>,
  isReprint: boolean = false,
  cols: number = 32
): Buffer {
  const lines: string[] = [];
  const sepBar = '='.repeat(cols);
  const dashBar = '-'.repeat(cols);

  const bizName = settings.business_name || 'POS KOPERASI TEHANG';
  const bizAddress = settings.business_address || settings.address || '';
  const bizPhone = settings.business_phone || settings.phone || '';
  const showMaskedNik = settings.show_masked_nik_on_receipt === 'true';

  const billNumber = bill?.bill_number || order?.order_number || 'BILL-' + Date.now();
  const createdAt = bill?.created_at || order?.created_at || new Date();
  const cashierName = cashierUser?.name || 'Kasir';

  lines.push('{INIT}');

  if (isReprint) {
    lines.push(sepBar);
    lines.push('{CENTER}{BOLD}*** SALINAN / REPRINT ***{/BOLD}{/CENTER}');
    lines.push('{CENTER}Cetak Ulang: ' + formatDateTimeWIB(new Date()) + '{/CENTER}');
    lines.push(sepBar);
  }

  lines.push('{CENTER}{BOLD}' + bizName.toUpperCase() + '{/BOLD}{/CENTER}');
  if (bizAddress) {
    for (const l of wrapText(bizAddress, cols)) {
      lines.push('{CENTER}' + l + '{/CENTER}');
    }
  }
  if (bizPhone) {
    lines.push('{CENTER}Telp: ' + bizPhone + '{/CENTER}');
  }
  lines.push(sepBar);

  lines.push(leftRight('No. Struk :', billNumber, cols));
  lines.push(leftRight('Waktu     :', formatDateTimeWIB(createdAt), cols));
  lines.push(leftRight('Kasir     :', cashierName, cols));

  let paymentMethod = 'cash';
  let paidAmount = Number(bill.paid_amount || bill.total || 0);
  let change = Number(bill.balance || 0);

  if (bill.payment_details) {
    try {
      const parsedDetails = typeof bill.payment_details === 'string'
        ? JSON.parse(bill.payment_details)
        : bill.payment_details;

      if (Array.isArray(parsedDetails) && parsedDetails.length > 0) {
        paymentMethod = parsedDetails[0].method || 'cash';
      } else if (parsedDetails && parsedDetails.method) {
        paymentMethod = parsedDetails.method;
      }
    } catch {}
  }

  const isSalaryDeduction = paymentMethod === 'salary_deduction';
  const isMember = Boolean(customer && (customer.is_member === 1 || customer.member_no));

  if (isMember) {
    lines.push(dashBar);
    lines.push(leftRight('Anggota   :', customer.name, cols));
    if (customer.member_no) {
      lines.push(leftRight('No. MBR   :', customer.member_no, cols));
    }
    if (showMaskedNik && customer.nik) {
      const masked = maskNikEightPrefix(customer.nik);
      if (masked) {
        lines.push(leftRight('NIK       :', masked, cols));
      }
    }
    if (customer.department) {
      lines.push(leftRight('Dept      :', customer.department, cols));
    }
  } else {
    lines.push(leftRight('Pelanggan :', customer?.name || 'Pembeli Umum', cols));
  }

  lines.push(dashBar);

  if (items && items.length > 0) {
    for (const item of items) {
      const pName = item.product_name || item.name || 'Produk';
      const qty = item.quantity || 1;
      const unit = item.unit || 'pcs';
      const unitPrice = Number(item.unit_price || item.price || 0);
      const subtotal = Number(item.subtotal || item.total || qty * unitPrice);

      const itemLines = formatItem2Lines(pName, qty, unit, unitPrice, subtotal, cols);
      for (const il of itemLines) {
        lines.push(il);
      }
    }
  }

  lines.push(dashBar);

  const subtotalVal = Number(bill.subtotal || bill.total || 0);
  const discountVal = Number(bill.discount_amount || 0);
  const totalVal = Number(bill.total || 0);

  lines.push(leftRight('Subtotal', formatCurrencyRp(subtotalVal), cols));
  if (discountVal > 0) {
    lines.push(leftRight('Diskon', '-' + formatCurrencyRp(discountVal), cols));
    lines.push(dashBar);
  }

  lines.push('{BOLD}' + leftRight('TOTAL', formatCurrencyRp(totalVal), cols) + '{/BOLD}');
  lines.push(sepBar);

  if (isSalaryDeduction) {
    lines.push('{BOLD}METODE : POTONG GAJI (BON){/BOLD}');
    lines.push(leftRight('Nominal Bon:', formatCurrencyRp(totalVal), cols));
    lines.push(sepBar);
    lines.push('{CENTER}Tanda Tangan Anggota / Kasir{/CENTER}');
    lines.push('');
    lines.push('{CENTER}(............................){/CENTER}');
    lines.push('');
  } else {
    lines.push(leftRight('Tunai', formatCurrencyRp(paidAmount > 0 ? paidAmount : totalVal), cols));
    lines.push(leftRight('Kembalian', formatCurrencyRp(Math.max(0, change)), cols));
    lines.push(sepBar);
  }

  lines.push('{CENTER}Terima kasih atas kunjungan{/CENTER}');
  lines.push('{CENTER}di ' + bizName + '{/CENTER}');
  lines.push('{CENTER}Barang yang dibeli tidak dapat{/CENTER}');
  lines.push('{CENTER}ditukar / dikembalikan{/CENTER}');
  lines.push('{CENTER}Simpan struk sbg bukti yg sah{/CENTER}');
  lines.push(dashBar);

  lines.push('{FEED_5}');

  return buildEscPosKoperasi(lines);
}

// ── Test Print Page Builder ──────────────────────────────────────────────────

export function buildTestPage(paperWidth: string = '58mm', printerName: string = 'Blueprint ECO-58D'): Buffer {
  const cols = paperWidth === '80mm' ? 48 : 32;
  const sep = '='.repeat(cols);
  const dash = '-'.repeat(cols);

  const lines = [
    '{INIT}',
    '{CENTER}{BOLD}TEST PRINT STRUK KOPERASI{/BOLD}{/CENTER}',
    '{CENTER}POS KOPERASI TEHANG{/CENTER}',
    sep,
    leftRight('Hardware :', 'Blueprint ECO-58D', cols),
    leftRight('Printer  :', truncateText(printerName, cols - 12), cols),
    leftRight('Kertas   :', `${paperWidth} (${cols} Kolom)`, cols),
    leftRight('Waktu    :', formatDateTimeWIB(new Date()), cols),
    dash,
    '{CENTER}TES ALIGNMENT & FONT 58MM{/CENTER}',
    '12345678901234567890123456789012'.slice(0, cols),
    dash,
    'Beras Pandan Wangi 5kg',
    leftRight('  1 sak x Rp 72.000', 'Rp 72.000', cols),
    dash,
    '{BOLD}' + leftRight('TOTAL TEST', 'Rp 72.000', cols) + '{/BOLD}',
    sep,
    '{CENTER}Jika teks terbaca rapi,{/CENTER}',
    '{CENTER}printer siap dipakai transaksi!{/CENTER}',
    dash,
    '{FEED_5}',
  ];

  return buildEscPosKoperasi(lines);
}

function truncateText(text: string, maxLen: number): string {
  const str = String(text || '');
  return str.length > maxLen ? str.slice(0, maxLen - 2) + '..' : str;
}

// ── Low-Level Windows Spooler & Network Dispatchers ──────────────────────────

export async function printViaWindowsSpooler(
  data: Buffer,
  printerName: string
): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { success: false, error: 'Windows Spooler is only supported on Windows' };
  }

  const tmpDir = process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp';
  const tmpFile = path.join(tmpDir, `flo_spool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.bin`);
  const psScriptFile = path.join(tmpDir, `flo_spool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.ps1`);

  try {
    fs.writeFileSync(tmpFile, data);

    const escapedPrinter = printerName.replace(/'/g, "''");
    const escapedFile = tmpFile.replace(/'/g, "''");

    const psScript = `
$requestedPrinter = '${escapedPrinter}'
$filePath = '${escapedFile}'
$bytes = [System.IO.File]::ReadAllBytes($filePath)

$installedPrinters = @(Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name)
$targetPrinter = $null

foreach ($p in $installedPrinters) {
    if ($p -eq $requestedPrinter -or $p.ToLower() -eq $requestedPrinter.ToLower()) {
        $targetPrinter = $p
        break
    }
}

if (-not $targetPrinter) {
    $thermalKeywords = @('eco', '58', 'blueprint', 'pos', 'thermal', 'receipt', 'haoyin')
    foreach ($p in $installedPrinters) {
        $pLower = $p.ToLower()
        foreach ($kw in $thermalKeywords) {
            if ($pLower.Contains($kw)) {
                $targetPrinter = $p
                break
            }
        }
        if ($targetPrinter) { break }
    }
}

if (-not $targetPrinter) {
    $defaultP = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -ExpandProperty Name -First 1
    if ($defaultP -and -not ($defaultP -like '*PDF*' -or $defaultP -like '*OneNote*' -or $defaultP -like '*XPS*')) {
        $targetPrinter = $defaultP
    }
}

if (-not $targetPrinter) {
    $pnpDev = Get-PnpDevice -Class 'Printer','PrintQueue','USB' -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*ECO58*' -or $_.FriendlyName -like '*HaoYin*' -or $_.FriendlyName -like '*Blueprint*' } | Select-Object -ExpandProperty FriendlyName -First 1
    if ($pnpDev) {
        Write-Error "Antrean printer '$requestedPrinter' tidak ditemukan di Windows. Perangkat USB fisik ($pnpDev) terdeteksi terhubung, namun driver antrean printer belum terdaftar pada Windows Printers & Scanners. Buka Windows Settings -> Bluetooth & devices -> Printers & Scanners -> Add device (Gunakan driver POS-58 / Blueprint pada port USB)."
    } else {
        $namesStr = ($installedPrinters -join ', ')
        Write-Error "Antrean printer '$requestedPrinter' tidak ditemukan di Windows. Printer yang terpasang di Windows saat ini: [$namesStr]. Silakan pilih printer yang sesuai pada menu Pengaturan Printer."
    }
    exit 1
}

$code = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOW pDocInfo);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes, out string errorMsg) {
        errorMsg = null;
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOW di = new DOCINFOW();
        di.pDocName = "POS Koperasi Struk";
        di.pDataType = "RAW";
        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            int err = Marshal.GetLastWin32Error();
            errorMsg = "Gagal membuka antrean printer " + szPrinterName + " (Win32 Error: " + err + ")";
            return false;
        }
        if (!StartDocPrinter(hPrinter, 1, di)) {
            int err = Marshal.GetLastWin32Error();
            ClosePrinter(hPrinter);
            errorMsg = "Gagal memulai print job pada " + szPrinterName + " (Win32 Error: " + err + ")";
            return false;
        }
        if (!StartPagePrinter(hPrinter)) {
            EndDocPrinter(hPrinter);
            ClosePrinter(hPrinter);
            errorMsg = "Gagal memulai halaman cetak pada " + szPrinterName;
            return false;
        }
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
        int written = 0;
        bool success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
        Marshal.FreeCoTaskMem(pUnmanagedBytes);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        if (!success) {
            errorMsg = "Gagal menulis byte ke printer " + szPrinterName;
        }
        return success;
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp
$errOut = ""
$result = [RawPrinterHelper]::SendBytesToPrinter($targetPrinter, $bytes, [ref]$errOut)
if ($result) {
    Write-Output "SUCCESS:$targetPrinter"
} else {
    Write-Error "$errOut"
}
`;

    fs.writeFileSync(psScriptFile, psScript, 'utf8');

    const result = execSync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psScriptFile}"`, {
      encoding: 'utf8',
      timeout: 10000,
    });

    if (result.includes('SUCCESS')) {
      return { success: true };
    }
    return { success: false, error: 'Windows Spooler tidak mengonfirmasi cetak' };
  } catch (err: any) {
    console.error('[Printer] Windows raw spooler error:', err.message);
    const cleanedErr = err.message ? err.message.split('\n')[0].replace(/^Command failed: .*?\n/, '').trim() : 'Spooler failed';
    return { success: false, error: cleanedErr };
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
    try { if (fs.existsSync(psScriptFile)) fs.unlinkSync(psScriptFile); } catch {}
  }
}

export async function printViaNetwork(ip: string, port: number, data: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    const client = new net.Socket();
    client.connect(port, ip, () => {
      client.write(data);
      client.end();
      resolve(true);
    });
    client.on('error', (err) => {
      console.error(`[Printer] Network error: ${err.message}`);
      resolve(false);
    });
    client.setTimeout(5000, () => {
      client.destroy();
      resolve(false);
    });
  });
}

export async function printViaUSB(data: Buffer, printerName?: string): Promise<{ success: boolean; error?: string }> {
  if (process.platform === 'win32') {
    const pName = printerName || 'Blueprint ECO-58D';
    return await printViaWindowsSpooler(data, pName);
  }

  if (process.platform === 'darwin' || process.platform === 'linux') {
    const tmpFile = `/tmp/flo_print_${Date.now()}.bin`;
    try {
      fs.writeFileSync(tmpFile, data);
      const cmd = printerName ? `lp -d "${printerName}" -o raw "${tmpFile}"` : `lp -o raw "${tmpFile}"`;
      execSync(cmd, { encoding: 'utf8' });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  return { success: false, error: 'Platform sistem operasi tidak didukung' };
}

// ── Unified Print Service Engine ────────────────────────────────────────────

export async function initPrinter(): Promise<void> {
  try {
    const db = getDatabase();
    db.prepare(`
      UPDATE printers
      SET name = 'Blueprint ECO-58D', paper_width = '58mm', updated_at = ?
      WHERE name = 'Thermal Printer'
    `).run(now());

    const count = (db.prepare('SELECT COUNT(*) as count FROM printers').get() as any)?.count || 0;
    if (count === 0) {
      const { v4: uuidv4 } = require('uuid');
      db.prepare(`
        INSERT INTO printers (id, name, connection_type, paper_width, is_default, created_at, updated_at)
        VALUES (?, 'Blueprint ECO-58D', 'usb', '58mm', 1, ?, ?)
      `).run(uuidv4(), now(), now());
    }

    defaultPrinter = db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
    if (!defaultPrinter) {
      defaultPrinter = db.prepare('SELECT * FROM printers LIMIT 1').get();
    }
    if (defaultPrinter) {
      console.log(`[Printer] Active printer: ${defaultPrinter.name} (${defaultPrinter.connection_type}, ${defaultPrinter.paper_width || '58mm'})`);
    }
  } catch (error) {
    console.log('[Printer] Initialization deferred (database not ready)');
  }
}

export function getPrinterConfig(): any {
  if (defaultPrinter) return defaultPrinter;
  try {
    const db = getDatabase();
    return db.prepare('SELECT * FROM printers WHERE is_default = 1').get();
  } catch {
    return null;
  }
}

export async function dispatchPrint(
  printer: any,
  data: Buffer
): Promise<{ success: boolean; code?: string; message?: string }> {
  if (!printer) {
    return {
      success: false,
      code: 'PRINTER_NOT_FOUND',
      message: 'Printer pilihan tidak ditemukan. Buka Settings Printer dan pilih ulang printer.',
    };
  }

  try {
    switch (printer.connection_type) {
      case 'network': {
        if (!printer.ip_address) {
          return {
            success: false,
            code: 'PRINTER_NOT_FOUND',
            message: 'Alamat IP printer network belum dikonfigurasi.',
          };
        }
        const ok = await printViaNetwork(printer.ip_address, printer.port || 9100, data);
        if (!ok) {
          return {
            success: false,
            code: 'PRINTER_OFFLINE',
            message: 'Printer network tidak merespons. Periksa koneksi LAN/Wi-Fi printer.',
          };
        }
        return { success: true };
      }
      case 'usb':
      case 'bluetooth': {
        const res = await printViaUSB(data, printer.name);
        if (!res.success) {
          return {
            success: false,
            code: 'PRINTER_OFFLINE',
            message: res.error || 'Printer tidak terhubung. Periksa listrik, kabel USB, kertas, dan status printer.',
          };
        }
        return { success: true };
      }
      default:
        return {
          success: false,
          code: 'PRINT_FAILED',
          message: `Tipe koneksi '${printer.connection_type}' tidak didukung.`,
        };
    }
  } catch (err: any) {
    return {
      success: false,
      code: 'PRINT_FAILED',
      message: 'Gagal mengirim dokumen ke printer: ' + (err.message || 'Error tidak diketahui'),
    };
  }
}

export async function printReceiptById(
  billId: number | string,
  isReprint: boolean = false,
  _actorUserId?: string
): Promise<{
  success: boolean;
  jobId?: string;
  printerName?: string;
  printedAt?: string;
  code?: string;
  message?: string;
}> {
  const db = getDatabase();

  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId) as any;
  if (!bill) {
    return {
      success: false,
      code: 'INVALID_PRINT_DATA',
      message: 'Data tagihan/bill tidak ditemukan di database.',
    };
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(bill.order_id) as any;
  if (!order) {
    return {
      success: false,
      code: 'INVALID_PRINT_DATA',
      message: 'Data transaksi order tidak ditemukan di database.',
    };
  }

  const items = db.prepare(`
    SELECT oi.*, p.unit
    FROM order_items oi
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(bill.order_id) as any[];

  let customer: any = null;
  const customerId = bill.customer_id || order.customer_id;
  if (customerId) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any;
  }

  let cashierUser: any = null;
  if (order.user_id) {
    cashierUser = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(order.user_id) as any;
  }

  const settingsRows = db.prepare('SELECT key, value FROM settings').all() as any[];
  const settings: Record<string, string> = {};
  for (const r of settingsRows) settings[r.key] = r.value;

  const printer = getPrinterConfig();
  if (!printer) {
    return {
      success: false,
      code: 'PRINTER_NOT_FOUND',
      message: 'Printer default belum dipilih. Buka menu Settings Printer untuk memilih printer.',
    };
  }

  const cols = printer.paper_width === '80mm' ? 48 : 32;
  const receiptBytes = generateKoperasiReceipt(
    order,
    bill,
    items,
    customer,
    cashierUser,
    settings,
    isReprint,
    cols
  );

  const printRes = await dispatchPrint(printer, receiptBytes);

  if (printRes.success) {
    db.prepare('UPDATE bills SET printed_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), bill.id);
    const jobId = `JOB-${Date.now()}`;
    return {
      success: true,
      jobId,
      printerName: printer.name,
      printedAt: new Date().toISOString(),
    };
  }

  return {
    success: false,
    code: printRes.code || 'PRINT_FAILED',
    message: printRes.message || 'Cetak struk gagal. Coba cetak ulang dari riwayat transaksi.',
  };
}

export async function printReceipt(order: any, bill: any, _business?: any, _template?: string): Promise<boolean> {
  const db = getDatabase();
  const printer = getPrinterConfig();
  if (!printer) return false;

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(bill.order_id) as any[];
  const customer = bill.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(bill.customer_id) : null;
  const cashier = order.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id) : null;

  const settingsRows = db.prepare('SELECT key, value FROM settings').all() as any[];
  const settings: Record<string, string> = {};
  for (const r of settingsRows) settings[r.key] = r.value;

  const cols = printer.paper_width === '80mm' ? 48 : 32;
  const data = generateKoperasiReceipt(order, bill, items, customer, cashier, settings, false, cols);
  const res = await dispatchPrint(printer, data);
  return res.success;
}

export async function printKOT(_order: any, _items: any[], _stationName: string): Promise<boolean> {
  return false;
}

export function getPrinterStatus(): { connected: boolean; printer: any } {
  const printer = getPrinterConfig();
  return { connected: !!printer, printer };
}
