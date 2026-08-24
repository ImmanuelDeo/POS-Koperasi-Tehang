import { Router, Response } from 'express';
import { getDatabase } from '../db';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  generateCatalogCsvTemplate,
  validateCatalogCsv,
  executeCatalogImport,
} from '../services/catalog-csv';

const router = Router();

// ── GET /api/catalog-csv/template ─────────────────────────────────────────────
// Download standard CSV catalog template for POS Koperasi
router.get('/template', (req: AuthenticatedRequest, res: Response) => {
  try {
    const csvContent = generateCatalogCsvTemplate();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="katalog-produk-koperasi-template.csv"');
    return res.status(200).send(csvContent);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal membuat template CSV' });
  }
});

// ── POST /api/catalog-csv/preview ────────────────────────────────────────────
// Memory-only validation & preview of CSV content without modifying database
router.post('/preview', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { csv } = req.body;

    if (!csv || typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ error: 'Konten CSV tidak boleh kosong' });
    }

    const db = getDatabase();
    const validationResult = validateCatalogCsv(db, csv);

    return res.status(200).json(validationResult);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal memproses validasi CSV' });
  }
});

// ── POST /api/catalog-csv/import ─────────────────────────────────────────────
// Atomic execution of catalog import + stock movements ledger
router.post('/import', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { csv } = req.body;

    if (!csv || typeof csv !== 'string' || csv.trim() === '') {
      return res.status(400).json({ error: 'Konten CSV tidak boleh kosong' });
    }

    const db = getDatabase();
    const validationResult = validateCatalogCsv(db, csv);

    if (!validationResult.valid) {
      return res.status(422).json({
        error: 'Terdapat kesalahan validasi pada file CSV. Impor dibatalkan.',
        validation: validationResult,
      });
    }

    if (validationResult.rows.length === 0) {
      return res.status(422).json({
        error: 'Tidak ada baris data produk yang valid untuk diimpor.',
      });
    }

    const userId = req.user?.id || 'system';
    const importResult = executeCatalogImport(db, validationResult.rows, userId);

    return res.status(201).json({
      message: `Berhasil mengimpor ${importResult.created_products_count} produk dan ${importResult.created_categories_count} kategori baru`,
      result: importResult,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal mengimpor katalog produk' });
  }
});

export const catalogCsvRoutes = router;
