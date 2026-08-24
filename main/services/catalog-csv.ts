import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { now } from '../db';
import { parseRupiahNumber, executeStockMovement } from './cooperative';

export const ALLOWED_UNITS = [
  'pcs', 'kg', 'gram', 'liter', 'ml', 'pack', 'pouch', 'box', 'sak', 'tray'
] as const;

export type UnitType = typeof ALLOWED_UNITS[number];

export interface CatalogRowData {
  row_number: number;
  barcode: string;
  sku: string | null;
  name: string;
  category_name: string;
  unit: UnitType;
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
  initial_stock_items_count: number;
  total_initial_stock_quantity: number;
  total_initial_stock_value: number;
  created_at: string;
}

/**
 * Parses RFC 4180 CSV string with zero external dependencies.
 * Handles:
 * - Quotes and escaped quotes ("")
 * - Commas inside quoted fields
 * - CRLF and LF line breaks
 * - UTF-8 BOM removal
 * - Formula injection sanitization
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
          i++; // Skip next quote
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
          i++; // Skip \n
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
 * Sanitizes cell values to prevent CSV Formula Injection (=, +, -, @).
 */
export function sanitizeTextValue(val: string): string {
  if (!val) return '';
  const trimmed = val.trim();
  if (/^[=+\-@]/.test(trimmed)) {
    // Escape leading formula character with single quote
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Generates official Indonesian Koperasi CSV catalog template.
 */
export function generateCatalogCsvTemplate(): string {
  const header = 'barcode,sku,name,category,unit,allow_decimal,cost_price,selling_price,member_price,initial_stock,low_stock_threshold,min_reorder_qty,is_active';
  const sampleRows = [
    '8992753101111,SKU-BYS-05K,Beras Pandan Wangi 5kg,Beras & Biji-bijian,sak,0,65000,72000,72000,50,10,20,1',
    '8991002102222,SKU-MYK-02L,Minyak Goreng Sawit 2L,Minyak & Mentega,pouch,0,31000,34500,34500,100,20,40,1',
    '8998866103333,SKU-GUL-01K,Gula Pasir Kristal Putih 1kg,Gula & Pemanis,kg,0,14500,17000,17000,80,15,30,1',
    '8993456104444,SKU-TPG-01K,Tepung Terigu Serbaguna 1kg,Tepung & Bumbu,pack,0,10500,12500,12500,60,10,25,1',
    '8992345105555,SKU-TLR-01K,Telur Ayam Ras Segar 1kg,Telur & Unggas,kg,1,26000,29500,29500,45.5,10,20,1',
    '8994567106666,SKU-MIE-085,Mi Instan Rasa Soto 85g,Makanan Instan,pcs,0,2700,3100,3100,240,40,80,1',
    '8995678107777,SKU-SKM-370,Susu Kental Manis Putih 370g,Susu & Olahan,pcs,0,11000,12800,12800,72,12,24,1',
    '8996789108888,SKU-KCP-550,"Kecap Manis Refill, Pouch 550ml",Tepung & Bumbu,pouch,0,18500,21000,21000,40,8,16,1',
  ];

  return [header, ...sampleRows].join('\r\n') + '\r\n';
}

function parseBooleanCell(val: any, defaultVal = false): boolean {
  if (val === undefined || val === null || val === '') return defaultVal;
  const s = String(val).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'ya' || s === 'y') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'tidak' || s === 't' || s === 'n') return false;
  return defaultVal;
}

/**
 * Validates in-memory CSV data against the SQLite catalog schema.
 * Returns preview, statistics, and any row-level validation errors.
 */
