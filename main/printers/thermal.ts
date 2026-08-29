import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getDatabase, now, getUserDataDirectory } from '../db';
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
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(d);
    let day = '', month = '', year = '', hour = '', minute = '';
    for (const p of parts) {
      if (p.type === 'day') day = p.value.padStart(2, '0');
      if (p.type === 'month') month = p.value.padStart(2, '0');
      if (p.type === 'year') year = p.value;
      if (p.type === 'hour') hour = p.value.padStart(2, '0');
      if (p.type === 'minute') minute = p.value.padStart(2, '0');
    }
    return `${day}/${month}/${year} ${hour}:${minute} WIB`;
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

  // 1. Detect physical USB port from active PnP devices and auto-heal printer port
  try {
    const healCmd = `$pnp = @(Get-PnpDevice -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like '*USBPRINT*' -or $_.FriendlyName -like '*ECO58*' -or $_.FriendlyName -like '*HaoYin*' -or $_.FriendlyName -like '*Blueprint*' -or $_.FriendlyName -like '*POS*' }); $p = $pnp | Where-Object { $_.InstanceId -match '(USB\\d{3})' } | Select-Object -First 1; if ($p -and $p.InstanceId -match '(USB\\d{3})') { $activePort = $matches[1]; $target = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Blueprint*' -or $_.Name -like '*ECO58*' -or $_.Name -like '*POS*' -or $_.Name -like '*HaoYin*' } | Select-Object -First 1; if ($target -and $target.PortName -ne $activePort -and $target.PortName -like 'USB*') { Set-Printer -Name $target.Name -PortName $activePort -ErrorAction SilentlyContinue } }`;
    execSync(`powershell -NoProfile -NonInteractive -Command "${healCmd}"`, {
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch {}

  // 2. Fetch all installed printers from Windows
  try {
    const psCmd = `Get-CimInstance Win32_Printer | Select-Object Name, Default, WorkOffline, PrinterStatus, ExtendedPrinterStatus, DetectedErrorState, DriverName, PortName | ConvertTo-Json -Compress`;
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
        const isHardError = p.DetectedErrorState === 4 || p.DetectedErrorState === 7 || p.DetectedErrorState === 8;
        const status = isHardError ? 'offline' : 'idle';

        printers.push({
          name,
          make: makeModel.make,
          model: makeModel.model,
          connectionType,
          deviceUri: name,
          driver,
          status,
          isDefault,
        });
      }
    }
  } catch (err: any) {
    console.log('[Printer] PowerShell printer detection fallback:', err?.message || err);
  }

  // 3. Check for any PnP USB thermal device that might not have a spooler queue yet
  try {
    const pnpCmd = `Get-PnpDevice -Class 'Printer','PrintQueue','USB','SoftwareDevice' -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -like '*ECO58*' -or $_.FriendlyName -like '*HaoYin*' -or $_.FriendlyName -like '*Blueprint*' } | Select-Object FriendlyName, InstanceId | ConvertTo-Json -Compress`;
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
        const exists = printers.some(p => 
          p.name.toLowerCase() === fName.toLowerCase() || 
          (p.name.toLowerCase().includes('blueprint') && fName.toLowerCase().includes('blueprint')) ||
          (p.name.toLowerCase().includes('eco-58') && fName.toLowerCase().includes('eco58')) ||
          (p.name.toLowerCase().includes('blueprint') && fName.toLowerCase().includes('haoyin'))
        );
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

// ── Koperasi Logo Raster Bit Image Generator (B&W 1-Bit ESC/POS) ─────────────

const logoRasterCache = new Map<string, Buffer | null>();

/**
 * Clear cached logo rasters (useful after settings/asset updates).
 */
export function clearLogoRasterCache(): void {
  logoRasterCache.clear();
}

/**
 * Generates an ESC/POS GS v 0 1-bit monochrome raster buffer centered on 384 dots width.
 * Fallback-safe: returns null if file not found, decode error, or logo disabled.
 */
export function getReceiptLogoRasterBuffer(settings: Record<string, string> = {}): Buffer | null {
  try {
    // 1. Check toggle (default: true)
    if (settings.receipt_logo_enabled === 'false') {
      return null;
    }

    const sizeProfile = (settings.receipt_logo_size || 'standard').toLowerCase();
    if (logoRasterCache.has(sizeProfile)) {
      return logoRasterCache.get(sizeProfile) || null;
    }

    // 2. Locate official logo: first check custom uploaded logo in userData/branding, then fallback to candidate paths
    let logoPath = '';
    if (settings.logo_path && settings.logo_path.trim().length > 0) {
      const customPath = path.join(getUserDataDirectory(), 'branding', settings.logo_path.trim());
      if (fs.existsSync(customPath)) {
        logoPath = customPath;
      }
    }

    if (!logoPath) {
      const candidatePaths = [
        path.join(__dirname, '..', '..', 'assets', 'logo_makin-group.png'),
        path.join(__dirname, '..', 'assets', 'logo_makin-group.png'),
        path.join(__dirname, '..', '..', 'frontend', 'public', 'logo.png'),
        path.join(process.cwd(), 'assets', 'logo_makin-group.png'),
        path.join(process.cwd(), 'frontend', 'public', 'logo.png'),
      ];

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          logoPath = p;
          break;
        }
      }
    }

    if (!logoPath) {
      console.warn('[ThermalPrinter] Logo asset not found, falling back to text-only header.');
      logoRasterCache.set(sizeProfile, null);
      return null;
    }

    const { PNG } = require('pngjs');
    const fileData = fs.readFileSync(logoPath);
    const srcPng = PNG.sync.read(fileData);

    // 3. Profile configuration for 58mm printer (384 dots / 48 bytes printable width)
    let targetWidth = 288; // Standard (Default, fills 75% width, bold & clear)

    if (sizeProfile === 'small') {
      targetWidth = 216; // Small (fills 56% width)
    } else if (sizeProfile === 'large') {
      targetWidth = 352; // Large (fills 92% width)
    }

    // Align targetWidth to multiple of 8
    targetWidth = Math.max(8, Math.round(targetWidth / 8) * 8);

    // Calculate proportional height maintaining exact aspect ratio
    const targetHeight = Math.round((targetWidth * srcPng.height) / srcPng.width);

    // Bilinear resize
    const dstPng = new PNG({ width: targetWidth, height: targetHeight });
    const xRatio = srcPng.width / targetWidth;
    const yRatio = srcPng.height / targetHeight;

    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const px = Math.floor(x * xRatio);
        const py = Math.floor(y * yRatio);
        const srcIdx = (py * srcPng.width + px) << 2;
        const dstIdx = (y * targetWidth + x) << 2;

        dstPng.data[dstIdx] = srcPng.data[srcIdx];
        dstPng.data[dstIdx + 1] = srcPng.data[srcIdx + 1];
        dstPng.data[dstIdx + 2] = srcPng.data[srcIdx + 2];
        dstPng.data[dstIdx + 3] = srcPng.data[srcIdx + 3];
      }
    }

    // Horizontal centering on full 384 dots (48 bytes) print line
    const totalPaperBytes = 48; // 384 dots / 8
    const imageBytesPerLine = targetWidth / 8;
    const leftPadBytes = Math.max(0, Math.floor((totalPaperBytes - imageBytesPerLine) / 2));
    const rightPadBytes = Math.max(0, totalPaperBytes - imageBytesPerLine - leftPadBytes);
    const lineBytes = totalPaperBytes; // Always full 48 bytes

    const rasterData: number[] = [];

    for (let y = 0; y < targetHeight; y++) {
      // 1. Left padding bytes (white = 0x00)
      for (let p = 0; p < leftPadBytes; p++) {
        rasterData.push(0x00);
      }

      // 2. Thresholded 1-bit image pixels
      for (let byteIdx = 0; byteIdx < imageBytesPerLine; byteIdx++) {
        let byteVal = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = byteIdx * 8 + bit;
          const idx = (y * targetWidth + x) << 2;
          const r = dstPng.data[idx];
          const g = dstPng.data[idx + 1];
          const b = dstPng.data[idx + 2];
          const a = dstPng.data[idx + 3];

          let isBlack = false;
          // Transparent pixels flattened to white background
          if (a > 64) {
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            // 1-bit threshold
            if (luminance < 160) {
              isBlack = true;
            }
          }

          if (isBlack) {
            byteVal |= 1 << (7 - bit);
          }
        }
        rasterData.push(byteVal);
      }

      // 3. Right padding bytes (white = 0x00)
      for (let p = 0; p < rightPadBytes; p++) {
        rasterData.push(0x00);
      }
    }

    // ESC/POS GS v 0 0 xL xH yL yH d1...dk (xL=48, xH=0 for 384 dots full span)
    const xL = lineBytes & 0xff;
    const xH = (lineBytes >> 8) & 0xff;
    const yL = targetHeight & 0xff;
    const yH = (targetHeight >> 8) & 0xff;

    const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    const body = Buffer.from(rasterData);
    const result = Buffer.concat([header, body, Buffer.from([0x0a])]);

    logoRasterCache.set(sizeProfile, result);
    return result;
  } catch (err: any) {
    console.warn('[ThermalPrinter] Failed to generate raster logo:', err?.message || err);
    return null;
  }
}

