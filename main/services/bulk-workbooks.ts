import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import { v4 as uuidv4 } from 'uuid';
import { createAuditLog } from './audit';
import { executeStockMovement, parseRupiahNumber } from './cooperative';
import { now } from '../db';
import { normalizeNik, validateNik } from './privacy';

type Action = 'UPDATE' | 'DELETE';
const MAX_WORKBOOK_DATA_ROWS = 20_000;
const MAX_WORKBOOK_ROWS = MAX_WORKBOOK_DATA_ROWS + 1;

interface WorkbookRow {
  row_number: number;
  id: string;
  action: Action;
  values: Record<string, string>;
}

interface WorkbookError {
  row: number;
  field: string;
  message: string;
}

interface WorkbookValidation<T> {
  valid: boolean;
  total_rows: number;
  valid_rows_count: number;
  error_rows_count: number;
  update_count: number;
  delete_count: number;
  errors: WorkbookError[];
  rows: T[];
}

interface ProductUpdateRow extends WorkbookRow {
  values: WorkbookRow['values'] & {
    barcode: string | null;
    sku: string | null;
    name: string;
    category: string | null;
    unit: string;
    allow_decimal: number;
    cost_price: number;
    selling_price: number;
    member_price: number | null;
    stock_quantity: number;
    low_stock_threshold: number;
    min_reorder_qty: number;
    track_inventory: number;
    is_active: number;
    description: string | null;
  };
}

interface MemberUpdateRow extends WorkbookRow {
  values: WorkbookRow['values'] & {
    name: string;
    nik: string | null;
    employee_id: string | null;
    member_no: string | null;
    department: string | null;
    phone: string | null;
    email: string | null;
    country_code: string | null;
    address: string | null;
    monthly_deduction_limit: number;
    outstanding_deduction_limit: number;
    salary_deduction_enabled: number;
    is_active: number;
    notes: string | null;
  };
}

function addWorkbookSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Array<{ header: string; key: string; width: number }>
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.height = 32;
  return sheet;
}

function setTextColumns(sheet: ExcelJS.Worksheet, keys: string[]): void {
  for (const key of keys) {
    sheet.getColumn(key).numFmt = '@';
  }
}

function setActionValidation(sheet: ExcelJS.Worksheet, rowCount: number): void {
  sheet.autoFilter = {
    from: 'A1',
    to: `${String.fromCharCode(64 + sheet.columnCount)}${rowCount + 1}`,
  };
  for (let row = 2; row <= rowCount + 1; row++) {
    sheet.getCell(row, 2).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"UPDATE,DELETE"'],
      showErrorMessage: true,
      errorTitle: 'Aksi tidak valid',
      error: 'Kosongkan untuk memperbarui, atau pilih DELETE untuk menghapus/menonaktifkan.',
    };
  }
}

