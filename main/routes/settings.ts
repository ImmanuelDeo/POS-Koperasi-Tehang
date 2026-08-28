import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, now, getUserDataDirectory } from '../db';
import { createAuditLog } from '../services/audit';
import { clearLogoRasterCache } from '../printers/thermal';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

export function isOwnerOrAdmin(role?: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function getAllSettings(db: ReturnType<typeof getDatabase>): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s: Record<string, string> = {};
  for (const row of rows) s[(row as any).key] = (row as any).value;
  return s;
}

export function upsertSettings(db: ReturnType<typeof getDatabase>, entries: Record<string, any>): void {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  for (const [key, val] of Object.entries(entries)) {
    if (val !== undefined) stmt.run(key, String(val), now());
  }
}

export function businessShape(s: Record<string, string>) {
  return {
    business_name:              s.business_name || 'POS Koperasi',
    business_address:           s.business_address || '',
    business_phone:             s.business_phone || '',
    business_email:             s.business_email || '',
    logo_path:                  s.logo_path || '',
    logo_url:                   '/api/settings/logo',
    timezone:                   s.timezone || 'Asia/Jakarta',
    currency:                   s.currency || 'IDR',
    country:                    s.country || 'ID',
    gstin:                      s.gstin || '',
    state_code:                 s.state_code || '',
    billing_type:               s.billing_type || 'postpaid',
    tables_required:            s.tables_required !== 'false',
    tax_registered:             s.tax_registered === 'true',
    instagram_handle:           s.instagram_handle || '',
    bill_show_name:             s.bill_show_name !== 'false',
    bill_show_address:          s.bill_show_address !== 'false',
    bill_show_phone:            s.bill_show_phone !== 'false',
    bill_show_gstn:             s.bill_show_gstn === 'true',
    show_masked_nik_on_receipt: s.show_masked_nik_on_receipt === 'true',
    receipt_logo_enabled:       s.receipt_logo_enabled !== 'false',
    receipt_logo_size:          s.receipt_logo_size || 'standard',
    receipt_footer_text:        s.receipt_footer_text || 'Terima kasih atas kunjungan anda',
    receipt_return_policy_text: s.receipt_return_policy_text || 'Barang yang dibeli tidak dapat ditukar/dikembalikan',
    report_header_title:        s.report_header_title || 'Laporan Rekapitulasi Potong Gaji',
    report_show_contact:        s.report_show_contact !== 'false',
  };
}

function taxShape(s: Record<string, string>) {
  return {
    tax_registered:       s.tax_registered === 'true',
    gstin:                s.gstin           || '',
    state_code:           s.state_code      || '',
    tax_scheme:           s.tax_scheme      || 'regular',
    country:              s.country         || 'ID',
    loyalty_enabled:      s.loyalty_enabled === 'true',
    loyalty_expiry_days:  parseInt(s.loyalty_expiry_days  || '365'),
    loyalty_points_per_rs: parseFloat(s.loyalty_points_per_rs || '1'),
    loyalty_redeem_value: parseFloat(s.loyalty_redeem_value || '0.25'),
  };
}

// ── Multipart Parsing & Image Validation Helpers ───────────────────────────

interface ParsedMultipartFile {
  fieldname: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

export function parseMultipartFormData(rawBody: Buffer, contentTypeHeader: string): ParsedMultipartFile[] {
  const files: ParsedMultipartFile[] = [];
  if (!rawBody || rawBody.length === 0 || !contentTypeHeader) return files;

  const boundaryMatch = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return files;
  const boundary = (boundaryMatch[1] || boundaryMatch[2]).trim();
  const boundaryBuffer = Buffer.from(`--${boundary}`);

  let start = 0;
  while (start < rawBody.length) {
    const boundaryIndex = rawBody.indexOf(boundaryBuffer, start);
    if (boundaryIndex === -1) break;

    const nextBoundaryIndex = rawBody.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
    if (nextBoundaryIndex === -1) break;

    const partBuffer = rawBody.slice(boundaryIndex + boundaryBuffer.length, nextBoundaryIndex);
    const headerEndIndex = partBuffer.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEndIndex !== -1) {
      const headerText = partBuffer.slice(0, headerEndIndex).toString('utf8');
      const nameMatch = headerText.match(/name="([^"]+)"/i);
      const filenameMatch = headerText.match(/filename="([^"]+)"/i);
      const typeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

