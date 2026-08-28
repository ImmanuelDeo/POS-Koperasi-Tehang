import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { normalizeNik, validateNik, maskNik } from './privacy';
import { createAuditLog } from './audit';
import { now } from '../db';

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
 * Generate standard CSV template for cooperative member import
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
      '6472010101900001',
      'EMP-001',
      'MBR-1001',
      'Produksi',
      '081234567890',
      'ahmad@koperasi.local',
      'Perumahan Karyawan Blok A1',
      '500000',
      '1',
      '1',
      'Staff Senior Pabrik',
    ],
    [
      'Siti Nurhaliza',
      '6472010202920002',
      'EMP-002',
      'MBR-1002',
      'Gudang',
      '081298765432',
      'siti@koperasi.local',
      'Perumahan Karyawan Blok B4',
      '750000',
      '1',
      '1',
      'Supervisor Logistik',
    ],
    [
      'Budi Santoso',
      '6472010303880003',
      'EMP-003',
      'MBR-1003',
      'Keuangan & HR',
      '085612345678',
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
      'EMP-004',
      'MBR-1004',
      'Umum',
      '087812349988',
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
 * Helper to split CSV lines while respecting quoted fields containing newlines or commas
 */
function parseCsvLines(csvText: string): string[][] {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Detect delimiter (, or ;) from first line
  const firstLine = normalized.split('\n')[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const nextChar = normalized[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
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
 * Validate Member CSV text against database constraints
 */
export function validateMemberCsv(db: Database.Database, csvContent: string): MemberCsvValidationResult {
  const rawRows = parseCsvLines(csvContent);

  if (rawRows.length === 0) {
    return {
      valid: false,
      total_rows: 0,
      valid_count: 0,
      error_count: 1,
      rows: [],
      errors: [{ row_number: 1, field: 'csv', message: 'File CSV kosong atau tidak memiliki data' }],
    };
  }

  const rawHeader = rawRows[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const dataRows = rawRows.slice(1);

  // Map header indexes
  const colMap: Record<string, number> = {};
  rawHeader.forEach((h, idx) => {
    if (['nama', 'name', 'namamember', 'namalengkap'].includes(h)) colMap.name = idx;
    else if (['nik', 'nikktp', 'nomorktp'].includes(h)) colMap.nik = idx;
    else if (['nikkaryawan', 'employeeid', 'empid', 'idkaryawan'].includes(h)) colMap.employee_id = idx;
    else if (['nomoranggota', 'memberno', 'noanggota', 'idmember'].includes(h)) colMap.member_no = idx;
    else if (['departemen', 'department', 'divisi', 'dept'].includes(h)) colMap.department = idx;
    else if (['nohp', 'phone', 'telepon', 'notelepon', 'whatsapp', 'wa'].includes(h)) colMap.phone = idx;
    else if (['email', 'surel'].includes(h)) colMap.email = idx;
    else if (['alamat', 'address'].includes(h)) colMap.address = idx;
    else if (['limitbulanan', 'monthlydeductionlimit', 'limit', 'limitpotongangaji', 'limitgaji'].includes(h)) colMap.limit = idx;
    else if (['potonggajiaktif', 'salarydeductionenabled', 'potonggaji', 'statusbon', 'bonaktif'].includes(h)) colMap.salary_deduction_enabled = idx;
    else if (['optinwhatsapp', 'optinwa', 'whatsapppromo', 'promowa', 'optinpromowa', 'optin'].includes(h)) colMap.whatsapp_optin = idx;
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
          message: "Header CSV wajib memiliki kolom nama/name (contoh: 'nama,nik,nik_karyawan,nomor_anggota,limit_bulanan')",
        },
      ],
    };
  }

  // Pre-load existing database identifiers to prevent duplicates
  const existingNiks = new Set<string>(
    (db.prepare("SELECT nik FROM customers WHERE nik IS NOT NULL AND nik != ''").all() as { nik: string }[]).map((r) => r.nik)
  );
  const existingEmpIds = new Set<string>(
    (db.prepare("SELECT employee_id FROM customers WHERE employee_id IS NOT NULL AND employee_id != ''").all() as { employee_id: string }[]).map((r) => r.employee_id.toLowerCase())
  );
  const existingMemberNos = new Set<string>(
    (db.prepare("SELECT member_no FROM customers WHERE member_no IS NOT NULL AND member_no != ''").all() as { member_no: string }[]).map((r) => r.member_no.toLowerCase())
  );

  const seenCsvNiks = new Set<string>();
  const seenCsvEmpIds = new Set<string>();
  const seenCsvMemberNos = new Set<string>();

  const validatedRows: ValidatedMemberRow[] = [];
  const errors: MemberCsvError[] = [];

  dataRows.forEach((row, index) => {
    const rowNum = index + 2; // 1-based, accounts for header row

    // Skip blank rows
    if (row.every((f) => f.trim().length === 0)) return;

    const rawName = colMap.name !== undefined ? (row[colMap.name] || '').trim() : '';
    const rawNik = colMap.nik !== undefined ? (row[colMap.nik] || '').trim() : '';
    const rawEmpId = colMap.employee_id !== undefined ? (row[colMap.employee_id] || '').trim() : '';
    const rawMemberNo = colMap.member_no !== undefined ? (row[colMap.member_no] || '').trim() : '';
    const rawDept = colMap.department !== undefined ? (row[colMap.department] || '').trim() : '';
    const rawPhone = colMap.phone !== undefined ? (row[colMap.phone] || '').trim() : '';
    const rawEmail = colMap.email !== undefined ? (row[colMap.email] || '').trim() : '';
    const rawAddress = colMap.address !== undefined ? (row[colMap.address] || '').trim() : '';
    const rawLimit = colMap.limit !== undefined ? (row[colMap.limit] || '').trim() : '';
    const rawDeductEnabled = colMap.salary_deduction_enabled !== undefined ? (row[colMap.salary_deduction_enabled] || '').trim() : '';
    const rawWhatsappOptin = colMap.whatsapp_optin !== undefined ? (row[colMap.whatsapp_optin] || '').trim() : '';
    const rawNotes = colMap.notes !== undefined ? (row[colMap.notes] || '').trim() : '';

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
          errors.push({ row_number: rowNum, field: 'nik', message: `NIK '${cleanNik}' duplikat dalam file CSV ini`, value: cleanNik });
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
      const lowerEmp = cleanEmpId.toLowerCase();
      if (seenCsvEmpIds.has(lowerEmp)) {
        errors.push({ row_number: rowNum, field: 'nik_karyawan', message: `NIK Karyawan (Employee ID) '${cleanEmpId}' duplikat dalam file CSV`, value: cleanEmpId });
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
      const lowerNo = cleanMemberNo.toLowerCase();
      if (seenCsvMemberNos.has(lowerNo)) {
        errors.push({ row_number: rowNum, field: 'nomor_anggota', message: `Nomor anggota '${cleanMemberNo}' duplikat dalam file CSV`, value: cleanMemberNo });
        rowHasError = true;
      } else if (existingMemberNos.has(lowerNo)) {
        errors.push({ row_number: rowNum, field: 'nomor_anggota', message: `Nomor anggota '${cleanMemberNo}' sudah terdaftar di database`, value: cleanMemberNo });
        rowHasError = true;
      } else {
        seenCsvMemberNos.add(lowerNo);
      }
    }

    // 5. Parse Monthly Deduction Limit
    let monthlyLimit = 0;
    if (rawLimit) {
      const cleanedLimit = rawLimit.replace(/[^0-9]/g, '');
      const parsedLimit = Number(cleanedLimit);
      if (isNaN(parsedLimit) || parsedLimit < 0) {
        errors.push({ row_number: rowNum, field: 'limit_bulanan', message: 'Limit bulanan harus berupa angka rupiah positif (0 = bebas limit)', value: rawLimit });
        rowHasError = true;
      } else {
        monthlyLimit = Math.round(parsedLimit);
      }
    }

    // 6. Parse Salary Deduction Enabled
    let deductEnabled = 1;
    if (rawDeductEnabled) {
      const val = rawDeductEnabled.toLowerCase();
      if (['0', 'false', 'tidak', 'nonaktif', 'no', 'off'].includes(val)) {
        deductEnabled = 0;
      }
    }

    // 7. Parse WhatsApp Marketing Opt-In (default 0)
    let waOptIn = 0;
    if (rawWhatsappOptin) {
      const val = rawWhatsappOptin.toLowerCase();
      if (['1', 'true', 'ya', 'yes', 'setuju', 'aktif', 'optin'].includes(val)) {
        waOptIn = 1;
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
        phone: rawPhone || null,
        email: rawEmail || null,
        address: rawAddress || null,
        monthly_deduction_limit: monthlyLimit,
        salary_deduction_enabled: deductEnabled,
        whatsapp_marketing_opt_in: waOptIn,
        notes: rawNotes || null,
      });
    }
  });

  return {
    valid: errors.length === 0,
    total_rows: dataRows.length,
    valid_count: validatedRows.length,
    error_count: errors.length,
    rows: validatedRows,
    errors,
  };
}

/**
 * Execute atomic database insertion for validated member rows
 */
export function executeMemberImport(
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

    for (const row of rows) {
      const id = uuidv4();
      const memberNo = row.member_no || `MBR-${Math.floor(1000 + Math.random() * 9000)}`;
      const optInAt = row.whatsapp_marketing_opt_in === 1 ? currentTime : null;
      const optInSource = row.whatsapp_marketing_opt_in === 1 ? 'csv_import' : null;
      const policyVer = row.whatsapp_marketing_opt_in === 1 ? 'v1.0-2026' : null;

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

      if (row.whatsapp_marketing_opt_in === 1) {
        insertConsentLog.run(id, actorUserId || null, currentTime);
      }
      createdCount++;
    }

    createAuditLog(db, {
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action: 'member.csv_imported',
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