// ── ESC/POS Low-Level Byte Builder (Blueprint ECO-58D Compatible) ────────────

export function buildEscPosKoperasi(lines: string[], settings?: Record<string, string>): Buffer {
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

    if (line.includes('{LOGO_HEADER}')) {
      const logoBuf = getReceiptLogoRasterBuffer(settings);
      if (logoBuf && logoBuf.length > 0) {
        buf.push(0x1B, 0x61, 0x00);
        buf.push(...logoBuf);
        resetAllStyles();
      }
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

  const bizName = settings.business_name || 'POS Koperasi';
  const bizAddress = settings.business_address || settings.address || '';
  const bizPhone = settings.business_phone || settings.phone || '';
  const showAddress = settings.bill_show_address !== 'false';
  const showPhone = settings.bill_show_phone !== 'false';

  const billNumber = bill?.bill_number || order?.order_number || 'BILL-' + Date.now();
  const createdAt = bill?.created_at || order?.created_at || new Date();
  const cashierName = cashierUser?.name || 'Kasir';

  lines.push('{INIT}');

  if (isReprint) {
    lines.push(sepBar);
    lines.push('{CENTER}{BOLD}*** SALINAN / REPRINT ***{/BOLD}{/CENTER}');
    lines.push('{CENTER}Cetak Ulang: ' + formatDateTimeWIB(new Date()) + '{/CENTER}');
    lines.push(sepBar);
    lines.push('{LOGO_HEADER}');
  } else {
    lines.push('{LOGO_HEADER}');
  }

  lines.push('{CENTER}{BOLD}' + bizName.toUpperCase() + '{/BOLD}{/CENTER}');
  if (showAddress && bizAddress) {
    for (const l of wrapText(bizAddress, cols)) {
      lines.push('{CENTER}' + l + '{/CENTER}');
    }
  }
  if (showPhone && bizPhone) {
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
  } else if (paymentMethod === 'qris') {
    lines.push('{BOLD}METODE : QRIS (NON-TUNAI){/BOLD}');
    lines.push(leftRight('Nominal QRIS:', formatCurrencyRp(totalVal), cols));
    lines.push(leftRight('Status       :', 'LUNAS (BERHASIL)', cols));
    lines.push(sepBar);
  } else if (paymentMethod === 'transfer') {
    lines.push('{BOLD}METODE : TRANSFER BANK{/BOLD}');
    lines.push(leftRight('Nominal Trf :', formatCurrencyRp(totalVal), cols));
    lines.push(leftRight('Status       :', 'LUNAS (BERHASIL)', cols));
    lines.push(sepBar);
  } else {
    lines.push(leftRight('Tunai', formatCurrencyRp(paidAmount > 0 ? paidAmount : totalVal), cols));
    lines.push(leftRight('Kembalian', formatCurrencyRp(Math.max(0, change)), cols));
    lines.push(sepBar);
  }

  const footerText = settings.receipt_footer_text ? settings.receipt_footer_text.trim() : ('Terima kasih atas kunjungan anda di ' + bizName);
  const returnPolicy = settings.receipt_return_policy_text ? settings.receipt_return_policy_text.trim() : 'Barang yang dibeli tidak dapat ditukar / dikembalikan';

  if (footerText) {
    for (const fl of wrapText(footerText, cols)) {
      lines.push('{CENTER}' + fl + '{/CENTER}');
    }
  }

  if (returnPolicy) {
    for (const rp of wrapText(returnPolicy, cols)) {
      lines.push('{CENTER}' + rp + '{/CENTER}');
    }
  }

  lines.push('{CENTER}Simpan struk sbg bukti yg sah{/CENTER}');
  lines.push(dashBar);

  lines.push('{FEED_5}');

  return buildEscPosKoperasi(lines, settings);
}

// ── Test Print Page Builder ──────────────────────────────────────────────────

export function buildTestPage(
  paperWidth: string = '58mm',
  printerName: string = 'Blueprint ECO-58D',
  settings: Record<string, string> = {}
): Buffer {
  const cols = paperWidth === '80mm' ? 48 : 32;
  const sep = '='.repeat(cols);
  const dash = '-'.repeat(cols);

  const lines = [
    '{INIT}',
    '{LOGO_HEADER}',
    '{CENTER}{BOLD}TEST PRINT STRUK KOPERASI{/BOLD}{/CENTER}',
    '{CENTER}KOPERASI{/CENTER}',
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

  return buildEscPosKoperasi(lines, settings);
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
$requested = '${escapedPrinter}'
$binFile = '${escapedFile}'
$bytes = [System.IO.File]::ReadAllBytes($binFile)

# 1. Clean any stuck/orphaned print jobs from previous attempts
Get-CimInstance Win32_PrintJob -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*$requested*" -or $_.Name -like "*Blueprint*" -or $_.Name -like "*ECO58*" -or $_.Name -like "*POS*" } | Remove-CimInstance -ErrorAction SilentlyContinue

# 2. Detect physical USB port from active USBPRINT PnP devices
$pnpDevices = @(Get-PnpDevice -Status OK -ErrorAction SilentlyContinue | Where-Object { 
    $_.InstanceId -like '*USBPRINT*' -or 
    $_.FriendlyName -like '*ECO58*' -or 
    $_.FriendlyName -like '*HaoYin*' -or 
    $_.FriendlyName -like '*Blueprint*' -or 
    $_.FriendlyName -like '*POS*'
})

$activePort = $null
foreach ($dev in $pnpDevices) {
    if ($dev.InstanceId -match '(USB\\d{3})') {
        $activePort = $matches[1]
        break
    }
}

# 3. Find matching Windows Spooler Queue
$installedPrinters = @(Get-Printer -ErrorAction SilentlyContinue)
$target = $null

foreach ($p in $installedPrinters) {
    if ($p.Name -eq $requested -or $p.Name.ToLower() -eq $requested.ToLower()) {
        $target = $p
        break
    }
}

if (-not $target) {
    $keywords = @('eco', '58', 'blueprint', 'pos', 'thermal', 'haoyin', 'receipt')
    foreach ($p in $installedPrinters) {
        $pNameLower = $p.Name.ToLower()
        foreach ($kw in $keywords) {
            if ($pNameLower.Contains($kw)) {
                $target = $p
                break
            }
        }
        if ($target) { break }
    }
}

if (-not $target) {
    $def = $installedPrinters | Where-Object { $_.Default -eq $true } | Select-Object -First 1
    if ($def -and -not ($def.Name -like '*PDF*' -or $def.Name -like '*OneNote*' -or $def.Name -like '*XPS*')) {
        $target = $def
    }
}

if (-not $target) {
    Write-Output "ERROR:Antrean printer '$requested' tidak ditemukan di Windows. Pastikan printer telah terinstall di Devices and Printers."
    exit 0
}

# 4. Auto-Heal: If physical USB port moved (e.g. USB002 -> USB003), automatically update PortName
if ($activePort -and $target.PortName -ne $activePort -and $target.PortName -like 'USB*') {
    try {
        Set-Printer -Name $target.Name -PortName $activePort -ErrorAction SilentlyContinue
        $target = Get-Printer -Name $target.Name -ErrorAction SilentlyContinue
    } catch {}
}

# 5. Low-Level C# Raw Spooler Injection via winspool.drv
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

    public static bool SendBytes(string szPrinterName, byte[] bytes, out string errorMsg) {
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
            errorMsg = "Gagal memulai dokumen cetak pada " + szPrinterName + " (Win32 Error: " + err + ")";
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
        bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
        Marshal.FreeCoTaskMem(pUnmanagedBytes);

        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);

        if (!ok) {
            errorMsg = "Gagal menulis byte data ke antrean " + szPrinterName;
        }
        return ok;
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp
$errOut = ""
$result = [RawPrinterHelper]::SendBytes($target.Name, $bytes, [ref]$errOut)

if ($result) {
    Write-Output "SUCCESS:$($target.Name)|$($target.PortName)"
} else {
    Write-Output "ERROR:$errOut"
}
`;

    fs.writeFileSync(psScriptFile, psScript, 'utf8');

    let output = '';
    try {
      output = execSync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psScriptFile}"`, {
        encoding: 'utf8',
        timeout: 15000,
      }).trim();
    } catch (execErr: any) {
      const rawMsg = execErr.stderr || execErr.stdout || execErr.message || '';
      return { success: false, error: 'Gagal menjalankan spooler cetak: ' + rawMsg.split('\n')[0] };
    }

    if (output.includes('SUCCESS')) {
      return { success: true };
    }
    if (output.includes('ERROR:')) {
      const err = output.split('ERROR:')[1].trim();
      return { success: false, error: err };
    }

    return { success: false, error: output || 'Windows Spooler tidak mengonfirmasi cetak' };
  } catch (err: any) {
    console.error('[Printer] Windows raw spooler error:', err.message);
    return { success: false, error: err.message || 'Spooler failed' };
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

// ── Printer Initialization & Configuration ──────────────────────────────────

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
    } else {
      console.log('[Printer] No printer configured');
    }
  } catch (error) {
    console.error('[Printer] Init error:', error);
  }
}

