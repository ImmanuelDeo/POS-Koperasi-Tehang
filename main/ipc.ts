import { ipcMain, dialog, app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDatabase, createBackup, restoreBackup, now, getDbPath } from './db';
import { isKioskModeEnabled, isLocalAppOrigin } from './config/security';

// In-memory rate limiting state
let failedAttempts = 0;
let lockoutUntil = 0;

/**
 * Reset rate limiter state for tests
 */
export function resetAdminRecoveryRateLimit(): void {
  failedAttempts = 0;
  lockoutUntil = 0;
}

/**
 * Timing-safe string comparison for legacy plaintext PIN verification.
 * Performs a dummy comparison if buffer lengths differ to keep execution time
 * roughly consistent, reducing timing side-channel leakage.
 */
function timingSafeCompare(submitted: string, stored: string): boolean {
  const bufA = Buffer.from(submitted, 'utf8');
  const bufB = Buffer.from(stored, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform a dummy comparison of equal length to keep execution time
    // roughly consistent even when lengths differ, reducing timing side-channel leakage.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function registerIpcHandlers(callbacks?: { onQuitRequested?: () => void }): void {


  // Database backup/restore does not require the optional Master PIN.
  // Use SQLite's backup API so custom-location backups include WAL data safely.
  ipcMain.handle('backup-database', async (_event, _pin?: string) => {
    try {
      console.log('[IPC] backup-database: Starting...');

      // Ask user where to save
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const result = await dialog.showSaveDialog({
        defaultPath: `flo-backup-${timestamp}.db`,
        filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Cancelled' };
      }

      const db = getDatabase();
      await db.backup(result.filePath);

      console.log('[IPC] backup-database: Complete:', result.filePath);
      return { success: true, path: result.filePath };
    } catch (error: any) {
      console.error('[IPC] backup-database: Error:', error);
      return { success: false, error: error.message };
    }
  });

  // Restore from a history path or prompt for a backup file when no path is supplied.
  ipcMain.handle('restore-backup', async (_event, pinOrPath?: string, backupPath?: string) => {
    try {
      const fs = require('fs');
      const candidate = backupPath || pinOrPath;
      if (candidate && typeof candidate === 'string' && candidate.length > 1 && fs.existsSync(candidate)) {
        restoreBackup(candidate);
        return { success: true };
      }

      const result = await dialog.showOpenDialog({
        filters: [{ name: 'SQLite Database', extensions: ['db'] }],
        properties: ['openFile'],
      });

      if (result.canceled || !result.filePaths.length) {
        return { success: false, error: 'Cancelled' };
      }

      restoreBackup(result.filePaths[0]);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Settings
  ipcMain.handle('get-settings', async () => {
    try {
      const db = getDatabase();
      const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
      const settings: Record<string, string> = {};
      rows.forEach((row) => {
        settings[row.key] = row.value;
      });
      return settings;
    } catch (error: any) {
      return { error: error.message };
    }
  });

  ipcMain.handle('set-setting', async (event, key: string, value: string) => {
    try {
      const db = getDatabase();
      db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
        .run(key, value, now());
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // KDS info
  ipcMain.handle('get-kds-info', async () => {
    const port = 3001;
    return {
      url: `http://127.0.0.1:${port}/kds`,
      wsUrl: `ws://127.0.0.1:${port}/kds`,
      localIP: '127.0.0.1',
      port,
    };
  });

  // Window management
  ipcMain.handle('open-kds-window', async () => {
    const kdsWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Flo - Kitchen Display',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    kdsWindow.loadURL('http://127.0.0.1:3001/kds');
  });

  ipcMain.handle('get-app-info', async () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
    };
  });

  // Printers
  ipcMain.handle('get-printers', async () => {
    try {
      const db = getDatabase();
      const printers = db.prepare('SELECT * FROM printers ORDER BY name').all();
      return printers;
    } catch (error: any) {
      return { error: error.message };
    }
  });

  ipcMain.handle('save-printer', async (event, printer: any) => {
    try {
      const db = getDatabase();
      if (printer.id) {
        db.prepare(`
          UPDATE printers SET name = ?, type = ?, connection_type = ?, ip_address = ?,
            port = ?, usb_vendor_id = ?, usb_product_id = ?, is_default = ?, updated_at = ?
          WHERE id = ?
        `).run(printer.name, printer.type, printer.connection_type, printer.ip_address,
          printer.port || 9100, printer.usb_vendor_id, printer.usb_product_id,
          printer.is_default ? 1 : 0, now(), printer.id);
      } else {
        db.prepare(`
          INSERT INTO printers (name, type, connection_type, ip_address, port, usb_vendor_id, usb_product_id, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(printer.name, printer.type, printer.connection_type, printer.ip_address,
          printer.port || 9100, printer.usb_vendor_id, printer.usb_product_id,
          printer.is_default ? 1 : 0, now(), now());
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Reports
  ipcMain.handle('get-daily-summary', async () => {
    try {
      const db = getDatabase();
      const today = new Date().toISOString().slice(0, 10);

      const bills = db.prepare(`
        SELECT COUNT(*) as bill_count, COALESCE(SUM(total), 0) as revenue
        FROM bills WHERE date(created_at) = date(?) AND payment_status = 'paid'
      `).get(today) as { bill_count: number; revenue: number };

      const covers = db.prepare(`
        SELECT COALESCE(SUM(guest_count), 0) as covers FROM orders
        WHERE date(created_at) = date(?) AND status != 'cancelled'
      `).get(today) as { covers: number };

      const pendingOrders = db.prepare(`
        SELECT COUNT(*) as count FROM orders WHERE status IN ('pending', 'preparing')
      `).get() as { count: number };

      return {
        date: today,
        revenue: bills.revenue,
        bill_count: bills.bill_count,
        covers: covers.covers,
        pending_orders: pendingOrders.count,
      };
    } catch (error: any) {
      return { error: error.message };
    }
  });

  // User management
  ipcMain.handle('get-users', async () => {
    try {
      const db = getDatabase();
      const users = db.prepare('SELECT id, name, email, role, is_active, created_at FROM users').all();
      return users;
    } catch (error: any) {
      return { error: error.message };
    }
  });

  ipcMain.handle('create-user', async (event, userData: any) => {
    try {
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync(userData.password, 10);

      const db = getDatabase();
      const result = db.prepare(`
        INSERT INTO users (name, email, password, pin, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(userData.name, userData.email, hashedPassword, userData.pin || null,
        userData.role || 'cashier', now(), now());

      return { success: true, id: result.lastInsertRowid };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('update-user', async (event, id: number, userData: any) => {
    try {
      const db = getDatabase();
      const updates: string[] = [];
      const params: any[] = [];

      if (userData.name) { updates.push('name = ?'); params.push(userData.name); }
      if (userData.email) { updates.push('email = ?'); params.push(userData.email); }
      if (userData.pin !== undefined) { updates.push('pin = ?'); params.push(userData.pin); }
      if (userData.role) { updates.push('role = ?'); params.push(userData.role); }
      if (userData.is_active !== undefined) { updates.push('is_active = ?'); params.push(userData.is_active ? 1 : 0); }

      if (updates.length === 0) return { success: false, error: 'No updates provided' };

      updates.push('updated_at = ?');
      params.push(now());
      params.push(id);

      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('delete-user', async (event, id: number) => {
    try {
      const db = getDatabase();
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ── Kiosk Mode & Secure Admin Recovery ──────────────────────────────
  ipcMain.handle('get-kiosk-mode-status', () => {
    return { isKiosk: isKioskModeEnabled() };
  });

  ipcMain.handle('admin-kiosk-recovery', async (event, payload: any) => {
    try {
      // 1. Sender validation: ensure request originates from local app only
      const senderUrl = event.senderFrame?.url;
      const port = parseInt(process.env.PORT || '3001', 10);
      if (!isLocalAppOrigin(senderUrl, port)) {
        return { success: false, error: 'Akses ditolak: Permintaan tidak sah.' };
      }

      // 2. In-memory Rate limiting check (5 attempts -> 60s cooldown)
      const nowMs = Date.now();
      if (nowMs < lockoutUntil) {
        const remainingSec = Math.ceil((lockoutUntil - nowMs) / 1000);
        return { success: false, error: `Terlalu banyak percobaan salah. Coba lagi dalam ${remainingSec} detik.` };
      }

      // 3. Payload validation
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: 'Format permintaan tidak valid.' };
      }

      const { pin, action } = payload;

      if (!pin || typeof pin !== 'string' || pin.trim().length < 4 || pin.trim().length > 12) {
        return { success: false, error: 'Format PIN tidak valid (wajib 4-12 karakter).' };
      }

      if (action !== 'exit_kiosk' && action !== 'quit_app') {
        return { success: false, error: 'Aksi recovery tidak valid.' };
      }

      const submittedPin = pin.trim();

      // 4. Query active owner and admin users ONLY (never include manager or cashier)
      // Note: Iterating through eligible users in sequence causes slight execution time variance
      // depending on user position in results. For local kiosk recovery with a small number of
      // admin/owner accounts, this is an acceptable and documented operational trade-off.
      const db = getDatabase();
      const eligibleUsers = db.prepare(`
        SELECT id, name, role, pin 
        FROM users 
        WHERE role IN ('owner', 'admin') 
          AND is_active = 1
      `).all() as { id: string; name: string; role: string; pin: string | null }[];

      let authenticatedUser: { id: string; name: string; role: string } | null = null;
      let needsBcryptUpgrade = false;

      for (const user of eligibleUsers) {
        if (!user.pin) continue;

        const storedPin = String(user.pin).trim();
        const isBcrypt = /^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$/.test(storedPin);

        if (isBcrypt) {
          if (bcrypt.compareSync(submittedPin, storedPin)) {
            authenticatedUser = { id: user.id, name: user.name, role: user.role };
            needsBcryptUpgrade = false;
            break;
          }
        } else {
          // Legacy plaintext comparison using timingSafeCompare helper
          if (timingSafeCompare(submittedPin, storedPin)) {
            authenticatedUser = { id: user.id, name: user.name, role: user.role };
            needsBcryptUpgrade = true;
            break;
          }
        }
      }


      // 5. Failure handling
      if (!authenticatedUser) {
        failedAttempts += 1;
        if (failedAttempts >= 5) {
          lockoutUntil = Date.now() + 60000;
          failedAttempts = 0;
          return { success: false, error: 'PIN salah 5 kali. Akses terkunci selama 60 detik.' };
        }
        return { success: false, error: 'PIN Admin tidak valid atau tidak memiliki wewenang.' };
      }

      // 6. Reset rate limit state on success
      failedAttempts = 0;
      lockoutUntil = 0;

      // 7. Auto-upgrade legacy plaintext to bcrypt hash (for matched owner/admin ONLY)
      if (needsBcryptUpgrade && authenticatedUser) {
        try {
          const hashedPin = bcrypt.hashSync(submittedPin, 10);
          db.prepare('UPDATE users SET pin = ?, updated_at = ? WHERE id = ?')
            .run(hashedPin, now(), authenticatedUser.id);
          console.log(`[Security] Upgraded legacy PIN to bcrypt hash for user: ${authenticatedUser.id}`);
        } catch (upgradeErr: any) {
          // Non-blocking: log generic error without exposing PIN
          console.error('[Security] Failed to upgrade legacy PIN to hash:', upgradeErr?.message || 'Database error');
        }
      }

      // 8. Execute recovery action
      if (action === 'exit_kiosk') {
        const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getAllWindows()[0];
        if (win) {
          win.setKiosk(false);
          win.setFullScreen(false);
          win.setSize(1400, 900);
          win.center();
          win.setMenuBarVisibility(true);
        }
        return { success: true, message: 'Mode Kiosk berhasil dinonaktifkan.' };
      } else if (action === 'quit_app') {
        if (callbacks?.onQuitRequested) {
          callbacks.onQuitRequested();
        } else {
          app.quit();
        }
        return { success: true };
      }

      return { success: false, error: 'Aksi tidak dikenal.' };
    } catch (err: any) {
      console.error('[IPC] admin-kiosk-recovery error:', err?.message || 'Internal error');
      return { success: false, error: 'Terjadi kesalahan sistem saat memproses recovery.' };
    }
  });

  console.log('[IPC] Handlers registered');
}