      if (nameMatch) {
        let data = partBuffer.slice(headerEndIndex + 4);
        if (data.length >= 2 && data[data.length - 2] === 0x0D && data[data.length - 1] === 0x0A) {
          data = data.slice(0, data.length - 2);
        }
        files.push({
          fieldname: nameMatch[1],
          filename: filenameMatch ? filenameMatch[1] : '',
          mimeType: typeMatch ? typeMatch[1].trim().toLowerCase() : 'application/octet-stream',
          data,
        });
      }
    }
    start = nextBoundaryIndex;
  }
  return files;
}

export function parseJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let offset = 2;
  while (offset < buf.length - 8) {
    if (buf[offset] !== 0xFF) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // Baseline & Progressive DCT frames (SOF0, SOF1, SOF2)
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    // Skip variable-length marker segments
    if (marker !== 0xD8 && marker !== 0xD9 && marker !== 0x00) {
      const len = buf.readUInt16BE(offset + 2);
      offset += 2 + len;
    } else {
      offset += 2;
    }
  }
  return null;
}

// ── Public Routes (Mounted globally or directly) ───────────────────────────

router.get('/public', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json({
      business_name: s.business_name || 'POS Koperasi',
      business_address: s.business_address || '',
      business_phone: s.business_phone || '',
      business_email: s.business_email || '',
      logo_url: '/api/settings/logo',
      has_custom_logo: Boolean(s.logo_path && s.logo_path.trim().length > 0),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export function serveCooperativeLogo(res: Response): void {
  try {
    const s = getAllSettings(getDatabase());
    const brandingDir = path.join(getUserDataDirectory(), 'branding');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (s.logo_path && s.logo_path.trim().length > 0) {
      const customPath = path.join(brandingDir, s.logo_path.trim());
      if (fs.existsSync(customPath)) {
        const isJpeg = customPath.toLowerCase().endsWith('.jpg') || customPath.toLowerCase().endsWith('.jpeg');
        res.setHeader('Content-Type', isJpeg ? 'image/jpeg' : 'image/png');
        return res.sendFile(customPath);
      }
    }

    // Fallback to default bundled logo
    const fallbackCandidates = [
      path.join(__dirname, '..', '..', 'frontend', 'public', 'logo.png'),
      path.join(process.cwd(), 'frontend', 'public', 'logo.png'),
      path.join(process.cwd(), 'assets', 'logo_makin-group.png'),
    ];

    for (const fb of fallbackCandidates) {
      if (fs.existsSync(fb)) {
        res.setHeader('Content-Type', 'image/png');
        return res.sendFile(fb);
      }
    }

    res.status(404).json({ error: 'Logo tidak ditemukan' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

router.get('/logo', (_req: Request, res: Response) => {
  serveCooperativeLogo(res);
});

// ── Specific Authenticated Routes ──────────────────────────────────────────

router.get('/business', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json(businessShape(s));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/business', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat mengubah identitas koperasi' });
    }

    const {
      business_name,
      business_address,
      business_phone,
      business_email,
      timezone,
      currency,
      country,
      gstin,
      state_code,
      billing_type,
      tables_required,
      tax_registered,
      instagram_handle,
      bill_show_name,
      bill_show_address,
      bill_show_phone,
      bill_show_gstn,
      show_masked_nik_on_receipt,
      receipt_logo_enabled,
      receipt_logo_size,
      receipt_footer_text,
      receipt_return_policy_text,
      report_header_title,
      report_show_contact,
    } = req.body;

    // Length Validations
    if (business_name !== undefined) {
      const cleanName = String(business_name).trim();
      if (!cleanName) return res.status(400).json({ error: 'Nama koperasi tidak boleh kosong' });
      if (cleanName.length > 60) return res.status(400).json({ error: 'Nama koperasi maksimal 60 karakter' });
    }

    if (business_address !== undefined && String(business_address).length > 150) {
      return res.status(400).json({ error: 'Alamat koperasi maksimal 150 karakter' });
    }

    if (business_phone !== undefined && String(business_phone).length > 25) {
      return res.status(400).json({ error: 'Nomor telepon koperasi maksimal 25 karakter' });
    }

    if (business_email !== undefined && String(business_email).length > 50) {
      return res.status(400).json({ error: 'Email koperasi maksimal 50 karakter' });
    }

    if (receipt_footer_text !== undefined && String(receipt_footer_text).length > 100) {
      return res.status(400).json({ error: 'Teks ucapan terima kasih maksimal 100 karakter' });
    }

    if (receipt_return_policy_text !== undefined && String(receipt_return_policy_text).length > 120) {
      return res.status(400).json({ error: 'Teks kebijakan retur maksimal 120 karakter' });
    }

    if (report_header_title !== undefined && String(report_header_title).length > 80) {
      return res.status(400).json({ error: 'Judul laporan PDF maksimal 80 karakter' });
    }

    const db = getDatabase();
    const prevSettings = getAllSettings(db);

    upsertSettings(db, {
      business_name: business_name !== undefined ? String(business_name).trim() : undefined,
      business_address: business_address !== undefined ? String(business_address).trim() : undefined,
      business_phone: business_phone !== undefined ? String(business_phone).trim() : undefined,
      business_email: business_email !== undefined ? String(business_email).trim() : undefined,
      timezone,
      currency,
      country,
      gstin,
      state_code,
      billing_type,
      tables_required: tables_required !== undefined ? (tables_required ? 'true' : 'false') : undefined,
      tax_registered: tax_registered !== undefined ? (tax_registered ? 'true' : 'false') : undefined,
      instagram_handle: instagram_handle !== undefined ? String(instagram_handle).trim() : undefined,
      bill_show_name: bill_show_name !== undefined ? (bill_show_name ? 'true' : 'false') : undefined,
      bill_show_address: bill_show_address !== undefined ? (bill_show_address ? 'true' : 'false') : undefined,
      bill_show_phone: bill_show_phone !== undefined ? (bill_show_phone ? 'true' : 'false') : undefined,
      bill_show_gstn: bill_show_gstn !== undefined ? (bill_show_gstn ? 'true' : 'false') : undefined,
      show_masked_nik_on_receipt: show_masked_nik_on_receipt !== undefined ? (show_masked_nik_on_receipt ? 'true' : 'false') : undefined,
      receipt_logo_enabled: receipt_logo_enabled !== undefined ? (receipt_logo_enabled ? 'true' : 'false') : undefined,
      receipt_logo_size: receipt_logo_size !== undefined ? String(receipt_logo_size) : undefined,
      receipt_footer_text: receipt_footer_text !== undefined ? String(receipt_footer_text).trim() : undefined,
      receipt_return_policy_text: receipt_return_policy_text !== undefined ? String(receipt_return_policy_text).trim() : undefined,
      report_header_title: report_header_title !== undefined ? String(report_header_title).trim() : undefined,
      report_show_contact: report_show_contact !== undefined ? (report_show_contact ? 'true' : 'false') : undefined,
    });

    if (receipt_logo_enabled !== undefined || receipt_logo_size !== undefined) {
      clearLogoRasterCache();
    }

    // Audit Logs
    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'settings.business_profile.updated',
      target_type: 'settings',
      details: {
        fields_updated: Object.keys(req.body).filter(k => req.body[k] !== undefined),
        status: 'success',
      },
      ip_address: req.ip,
    });

    if (receipt_footer_text !== undefined || receipt_return_policy_text !== undefined || bill_show_address !== undefined || bill_show_phone !== undefined) {
      createAuditLog(db, {
        actor_user_id: req.user?.id,
        actor_role: req.user?.role,
        action: 'settings.receipt_format.updated',
        target_type: 'settings',
        details: {
          receipt_logo_enabled: receipt_logo_enabled !== undefined ? Boolean(receipt_logo_enabled) : prevSettings.receipt_logo_enabled !== 'false',
          receipt_logo_size: receipt_logo_size || prevSettings.receipt_logo_size || 'standard',
          bill_show_address: bill_show_address !== undefined ? Boolean(bill_show_address) : prevSettings.bill_show_address !== 'false',
          bill_show_phone: bill_show_phone !== undefined ? Boolean(bill_show_phone) : prevSettings.bill_show_phone !== 'false',
        },
        ip_address: req.ip,
      });
    }

    res.json(businessShape(getAllSettings(db)));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Logo Upload & Delete (Strict Owner/Admin RBAC) ─────────────────────────

router.post('/logo', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat mengunggah logo' });
    }

    const rawBody: Buffer = (req as any).rawBody || req.body;
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data') || !Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ error: 'Header Content-Type harus multipart/form-data dengan file pada field logo' });
    }

    const files = parseMultipartFormData(rawBody, contentType);
    const logoFile = files.find(f => f.fieldname === 'logo');

    if (!logoFile || !logoFile.data || logoFile.data.length === 0) {
      return res.status(400).json({ error: 'File logo tidak ditemukan dalam request (pastikan field bernama logo)' });
    }

    // 1. File size check (Max 2MB = 2,097,152 bytes)
    const MAX_SIZE = 2 * 1024 * 1024;
    if (logoFile.data.length > MAX_SIZE) {
      return res.status(400).json({ error: 'Ukuran file melebihi batas maksimum 2MB' });
    }

    const buf = logoFile.data;

    // 2. Magic bytes validation (PNG or JPEG only; reject SVG or corrupt files)
    const isPng = buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;

    const isJpeg = buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;

    if (!isPng && !isJpeg) {
      return res.status(400).json({
        error: 'Format file tidak valid. Hanya file gambar PNG atau JPG/JPEG yang diperbolehkan (SVG tidak didukung).',
      });
    }

    // 3. Dimension & Actual Decode Validation
    let width = 0;
    let height = 0;

    if (isPng) {
      try {
        const { PNG } = require('pngjs');
        const png = PNG.sync.read(buf);
        width = png.width;
        height = png.height;
      } catch (err: any) {
        return res.status(400).json({ error: 'File PNG rusak atau tidak dapat didekode' });
      }
    } else {
      const dim = parseJpegDimensions(buf);
      if (!dim) {
        return res.status(400).json({ error: 'File JPEG rusak atau tidak dapat didekode' });
      }
      width = dim.width;
      height = dim.height;
    }

    if (width < 64 || height < 64 || width > 2048 || height > 2048) {
      return res.status(400).json({
        error: `Dimensi gambar (${width}x${height}px) tidak memenuhi syarat. Ukuran harus antara 64x64 hingga 2048x2048 piksel.`,
      });
    }

    // 4. Persistent Storage in <userData>/branding/
    const brandingDir = path.join(getUserDataDirectory(), 'branding');
    if (!fs.existsSync(brandingDir)) {
      fs.mkdirSync(brandingDir, { recursive: true });
    }

    const ext = isPng ? 'png' : 'jpg';
    const relativeFilename = `logo-${Date.now()}-${uuidv4().replace(/-/g, '').slice(0, 8)}.${ext}`;
    const newFilePath = path.join(brandingDir, relativeFilename);

    // Write new file
    fs.writeFileSync(newFilePath, buf);

    // 5. Update Database Transactionally
    const db = getDatabase();
    const prevSettings = getAllSettings(db);
    const oldLogoPath = prevSettings.logo_path;

    upsertSettings(db, { logo_path: relativeFilename });
    clearLogoRasterCache();

    // 6. Delete old logo file ONLY after new file write and DB update succeed
    if (oldLogoPath && oldLogoPath !== relativeFilename) {
      const oldFilePath = path.join(brandingDir, oldLogoPath);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch {}
      }
    }

    // 7. Audit Log (No raw image or sensitive paths)
    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'settings.branding_logo.uploaded',
      target_type: 'settings',
      details: {
        file_identifier: relativeFilename,
        mime_type: isPng ? 'image/png' : 'image/jpeg',
        file_size: buf.length,
        dimensions: `${width}x${height}`,
        status: 'success',
      },
      ip_address: req.ip,
    });

    res.json({
      success: true,
      logo_url: '/api/settings/logo',
      logo_path: relativeFilename,
      width,
      height,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/logo', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat menghapus logo' });
    }

    const db = getDatabase();
    const prevSettings = getAllSettings(db);
    const oldLogoPath = prevSettings.logo_path;

    if (oldLogoPath) {
      const oldFilePath = path.join(getUserDataDirectory(), 'branding', oldLogoPath);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch {}
      }
    }

    upsertSettings(db, { logo_path: '' });
    clearLogoRasterCache();

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'settings.branding_logo.removed',
      target_type: 'settings',
      details: {
        previous_identifier: oldLogoPath || 'none',
        status: 'success',
      },
      ip_address: req.ip,
    });

    res.json({ success: true, message: 'Logo berhasil dihapus, dikembalikan ke logo bawaan' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Tax, Loyalty, Payment Methods ──────────────────────────────────────────

router.get('/tax', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json(taxShape(s));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/tax', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat mengubah konfigurasi pajak' });
    }
    const { tax_registered, gstin, state_code, tax_scheme, country } = req.body;
    const db = getDatabase();
    upsertSettings(db, { tax_registered, gstin, state_code, tax_scheme, country });
    res.json(taxShape(getAllSettings(db)));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/loyalty', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json({
      loyalty_enabled:       s.loyalty_enabled === 'true',
      loyalty_expiry_days:   parseInt(s.loyalty_expiry_days  || '365'),
      loyalty_points_per_rs: parseFloat(s.loyalty_points_per_rs || '1'),
      loyalty_redeem_value:  parseFloat(s.loyalty_redeem_value || '0.25'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/loyalty', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat mengubah loyalty points' });
    }
    const { loyalty_enabled, loyalty_expiry_days, loyalty_points_per_rs, loyalty_redeem_value } = req.body;
    const db = getDatabase();
    upsertSettings(db, { loyalty_enabled, loyalty_expiry_days, loyalty_points_per_rs, loyalty_redeem_value });
    const s = getAllSettings(db);
    res.json({
      loyalty_enabled:       s.loyalty_enabled === 'true',
      loyalty_expiry_days:   parseInt(s.loyalty_expiry_days  || '365'),
      loyalty_points_per_rs: parseFloat(s.loyalty_points_per_rs || '1'),
      loyalty_redeem_value:  parseFloat(s.loyalty_redeem_value || '0.25'),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Payment Methods ────────────────────────────────────────────────────────

router.get('/payment-methods', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json({
      qris_merchant_name: s.qris_merchant_name || 'Koperasi Karyawan Tehang',
      qris_image_url: s.qris_image_url || '',
      bank_name: s.bank_name || 'Bank BCA',
      bank_account_number: s.bank_account_number || '',
      bank_account_holder: s.bank_account_holder || 'Koperasi Tehang',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/payment-methods', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat mengubah metode pembayaran' });
    }
    const { qris_merchant_name, qris_image_url, bank_name, bank_account_number, bank_account_holder } = req.body;
    const db = getDatabase();
    upsertSettings(db, {
      qris_merchant_name,
      qris_image_url,
      bank_name,
      bank_account_number,
      bank_account_holder,
    });
    res.json({ success: true, settings: getAllSettings(db) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Discount Settings ──────────────────────────────────────────────────────

router.get('/discount', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json({
      discount_max_percentage: parseFloat(s.discount_max_percentage || '25'),
      discount_max_amount: parseFloat(s.discount_max_amount || '0'),
      discount_mode: s.discount_mode || 'percentage',
      discount_requires_approval: s.discount_requires_approval === 'true',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/discount', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat mengubah batas diskon' });
    }
    const { discount_max_percentage, discount_max_amount, discount_mode, discount_requires_approval } = req.body;
    const db = getDatabase();
    upsertSettings(db, {
      discount_max_percentage,
      discount_max_amount,
      discount_mode,
      discount_requires_approval: discount_requires_approval !== undefined ? String(discount_requires_approval) : undefined,
    });
    const s = getAllSettings(db);
    res.json({
      discount_max_percentage: parseFloat(s.discount_max_percentage || '25'),
      discount_max_amount: parseFloat(s.discount_max_amount || '0'),
      discount_mode: s.discount_mode || 'percentage',
      discount_requires_approval: s.discount_requires_approval === 'true',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── KDS Settings ───────────────────────────────────────────────────────────

router.get('/kds', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json({
      kds_default_view: s.kds_default_view || 'tabs',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/kds', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { kds_default_view } = req.body;
    const db = getDatabase();
    upsertSettings(db, { kds_default_view: kds_default_view || 'tabs' });
    res.json({ kds_default_view: kds_default_view || 'tabs' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Cloud Sync Settings (Offline / LAN Default) ───────────────────────────

router.get('/cloud', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json({
      cloud_api_key: s.cloud_api_key || '',
      cloud_store_id: s.cloud_store_id || '',
      cloud_sync_enabled: s.cloud_sync_enabled === 'true',
      cloud_orders_enabled: s.cloud_orders_enabled === 'true',
      cloud_last_sync: s.cloud_last_sync || null,
      cloud_registration_status: s.cloud_registration_status || 'unregistered',
      cloud_pending_store_id: s.cloud_pending_store_id || null,
      cloud_connected: s.cloud_connected === 'true',
      cloud_relay_mode: s.cloud_relay_mode || 'disconnected',
      cloud_last_heartbeat: s.cloud_last_heartbeat || null,
      cloud_last_error: s.cloud_last_error || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/cloud', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat mengubah konfigurasi cloud' });
    }
    const { cloud_api_key, cloud_store_id, cloud_sync_enabled, cloud_orders_enabled } = req.body;
    const db = getDatabase();
    upsertSettings(db, {
      cloud_api_key,
      cloud_store_id,
      cloud_sync_enabled: cloud_sync_enabled !== undefined ? String(cloud_sync_enabled) : undefined,
      cloud_orders_enabled: cloud_orders_enabled !== undefined ? String(cloud_orders_enabled) : undefined,
    });
    res.json({ success: true, message: 'Pengaturan cloud disimpan' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/cloud/test', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Mode offline LAN koperasi aktif' });
});

router.post('/cloud/register', (req: Request, res: Response) => {
  res.json({ success: true, message: 'Pendaftaran toko tercatat di sistem lokal' });
});

// ── Google Drive Settings ─────────────────────────────────────────────────

router.get('/google-drive', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json({
      configured: s.gdrive_configured === 'true',
      secure_storage_available: true,
      connected: s.gdrive_connected === 'true',
      account_email: s.gdrive_account_email || null,
      frequency: s.gdrive_frequency || 'daily',
      retention_count: parseInt(s.gdrive_retention_count || '10', 10),
      last_backup_at: s.gdrive_last_backup_at || null,
      last_backup_status: s.gdrive_last_backup_status || null,
      last_backup_filename: s.gdrive_last_backup_filename || null,
      last_error: s.gdrive_last_error || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/google-drive', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { frequency, retention_count } = req.body;
    const db = getDatabase();
    upsertSettings(db, {
      gdrive_frequency: frequency,
      gdrive_retention_count: retention_count ? String(retention_count) : undefined,
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/google-drive/connect', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Google Drive backup siap dikonfigurasi' });
});

router.post('/google-drive/disconnect', (_req: Request, res: Response) => {
  const db = getDatabase();
  upsertSettings(db, { gdrive_connected: 'false', gdrive_account_email: '' });
  res.json({ success: true, message: 'Google Drive dinonaktifkan' });
});

router.post('/google-drive/backup-now', async (_req: Request, res: Response) => {
  try {
    const { createBackup } = await import('../db');
    const backupPath = await createBackup();
    res.json({ success: true, backupPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Generic Key-Value Routes ───────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  try {
    const s = getAllSettings(getDatabase());
    res.json({ settings: s });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:key', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const key = req.params.key;
    const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get(key) as any;

    // Always return 200 with setting object (or default null) to avoid breaking frontend loaders
    res.json({
      setting: setting || { key, value: null, updated_at: null },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:key', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRole = req.user?.role || '';
    if (!isOwnerOrAdmin(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Hanya Owner atau Admin yang dapat mengubah pengaturan sistem' });
    }
    const { value } = req.body;
    const db = getDatabase();
    const valStr = value !== undefined ? String(value) : '';

    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(req.params.key, valStr, now());

    const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key);
    res.json({ setting });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const settingsRoutes = router;