export function getPrinterConfig(): any {
  try {
    const db = getDatabase();
    const p = db.prepare('SELECT * FROM printers WHERE is_default = 1').get() as any;
    if (p) {
      defaultPrinter = p;
      return p;
    }
    const fallback = db.prepare('SELECT * FROM printers ORDER BY created_at ASC LIMIT 1').get() as any;
    if (fallback) {
      defaultPrinter = fallback;
      return fallback;
    }
    return null;
  } catch {
    return defaultPrinter || null;
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

export function getPrinterHardwareStatus(printer?: any): {
  isConfigured: boolean;
  isOnline: boolean;
  status: 'online' | 'offline' | 'error' | 'not_configured';
  message: string;
  printer: any;
} {
  const p = printer || getPrinterConfig();
  if (!p) {
    return {
      isConfigured: false,
      isOnline: false,
      status: 'not_configured',
      message: 'Belum ada printer default yang dikonfigurasi.',
      printer: null,
    };
  }

  if (p.connection_type === 'network') {
    return {
      isConfigured: true,
      isOnline: !!p.ip_address,
      status: p.ip_address ? 'online' : 'offline',
      message: p.ip_address ? `Printer network siap (${p.ip_address})` : 'IP printer belum disetting',
      printer: p,
    };
  }

  if (process.platform === 'win32') {
    try {
      const detected = detectWindowsPrinters();
      const pName = (p.name || 'Blueprint ECO-58D').toLowerCase();
      
      const match = detected.find(d => {
        const dName = d.name.toLowerCase();
        if (dName === pName || dName.includes(pName) || pName.includes(dName)) return true;
        if (pName.includes('blueprint') && (dName.includes('blueprint') || dName.includes('eco') || dName.includes('haoyin'))) return true;
        if (pName.includes('eco') && (dName.includes('blueprint') || dName.includes('eco') || dName.includes('haoyin'))) return true;
        if (pName.includes('pos') && dName.includes('pos')) return true;
        return false;
      });

      if (match) {
        if (match.status === 'offline') {
          return {
            isConfigured: true,
            isOnline: false,
            status: 'offline',
            message: `Printer '${match.name}' sedang Offline. Periksa kabel USB dan tombol power.`,
            printer: { ...p, is_online: false, hardware_name: match.name },
          };
        }
        return {
          isConfigured: true,
          isOnline: true,
          status: 'online',
          message: `Printer '${match.name}' siap dan terhubung.`,
          printer: { ...p, is_online: true, hardware_name: match.name },
        };
      }
    } catch {}
  }

  return {
    isConfigured: true,
    isOnline: false,
    status: 'offline',
    message: `Printer '${p.name}' tidak terdeteksi di Windows. Pastikan kabel USB terhubung dan printer menyala.`,
    printer: { ...p, is_online: false },
  };
}

export function getPrinterStatus(): { connected: boolean; printer: any } {
  const hw = getPrinterHardwareStatus();
  return { connected: hw.isOnline, printer: hw.printer };
}