export async function generateAllProductsWorkbook(db: Database.Database): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'POS Koperasi';
  workbook.created = new Date();
  const sheet = addWorkbookSheet(workbook, 'Data Produk', [
    { header: 'id', key: 'id', width: 38 },
    { header: 'action', key: 'action', width: 18 },
    { header: 'barcode', key: 'barcode', width: 20 },
    { header: 'sku', key: 'sku', width: 20 },
    { header: 'name', key: 'name', width: 35 },
    { header: 'category', key: 'category', width: 24 },
    { header: 'unit', key: 'unit', width: 14 },
    { header: 'allow_decimal', key: 'allow_decimal', width: 20 },
    { header: 'cost_price', key: 'cost_price', width: 16 },
    { header: 'selling_price', key: 'selling_price', width: 16 },
    { header: 'member_price', key: 'member_price', width: 18 },
    { header: 'stock_quantity', key: 'stock_quantity', width: 22 },
    { header: 'low_stock_threshold', key: 'low_stock_threshold', width: 22 },
    { header: 'min_reorder_qty', key: 'min_reorder_qty', width: 20 },
    { header: 'track_inventory', key: 'track_inventory', width: 20 },
    { header: 'is_active', key: 'is_active', width: 16 },
    { header: 'description', key: 'description', width: 40 },
  ]);
  const products = db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.deleted_at IS NULL
    ORDER BY p.name COLLATE NOCASE, p.id
  `).all() as Array<Record<string, unknown>>;

  for (const product of products) {
    sheet.addRow({
      ...product,
      action: '',
      barcode: product.barcode ?? '',
      sku: product.sku ?? '',
      category: product.category_name ?? '',
      allow_decimal: Number(product.allow_decimal ?? 0),
      cost_price: Number(product.cost ?? 0),
      selling_price: Number(product.price ?? 0),
      member_price: product.member_price ?? '',
      stock_quantity: Number(product.stock_quantity ?? 0),
      low_stock_threshold: Number(product.low_stock_threshold ?? 0),
      min_reorder_qty: Number(product.min_reorder_qty ?? 0),
      track_inventory: Number(product.track_inventory ?? 0),
      is_active: Number(product.is_active ?? 1),
      description: product.description ?? '',
    });
  }
  setTextColumns(sheet, ['id', 'barcode', 'sku']);
  setActionValidation(sheet, products.length);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function generateAllMembersWorkbook(db: Database.Database): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'POS Koperasi';
  workbook.created = new Date();
  const sheet = addWorkbookSheet(workbook, 'Data Anggota', [
    { header: 'id', key: 'id', width: 38 },
    { header: 'action', key: 'action', width: 18 },
    { header: 'name', key: 'name', width: 30 },
    { header: 'nik', key: 'nik', width: 22 },
    { header: 'employee_id', key: 'employee_id', width: 22 },
    { header: 'member_no', key: 'member_no', width: 22 },
    { header: 'department', key: 'department', width: 24 },
    { header: 'phone', key: 'phone', width: 20 },
    { header: 'email', key: 'email', width: 30 },
    { header: 'country_code', key: 'country_code', width: 16 },
    { header: 'address', key: 'address', width: 40 },
    { header: 'monthly_deduction_limit', key: 'monthly_deduction_limit', width: 28 },
    { header: 'outstanding_deduction_limit', key: 'outstanding_deduction_limit', width: 30 },
    { header: 'salary_deduction_enabled', key: 'salary_deduction_enabled', width: 30 },
    { header: 'is_active', key: 'is_active', width: 16 },
    { header: 'notes', key: 'notes', width: 35 },
  ]);
  const members = db.prepare(`
    SELECT id, name, nik, employee_id, member_no, department, phone, email, country_code,
           address, monthly_deduction_limit, outstanding_deduction_limit,
           salary_deduction_enabled, is_active, notes
    FROM customers
    WHERE is_member = 1
    ORDER BY name COLLATE NOCASE, id
  `).all() as Array<Record<string, unknown>>;

  for (const member of members) {
    sheet.addRow({ ...member, action: '' });
  }
  setTextColumns(sheet, ['id', 'nik', 'employee_id', 'member_no', 'phone']);
  setActionValidation(sheet, members.length);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function parseEditableWorkbook(buffer: Buffer): Promise<string[][]> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
    throw new Error('File Excel kosong atau melebihi batas 10 MB.');
  }
  const workbook = new ExcelJS.Workbook();
  try {
    const arrayBuffer = new ArrayBuffer(buffer.length);
    new Uint8Array(arrayBuffer).set(buffer);
    await workbook.xlsx.load(arrayBuffer);
  } catch (error) {
    throw new Error(`File Excel tidak dapat dibaca: ${error instanceof Error ? error.message : String(error)}`);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  if (worksheet.rowCount > MAX_WORKBOOK_ROWS || worksheet.columnCount > 40) {
    throw new Error(`Workbook melebihi batas ${MAX_WORKBOOK_DATA_ROWS.toLocaleString('id-ID')} baris data atau 40 kolom.`);
  }

  const rows: string[][] = [];
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const values: string[] = [];
    for (let column = 1; column <= worksheet.columnCount; column++) {
      const cell = row.getCell(column);
      const value = cell.value;
      if (value && typeof value === 'object') {
        if ('formula' in value || 'sharedFormula' in value) {
          throw new Error(`Formula Excel tidak diperbolehkan (baris ${rowNumber}, kolom ${column}).`);
        }
        if ('text' in value) {
          values.push(String(value.text ?? '').trim());
          continue;
        }
        if ('result' in value) {
          values.push(String(value.result ?? '').trim());
          continue;
        }
        if ('richText' in value) {
          values.push(value.richText.map((part) => part.text).join('').trim());
          continue;
        }
      }
      values.push(value === null || value === undefined ? '' : String(value).trim());
    }
    rows.push(values);
  }
  while (rows.length > 0 && rows[rows.length - 1].every((value) => value === '')) rows.pop();
  return rows;
}

function mapHeaders(grid: string[][], required: string[]): { headers: Map<string, number>; errors: WorkbookError[] } {
  const errors: WorkbookError[] = [];
  if (grid.length < 2) {
    return { headers: new Map(), errors: [{ row: 1, field: 'file', message: 'File harus berisi header dan minimal satu baris data.' }] };
  }
  const headers = new Map<string, number>();
  grid[0].forEach((raw, index) => {
    const name = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (name) {
      if (headers.has(name)) errors.push({ row: 1, field: name, message: `Kolom '${name}' muncul lebih dari sekali.` });
      headers.set(name, index);
    }
  });
  for (const name of required) {
    if (!headers.has(name)) errors.push({ row: 1, field: name, message: `Kolom wajib '${name}' tidak ditemukan.` });
  }
  return { headers, errors };
}

function textAt(row: string[], headers: Map<string, number>, name: string): string {
  const index = headers.get(name);
  return index === undefined ? '' : String(row[index] ?? '').trim();
}

function parseBoolean(value: string, field: string, row: number, errors: WorkbookError[]): number {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'ya', 'yes', 'aktif'].includes(normalized)) return 1;
  if (['0', 'false', 'tidak', 'no', 'nonaktif'].includes(normalized)) return 0;
  errors.push({ row, field, message: `Nilai '${value}' harus 0/1 (atau Ya/Tidak).` });
  return 0;
}

function parseNonNegativeNumber(
  value: string,
  field: string,
  row: number,
  errors: WorkbookError[],
  allowBlank = false
): number | null {
  if (allowBlank && value.trim() === '') return null;
  const parsed = parseRupiahNumber(value);
  if (parsed === null || parsed < 0 || !Number.isFinite(parsed)) {
    errors.push({ row, field, message: `Nilai '${value}' harus angka nol atau lebih.` });
    return null;
  }
  return parsed;
}

function parseNonNegativeDecimal(value: string, field: string, row: number, errors: WorkbookError[]): number | null {
  const parsed = Number(value.trim().replace(',', '.'));
  if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) {
    errors.push({ row, field, message: `Nilai '${value}' harus angka nol atau lebih.` });
    return null;
  }
  return Math.round(parsed * 1000) / 1000;
}

function extractAction(row: string[], headers: Map<string, number>, rowNumber: number, errors: WorkbookError[]): Action {
  const value = textAt(row, headers, 'action').toUpperCase();
  if (!value || value === 'UPDATE') return 'UPDATE';
  if (value === 'DELETE') return 'DELETE';
  errors.push({ row: rowNumber, field: 'action', message: "Kosongkan action/isi UPDATE, atau isi DELETE untuk menghapus." });
  return 'UPDATE';
}

function uniqueRowIds(rows: WorkbookRow[], errors: WorkbookError[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) errors.push({ row: row.row_number, field: 'id', message: `ID '${row.id}' muncul lebih dari sekali.` });
    seen.add(row.id);
  }
}

export function validateProductWorkbook(db: Database.Database, grid: string[][]): WorkbookValidation<ProductUpdateRow> {
  const { headers, errors } = mapHeaders(grid, [
    'id', 'action', 'barcode', 'sku', 'name', 'category', 'unit', 'allow_decimal', 'cost_price',
    'selling_price', 'member_price', 'stock_quantity', 'low_stock_threshold', 'min_reorder_qty',
    'track_inventory', 'is_active', 'description',
  ]);
  const rows: ProductUpdateRow[] = [];
  if (errors.length) {
    return { valid: false, total_rows: Math.max(0, grid.length - 1), valid_rows_count: 0, error_rows_count: errors.length, update_count: 0, delete_count: 0, errors, rows };
  }

  const products = new Map(
    (db.prepare('SELECT id, name FROM products WHERE deleted_at IS NULL').all() as Array<{ id: string; name: string }>)
      .map((product) => [product.id, product])
  );
  const dataRows = grid.slice(1);
  if (dataRows.length > MAX_WORKBOOK_DATA_ROWS) {
    errors.push({ row: 1, field: 'file', message: `Maksimal ${MAX_WORKBOOK_DATA_ROWS.toLocaleString('id-ID')} baris data per impor.` });
  }

  dataRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    if (raw.every((value) => !String(value ?? '').trim())) return;
    const id = textAt(raw, headers, 'id');
    if (!id) {
      errors.push({ row: rowNumber, field: 'id', message: 'ID produk wajib ada dan tidak boleh diubah.' });
      return;
    }
    const action = extractAction(raw, headers, rowNumber, errors);
    const product = products.get(id);
    if (!product) {
      errors.push({ row: rowNumber, field: 'id', message: `Produk dengan ID '${id}' tidak ditemukan atau sudah dihapus.` });
      return;
    }
    const values = {} as ProductUpdateRow['values'];
    if (action === 'DELETE') {
      rows.push({ row_number: rowNumber, id, action, values });
      return;
    }

    const name = textAt(raw, headers, 'name');
    const unit = textAt(raw, headers, 'unit');
    const category = textAt(raw, headers, 'category') || null;
    const barcode = textAt(raw, headers, 'barcode') || null;
    const sku = textAt(raw, headers, 'sku') || null;
    if (!name || name.length > 255) errors.push({ row: rowNumber, field: 'name', message: 'Nama wajib diisi (maksimal 255 karakter).' });
    if (!unit || unit.length > 30) errors.push({ row: rowNumber, field: 'unit', message: 'Satuan wajib diisi (maksimal 30 karakter).' });
    if (barcode && (barcode.length > 128 || /[\x00-\x1F\x7F]/.test(barcode))) errors.push({ row: rowNumber, field: 'barcode', message: 'Barcode maksimal 128 karakter dan tidak boleh berisi karakter kontrol.' });
    if (sku && sku.length > 64) errors.push({ row: rowNumber, field: 'sku', message: 'SKU maksimal 64 karakter.' });
    if (category && category.length > 100) errors.push({ row: rowNumber, field: 'category', message: 'Kategori maksimal 100 karakter.' });
    const allowDecimal = parseBoolean(textAt(raw, headers, 'allow_decimal'), 'allow_decimal', rowNumber, errors);
    const trackInventory = parseBoolean(textAt(raw, headers, 'track_inventory'), 'track_inventory', rowNumber, errors);
    const isActive = parseBoolean(textAt(raw, headers, 'is_active'), 'is_active', rowNumber, errors);
    const cost = parseNonNegativeNumber(textAt(raw, headers, 'cost_price'), 'cost_price', rowNumber, errors);
    const price = parseNonNegativeNumber(textAt(raw, headers, 'selling_price'), 'selling_price', rowNumber, errors);
    const memberPrice = parseNonNegativeNumber(textAt(raw, headers, 'member_price'), 'member_price', rowNumber, errors, true);
    const stock = parseNonNegativeDecimal(textAt(raw, headers, 'stock_quantity'), 'stock_quantity', rowNumber, errors);
    const threshold = parseNonNegativeDecimal(textAt(raw, headers, 'low_stock_threshold'), 'low_stock_threshold', rowNumber, errors);
    const reorder = parseNonNegativeDecimal(textAt(raw, headers, 'min_reorder_qty'), 'min_reorder_qty', rowNumber, errors);
    if (!allowDecimal && stock !== null && !Number.isInteger(stock)) {
      errors.push({ row: rowNumber, field: 'stock_quantity', message: 'Stok harus bilangan bulat jika allow_decimal=0.' });
    }
    values.barcode = barcode;
    values.sku = sku;
    values.name = name;
    values.category = category;
    values.unit = unit;
    values.allow_decimal = allowDecimal;
    values.cost_price = cost ?? 0;
    values.selling_price = price ?? 0;
    values.member_price = memberPrice;
    values.stock_quantity = stock ?? 0;
    values.low_stock_threshold = threshold ?? 0;
    values.min_reorder_qty = reorder ?? 0;
    values.track_inventory = trackInventory;
    values.is_active = isActive;
    values.description = textAt(raw, headers, 'description') || null;
    rows.push({ row_number: rowNumber, id, action, values });
  });
  uniqueRowIds(rows, errors);
  const valid = errors.length === 0 && rows.length > 0;
  return {
    valid,
    total_rows: dataRows.length,
    valid_rows_count: errors.length ? 0 : rows.length,
    error_rows_count: errors.length,
    update_count: rows.filter((row) => row.action === 'UPDATE').length,
    delete_count: rows.filter((row) => row.action === 'DELETE').length,
    errors,
    rows,
  };
}

export function validateMemberWorkbook(db: Database.Database, grid: string[][]): WorkbookValidation<MemberUpdateRow> {
  const { headers, errors } = mapHeaders(grid, [
    'id', 'action', 'name', 'nik', 'employee_id', 'member_no', 'department', 'phone', 'email',
    'country_code', 'address', 'monthly_deduction_limit', 'outstanding_deduction_limit',
    'salary_deduction_enabled', 'is_active', 'notes',
  ]);
  const rows: MemberUpdateRow[] = [];
  if (errors.length) {
    return { valid: false, total_rows: Math.max(0, grid.length - 1), valid_rows_count: 0, error_rows_count: errors.length, update_count: 0, delete_count: 0, errors, rows };
  }
  const members = new Map(
    (db.prepare('SELECT id, name FROM customers WHERE is_member = 1').all() as Array<{ id: string; name: string }>)
      .map((member) => [member.id, member])
  );
  const dataRows = grid.slice(1);
  if (dataRows.length > MAX_WORKBOOK_DATA_ROWS) {
    errors.push({ row: 1, field: 'file', message: `Maksimal ${MAX_WORKBOOK_DATA_ROWS.toLocaleString('id-ID')} baris data per impor.` });
  }

  dataRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    if (raw.every((value) => !String(value ?? '').trim())) return;
    const id = textAt(raw, headers, 'id');
    if (!id) {
      errors.push({ row: rowNumber, field: 'id', message: 'ID anggota wajib ada dan tidak boleh diubah.' });
      return;
    }
    const action = extractAction(raw, headers, rowNumber, errors);
    if (!members.has(id)) {
      errors.push({ row: rowNumber, field: 'id', message: `Anggota dengan ID '${id}' tidak ditemukan.` });
      return;
    }
    const values = {} as MemberUpdateRow['values'];
    if (action === 'DELETE') {
      rows.push({ row_number: rowNumber, id, action, values });
      return;
    }

    const name = textAt(raw, headers, 'name');
    if (!name || name.length > 255) errors.push({ row: rowNumber, field: 'name', message: 'Nama wajib diisi (maksimal 255 karakter).' });
    const rawNik = textAt(raw, headers, 'nik');
    let nik: string | null = null;
    if (rawNik) {
      const result = validateNik(rawNik, true);
      if (!result.valid) errors.push({ row: rowNumber, field: 'nik', message: result.error || 'NIK tidak valid.' });
      else nik = normalizeNik(rawNik);
    }
    const employeeId = textAt(raw, headers, 'employee_id') || null;
    const memberNo = textAt(raw, headers, 'member_no') || null;
    const phoneRaw = textAt(raw, headers, 'phone');
    const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, '') : null;
    if (phone && (phone.length < 8 || phone.length > 20)) errors.push({ row: rowNumber, field: 'phone', message: 'Nomor telepon harus 8-20 digit.' });
    for (const [field, value] of [['employee_id', employeeId], ['member_no', memberNo]] as const) {
      if (value && value.length > 100) errors.push({ row: rowNumber, field, message: 'Maksimal 100 karakter.' });
    }
    const countryCode = textAt(raw, headers, 'country_code') || null;
    if (countryCode && !/^\+\d{1,4}$/.test(countryCode)) errors.push({ row: rowNumber, field: 'country_code', message: 'Kode negara harus menggunakan format +angka.' });
    for (const [field, value] of [
      ['name', name],
      ['department', textAt(raw, headers, 'department')],
      ['email', textAt(raw, headers, 'email')],
      ['address', textAt(raw, headers, 'address')],
      ['notes', textAt(raw, headers, 'notes')],
    ] as const) {
      if (value.length > (field === 'name' ? 255 : 500)) {
        errors.push({ row: rowNumber, field, message: 'Teks melebihi panjang maksimum yang diizinkan.' });
      }
    }
    const email = textAt(raw, headers, 'email');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ row: rowNumber, field: 'email', message: 'Format email tidak valid.' });
    }
    const monthlyLimit = parseNonNegativeNumber(textAt(raw, headers, 'monthly_deduction_limit'), 'monthly_deduction_limit', rowNumber, errors);
    const outstandingLimit = parseNonNegativeNumber(textAt(raw, headers, 'outstanding_deduction_limit'), 'outstanding_deduction_limit', rowNumber, errors);
    const deductionEnabled = parseBoolean(textAt(raw, headers, 'salary_deduction_enabled'), 'salary_deduction_enabled', rowNumber, errors);
    const isActive = parseBoolean(textAt(raw, headers, 'is_active'), 'is_active', rowNumber, errors);
    if (monthlyLimit !== null && !Number.isInteger(monthlyLimit)) errors.push({ row: rowNumber, field: 'monthly_deduction_limit', message: 'Limit harus berupa Rupiah bilangan bulat.' });
    if (outstandingLimit !== null && !Number.isInteger(outstandingLimit)) errors.push({ row: rowNumber, field: 'outstanding_deduction_limit', message: 'Limit harus berupa Rupiah bilangan bulat.' });
    values.name = name;
    values.nik = nik;
    values.employee_id = employeeId;
    values.member_no = memberNo;
    values.department = textAt(raw, headers, 'department') || null;
    values.phone = phone;
    values.email = email || null;
    values.country_code = countryCode;
    values.address = textAt(raw, headers, 'address') || null;
    values.monthly_deduction_limit = monthlyLimit ?? 0;
    values.outstanding_deduction_limit = outstandingLimit ?? 0;
    values.salary_deduction_enabled = deductionEnabled;
    values.is_active = isActive;
    values.notes = textAt(raw, headers, 'notes') || null;
    rows.push({ row_number: rowNumber, id, action, values });
  });
  uniqueRowIds(rows, errors);

  if (errors.length === 0) {
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const existingIdentifiers = new Map<string, string>();
    const addExistingIdentifier = (field: string, value: string | null, id: string) => {
      if (!value) return;
      const key = `${field}:${value.trim().toLowerCase()}`;
      if (!existingIdentifiers.has(key)) existingIdentifiers.set(key, id);
    };
    const existing = db.prepare(`
      SELECT c.id, c.nik, c.employee_id, c.member_no,
        EXISTS(SELECT 1 FROM orders o WHERE o.customer_id = c.id) AS has_orders,
        EXISTS(SELECT 1 FROM salary_deductions s WHERE s.member_id = c.id) AS has_deductions,
        EXISTS(SELECT 1 FROM customer_consent_logs l WHERE l.customer_id = c.id) AS has_consent_logs
      FROM customers c
    `).all() as Array<{
      id: string; nik: string | null; employee_id: string | null; member_no: string | null;
      has_orders: number; has_deductions: number; has_consent_logs: number;
    }>;
    for (const member of existing) {
      const row = rowById.get(member.id);
      const identifiersRemain = !row
        || row.action === 'DELETE' && (member.has_orders > 0 || member.has_deductions > 0 || member.has_consent_logs > 0);
      if (!identifiersRemain) continue;
      addExistingIdentifier('nik', member.nik, member.id);
      addExistingIdentifier('employee_id', member.employee_id, member.id);
      addExistingIdentifier('member_no', member.member_no, member.id);
    }
    const importedIdentifiers = new Map<string, number>();
    for (const row of rows) {
      if (row.action === 'DELETE') continue;
      for (const field of ['nik', 'employee_id', 'member_no'] as const) {
        const value = row.values[field];
        if (!value) continue;
        const key = `${field}:${value.trim().toLowerCase()}`;
        const existingId = existingIdentifiers.get(key);
        if (existingId && existingId !== row.id) {
          errors.push({ row: row.row_number, field, message: `Nilai '${value}' sudah digunakan anggota lain.` });
        }
        const firstRow = importedIdentifiers.get(key);
        if (firstRow !== undefined) {
          errors.push({ row: row.row_number, field, message: `Nilai '${value}' bentrok dengan data baris ${firstRow}.` });
        } else {
          importedIdentifiers.set(key, row.row_number);
        }
      }
    }
  }

  return {
    valid: errors.length === 0 && rows.length > 0,
    total_rows: dataRows.length,
    valid_rows_count: errors.length ? 0 : rows.length,
    error_rows_count: errors.length,
    update_count: rows.filter((row) => row.action === 'UPDATE').length,
    delete_count: rows.filter((row) => row.action === 'DELETE').length,
    errors,
    rows,
  };
}

export function executeProductWorkbookImport(
  db: Database.Database,
  rows: ProductUpdateRow[],
  userId: string,
  userRole: string
): { updated_count: number; deleted_count: number; stock_adjustments: number } {
  const batchId = `PRODUCT-XLSX-${Date.now()}`;
  const transaction = db.transaction(() => {
    const categories = new Map<string, string>();
    for (const category of db.prepare('SELECT id, name FROM categories WHERE deleted_at IS NULL').all() as Array<{ id: string; name: string }>) {
      categories.set(category.name.trim().toLowerCase(), category.id);
    }
    const units = new Set(
      (db.prepare('SELECT name FROM product_units').all() as Array<{ name: string }>)
        .map(({ name }) => name.trim().toLowerCase())
    );
    let updatedCount = 0;
    let deletedCount = 0;
    let stockAdjustments = 0;
    const currentTime = now();

    for (const row of rows) {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND deleted_at IS NULL').get(row.id) as Record<string, any>;
      if (!product) throw new Error(`Produk ID ${row.id} berubah atau sudah dihapus. Impor dibatalkan.`);
      if (row.action === 'DELETE') {
        db.prepare('UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?').run(currentTime, currentTime, row.id);
        deletedCount++;
        continue;
      }

      const value = row.values;
      let categoryId: string | null = null;
      if (value.category) {
        const key = value.category.trim().toLowerCase();
        categoryId = categories.get(key) ?? null;
        if (!categoryId) {
          categoryId = uuidv4();
          db.prepare(`INSERT INTO categories (id, name, description, is_active, created_at, updated_at)
            VALUES (?, ?, 'Kategori dari impor massal Excel', 1, ?, ?)`)
            .run(categoryId, value.category.trim(), currentTime, currentTime);
          categories.set(key, categoryId);
        }
      }
      if (!units.has(value.unit.toLowerCase())) {
        db.prepare('INSERT OR IGNORE INTO product_units (id, name, created_at) VALUES (?, ?, ?)')
          .run(uuidv4(), value.unit, currentTime);
        units.add(value.unit.toLowerCase());
      }

      const oldStock = Number(product.stock_quantity ?? 0);
      const quantityChange = value.stock_quantity - oldStock;
      const oldTracking = Number(product.track_inventory ?? 0) === 1;
      const newTracking = value.track_inventory === 1;

      if (quantityChange !== 0 && !oldTracking && newTracking) {
        db.prepare('UPDATE products SET track_inventory = 1 WHERE id = ?').run(row.id);
      }
      if (quantityChange !== 0 && (oldTracking || newTracking)) {
        const movement = executeStockMovement(db, {
          productId: row.id,
          movementType: 'adjustment',
          quantityChange,
          unitCost: value.cost_price,
          referenceType: 'excel_bulk_update',
          referenceId: batchId,
          notes: `Penyesuaian stok melalui workbook massal baris ${row.row_number}`,
          createdBy: userId,
        });
        if (!movement.success) throw new Error(`Gagal memperbarui stok produk '${product.name}': ${movement.error}`);
        stockAdjustments++;
      }
      db.prepare(`
        UPDATE products SET category_id = ?, name = ?, sku = ?, barcode = ?, description = ?,
          price = ?, cost = ?, member_price = ?, unit = ?, allow_decimal = ?,
          track_inventory = ?, stock_quantity = ?, low_stock_threshold = ?, min_reorder_qty = ?,
          is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        categoryId, value.name, value.sku, value.barcode, value.description,
        value.selling_price, value.cost_price, value.member_price, value.unit,
        value.allow_decimal, value.track_inventory, value.stock_quantity,
        value.low_stock_threshold, value.min_reorder_qty, value.is_active,
        currentTime, row.id
      );
      updatedCount++;
    }
    createAuditLog(db, {
      actor_user_id: userId,
      actor_role: userRole,
      action: 'product.bulk_workbook_imported',
      target_type: 'product_catalog',
      target_id: batchId,
      details: { batch_id: batchId, updated_count: updatedCount, deleted_count: deletedCount, stock_adjustments: stockAdjustments },
    });
    return { updated_count: updatedCount, deleted_count: deletedCount, stock_adjustments: stockAdjustments };
  });
  return transaction();
}

