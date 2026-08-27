import { Router, Response } from 'express';
import { getDatabase } from '../db';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  generateMemberCsvTemplate,
  validateMemberCsv,
  executeMemberImport,
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

// ── POST /api/members/csv/preview ────────────────────────────────────────────
// Memory-only validation & preview of member CSV content without modifying DB
router.post('/preview', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { csv } = req.body;

    if (!csv || typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ error: 'Konten file CSV tidak boleh kosong' });
    }

    const db = getDatabase();
    const validationResult = validateMemberCsv(db, csv);

    return res.status(200).json({
      ...validationResult,
      rows: validationResult.rows.slice(0, 50),
      errors: validationResult.errors.slice(0, 50),
      preview_limited: validationResult.rows.length > 50,
      errors_limited: validationResult.errors.length > 50,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal memproses validasi CSV member' });
  }
});

// ── POST /api/members/csv/import ─────────────────────────────────────────────
// Atomic execution of member import
router.post('/import', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { csv } = req.body;

    if (!csv || typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ error: 'Konten file CSV tidak boleh kosong' });
    }

    const db = getDatabase();
    const validationResult = validateMemberCsv(db, csv);

    if (!validationResult.valid) {
      return res.status(422).json({
        error: 'Terdapat kesalahan validasi pada file CSV. Impor dibatalkan demi keamanan data.',
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
    const importResult = executeMemberImport(db, validationResult.rows, userId, userRole);

    return res.status(201).json({
      message: `Berhasil mengimpor ${importResult.created_members_count} anggota koperasi baru`,
      result: importResult,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal mengimpor data member dari CSV' });
  }
});

export const memberCsvRoutes = router;
