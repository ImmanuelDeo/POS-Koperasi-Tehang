import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { normalizeNik, validateNik, maskNik } from './privacy';
import { createAuditLog } from './audit';
import { now } from '../db';
import { findMemberIdentifierConflict } from './member-identifiers';

export interface ValidatedMemberRow {
  row_number: number;
  name: string;
  nik: string | null;
  nik_masked: string | null;
  employee_id: string | null;
  member_no: string | null;
  department: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  monthly_deduction_limit: number;
  salary_deduction_enabled: number;
  whatsapp_marketing_opt_in: number;
  notes: string | null;
}

export interface MemberCsvError {
  row_number: number;
  field: string;
  message: string;
  value?: string;
}

export interface MemberCsvValidationResult {
  valid: boolean;
  total_rows: number;
  valid_count: number;
  error_count: number;
  rows: ValidatedMemberRow[];
  errors: MemberCsvError[];
}

export interface MemberCsvImportResult {
  created_members_count: number;
  total_processed: number;
}

/**
 * Generate standard CSV template for cooperative member import with formula text-force
 */
export function generateMemberCsvTemplate(): string {
  const headers = [
    'nama',
    'nik',
    'nik_karyawan',
    'nomor_anggota',
    'departemen',
    'no_hp',
    'email',
    'alamat',
    'limit_bulanan',
    'potong_gaji_aktif',
    'opt_in_whatsapp_promo',
    'catatan',
  ];

  const sampleRows = [
    [
      'Ahmad Subarjo',
      '="6472010101900001"',
      '="EMP-001"',
      '="MBR-1001"',
      'Produksi',
      '="081234567890"',
      'ahmad@koperasi.local',
      'Perumahan Karyawan Blok A1',
      '500000',
      '1',
      '1',
      'Staff Senior Pabrik',
    ],
    [
      'Siti Nurhaliza',
      '="6472010202920002"',
      '="EMP-002"',
      '="MBR-1002"',
      'Gudang',
      '="081298765432"',
      'siti@koperasi.local',
      'Perumahan Karyawan Blok B4',
      '750000',
      '1',
      '1',
      'Supervisor Logistik',
    ],
    [
      'Budi Santoso',
      '="6472010303880003"',
      '="EMP-003"',
      '="MBR-1003"',
      'Keuangan & HR',
      '="085612345678"',
      'budi@koperasi.local',
      'Jl. Melati No. 12',
      '1000000',
      '1',
      '0',
      'Staff HRD',
    ],
    [
      'Dewi Lestari',
      '',
      '="EMP-004"',
      '="MBR-1004"',
      'Umum',
      '="087812349988"',
      'dewi@koperasi.local',
      '',
      '0',
      '1',
      '1',
      'Member Toko Sembako',
    ],
  ];

  const formatLine = (arr: string[]) =>
    arr.map((val) => `"${val.replace(/"/g, '""')}"`).join(',');

  return [formatLine(headers), ...sampleRows.map(formatLine)].join('\r\n') + '\r\n';
}

/**
 * Generate standard XLSX Excel template for cooperative member import with explicit Text Cell Formatting (@)
 * ensuring NIK, employee_id, member_no, and phone never lose leading zeroes.
 */