export function validateCatalogCsv(db: Database.Database, csvContent: string): CatalogCsvValidationResult {
  const parsedGrid = parseRfc4180Csv(csvContent);

  if (parsedGrid.length < 2) {
    return {
      valid: false,
      total_rows: 0,
      valid_rows_count: 0,
      error_rows_count: 0,
      new_categories: [],
      existing_categories: [],
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, message: 'File CSV kosong atau tidak memiliki baris data setelah header' }],
      rows: [],
    };
  }

  const rawHeaders = parsedGrid[0].map(h => h.toLowerCase().trim().replace(/^"/, '').replace(/"$/, ''));
  const headerMap: Record<string, number> = {};

  rawHeaders.forEach((h, idx) => {
    if (h === 'barcode' || h === 'kode_barcode' || h === 'barcode_produk') headerMap.barcode = idx;
    else if (h === 'sku' || h === 'kode_sku' || h === 'sku_produk') headerMap.sku = idx;
    else if (h === 'name' || h === 'nama' || h === 'nama_produk' || h === 'product_name') headerMap.name = idx;
    else if (h === 'category' || h === 'kategori' || h === 'nama_kategori' || h === 'category_name') headerMap.category = idx;
    else if (h === 'unit' || h === 'satuan' || h === 'satuan_produk') headerMap.unit = idx;
    else if (h === 'allow_decimal' || h === 'desimal' || h === 'boleh_desimal') headerMap.allow_decimal = idx;
    else if (h === 'cost_price' || h === 'harga_beli' || h === 'cost' || h === 'hpp') headerMap.cost_price = idx;
    else if (h === 'selling_price' || h === 'harga_jual' || h === 'price' || h === 'harga_umum') headerMap.selling_price = idx;
    else if (h === 'member_price' || h === 'harga_member' || h === 'harga_anggota') headerMap.member_price = idx;
    else if (h === 'initial_stock' || h === 'stok_awal' || h === 'stok' || h === 'stock') headerMap.initial_stock = idx;
    else if (h === 'low_stock_threshold' || h === 'min_stok' || h === 'batas_stok_minimum') headerMap.low_stock_threshold = idx;
    else if (h === 'min_reorder_qty' || h === 'reorder_qty' || h === 'min_reorder') headerMap.min_reorder_qty = idx;
    else if (h === 'is_active' || h === 'aktif' || h === 'status_aktif') headerMap.is_active = idx;
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
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, field: 'barcode', message: 'Header wajib "barcode" tidak ditemukan di file CSV' }],
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
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, field: 'name', message: 'Header wajib "name" (nama produk) tidak ditemukan di file CSV' }],
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
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, field: 'selling_price', message: 'Header wajib "selling_price" (harga jual) tidak ditemukan di file CSV' }],
      rows: [],
    };
  }

  const errors: CatalogRowError[] = [];
  const validRows: CatalogRowData[] = [];
  const seenFileBarcodes = new Map<string, number>(); // barcode -> rowNumber
  const seenFileSkus = new Map<string, number>(); // sku -> rowNumber

  // Load existing database barcodes and SKUs
  const dbBarcodes = new Set<string>();
  const dbSkus = new Set<string>();
  const dbCategories = new Map<string, { id: string; name: string }>(); // lowerName -> cat

  try {
    const existingProds = db.prepare('SELECT barcode, sku, name FROM products WHERE deleted_at IS NULL').all() as any[];
    for (const p of existingProds) {
      if (p.barcode) dbBarcodes.add(p.barcode.trim().toLowerCase());
      if (p.sku) dbSkus.add(p.sku.trim().toLowerCase());
    }

    const existingCats = db.prepare('SELECT id, name FROM categories WHERE deleted_at IS NULL').all() as any[];
    for (const c of existingCats) {
      if (c.name) dbCategories.set(c.name.trim().toLowerCase(), c);
    }
  } catch (err: any) {
    // Database query failed
    return {
      valid: false,
      total_rows: 0,
      valid_rows_count: 0,
      error_rows_count: 0,
      new_categories: [],
      existing_categories: [],
      total_initial_stock_items: 0,
      total_initial_stock_value: 0,
      errors: [{ row: 1, message: `Gagal membaca database: ${err.message}` }],
      rows: [],
    };
  }

  const newCategorySet = new Set<string>();
  const existingCategorySet = new Set<string>();

  const dataRows = parsedGrid.slice(1);
  const MAX_ROWS = 1000;

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
    if (!rawRow || rawRow.every(c => !c || c.trim() === '')) {
      continue;
    }

    const rawBarcode = headerMap.barcode !== undefined ? (rawRow[headerMap.barcode] || '').trim() : '';
    const rawSku = headerMap.sku !== undefined ? (rawRow[headerMap.sku] || '').trim() : '';
    const rawName = headerMap.name !== undefined ? (rawRow[headerMap.name] || '').trim() : '';
    const rawCategory = headerMap.category !== undefined ? (rawRow[headerMap.category] || '').trim() : '';
    const rawUnit = headerMap.unit !== undefined ? (rawRow[headerMap.unit] || '').trim().toLowerCase() : 'pcs';
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
    if (!rawBarcode) {
      errors.push({ row: rowNum, field: 'barcode', name: rawName, message: 'Barcode wajib diisi' });
      rowHasError = true;
    } else {
      if (rawBarcode.length < 1 || rawBarcode.length > 128) {
        errors.push({ row: rowNum, field: 'barcode', barcode: rawBarcode, name: rawName, message: 'Panjang barcode harus antara 1 - 128 karakter' });
        rowHasError = true;
      }
      if (/[\x00-\x1F\x7F]/.test(rawBarcode)) {
        errors.push({ row: rowNum, field: 'barcode', barcode: rawBarcode, name: rawName, message: 'Barcode memuat karakter kontrol tidak valid' });
        rowHasError = true;
      }

      // Check duplicate in file
      const lowerBarcode = rawBarcode.toLowerCase();
      if (seenFileBarcodes.has(lowerBarcode)) {
        const prevRow = seenFileBarcodes.get(lowerBarcode);
        errors.push({
          row: rowNum,
          field: 'barcode',
          barcode: rawBarcode,
          name: rawName,
          message: `Duplikat barcode '${rawBarcode}' di dalam file CSV (sebelumnya ada di baris ${prevRow})`,
        });
        rowHasError = true;
      } else {
        seenFileBarcodes.set(lowerBarcode, rowNum);
      }

      // Check duplicate in database
      if (dbBarcodes.has(lowerBarcode)) {
        errors.push({
          row: rowNum,
          field: 'barcode',
          barcode: rawBarcode,
          name: rawName,
          message: `Barcode '${rawBarcode}' sudah digunakan oleh produk lain di database`,
        });
        rowHasError = true;
      }
    }

    // 2. SKU validation (optional)
    let cleanSku: string | null = null;
    if (rawSku) {
      if (rawSku.length > 64) {
        errors.push({ row: rowNum, field: 'sku', barcode: rawBarcode, name: rawName, message: 'SKU maksimal 64 karakter' });
        rowHasError = true;
      }
      const lowerSku = rawSku.toLowerCase();
      if (seenFileSkus.has(lowerSku)) {
        const prevRow = seenFileSkus.get(lowerSku);
        errors.push({
          row: rowNum,
          field: 'sku',
          barcode: rawBarcode,
          name: rawName,
          message: `Duplikat SKU '${rawSku}' di dalam file CSV (sebelumnya ada di baris ${prevRow})`,
        });
        rowHasError = true;
      } else {
        seenFileSkus.set(lowerSku, rowNum);
      }

      if (dbSkus.has(lowerSku)) {
        errors.push({
          row: rowNum,
          field: 'sku',
          barcode: rawBarcode,
          name: rawName,
          message: `SKU '${rawSku}' sudah digunakan oleh produk lain di database`,
        });
        rowHasError = true;
      }
      cleanSku = sanitizeTextValue(rawSku);
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

    // 5. Unit validation
    let validUnit: UnitType = 'pcs';
    if (rawUnit) {
      if (ALLOWED_UNITS.includes(rawUnit as UnitType)) {
        validUnit = rawUnit as UnitType;
      } else {
        errors.push({
          row: rowNum,
          field: 'unit',
          barcode: rawBarcode,
          name: rawName,
          message: `Satuan '${rawUnit}' tidak valid. Pilih dari: ${ALLOWED_UNITS.join(', ')}`,
        });
        rowHasError = true;
      }
    }

    // 6. Allow decimal boolean
    const allowDecimalBool = parseBooleanCell(rawAllowDecimal, false);

    // 7. Selling price validation
    const parsedSellingPrice = parseRupiahNumber(rawSellingPrice);
    if (parsedSellingPrice === null || parsedSellingPrice <= 0) {
      errors.push({
        row: rowNum,
        field: 'selling_price',
        barcode: rawBarcode,
        name: rawName,
        message: 'Harga jual (selling_price) wajib diisi dengan nominal Rupiah positif (> 0)',
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
          field: 'cost_price',
          barcode: rawBarcode,
          name: rawName,
          message: 'Harga pokok/beli (cost_price) harus berupa nominal Rupiah valid (>= 0)',
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
          field: 'member_price',
          barcode: rawBarcode,
          name: rawName,
          message: 'Harga member (member_price) harus berupa nominal Rupiah valid (>= 0)',
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
          field: 'initial_stock',
          barcode: rawBarcode,
          name: rawName,
          message: 'Stok awal (initial_stock) harus berupa angka positif (>= 0)',
        });
        rowHasError = true;
      } else {
        if (!allowDecimalBool && !Number.isInteger(numStock)) {
          errors.push({
            row: rowNum,
            field: 'initial_stock',
            barcode: rawBarcode,
            name: rawName,
            message: `Stok awal '${numStock}' memuat desimal untuk satuan '${validUnit}'. Ubah allow_decimal=1 bila ingin desimal.`,
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
        barcode: rawBarcode,
        sku: cleanSku,
        name: sanitizeTextValue(rawName),
        category_name: cleanCategoryName,
        unit: validUnit,
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
    total_initial_stock_items: totalInitialStockItems,
    total_initial_stock_value: Math.round(totalInitialStockValue),
    errors,
    rows: validRows,
  };
}

/**
 * Atomically executes catalog CSV import within a single SQLite transaction.
 * Creates new categories, inserts products, records initial stock in ledger, and writes audit log.
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
  let initialStockItemsCount = 0;
  let totalInitialStockQty = 0;
  let totalInitialStockVal = 0;

  const importTx = db.transaction(() => {
    // 1. Map existing categories and insert new ones
    const categoryMap = new Map<string, string>(); // lowerName -> categoryId
    const existingCats = db.prepare('SELECT id, name FROM categories WHERE deleted_at IS NULL').all() as any[];
    for (const c of existingCats) {
      categoryMap.set(c.name.trim().toLowerCase(), c.id);
    }

    const insertCatStmt = db.prepare(`
      INSERT INTO categories (id, name, description, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);

    // Create new categories if needed
    for (const row of rows) {
      const lowerCat = row.category_name.trim().toLowerCase();
      if (!categoryMap.has(lowerCat)) {
        const newCatId = uuidv4();
        insertCatStmt.run(newCatId, row.category_name.trim(), 'Kategori dari impor CSV katalog', now(), now());
        categoryMap.set(lowerCat, newCatId);
        createdCategoriesCount++;
        createdCategoryNames.push(row.category_name.trim());
      }
    }

    // 2. Prepare product insert statement
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
        null, // description
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

      // 3. Record Initial Stock Movement if initial_stock > 0
      if (row.initial_stock > 0) {
        executeStockMovement(db, {
          productId,
          movementType: 'initial',
          quantityChange: row.initial_stock,
          unitCost: row.cost_price,
          referenceType: 'csv_import',
          referenceId: batchId,
          notes: `Stok awal impor katalog CSV batch ${batchId}`,
          createdBy: userId,
        });

        initialStockItemsCount++;
        totalInitialStockQty += row.initial_stock;
        totalInitialStockVal += (row.initial_stock * row.cost_price);
      }
    }

    // 4. Record Audit Log entry
    db.prepare(`
      INSERT INTO audit_logs (
        actor_user_id, actor_role, action, target_type, target_id, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      'admin',
      'catalog.csv_imported',
      'product_catalog',
      batchId,
      JSON.stringify({
        batch_id: batchId,
        total_products: rows.length,
        created_categories_count: createdCategoriesCount,
        created_categories: createdCategoryNames,
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
      initial_stock_items_count: initialStockItemsCount,
      total_initial_stock_quantity: totalInitialStockQty,
      total_initial_stock_value: Math.round(totalInitialStockVal),
      created_at: now(),
    };
  });

  return importTx();
}
