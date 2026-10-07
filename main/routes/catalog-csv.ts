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
import {
  executeProductWorkbookImport,
  generateAllProductsWorkbook,
  parseEditableWorkbook,
  validateProductWorkbook,
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

function canManageProducts(req: AuthenticatedRequest, res: Response): boolean {
  if (['owner', 'admin', 'office_inventory'].includes(req.user?.role || '')) return true;
  res.status(403).json({ error: 'Akses ekspor/impor massal produk hanya untuk Owner, Admin, atau Inventory.' });
  return false;
}

// GET /api/catalog-csv/export-all: export seluruh produk aktif/arsip ke workbook; tanpa parameter.
router.get('/export-all', async (req: AuthenticatedRequest, res: Response) => {
  if (!canManageProducts(req, res)) return;
  try {
    const buffer = await generateAllProductsWorkbook(getDatabase());
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="data-semua-produk-koperasi.xlsx"');
    return res.status(200).send(buffer);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Gagal mengekspor data produk.' });
  }
});

// POST /api/catalog-csv/bulk-preview: validate editable workbook in memory; body: xlsx_base64.
router.post('/bulk-preview', async (req: AuthenticatedRequest, res: Response) => {
  if (!canManageProducts(req, res)) return;
  try {
    const grid = await readEditableWorkbook(req.body);
    const validation = validateProductWorkbook(getDatabase(), grid);
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
    return res.status(400).json({ error: error.message || 'Gagal membaca workbook produk.' });
  }
});

// POST /api/catalog-csv/bulk-import: apply validated edits/deletions atomically; body: xlsx_base64.
router.post('/bulk-import', async (req: AuthenticatedRequest, res: Response) => {
  if (!canManageProducts(req, res)) return;
  let grid: string[][];
  try {
    grid = await readEditableWorkbook(req.body);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'File workbook produk tidak valid.' });
  }

  const db = getDatabase();
  let validation;
  try {
    validation = validateProductWorkbook(db, grid);
  } catch (error: any) {
    console.error('[Catalog XLSX] Bulk import validation failed:', error);
    return res.status(500).json({ error: error.message || 'Gagal memvalidasi workbook produk.' });
  }
  if (!validation.valid) {
    return res.status(422).json({
      error: 'Validasi gagal; tidak ada perubahan produk yang disimpan.',
      validation: { ...validation, rows: validation.rows.slice(0, 50), errors: validation.errors.slice(0, 50) },
    });
  }
  try {
    const result = executeProductWorkbookImport(db, validation.rows, req.user!.id, req.user!.role);
    return res.status(200).json({ message: 'Perubahan data produk berhasil diterapkan.', result });
  } catch (error: any) {
    const message = String(error?.message || '');
    if (message.includes('SQLITE_CONSTRAINT_UNIQUE') || message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Impor dibatalkan karena terjadi konflik data unik. Tidak ada perubahan yang disimpan.' });
    }
    console.error('[Catalog XLSX] Bulk import failed:', error);
    return res.status(500).json({ error: error.message || 'Gagal menerapkan perubahan produk.' });
  }
});

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