export function executeMemberWorkbookImport(
  db: Database.Database,
  rows: MemberUpdateRow[],
  userId: string,
  userRole: string
): { updated_count: number; deleted_count: number; archived_count: number } {
  const batchId = `MEMBER-XLSX-${Date.now()}`;
  const transaction = db.transaction(() => {
    let updatedCount = 0;
    let deletedCount = 0;
    let archivedCount = 0;
    const currentTime = now();

    for (const row of rows.filter((item) => item.action === 'DELETE')) {
      const member = db.prepare('SELECT * FROM customers WHERE id = ? AND is_member = 1').get(row.id) as Record<string, any>;
      if (!member) throw new Error(`Anggota ID ${row.id} berubah atau tidak ditemukan. Impor dibatalkan.`);
      const orderCount = (db.prepare('SELECT COUNT(*) AS count FROM orders WHERE customer_id = ?').get(row.id) as { count: number }).count;
      const deductionCount = (db.prepare('SELECT COUNT(*) AS count FROM salary_deductions WHERE member_id = ?').get(row.id) as { count: number }).count;
      const consentCount = (db.prepare('SELECT COUNT(*) AS count FROM customer_consent_logs WHERE customer_id = ?').get(row.id) as { count: number }).count;
      if (orderCount === 0 && deductionCount === 0 && consentCount === 0) {
        db.prepare('DELETE FROM loyalty_ledger WHERE customer_id = ?').run(row.id);
        db.prepare('DELETE FROM customers WHERE id = ?').run(row.id);
        deletedCount++;
      } else {
        db.prepare(`UPDATE customers SET is_active = 0, salary_deduction_enabled = 0, updated_at = ? WHERE id = ?`)
          .run(currentTime, row.id);
        archivedCount++;
      }
    }

    const updateRows = rows.filter((row) => row.action === 'UPDATE');
    const updateMemberIds = updateRows.map((row) => row.id);
    for (let offset = 0; offset < updateMemberIds.length; offset += 500) {
      const chunk = updateMemberIds.slice(offset, offset + 500);
      const placeholders = chunk.map(() => '?').join(',');
      db.prepare(`UPDATE customers SET nik = NULL, employee_id = NULL, member_no = NULL WHERE id IN (${placeholders})`).run(...chunk);
    }
    for (const row of updateRows) {
      const member = db.prepare('SELECT id FROM customers WHERE id = ? AND is_member = 1').get(row.id);
      if (!member) throw new Error(`Anggota ID ${row.id} berubah atau tidak ditemukan. Impor dibatalkan.`);
      const value = row.values;
      db.prepare(`
        UPDATE customers SET name = ?, nik = ?, employee_id = ?, member_no = ?,
          department = ?, phone = ?, email = ?, country_code = ?, address = ?,
          monthly_deduction_limit = ?, outstanding_deduction_limit = ?,
          salary_deduction_enabled = ?, is_active = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(
        value.name, value.nik, value.employee_id, value.member_no,
        value.department, value.phone, value.email, value.country_code, value.address,
        value.monthly_deduction_limit, value.outstanding_deduction_limit,
        value.salary_deduction_enabled, value.is_active, value.notes,
        currentTime, row.id
      );
      updatedCount++;
    }
    createAuditLog(db, {
      actor_user_id: userId,
      actor_role: userRole,
      action: 'member.bulk_workbook_imported',
      target_type: 'member',
      target_id: batchId,
      details: { batch_id: batchId, updated_count: updatedCount, deleted_count: deletedCount, archived_count: archivedCount },
    });
    return { updated_count: updatedCount, deleted_count: deletedCount, archived_count: archivedCount };
  });
  return transaction();
}
