import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { now } from '../db';
import { parseRupiahNumber, executeStockMovement } from './cooperative';

export interface CatalogRowData {
  row_number: number;
  barcode: string;
  sku: string | null;
  name: string;
  category_name: string;
  unit: string;
  allow_decimal: boolean;
  cost_price: number;
  selling_price: number;
  member_price: number | null;
  initial_stock: number;
  low_stock_threshold: number;
  min_reorder_qty: number;
  is_active: boolean;
}

export interface CatalogRowError {
  row: number;
  barcode?: string;
  name?: string;
  field?: string;
  message: string;
}

export interface CatalogCsvValidationResult {
  valid: boolean;
  total_rows: number;
  valid_rows_count: number;
  error_rows_count: number;
  new_categories: string[];
  existing_categories: string[];
  new_units: string[];
  total_initial_stock_items: number;
  total_initial_stock_value: number;
  errors: CatalogRowError[];
  rows: CatalogRowData[];
}

export interface CatalogImportExecutionResult {
  success: boolean;
  batch_id: string;
  created_products_count: number;
  created_categories_count: number;
  created_categories: string[];
  created_units_count: number;
  created_units: string[];
  initial_stock_items_count: number;
  total_initial_stock_quantity: number;
  total_initial_stock_value: number;
  created_at: string;
}

/**
 * Parses RFC 4180 CSV string with zero external dependencies.
 * Handles quotes, CRLF/LF, UTF-8 BOM, and preserves raw leading zeroes.
 */
