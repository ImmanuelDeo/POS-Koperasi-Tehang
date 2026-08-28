import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { getDatabase, getDbPath, createBackup, getUserDataDirectory, now } from '../db';
import { createAuditLog } from '../services/audit';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// ── GET /api/db-tools/master-pin/status ──────────────────────────────────────
router.get('/master-pin/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const pinRow = db.prepare("SELECT value FROM settings WHERE key = 'master_pin'").get() as any;
    const isSet = Boolean(pinRow && pinRow.value && pinRow.value.trim().length > 0);
    res.json({ available: true, isSet });
  } catch (error: any) {
    res.json({ available: false, isSet: false });
  }
});

// ── POST /api/db-tools/master-pin/reset ─────────────────────────────────────
router.post('/master-pin/reset', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { new_pin } = req.body;
    if (!new_pin || String(new_pin).trim().length < 4) {
      return res.status(400).json({ error: 'Master PIN minimal 4 digit' });
    }

    const db = getDatabase();
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('master_pin', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(new_pin).trim(), now());

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'database.master_pin.updated',
      target_type: 'settings',
      details: { status: 'success' },
      ip_address: req.ip,
    });

    res.json({ success: true, message: 'Master PIN berhasil diperbarui' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/db-tools/backups ───────────────────────────────────────────────
router.get('/backups', (_req: Request, res: Response) => {
  try {
    const backupDir = path.join(getUserDataDirectory(), 'backups');
    if (!fs.existsSync(backupDir)) {
      return res.json({ backups: [] });
    }

    const files = fs.readdirSync(backupDir);
    const backups = files
      .filter((f) => f.endsWith('.db') || f.endsWith('.bak'))
      .map((fileName) => {
        const fullPath = path.join(backupDir, fileName);
        const stat = fs.statSync(fullPath);
        return {
          fileName,
          path: fullPath,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
          kind: fileName.includes('auto') ? 'auto' : 'manual',
          schemaVersion: 14,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ backups });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/db-tools/backups/:fileName/delete ─────────────────────────────
router.post('/backups/:fileName/delete', (req: AuthenticatedRequest, res: Response) => {
  try {
    const fileName = path.basename(decodeURIComponent(req.params.fileName));
    const backupDir = path.join(getUserDataDirectory(), 'backups');
    const targetPath = path.join(backupDir, fileName);

    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }

    const db = getDatabase();
    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'database.backup.deleted',
      target_type: 'backup',
      target_id: fileName,
      details: { fileName },
      ip_address: req.ip,
    });

    res.json({ success: true, message: 'Backup berhasil dihapus' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── GET /api/db-tools/health-check ──────────────────────────────────────────
router.get('/health-check', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const integrity = (db.prepare('PRAGMA integrity_check').get() as any)?.integrity_check || 'ok';
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all();

    const tables = ['products', 'categories', 'customers', 'orders', 'bills', 'stock_movements', 'users'];
    const counts: Record<string, number> = {};

    for (const t of tables) {
      try {
        counts[t] = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any)?.c || 0;
      } catch {
        counts[t] = 0;
      }
    }

    const issues: string[] = [];
    if (integrity !== 'ok') issues.push(`Integrity check failed: ${integrity}`);
    if (fkCheck.length > 0) issues.push(`Foreign key violations found: ${fkCheck.length}`);

    res.json({
      status: issues.length === 0 ? 'healthy' : 'warning',
      timestamp: new Date().toISOString(),
      schema_version: 14,
      integrity,
      foreign_key_violations: fkCheck.length,
      counts,
      issues,
      applied: [],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/db-tools/apply-safe-fixes ─────────────────────────────────────
router.post('/apply-safe-fixes', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec('PRAGMA optimize;');

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'database.safe_fixes.applied',
      target_type: 'database',
      details: { status: 'success' },
      ip_address: req.ip,
    });

    res.json({
      success: true,
      applied: ['WAL Checkpointed', 'Database Index Optimized'],
      errors: [],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message, applied: [], errors: [error.message] });
  }
});

// ── POST /api/db-tools/initialize ──────────────────────────────────────────
router.post('/initialize', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const backupPath = await createBackup();
    const db = getDatabase();

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'database.initialize.created_backup',
      target_type: 'database',
      details: { backupPath },
      ip_address: req.ip,
    });

    res.json({
      success: true,
      message: 'Database snapshot dibuat sebelum inisialisasi',
      backupPath,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export const dbToolsRoutes = router;
