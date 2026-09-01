import { Router, Response } from 'express';
import { getDatabase } from '../db';
import { AuthenticatedRequest } from '../middleware/auth';
import {
  generateCatalogCsvTemplate,
  generateCatalogXlsxTemplate,
  parseRfc4180Csv,
  parseXlsxBuffer,
  validateCatalogGrid,
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

// ── GET /api/catalog-csv/template-xlsx ────────────────────────────────────────
// Download standard XLSX Excel catalog template with explicit text formatting
router.get('/template-xlsx', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const buffer = await generateCatalogXlsxTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="katalog-produk-koperasi-template.xlsx"');
    return res.status(200).send(buffer);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal membuat template Excel' });
  }
});

// Helper to extract grid from request payload (csv string or xlsx_base64)
async function extractGridFromPayload(body: any): Promise<string[][]> {
  const { csv, xlsx_base64 } = body || {};
  if (xlsx_base64 && typeof xlsx_base64 === 'string') {
    const buffer = Buffer.from(xlsx_base64, 'base64');
    return await parseXlsxBuffer(buffer);
  }
  if (csv && typeof csv === 'string') {
    return parseRfc4180Csv(csv);
  }
  return [];
}

// ── POST /api/catalog-csv/preview ────────────────────────────────────────────
// Memory-only validation & preview of CSV/XLSX content without modifying database
router.post('/preview', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const grid = await extractGridFromPayload(req.body);

    if (!grid || grid.length === 0) {
      return res.status(400).json({ error: 'Konten file CSV/Excel tidak boleh kosong' });
    }

    const db = getDatabase();
    const validationResult = validateCatalogGrid(db, grid);

    return res.status(200).json({
      ...validationResult,
      rows: validationResult.rows.slice(0, 50),
      errors: validationResult.errors.slice(0, 50),
      preview_limited: validationResult.rows.length > 50,
      errors_limited: validationResult.errors.length > 50,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal memproses validasi file' });
  }
});

// ── POST /api/catalog-csv/import ─────────────────────────────────────────────
// Atomic execution of catalog import + stock movements ledger (All-or-Nothing)
router.post('/import', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const grid = await extractGridFromPayload(req.body);

    if (!grid || grid.length === 0) {
      return res.status(400).json({ error: 'Konten file CSV/Excel tidak boleh kosong' });
    }

    const db = getDatabase();
    const validationResult = validateCatalogGrid(db, grid);

    if (!validationResult.valid) {
      return res.status(422).json({
        error: 'Terdapat kesalahan validasi pada file. Impor dibatalkan secara penuh (All-or-Nothing).',
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
      message: `Berhasil mengimpor ${importResult.created_products_count} produk, ${importResult.created_categories_count} kategori baru, dan ${importResult.created_units_count} satuan baru.`,
      result: importResult,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal mengimpor katalog produk' });
  }
});

export const catalogCsvRoutes = router;