export function parseRfc4180Csv(csvContent: string): string[][] {
  if (!csvContent || typeof csvContent !== 'string') {
    return [];
  }

  // Strip UTF-8 BOM if present
  let cleanText = csvContent.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentCell += '"';
          i++;
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  // Push last cell & row if remaining
  currentRow.push(currentCell.trim());
  if (currentRow.some(c => c.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Parses an XLSX buffer directly into string[][] using ExcelJS,
 * preserving string values with leading zeros (e.g. '0812345678', '0000000001').
 */
export async function parseXlsxBuffer(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const rowValues: string[] = [];
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    for (const val of values) {
      if (val === null || val === undefined) {
        rowValues.push('');
      } else if (typeof val === 'object' && 'text' in val) {
        rowValues.push(String((val as any).text || '').trim());
      } else if (typeof val === 'object' && 'result' in val) {
        rowValues.push(String((val as any).result || '').trim());
      } else {
        rowValues.push(String(val).trim());
      }
    }
    if (rowValues.some(c => c.length > 0)) {
      rows.push(rowValues);
    }
  });

  return rows;
}

/**
 * Sanitizes cell values to prevent CSV Formula Injection (=, +, -, @).
 */
export function sanitizeTextValue(val: string): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (/^[=+\-@]/.test(trimmed)) {
    // If it starts with formula force like ="08123", unwrap it
    const match = trimmed.match(/^="([^"]+)"$/);
    if (match) {
      return match[1].trim();
    }
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Generates official Indonesian Koperasi CSV catalog template with formula text-force for Excel CSV compatibility.
 */
export function generateCatalogCsvTemplate(): string {
  const header = 'barcode,sku,nama_produk,kategori,satuan,boleh_desimal,harga_beli,harga_jual,harga_member,stok_awal,batas_stok_minimum,min_reorder_qty,status_aktif';
  const sampleRows = [
    '="0812345678",SKU-BYS-05K,Beras Pandan Wangi 5kg,Beras & Biji-bijian,sak,0,65000,72000,70000,50,10,20,1',
    '="0000000001",SKU-MYK-02L,Minyak Goreng Sawit 2L,Minyak & Mentega,pouch,0,31000,34500,33500,100,20,40,1',
    '8998866103333,SKU-GUL-01K,Gula Pasir Kristal Putih 1kg,Gula & Pemanis,kg,0,14500,17000,16500,80,15,30,1',
    '8993456104444,SKU-KCP-RCG,Kecap Manis Renceng 11x20ml,Bumbu & Dapur,renceng,0,9000,11000,10500,30,5,10,1',
    '8992345105555,SKU-TLR-01K,Telur Ayam Ras Segar 1kg,Telur & Unggas,kg,1,26000,29500,28500,45.5,10,20,1',
    '8994567106666,SKU-MIE-085,Mi Instan Rasa Soto 85g,Makanan Instan,pcs,0,2700,3100,3100,240,40,80,1',
  ];

  return [header, ...sampleRows].join('\r\n') + '\r\n';
}

/**
 * Generates official Indonesian Koperasi XLSX catalog template with explicit Text Cell Formatting (@)
 * guaranteeing leading zeroes (e.g. '0812345678') are 100% preserved in Excel.
 */
export async function generateCatalogXlsxTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'POS Koperasi';
  workbook.lastModifiedBy = 'POS Koperasi';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Katalog Produk');

  worksheet.columns = [
    { header: 'Barcode', key: 'barcode', width: 20 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Nama Produk', key: 'name', width: 35 },
    { header: 'Kategori', key: 'category', width: 22 },
    { header: 'Satuan', key: 'unit', width: 14 },
    { header: 'Boleh Desimal (0/1)', key: 'allow_decimal', width: 18 },
    { header: 'Harga Beli / HPP (Rp)', key: 'cost_price', width: 20 },
    { header: 'Harga Jual Umum (Rp)', key: 'selling_price', width: 20 },
    { header: 'Harga Anggota (Rp)', key: 'member_price', width: 20 },
    { header: 'Stok Awal', key: 'initial_stock', width: 14 },
    { header: 'Batas Stok Minimum', key: 'low_stock_threshold', width: 20 },
    { header: 'Min Reorder Qty', key: 'min_reorder_qty', width: 16 },
    { header: 'Status Aktif (0/1)', key: 'is_active', width: 16 },
  ];

  // Header row styling
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 28;

  const sampleData = [
    {
      barcode: '0812345678',
      sku: 'SKU-BYS-05K',
      name: 'Beras Pandan Wangi 5kg',
      category: 'Beras & Biji-bijian',
      unit: 'sak',
      allow_decimal: 0,
      cost_price: 65000,
      selling_price: 72000,
      member_price: 70000,
      initial_stock: 50,
      low_stock_threshold: 10,
      min_reorder_qty: 20,
      is_active: 1,
    },
    {
      barcode: '0000000001',
      sku: 'SKU-MYK-02L',
      name: 'Minyak Goreng Sawit 2L',
      category: 'Minyak & Mentega',
      unit: 'pouch',
      allow_decimal: 0,
      cost_price: 31000,
      selling_price: 34500,
      member_price: 33500,
      initial_stock: 100,
      low_stock_threshold: 20,
      min_reorder_qty: 40,
      is_active: 1,
    },
    {
      barcode: '8998866103333',
      sku: 'SKU-GUL-01K',
      name: 'Gula Pasir Kristal Putih 1kg',
      category: 'Gula & Pemanis',
      unit: 'kg',
      allow_decimal: 0,
      cost_price: 14500,
      selling_price: 17000,
      member_price: 16500,
      initial_stock: 80,
      low_stock_threshold: 15,
      min_reorder_qty: 30,
      is_active: 1,
    },
    {
      barcode: '8993456104444',
      sku: 'SKU-KCP-RCG',
      name: 'Kecap Manis Renceng 11x20ml',
      category: 'Bumbu & Dapur',
      unit: 'renceng',
      allow_decimal: 0,
      cost_price: 9000,
      selling_price: 11000,
      member_price: 10500,
      initial_stock: 30,
      low_stock_threshold: 5,
      min_reorder_qty: 10,
      is_active: 1,
    },
    {
      barcode: '8992345105555',
      sku: 'SKU-TLR-01K',
      name: 'Telur Ayam Ras Segar 1kg',
      category: 'Telur & Segar',
      unit: 'kg',
      allow_decimal: 1,
      cost_price: 26000,
      selling_price: 29500,
      member_price: 28500,
      initial_stock: 45.5,
      low_stock_threshold: 10,
      min_reorder_qty: 20,
      is_active: 1,
    },
    {
      barcode: '8994567106666',
      sku: 'SKU-MIE-085',
      name: 'Mi Instan Rasa Soto 85g',
      category: 'Makanan Instan',
      unit: 'pcs',
      allow_decimal: 0,
      cost_price: 2700,
      selling_price: 3100,
      member_price: 3100,
      initial_stock: 240,
      low_stock_threshold: 40,
      min_reorder_qty: 80,
      is_active: 1,
    },
  ];

  for (const item of sampleData) {
    const row = worksheet.addRow(item);
    // Explicit Text format (@) for text columns
    row.getCell('barcode').numFmt = '@';
    row.getCell('sku').numFmt = '@';
    row.getCell('name').numFmt = '@';
    row.getCell('category').numFmt = '@';
    row.getCell('unit').numFmt = '@';
  }

  worksheet.getColumn('barcode').numFmt = '@';
  worksheet.getColumn('sku').numFmt = '@';

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function parseBooleanCell(val: any, defaultVal = false): boolean {
  if (val === undefined || val === null || val === '') return defaultVal;
  const s = String(val).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'ya' || s === 'y') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'tidak' || s === 't' || s === 'n') return false;
  return defaultVal;
}

