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

const router = Router();

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
    return res.status(500).json({ error: error.message || 'Gagal mengimpor data member dari file' });
  }
});

export const memberCsvRoutes = router;
