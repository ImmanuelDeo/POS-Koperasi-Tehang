import { Router, Request, Response } from 'express';
import { getDatabase, now } from '../db';
import { v4 as uuidv4 } from 'uuid';
import {
  detectConnectedPrinters,
  buildTestPage,
  dispatchPrint,
  printReceiptById,
} from '../printers/thermal';
import { createAuditLog } from '../services/audit';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/printers — list all configured printers
router.get('/', (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printers = db.prepare('SELECT * FROM printers ORDER BY is_default DESC, name').all();
    res.json({ printers });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/printers/detect — detect connected USB/network/bluetooth printers from OS
router.get('/detect', async (_req: Request, res: Response) => {
  try {
    const printers = await detectConnectedPrinters();
    console.log('[Printer] Detected printers from OS:', printers.length);
    res.json({ printers });
  } catch (error: any) {
    console.error('[Printer] Detection error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/printers/:id — get printer by ID
router.get('/:id', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    if (!printer) return res.status(404).json({ error: 'Printer not found' });
    res.json({ printer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers — create new printer configuration
router.post('/', (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, connection_type, ip_address, port, usb_device_path, paper_width, is_default } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!connection_type) return res.status(400).json({ error: 'connection_type is required' });
    if (!['network', 'usb', 'webusb'].includes(connection_type)) {
      return res.status(400).json({ error: 'connection_type must be network | usb | webusb' });
    }
    if (connection_type === 'network' && !ip_address) {
      return res.status(400).json({ error: 'ip_address is required for network printers' });
    }

    const db = getDatabase();
    const id = uuidv4();

    const existingPrinters = db.prepare('SELECT COUNT(*) as count FROM printers').get() as any;
    const isFirstPrinter = existingPrinters?.count === 0;
    const makeDefault = Boolean(is_default || isFirstPrinter);

    if (makeDefault) {
      db.prepare('UPDATE printers SET is_default = 0').run();
    }

    db.prepare(`
      INSERT INTO printers (id, name, connection_type, ip_address, port, usb_device_path, paper_width, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      connection_type,
      ip_address || null,
      port || 9100,
      usb_device_path || null,
      paper_width || '58mm',
      makeDefault ? 1 : 0,
      now(),
      now()
    );

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'printer.settings.updated',
      target_type: 'printer',
      target_id: id,
      details: {
        operation: 'create',
        name,
        connection_type,
        paper_width: paper_width || '58mm',
        is_default: makeDefault,
      },
    });

    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(id);
    res.status(201).json({ printer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/printers/:id — update printer
router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id) as any;
    if (!existing) return res.status(404).json({ error: 'Printer not found' });

    const { name, connection_type, ip_address, port, usb_device_path, paper_width, is_default } = req.body;

    if (is_default) {
      db.prepare('UPDATE printers SET is_default = 0').run();
    }

    db.prepare(`
      UPDATE printers SET
        name = COALESCE(?, name),
        connection_type = COALESCE(?, connection_type),
        ip_address = ?,
        port = COALESCE(?, port),
        usb_device_path = ?,
        paper_width = COALESCE(?, paper_width),
        is_default = COALESCE(?, is_default),
        updated_at = ?
      WHERE id = ?
    `).run(
      name || null,
      connection_type || null,
      ip_address !== undefined ? (ip_address || null) : existing.ip_address,
      port || null,
      usb_device_path !== undefined ? (usb_device_path || null) : existing.usb_device_path,
      paper_width || null,
      is_default !== undefined ? (is_default ? 1 : 0) : null,
      now(),
      req.params.id
    );

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'printer.settings.updated',
      target_type: 'printer',
      target_id: req.params.id,
      details: {
        operation: 'update',
        name: name || existing.name,
        connection_type: connection_type || existing.connection_type,
        paper_width: paper_width || existing.paper_width,
        is_default: is_default !== undefined ? is_default : existing.is_default,
      },
    });

    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
    res.json({ printer });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/printers/:id — delete printer
router.delete('/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id) as any;
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    db.prepare('DELETE FROM printers WHERE id = ?').run(req.params.id);

    // If deleted printer was default, assign default to first remaining printer
    if (printer.is_default === 1) {
      const firstRemaining = db.prepare('SELECT id FROM printers ORDER BY created_at ASC LIMIT 1').get() as any;
      if (firstRemaining) {
        db.prepare('UPDATE printers SET is_default = 1 WHERE id = ?').run(firstRemaining.id);
      }
    }

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'printer.settings.updated',
      target_type: 'printer',
      target_id: req.params.id,
      details: { operation: 'delete', name: printer.name },
    });

    res.json({ message: 'Printer deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/:id/set-default — set as default printer
router.post('/:id/set-default', (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id) as any;
    if (!printer) return res.status(404).json({ error: 'Printer not found' });

    db.prepare('UPDATE printers SET is_default = 0').run();
    db.prepare('UPDATE printers SET is_default = 1, updated_at = ? WHERE id = ?').run(now(), req.params.id);

    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'printer.settings.updated',
      target_type: 'printer',
      target_id: req.params.id,
      details: { operation: 'set_default', name: printer.name },
    });

    res.json({ message: 'Default printer set', printer: { ...printer, is_default: 1 } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/printers/:id/test — test print job 58mm
router.post('/:id/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = getDatabase();
    const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id) as any;
    if (!printer) {
      return res.status(404).json({
        success: false,
        code: 'PRINTER_NOT_FOUND',
        message: 'Printer tidak ditemukan.',
      });
    }

    const testData = buildTestPage(printer.paper_width || '58mm', printer.name);
    const printRes = await dispatchPrint(printer, testData);

    if (printRes.success) {
      createAuditLog(db, {
        actor_user_id: req.user?.id,
        actor_role: req.user?.role,
        action: 'printer.test_print.completed',
        target_type: 'printer',
        target_id: printer.id,
        details: { printer_name: printer.name, paper_width: printer.paper_width || '58mm' },
      });

      return res.json({
        success: true,
        jobId: `TEST-${Date.now()}`,
        printerName: printer.name,
        printedAt: new Date().toISOString(),
      });
    }

    return res.status(502).json({
      success: false,
      code: printRes.code || 'PRINT_FAILED',
      message: printRes.message || 'Printer tidak merespons. Periksa koneksi printer.',
    });
  } catch (error: any) {
    console.error('[Printer Test] Error:', error);
    res.status(500).json({
      success: false,
      code: 'PRINT_FAILED',
      message: 'Terjadi kesalahan sistem saat mencoba test print: ' + error.message,
    });
  }
});

// POST /api/printers/print-bill — print bill receipt (server is the source of truth)
router.post('/print-bill', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { billId, orderId, isReprint } = req.body;

    if (!billId && !orderId) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PRINT_DATA',
        message: 'billId atau orderId diperlukan untuk mencetak struk.',
      });
    }

    const db = getDatabase();

    let targetBillId = billId;
    if (!targetBillId && orderId) {
      const foundBill = db.prepare('SELECT id FROM bills WHERE order_id = ?').get(orderId) as any;
      if (foundBill) {
        targetBillId = foundBill.id;
      }
    }

    if (!targetBillId) {
      return res.status(404).json({
        success: false,
        code: 'INVALID_PRINT_DATA',
        message: 'Data tagihan/bill tidak ditemukan untuk transaksi ini.',
      });
    }

    const printRes = await printReceiptById(targetBillId, Boolean(isReprint), req.user?.id);

    if (printRes.success) {
      createAuditLog(db, {
        actor_user_id: req.user?.id,
        actor_role: req.user?.role,
        action: isReprint ? 'receipt.reprinted' : 'receipt.printed',
        target_type: 'bill',
        target_id: String(targetBillId),
        details: {
          is_reprint: Boolean(isReprint),
          printer_name: printRes.printerName,
          job_id: printRes.jobId,
        },
      });

      return res.json(printRes);
    }

    return res.status(502).json(printRes);
  } catch (error: any) {
    console.error('[Print Bill] Error:', error);
    res.status(500).json({
      success: false,
      code: 'PRINT_FAILED',
      message: 'Cetak struk gagal karena gangguan internal sistem.',
    });
  }
});

// POST /api/printers/retry-print — retry print job for a bill
router.post('/retry-print', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { billId } = req.body;
    if (!billId) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PRINT_DATA',
        message: 'billId diperlukan untuk melakukan retry print.',
      });
    }

    const db = getDatabase();
    createAuditLog(db, {
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
      action: 'printer.print.retry_requested',
      target_type: 'bill',
      target_id: String(billId),
      details: { retry: true },
    });

    const printRes = await printReceiptById(billId, false, req.user?.id);
    if (printRes.success) {
      return res.json(printRes);
    }
    return res.status(502).json(printRes);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      code: 'PRINT_FAILED',
      message: 'Gagal mengulang cetak struk: ' + error.message,
    });
  }
});

export const printerRoutes = router;
