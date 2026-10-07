import { Router, Response } from 'express';
import { getDatabase } from '../db';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  generateMemberCsvTemplate,
  generateMemberXlsxTemplate,
  parseCsvLines,
  parseMemberXlsxBuffer,
  validateMemberGrid,
  executeMemberCsvImport,
} from '../services/member-csv';
import {
  executeMemberWorkbookImport,
  generateAllMembersWorkbook,
  parseEditableWorkbook,
  validateMemberWorkbook,
} from '../services/bulk-workbooks';

const router = Router();
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function readEditableWorkbook(body: any): Promise<string[][]> {
  const encoded = body?.xlsx_base64;
  if (typeof encoded !== 'string' || !encoded || encoded.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('File Excel (.xlsx) wajib diunggah dan maksimal 10 MB.');
  }
  return parseEditableWorkbook(Buffer.from(encoded, 'base64'));
}

function canManageMemberWorkbook(req: AuthenticatedRequest, res: Response): boolean {
  if (['owner', 'office_hr'].includes(req.user?.role || '')) return true;
  res.status(403).json({ error: 'Akses workbook seluruh anggota termasuk NIK hanya untuk Owner atau HR.' });
  return false;
}

// GET /api/members-csv/export-all: export data seluruh anggota termasuk NIK; hanya role owner/admin/HR.
router.get('/export-all', async (req: AuthenticatedRequest, res: Response) => {
  if (!canManageMemberWorkbook(req, res)) return;
  try {
    const buffer = await generateAllMembersWorkbook(getDatabase());
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="data-semua-anggota-koperasi.xlsx"');
    return res.status(200).send(buffer);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal mengekspor data anggota.' });
  }
});

// POST /api/members-csv/bulk-preview: validate editable member workbook in memory; body: xlsx_base64.
router.post('/bulk-preview', async (req: AuthenticatedRequest, res: Response) => {
  if (!canManageMemberWorkbook(req, res)) return;
  try {
    const grid = await readEditableWorkbook(req.body);
    const validation = validateMemberWorkbook(getDatabase(), grid);
    return res.status(200).json({
      ...validation,
      rows: validation.rows.slice(0, 50).map((row) => ({
        row_number: row.row_number,
        id: row.id,
        action: row.action,
        name: row.values.name || '',
      })),
      errors: validation.errors.slice(0, 50),
      preview_limited: validation.rows.length > 50,
      errors_limited: validation.errors.length > 50,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Gagal membaca workbook anggota.' });
  }
});

// POST /api/members-csv/bulk-import: apply member edits/deletions atomically; body: xlsx_base64.
router.post('/bulk-import', async (req: AuthenticatedRequest, res: Response) => {
  if (!canManageMemberWorkbook(req, res)) return;
  let grid: string[][];
  try {
    grid = await readEditableWorkbook(req.body);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'File workbook anggota tidak valid.' });
  }

  const db = getDatabase();
  let validation;
  try {
    validation = validateMemberWorkbook(db, grid);
  } catch (error: any) {
    console.error('[Members XLSX] Bulk import validation failed:', error);
    return res.status(500).json({ error: error.message || 'Gagal memvalidasi workbook anggota.' });
  }
  if (!validation.valid) {
    return res.status(422).json({
      error: 'Validasi gagal; tidak ada perubahan anggota yang disimpan.',
      validation: { ...validation, rows: validation.rows.slice(0, 50), errors: validation.errors.slice(0, 50) },
    });
  }
  try {
    const result = executeMemberWorkbookImport(db, validation.rows, req.user!.id, req.user!.role);
    return res.status(200).json({ message: 'Perubahan data anggota berhasil diterapkan.', result });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('SQLITE_CONSTRAINT_UNIQUE') || message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Impor dibatalkan karena konflik NIK/ID karyawan/nomor anggota. Tidak ada perubahan yang disimpan.' });
    }
    console.error('[Members XLSX] Bulk import failed:', error);
    return res.status(500).json({ error: error.message || 'Gagal menerapkan perubahan anggota.' });
  }
});

// ── GET /api/members/csv/template ─────────────────────────────────────────────
// Download standard CSV template for cooperative member import
router.get('/template', (req: AuthenticatedRequest, res: Response) => {
  try {
    const csvContent = generateMemberCsvTemplate();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="template-impor-member-koperasi.csv"');
    return res.status(200).send(csvContent);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal membuat template CSV member' });
  }
});

// ── GET /api/members/csv/template-xlsx ────────────────────────────────────────
// Download standard XLSX Excel template with explicit text formatting for NIK & Phone
router.get('/template-xlsx', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const buffer = await generateMemberXlsxTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template-impor-member-koperasi.xlsx"');
    return res.status(200).send(buffer);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal membuat template Excel member' });
  }
});

async function extractMemberGridFromPayload(body: any): Promise<string[][]> {
  const { csv, xlsx_base64 } = body || {};
  if (xlsx_base64 && typeof xlsx_base64 === 'string') {
    const buffer = Buffer.from(xlsx_base64, 'base64');
    return await parseMemberXlsxBuffer(buffer);
  }
  if (csv && typeof csv === 'string') {
    return parseCsvLines(csv);
  }
  return [];
}

// ── POST /api/members/csv/preview ────────────────────────────────────────────
// Memory-only validation & preview of member CSV/XLSX content without modifying DB
router.post('/preview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const grid = await extractMemberGridFromPayload(req.body);

    if (!grid || grid.length === 0) {
      return res.status(400).json({ error: 'Konten file CSV/Excel tidak boleh kosong' });
    }

    const db = getDatabase();
    const validationResult = validateMemberGrid(db, grid);

    return res.status(200).json({
      ...validationResult,
      rows: validationResult.rows.slice(0, 50),
      errors: validationResult.errors.slice(0, 50),
      preview_limited: validationResult.rows.length > 50,
      errors_limited: validationResult.errors.length > 50,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal memproses validasi file member' });
  }
});

// ── POST /api/members/csv/import ─────────────────────────────────────────────
// Atomic execution of member import
router.post('/import', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const grid = await extractMemberGridFromPayload(req.body);

    if (!grid || grid.length === 0) {
      return res.status(400).json({ error: 'Konten file CSV/Excel tidak boleh kosong' });
    }

    const db = getDatabase();
    const validationResult = validateMemberGrid(db, grid);

    if (!validationResult.valid) {
      return res.status(422).json({
        error: 'Terdapat kesalahan validasi pada file. Impor dibatalkan demi keamanan data.',
        validation: validationResult,
      });
    }

    if (validationResult.rows.length === 0) {
      return res.status(422).json({
        error: 'Tidak ada baris data member yang valid untuk diimpor.',
      });
    }

    const userId = req.user?.id || 'system';
    const userRole = req.user?.role || 'cashier';
    const importResult = executeMemberCsvImport(db, validationResult.rows, userId, userRole);

    return res.status(201).json({
      message: `Berhasil mengimpor ${importResult.created_members_count} anggota koperasi baru`,
      result: importResult,
    });
  } catch (error: any) {
    const message = String(error?.message || '');
    const isConflict = message.includes('Konflik data unik')
      || message.includes('sudah digunakan saat impor')
      || message.includes('sudah digunakan oleh anggota lain');
    return res.status(isConflict ? 409 : 500).json({ error: error.message || 'Gagal mengimpor data member dari file' });
  }
});

export const memberCsvRoutes = router;