/**
 * Validates parsed grid data against SQLite schema with flexible units and non-blocking duplicate barcodes.
 */
export function validateCatalogGrid(db: Database.Database, parsedGrid: string[][]): CatalogCsvValidationResult {
  if (parsedGrid.length < 2) {
    return {
      valid: false,
      total_rows: 0,
      valid_rows_count: 0,
      error_rows_count: 0,
      new_categories: [],
      existing_categories: [],
      new_units: [],
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, message: 'File kosong atau tidak memiliki baris data setelah header' }],
      rows: [],
    };
  }

  const rawHeaders = parsedGrid[0].map(h => h.toLowerCase().trim().replace(/^"/, '').replace(/"$/, ''));
  const headerMap: Record<string, number> = {};

  rawHeaders.forEach((h, idx) => {
    if (h === 'barcode' || h === 'kode_barcode' || h === 'barcode_produk' || h === 'kode batang' || h === 'kode_batang') headerMap.barcode = idx;
    else if (h === 'sku' || h === 'kode_sku' || h === 'sku_produk') headerMap.sku = idx;
    else if (h === 'name' || h === 'nama' || h === 'nama_produk' || h === 'product_name' || h.startsWith('nama produk')) headerMap.name = idx;
    else if (h === 'category' || h === 'kategori' || h === 'nama_kategori' || h === 'category_name') headerMap.category = idx;
    else if (h === 'unit' || h === 'satuan' || h === 'satuan_produk') headerMap.unit = idx;
    else if (h === 'allow_decimal' || h === 'desimal' || h === 'boleh_desimal' || h.startsWith('boleh desimal')) headerMap.allow_decimal = idx;
    else if (h === 'cost_price' || h === 'harga_beli' || h === 'cost' || h === 'hpp' || h.startsWith('harga beli')) headerMap.cost_price = idx;
    else if (h === 'selling_price' || h === 'harga_jual' || h === 'price' || h === 'harga_umum' || h.startsWith('harga jual')) headerMap.selling_price = idx;
    else if (h === 'member_price' || h === 'harga_member' || h === 'harga_anggota' || h.startsWith('harga anggota')) headerMap.member_price = idx;
    else if (h === 'initial_stock' || h === 'stok_awal' || h === 'stok' || h === 'stock' || h.startsWith('stok awal')) headerMap.initial_stock = idx;
    else if (h === 'low_stock_threshold' || h === 'min_stok' || h === 'batas_stok_minimum' || h.startsWith('batas stok')) headerMap.low_stock_threshold = idx;
    else if (h === 'min_reorder_qty' || h === 'reorder_qty' || h === 'min_reorder' || h.startsWith('min reorder')) headerMap.min_reorder_qty = idx;
    else if (h === 'is_active' || h === 'aktif' || h === 'status_aktif' || h.startsWith('status aktif')) headerMap.is_active = idx;
  });

  // Check mandatory headers
  if (headerMap.barcode === undefined) {
    return {
      valid: false,
      total_rows: 0,
      valid_rows_count: 0,
      error_rows_count: 0,
      new_categories: [],
      existing_categories: [],
      new_units: [],
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, field: 'barcode', message: 'Header wajib "barcode" tidak ditemukan di file' }],
      rows: [],
    };
  }

  if (headerMap.name === undefined) {
    return {
      valid: false,
      total_rows: 0,
      valid_rows_count: 0,
      error_rows_count: 0,
      new_categories: [],
      existing_categories: [],
      new_units: [],
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, field: 'name', message: 'Header wajib "nama_produk" / "name" tidak ditemukan di file' }],
      rows: [],
    };
  }

  if (headerMap.selling_price === undefined) {
    return {
      valid: false,
      total_rows: 0,
      valid_rows_count: 0,
      error_rows_count: 0,
      new_categories: [],
      existing_categories: [],
      new_units: [],
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, field: 'selling_price', message: 'Header wajib "harga_jual" / "selling_price" tidak ditemukan di file' }],
      rows: [],
    };
  }

  const errors: CatalogRowError[] = [];
  const validRows: CatalogRowData[] = [];

  const dbCategories = new Map<string, { id: string; name: string }>();
  const dbUnits = new Set<string>();

  try {
    const existingCats = db.prepare('SELECT id, name FROM categories WHERE deleted_at IS NULL').all() as any[];
    for (const c of existingCats) {
      if (c.name) dbCategories.set(c.name.trim().toLowerCase(), c);
    }
    try {
      const unitsList = db.prepare('SELECT name FROM product_units').all() as any[];
      for (const u of unitsList) {
        if (u.name) dbUnits.add(u.name.trim().toLowerCase());
      }
    } catch {}
  } catch (err: any) {
    return {
      valid: false,
      total_rows: 0,
      valid_rows_count: 0,
      error_rows_count: 0,
      new_categories: [],
      existing_categories: [],
      new_units: [],
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, message: `Gagal membaca database: ${err.message}` }],
      rows: [],
    };
  }

  const newCategorySet = new Set<string>();
  const existingCategorySet = new Set<string>();
  const newUnitSet = new Set<string>();

  const dataRows = parsedGrid.slice(1);
  const MAX_ROWS = 5000;

  if (dataRows.length > MAX_ROWS) {
    errors.push({
      row: 1,
      message: `File memuat ${dataRows.length} baris. Maksimal impor per batch adalah ${MAX_ROWS} baris.`,
    });
  }

  let totalInitialStockItems = 0;
  let totalInitialStockValue = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = i + 2; // 1-indexed (Row 1 is header)
    const rawRow = dataRows[i];

    // Skip completely empty rows
    if (!rawRow || rawRow.every(c => !c || String(c).trim() === '')) {
      continue;
    }

    const rawBarcode = headerMap.barcode !== undefined ? String(rawRow[headerMap.barcode] || '').trim() : '';
    const rawSku = headerMap.sku !== undefined ? String(rawRow[headerMap.sku] || '').trim() : '';
    const rawName = headerMap.name !== undefined ? String(rawRow[headerMap.name] || '').trim() : '';
    const rawCategory = headerMap.category !== undefined ? String(rawRow[headerMap.category] || '').trim() : '';
    const rawUnit = headerMap.unit !== undefined ? String(rawRow[headerMap.unit] || '').trim() : 'pcs';
    const rawAllowDecimal = headerMap.allow_decimal !== undefined ? rawRow[headerMap.allow_decimal] : '0';
    const rawCostPrice = headerMap.cost_price !== undefined ? rawRow[headerMap.cost_price] : '0';
    const rawSellingPrice = headerMap.selling_price !== undefined ? rawRow[headerMap.selling_price] : '';
    const rawMemberPrice = headerMap.member_price !== undefined ? rawRow[headerMap.member_price] : '';
    const rawInitialStock = headerMap.initial_stock !== undefined ? rawRow[headerMap.initial_stock] : '0';
    const rawLowStock = headerMap.low_stock_threshold !== undefined ? rawRow[headerMap.low_stock_threshold] : '5';
    const rawMinReorder = headerMap.min_reorder_qty !== undefined ? rawRow[headerMap.min_reorder_qty] : '0';
    const rawIsActive = headerMap.is_active !== undefined ? rawRow[headerMap.is_active] : '1';

    let rowHasError = false;

    // 1. Barcode validation
    let cleanBarcode = '';
    if (!rawBarcode) {
      errors.push({ row: rowNum, field: 'barcode', name: rawName, message: 'Barcode wajib diisi' });
      rowHasError = true;
    } else {
      cleanBarcode = sanitizeTextValue(rawBarcode);
      if (cleanBarcode.length < 1 || cleanBarcode.length > 128) {
        errors.push({ row: rowNum, field: 'barcode', barcode: rawBarcode, name: rawName, message: 'Panjang barcode harus antara 1 - 128 karakter' });
        rowHasError = true;
      }
      if (/[\x00-\x1F\x7F]/.test(cleanBarcode)) {
        errors.push({ row: rowNum, field: 'barcode', barcode: rawBarcode, name: rawName, message: 'Barcode memuat karakter kontrol tidak valid' });
        rowHasError = true;
      }
    }

    // 2. SKU validation (optional)
    let cleanSku: string | null = null;
    if (rawSku) {
      cleanSku = sanitizeTextValue(rawSku);
      if (cleanSku.length > 64) {
        errors.push({ row: rowNum, field: 'sku', barcode: rawBarcode, name: rawName, message: 'SKU maksimal 64 karakter' });
        rowHasError = true;
      }
    }

    // 3. Name validation
    if (!rawName) {
      errors.push({ row: rowNum, field: 'name', barcode: rawBarcode, message: 'Nama produk wajib diisi' });
      rowHasError = true;
    } else if (rawName.length > 255) {
      errors.push({ row: rowNum, field: 'name', barcode: rawBarcode, message: 'Nama produk maksimal 255 karakter' });
      rowHasError = true;
    }

    // 4. Category validation
    const cleanCategoryName = rawCategory ? sanitizeTextValue(rawCategory) : 'Umum';
    const lowerCatName = cleanCategoryName.toLowerCase();
    if (dbCategories.has(lowerCatName)) {
      existingCategorySet.add(dbCategories.get(lowerCatName)!.name);
    } else {
      newCategorySet.add(cleanCategoryName);
    }

    // 5. Unit validation (Flexible string - accepts any unit up to 30 characters)
    let cleanUnit = 'pcs';
    if (rawUnit) {
      const sanitizedUnit = sanitizeTextValue(rawUnit).trim();
      if (sanitizedUnit.length > 30) {
        errors.push({
          row: rowNum,
          field: 'satuan',
          barcode: rawBarcode,
          name: rawName,
          message: 'Nama satuan maksimal 30 karakter',
        });
        rowHasError = true;
      } else if (sanitizedUnit.length > 0) {
        cleanUnit = sanitizedUnit;
        if (!dbUnits.has(cleanUnit.toLowerCase())) {
          newUnitSet.add(cleanUnit);
        }
      }
    }

    // 6. Allow decimal boolean
    const allowDecimalBool = parseBooleanCell(rawAllowDecimal, false);

    // 7. Selling price validation
    const parsedSellingPrice = parseRupiahNumber(rawSellingPrice);
    if (parsedSellingPrice === null || parsedSellingPrice < 0) {
      errors.push({
        row: rowNum,
        field: 'harga_jual',
        barcode: rawBarcode,
        name: rawName,
        message: 'Harga jual wajib diisi dengan nominal Rupiah valid (>= 0)',
      });
      rowHasError = true;
    }

    // 8. Cost price (HPP) validation
    let parsedCostPrice = 0;
    if (rawCostPrice !== undefined && rawCostPrice !== null && String(rawCostPrice).trim() !== '') {
      const pCost = parseRupiahNumber(rawCostPrice);
      if (pCost === null || pCost < 0) {
        errors.push({
          row: rowNum,
          field: 'harga_beli',
          barcode: rawBarcode,
          name: rawName,
          message: 'Harga beli (HPP) harus berupa nominal Rupiah valid (>= 0)',
        });
        rowHasError = true;
      } else {
        parsedCostPrice = pCost;
      }
    }

    // 9. Member price validation (optional)
    let parsedMemberPrice: number | null = null;
    if (rawMemberPrice !== undefined && rawMemberPrice !== null && String(rawMemberPrice).trim() !== '') {
      const pMember = parseRupiahNumber(rawMemberPrice);
      if (pMember === null || pMember < 0) {
        errors.push({
          row: rowNum,
          field: 'harga_member',
          barcode: rawBarcode,
          name: rawName,
          message: 'Harga anggota/member harus berupa nominal Rupiah valid (>= 0)',
        });
        rowHasError = true;
      } else {
        parsedMemberPrice = pMember;
      }
    }

    // 10. Initial stock validation
    let parsedInitialStock = 0;
    if (rawInitialStock !== undefined && rawInitialStock !== null && String(rawInitialStock).trim() !== '') {
      const stockStr = String(rawInitialStock).trim().replace(/\s+/g, '');
      const numStock = Number(stockStr.replace(/,/g, '.'));
      if (isNaN(numStock) || !Number.isFinite(numStock) || numStock < 0) {
        errors.push({
          row: rowNum,
          field: 'stok_awal',
          barcode: rawBarcode,
          name: rawName,
          message: 'Stok awal harus berupa angka positif (>= 0)',
        });
        rowHasError = true;
      } else {
        if (!allowDecimalBool && !Number.isInteger(numStock)) {
          errors.push({
            row: rowNum,
            field: 'stok_awal',
            barcode: rawBarcode,
            name: rawName,
            message: `Stok awal '${numStock}' memuat desimal untuk satuan '${cleanUnit}'. Ubah boleh_desimal=1 bila ingin desimal.`,
          });
          rowHasError = true;
        } else {
          parsedInitialStock = numStock;
        }
      }
    }

    // 11. Low stock threshold
    let parsedLowStock = 5;
    if (rawLowStock !== undefined && rawLowStock !== null && String(rawLowStock).trim() !== '') {
      const n = Number(String(rawLowStock).trim().replace(/,/g, '.'));
      if (!isNaN(n) && n >= 0) parsedLowStock = n;
    }

    // 12. Min reorder qty
    let parsedMinReorder = 0;
    if (rawMinReorder !== undefined && rawMinReorder !== null && String(rawMinReorder).trim() !== '') {
      const n = Number(String(rawMinReorder).trim().replace(/,/g, '.'));
      if (!isNaN(n) && n >= 0) parsedMinReorder = n;
    }

    // 13. Is active
    const isActiveBool = parseBooleanCell(rawIsActive, true);

    if (!rowHasError) {
      if (parsedInitialStock > 0) {
        totalInitialStockItems++;
        totalInitialStockValue += (parsedInitialStock * parsedCostPrice);
      }

      validRows.push({
        row_number: rowNum,
        barcode: cleanBarcode,
        sku: cleanSku,
        name: sanitizeTextValue(rawName),
        category_name: cleanCategoryName,
        unit: cleanUnit,
        allow_decimal: allowDecimalBool,
        cost_price: parsedCostPrice,
        selling_price: parsedSellingPrice || 0,
        member_price: parsedMemberPrice,
        initial_stock: parsedInitialStock,
        low_stock_threshold: parsedLowStock,
        min_reorder_qty: parsedMinReorder,
        is_active: isActiveBool,
      });
    }
  }

  const isOverallValid = errors.length === 0 && validRows.length > 0;

  return {
    valid: isOverallValid,
    total_rows: dataRows.length,
    valid_rows_count: validRows.length,
    error_rows_count: errors.length,
    new_categories: Array.from(newCategorySet),
    existing_categories: Array.from(existingCategorySet),
    new_units: Array.from(newUnitSet),
    total_initial_stock_items: totalInitialStockItems,
    total_initial_stock_value: Math.round(totalInitialStockValue),
    errors,
    rows: validRows,
  };
}