export async function generateMemberXlsxTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'POS Koperasi';
  workbook.lastModifiedBy = 'POS Koperasi';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Data Anggota');

  worksheet.columns = [
    { header: 'Nama Lengkap', key: 'name', width: 28 },
    { header: 'NIK (16 Digit)', key: 'nik', width: 22 },
    { header: 'NIK Karyawan (Emp ID)', key: 'employee_id', width: 22 },
    { header: 'Nomor Anggota', key: 'member_no', width: 18 },
    { header: 'Departemen / Divisi', key: 'department', width: 22 },
    { header: 'No HP / WhatsApp', key: 'phone', width: 20 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Alamat', key: 'address', width: 32 },
    { header: 'Limit Bulanan (Rp)', key: 'monthly_deduction_limit', width: 20 },
    { header: 'Potong Gaji Aktif (0/1)', key: 'salary_deduction_enabled', width: 22 },
    { header: 'Opt-in Promo WA (0/1)', key: 'whatsapp_marketing_opt_in', width: 22 },
    { header: 'Catatan', key: 'notes', width: 25 },
  ];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 28;

  const sampleMembers = [
    {
      name: 'Ahmad Subarjo',
      nik: '6472010101900001',
      employee_id: 'EMP-001',
      member_no: 'MBR-1001',
      department: 'Produksi',
      phone: '081234567890',
      email: 'ahmad@koperasi.local',
      address: 'Perumahan Karyawan Blok A1',
      monthly_deduction_limit: 500000,
      salary_deduction_enabled: 1,
      whatsapp_marketing_opt_in: 1,
      notes: 'Staff Senior Pabrik',
    },
    {
      name: 'Siti Nurhaliza',
      nik: '6472010202920002',
      employee_id: 'EMP-002',
      member_no: 'MBR-1002',
      department: 'Gudang',
      phone: '081298765432',
      email: 'siti@koperasi.local',
      address: 'Perumahan Karyawan Blok B4',
      monthly_deduction_limit: 750000,
      salary_deduction_enabled: 1,
      whatsapp_marketing_opt_in: 1,
      notes: 'Supervisor Logistik',
    },
    {
      name: 'Budi Santoso',
      nik: '6472010303880003',
      employee_id: 'EMP-003',
      member_no: 'MBR-1003',
      department: 'Keuangan & HR',
      phone: '085612345678',
      email: 'budi@koperasi.local',
      address: 'Jl. Melati No. 12',
      monthly_deduction_limit: 1000000,
      salary_deduction_enabled: 1,
      whatsapp_marketing_opt_in: 0,
      notes: 'Staff HRD',
    },
    {
      name: 'Dewi Lestari',
      nik: '',
      employee_id: 'EMP-004',
      member_no: 'MBR-1004',
      department: 'Umum',
      phone: '087812349988',
      email: 'dewi@koperasi.local',
      address: '',
      monthly_deduction_limit: 0,
      salary_deduction_enabled: 1,
      whatsapp_marketing_opt_in: 1,
      notes: 'Member Toko Sembako',
    },
  ];

  for (const m of sampleMembers) {
    const row = worksheet.addRow(m);
    row.getCell('nik').numFmt = '@';
    row.getCell('employee_id').numFmt = '@';
    row.getCell('member_no').numFmt = '@';
    row.getCell('phone').numFmt = '@';
  }

  worksheet.getColumn('nik').numFmt = '@';
  worksheet.getColumn('employee_id').numFmt = '@';
  worksheet.getColumn('member_no').numFmt = '@';
  worksheet.getColumn('phone').numFmt = '@';

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Parses XLSX buffer for Member import preserving raw strings with leading zeroes
 */
export async function parseMemberXlsxBuffer(buffer: Buffer): Promise<string[][]> {
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
 * Helper to split CSV lines while respecting quoted fields containing newlines or commas
 */
export function parseCsvLines(csvText: string): string[][] {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const firstLine = normalized.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const nextChar = normalized[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if (char === '\n' && !insideQuotes) {
      currentRow.push(currentField);
      if (currentRow.some((f) => f.trim().length > 0)) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((f) => f.trim().length > 0)) {
      lines.push(currentRow);
    }
  }

  return lines;
}

/**
 * Validate Member Grid data (CSV or XLSX) against database constraints
 */
export function validateMemberGrid(db: Database.Database, rawRows: string[][]): MemberCsvValidationResult {
  if (rawRows.length === 0) {
    return {
      valid: false,
      total_rows: 0,
      valid_count: 0,
      error_count: 1,
      rows: [],
      errors: [{ row_number: 1, field: 'file', message: 'File kosong atau tidak memiliki data' }],
    };
  }

  const rawHeader = rawRows[0].map((h) => h.trim().toLowerCase().replace(/[\s_()\-]+/g, ''));
  const dataRows = rawRows.slice(1);

  // Map header indexes
  const colMap: Record<string, number> = {};
  rawHeader.forEach((h, idx) => {
    if (['nama', 'name', 'namamember', 'namalengkap'].includes(h) || h.startsWith('nama')) colMap.name = idx;
    else if (['nik', 'nikktp', 'nomorktp', 'nik16digit'].includes(h) || h.startsWith('nik16')) colMap.nik = idx;
    else if (['nikkaryawan', 'employeeid', 'empid', 'idkaryawan', 'nikkaryawanempid'].includes(h) || h.startsWith('nikkaryawan')) colMap.employee_id = idx;
    else if (['nomoranggota', 'memberno', 'noanggota', 'idmember'].includes(h) || h.startsWith('nomoranggota')) colMap.member_no = idx;
    else if (['departemen', 'department', 'divisi', 'dept', 'departemendivisi'].includes(h) || h.startsWith('departemen')) colMap.department = idx;
    else if (['nohp', 'phone', 'telepon', 'notelepon', 'whatsapp', 'wa', 'nohpwhatsapp'].includes(h) || h.startsWith('nohp')) colMap.phone = idx;
    else if (['email', 'surel'].includes(h)) colMap.email = idx;
    else if (['alamat', 'address'].includes(h)) colMap.address = idx;
    else if (['limitbulanan', 'monthlydeductionlimit', 'limit', 'limitpotongangaji', 'limitgaji', 'limitbulananrp'].includes(h) || h.startsWith('limitbulanan')) colMap.limit = idx;
    else if (['potonggajiaktif', 'salarydeductionenabled', 'potonggaji', 'statusbon', 'bonaktif', 'potonggajiaktif01'].includes(h) || h.startsWith('potonggajiaktif')) colMap.salary_deduction_enabled = idx;
    else if (['optinwhatsapp', 'optinwa', 'whatsapppromo', 'promowa', 'optinpromowa', 'optin', 'optinpromowa01'].includes(h) || h.startsWith('optinpromo')) colMap.whatsapp_optin = idx;
    else if (['catatan', 'notes', 'keterangan'].includes(h)) colMap.notes = idx;
  });

  if (colMap.name === undefined) {
    return {
      valid: false,
      total_rows: dataRows.length,
      valid_count: 0,
      error_count: 1,
      rows: [],
      errors: [
        {
          row_number: 1,
          field: 'header',
          message: "Header file wajib memiliki kolom nama (contoh: 'nama, nik, nik_karyawan, nomor_anggota, limit_bulanan')",
        },
      ],
    };
  }

  // Pre-load existing database identifiers to prevent duplicates
  const existingNiks = new Set<string>(
    (db.prepare("SELECT nik FROM customers WHERE nik IS NOT NULL AND TRIM(nik) != ''").all() as { nik: string }[]).map((r) => r.nik.trim())
  );
  const existingEmpIds = new Set<string>(
    (db.prepare("SELECT employee_id FROM customers WHERE employee_id IS NOT NULL AND TRIM(employee_id) != ''").all() as { employee_id: string }[]).map((r) => r.employee_id.trim().toLowerCase())
  );
  const existingMemberNos = new Set<string>(
    (db.prepare("SELECT member_no FROM customers WHERE member_no IS NOT NULL AND TRIM(member_no) != ''").all() as { member_no: string }[]).map((r) => r.member_no.trim().toLowerCase())
  );

  const seenCsvNiks = new Set<string>();
  const seenCsvEmpIds = new Set<string>();
  const seenCsvMemberNos = new Set<string>();

  const validatedRows: ValidatedMemberRow[] = [];
  const errors: MemberCsvError[] = [];

  dataRows.forEach((row, index) => {
    const rowNum = index + 2;

    // Skip blank rows
    if (row.every((f) => String(f).trim().length === 0)) return;

    const cleanField = (val: any) => {
      if (!val) return '';
      let s = String(val).trim();
      const formulaMatch = s.match(/^="([^"]+)"$/);
      if (formulaMatch) s = formulaMatch[1].trim();
      return s;
    };

    const rawName = colMap.name !== undefined ? cleanField(row[colMap.name]) : '';
    const rawNik = colMap.nik !== undefined ? cleanField(row[colMap.nik]) : '';
    const rawEmpId = colMap.employee_id !== undefined ? cleanField(row[colMap.employee_id]) : '';
    const rawMemberNo = colMap.member_no !== undefined ? cleanField(row[colMap.member_no]) : '';
    const rawDept = colMap.department !== undefined ? cleanField(row[colMap.department]) : '';
    const rawPhone = colMap.phone !== undefined ? cleanField(row[colMap.phone]) : '';
    const rawEmail = colMap.email !== undefined ? cleanField(row[colMap.email]) : '';
    const rawAddress = colMap.address !== undefined ? cleanField(row[colMap.address]) : '';
    const rawLimit = colMap.limit !== undefined ? cleanField(row[colMap.limit]) : '';
    const rawDeductEnabled = colMap.salary_deduction_enabled !== undefined ? cleanField(row[colMap.salary_deduction_enabled]) : '';
    const rawWhatsappOptin = colMap.whatsapp_optin !== undefined ? cleanField(row[colMap.whatsapp_optin]) : '';
    const rawNotes = colMap.notes !== undefined ? cleanField(row[colMap.notes]) : '';

    let rowHasError = false;

    // 1. Validate Name
    if (!rawName) {
      errors.push({ row_number: rowNum, field: 'nama', message: 'Nama lengkap member wajib diisi', value: rawName });
      rowHasError = true;
    }

    // 2. Validate NIK
    let cleanNik: string | null = null;
    let maskedNik: string | null = null;
    if (rawNik) {
      const nikCheck = validateNik(rawNik, true);
      if (!nikCheck.valid) {
        errors.push({ row_number: rowNum, field: 'nik', message: nikCheck.error || 'Format NIK tidak valid', value: rawNik });
        rowHasError = true;
      } else {
        cleanNik = nikCheck.normalized!;
        maskedNik = maskNik(cleanNik);

        if (seenCsvNiks.has(cleanNik)) {
          errors.push({ row_number: rowNum, field: 'nik', message: `NIK '${cleanNik}' duplikat dalam file ini`, value: cleanNik });
          rowHasError = true;
        } else if (existingNiks.has(cleanNik)) {
          errors.push({ row_number: rowNum, field: 'nik', message: `NIK '${cleanNik}' sudah terdaftar dalam database koperasi`, value: cleanNik });
          rowHasError = true;
        } else {
          seenCsvNiks.add(cleanNik);
        }
      }
    }

    // 3. Validate Employee ID
    let cleanEmpId: string | null = null;
    if (rawEmpId) {
      cleanEmpId = rawEmpId;
      const lowerEmp = cleanEmpId.trim().toLowerCase();
      if (seenCsvEmpIds.has(lowerEmp)) {
        errors.push({ row_number: rowNum, field: 'nik_karyawan', message: `NIK Karyawan (Employee ID) '${cleanEmpId}' duplikat dalam file`, value: cleanEmpId });
        rowHasError = true;
      } else if (existingEmpIds.has(lowerEmp)) {
        errors.push({ row_number: rowNum, field: 'nik_karyawan', message: `NIK Karyawan (Employee ID) '${cleanEmpId}' sudah ada di database`, value: cleanEmpId });
        rowHasError = true;
      } else {
        seenCsvEmpIds.add(lowerEmp);
      }
    }

    // 4. Validate Member No
    let cleanMemberNo: string | null = null;
    if (rawMemberNo) {
      cleanMemberNo = rawMemberNo;
      const lowerMbr = cleanMemberNo.trim().toLowerCase();
      if (seenCsvMemberNos.has(lowerMbr)) {
        errors.push({ row_number: rowNum, field: 'nomor_anggota', message: `Nomor Anggota '${cleanMemberNo}' duplikat dalam file`, value: cleanMemberNo });
        rowHasError = true;
      } else if (existingMemberNos.has(lowerMbr)) {
        errors.push({ row_number: rowNum, field: 'nomor_anggota', message: `Nomor Anggota '${cleanMemberNo}' sudah ada di database`, value: cleanMemberNo });
        rowHasError = true;
      } else {
        seenCsvMemberNos.add(lowerMbr);
      }
    }

    // 5. Validate Phone
    let cleanPhone: string | null = null;
    if (rawPhone) {
      const sanitizedPhone = rawPhone.replace(/[^\d+]/g, '');
      if (sanitizedPhone.length < 8 || sanitizedPhone.length > 20) {
        errors.push({ row_number: rowNum, field: 'no_hp', message: `Format nomor HP '${rawPhone}' tidak valid (8-20 digit)`, value: rawPhone });
        rowHasError = true;
      } else {
        cleanPhone = sanitizedPhone;
      }
    }

    // 6. Validate Limit
    let limitValue = 0;
    if (rawLimit) {
      const parsedLimit = Number(rawLimit.replace(/[^0-9.-]+/g, ''));
      if (isNaN(parsedLimit) || parsedLimit < 0) {
        errors.push({ row_number: rowNum, field: 'limit_bulanan', message: `Limit bulanan '${rawLimit}' harus angka positif >= 0`, value: rawLimit });
        rowHasError = true;
      } else {
        limitValue = parsedLimit;
      }
    }

    // 7. Validate Deduction Enabled
    let deductEnabledValue = 1;
    if (rawDeductEnabled) {
      const lower = rawDeductEnabled.toLowerCase();
      if (['1', 'true', 'ya', 'yes', 'aktif', 'y'].includes(lower)) {
        deductEnabledValue = 1;
      } else if (['0', 'false', 'tidak', 'no', 'nonaktif', 't', 'n'].includes(lower)) {
        deductEnabledValue = 0;
      } else {
        errors.push({ row_number: rowNum, field: 'potong_gaji_aktif', message: `Status potong gaji '${rawDeductEnabled}' harus 1 (Ya) atau 0 (Tidak)`, value: rawDeductEnabled });
        rowHasError = true;
      }
    }

    // 8. Validate WhatsApp Marketing Opt-In
    let waOptinValue = 1;
    if (rawWhatsappOptin) {
      const lower = rawWhatsappOptin.toLowerCase();
      if (['1', 'true', 'ya', 'yes', 'aktif', 'y'].includes(lower)) {
        waOptinValue = 1;
      } else if (['0', 'false', 'tidak', 'no', 'nonaktif', 't', 'n'].includes(lower)) {
        waOptinValue = 0;
      } else {
        errors.push({ row_number: rowNum, field: 'opt_in_whatsapp_promo', message: `Status opt-in WA '${rawWhatsappOptin}' harus 1 (Ya) atau 0 (Tidak)`, value: rawWhatsappOptin });
        rowHasError = true;
      }
    }

    if (!rowHasError) {
      validatedRows.push({
        row_number: rowNum,
        name: rawName,
        nik: cleanNik,
        nik_masked: maskedNik,
        employee_id: cleanEmpId,
        member_no: cleanMemberNo,
        department: rawDept || 'Umum',
        phone: cleanPhone,
        email: rawEmail || null,
        address: rawAddress || null,
        monthly_deduction_limit: limitValue,
        salary_deduction_enabled: deductEnabledValue,
        whatsapp_marketing_opt_in: waOptinValue,
        notes: rawNotes || null,
      });
    }
  });

  return {
    valid: errors.length === 0 && validatedRows.length > 0,
    total_rows: dataRows.length,
    valid_count: validatedRows.length,
    error_count: errors.length,
    rows: validatedRows,
    errors,
  };
}

/**
 * Validate Member CSV text against database constraints
 */
export function validateMemberCsv(db: Database.Database, csvContent: string): MemberCsvValidationResult {
  const rawRows = parseCsvLines(csvContent);
  return validateMemberGrid(db, rawRows);
}

/**
 * Execute Member CSV/XLSX Import atomically
 */
export function executeMemberCsvImport(
  db: Database.Database,
  rows: ValidatedMemberRow[],
  actorUserId?: string,
  actorRole?: string
): MemberCsvImportResult {
  const insertMember = db.prepare(`
    INSERT INTO customers (
      id, nik, name, phone, email, address, notes,
      is_member, member_no, employee_id, department,
      salary_deduction_enabled, monthly_deduction_limit, outstanding_deduction_limit,
      whatsapp_marketing_opt_in, whatsapp_marketing_opt_in_at, whatsapp_marketing_opt_in_source, whatsapp_marketing_policy_version,
      is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)
  `);

  const insertConsentLog = db.prepare(`
    INSERT INTO customer_consent_logs (
      customer_id, event_type, source, policy_version, actor_user_id, reason, created_at
    ) VALUES (?, 'OPT_IN', 'csv_import', 'v1.0-2026', ?, 'Explicit opt-in recorded during member CSV import', ?)
  `);

  const importTx = db.transaction(() => {
    let createdCount = 0;
    const currentTime = now();

    // Pre-load existing member_no (lowercased) agar nomor auto-generate tidak tabrakan UNIQUE
    const takenMemberNos = new Set<string>(
      (db.prepare("SELECT member_no FROM customers WHERE member_no IS NOT NULL AND TRIM(member_no) != ''").all() as { member_no: string }[]).map((r) => String(r.member_no).trim().toLowerCase())
    );
    const seenNiks = new Set<string>();
    const seenEmployeeIds = new Set<string>();

    const makeUniqueMemberNo = (preferred: string | null): string => {
      let candidate = preferred && preferred.trim().length > 0 ? preferred.trim() : '';
      if (!candidate) {
        do {
          candidate = `MBR-${Math.floor(100000 + Math.random() * 900000)}`;
        } while (takenMemberNos.has(candidate.toLowerCase()));
      } else if (takenMemberNos.has(candidate.toLowerCase())) {
        throw new Error(`Nomor anggota '${candidate}' sudah digunakan saat impor baris diproses`);
      }
      takenMemberNos.add(candidate.toLowerCase());
      return candidate;
    };

    for (const row of rows) {
      const id = uuidv4();
      const memberNo = makeUniqueMemberNo(row.member_no);
      if (row.nik && (seenNiks.has(row.nik) || findMemberIdentifierConflict(db, 'nik', row.nik))) {
        throw new Error(`NIK pada baris ${row.row_number} sudah digunakan oleh anggota lain. Impor dibatalkan.`);
      }
      if (row.employee_id && (seenEmployeeIds.has(row.employee_id.toLowerCase()) || findMemberIdentifierConflict(db, 'employee_id', row.employee_id))) {
        throw new Error(`NIK karyawan pada baris ${row.row_number} sudah digunakan oleh anggota lain. Impor dibatalkan.`);
      }
      if (row.member_no && findMemberIdentifierConflict(db, 'member_no', row.member_no)) {
        throw new Error(`Nomor anggota pada baris ${row.row_number} sudah digunakan oleh anggota lain. Impor dibatalkan.`);
      }
      const optInAt = row.whatsapp_marketing_opt_in === 1 ? currentTime : null;
      const optInSource = row.whatsapp_marketing_opt_in === 1 ? 'csv_import' : null;
      const policyVer = row.whatsapp_marketing_opt_in === 1 ? 'v1.0-2026' : null;

      try {
        insertMember.run(
          id,
          row.nik,
          row.name,
          row.phone,
          row.email,
          row.address,
          row.notes,
          memberNo,
          row.employee_id,
          row.department,
          row.salary_deduction_enabled,
          row.monthly_deduction_limit,
          row.whatsapp_marketing_opt_in,
          optInAt,
          optInSource,
          policyVer,
          currentTime,
          currentTime
        );
      } catch (error: any) {
        if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(error?.message || '').includes('UNIQUE constraint failed')) {
          throw new Error(`Konflik data unik pada baris ${row.row_number} (NIK, nomor anggota, atau NIK karyawan). Tidak ada data impor yang disimpan.`);
        }
        throw error;
      }

      if (row.nik) seenNiks.add(row.nik);
      if (row.employee_id) seenEmployeeIds.add(row.employee_id.toLowerCase());
      if (row.whatsapp_marketing_opt_in === 1) {
        insertConsentLog.run(id, actorUserId || null, currentTime);
      }
      createdCount++;
    }

    createAuditLog(db, {
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action: 'member.imported',
      target_type: 'member',
      details: JSON.stringify({
        total_rows_imported: createdCount,
        imported_at: now(),
      }),
    });

    return createdCount;
  });

  const createdMembersCount = importTx();

  return {
    created_members_count: createdMembersCount,
    total_processed: rows.length,
  };
}