/**
 * Validates in-memory CSV text against catalog schema.
 */
export function validateCatalogCsv(db: Database.Database, csvContent: string): CatalogCsvValidationResult {
  const parsedGrid = parseRfc4180Csv(csvContent);
  return validateCatalogGrid(db, parsedGrid);
}

/**
 * Atomically executes catalog import inside a single SQLite transaction (All-or-Nothing).
 * Creates new categories, registers new units in product_units, inserts products,
 * records initial stock in ledger, and writes audit log.
 */
export function executeCatalogImport(
  db: Database.Database,
  rows: CatalogRowData[],
  userId: string
): CatalogImportExecutionResult {
  if (!rows || rows.length === 0) {
    throw new Error('Tidak ada baris produk valid untuk diimpor');
  }

  const batchId = `IMPORT-${Date.now()}`;
  let createdCategoriesCount = 0;
  const createdCategoryNames: string[] = [];
  let createdUnitsCount = 0;
  const createdUnitNames: string[] = [];
  let initialStockItemsCount = 0;
  let totalInitialStockQty = 0;
  let totalInitialStockVal = 0;

  const importTx = db.transaction(() => {
    // 1. Map existing categories and insert new ones
    const categoryMap = new Map<string, string>();
    const existingCats = db.prepare('SELECT id, name FROM categories WHERE deleted_at IS NULL').all() as any[];
    for (const c of existingCats) {
      categoryMap.set(c.name.trim().toLowerCase(), c.id);
    }

    const insertCatStmt = db.prepare(`
      INSERT INTO categories (id, name, description, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);

    for (const row of rows) {
      const lowerCat = row.category_name.trim().toLowerCase();
      if (!categoryMap.has(lowerCat)) {
        const newCatId = uuidv4();
        insertCatStmt.run(newCatId, row.category_name.trim(), 'Kategori dari impor katalog', now(), now());
        categoryMap.set(lowerCat, newCatId);
        createdCategoriesCount++;
        createdCategoryNames.push(row.category_name.trim());
      }
    }

    // 2. Register any new units into product_units
    const insertUnitStmt = db.prepare(`
      INSERT OR IGNORE INTO product_units (id, name, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);

    const knownUnits = new Set<string>();
    try {
      const existingUnits = db.prepare('SELECT name FROM product_units').all() as any[];
      for (const u of existingUnits) {
        if (u.name) knownUnits.add(u.name.trim().toLowerCase());
      }
    } catch {}

    for (const row of rows) {
      const uTrim = row.unit.trim();
      const uLower = uTrim.toLowerCase();
      if (uTrim && !knownUnits.has(uLower)) {
        insertUnitStmt.run(uuidv4(), uTrim);
        knownUnits.add(uLower);
        createdUnitsCount++;
        createdUnitNames.push(uTrim);
      }
    }

    // 3. Prepare product insert statement
    const insertProdStmt = db.prepare(`
      INSERT INTO products (
        id, category_id, name, sku, barcode, description,
        price, cost, member_price, unit, allow_decimal,
        track_inventory, stock_quantity, low_stock_threshold, min_reorder_qty,
        is_active, tax_type, tax_rate, cb_percent, tags,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, 'none', 0, 0, '[]',
        ?, ?
      )
    `);

    for (const row of rows) {
      const productId = uuidv4();
      const catId = categoryMap.get(row.category_name.trim().toLowerCase()) || null;
      const trackInventory = row.initial_stock > 0 ? 1 : (row.allow_decimal ? 1 : 0);

      insertProdStmt.run(
        productId,
        catId,
        row.name,
        row.sku,
        row.barcode,
        null,
        row.selling_price,
        row.cost_price,
        row.member_price,
        row.unit,
        row.allow_decimal ? 1 : 0,
        trackInventory,
        row.initial_stock,
        row.low_stock_threshold,
        row.min_reorder_qty,
        row.is_active ? 1 : 0,
        now(),
        now()
      );

      // 4. Record Initial Stock Movement if initial_stock > 0
      if (row.initial_stock > 0) {
        executeStockMovement(db, {
          productId,
          movementType: 'initial',
          quantityChange: row.initial_stock,
          unitCost: row.cost_price,
          referenceType: 'csv_import',
          referenceId: batchId,
          notes: `Stok awal impor katalog batch ${batchId}`,
          createdBy: userId,
        });

        initialStockItemsCount++;
        totalInitialStockQty += row.initial_stock;
        totalInitialStockVal += (row.initial_stock * row.cost_price);
      }
    }

    // 5. Record Audit Log entry
    db.prepare(`
      INSERT INTO audit_logs (
        actor_user_id, actor_role, action, target_type, target_id, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      'admin',
      'catalog.imported',
      'product_catalog',
      batchId,
      JSON.stringify({
        batch_id: batchId,
        total_products: rows.length,
        created_categories_count: createdCategoriesCount,
        created_categories: createdCategoryNames,
        created_units_count: createdUnitsCount,
        created_units: createdUnitNames,
        initial_stock_items: initialStockItemsCount,
        total_initial_stock_quantity: totalInitialStockQty,
        total_initial_stock_value: Math.round(totalInitialStockVal),
      }),
      now()
    );

    return {
      success: true,
      batch_id: batchId,
      created_products_count: rows.length,
      created_categories_count: createdCategoriesCount,
      created_categories: createdCategoryNames,
      created_units_count: createdUnitsCount,
      created_units: createdUnitNames,
      initial_stock_items_count: initialStockItemsCount,
      total_initial_stock_quantity: totalInitialStockQty,
      total_initial_stock_value: Math.round(totalInitialStockVal),
      created_at: now(),
    };
  });

  return importTx();
}
