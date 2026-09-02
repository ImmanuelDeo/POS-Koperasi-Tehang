import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// Bump this whenever the schema changes incompatibly
export const SCHEMA_VERSION = 19;

let db: Database.Database;

function usesElectronUserDataPath(): boolean {
  return Boolean(app?.isPackaged) || Boolean(process.env.FLO_USER_DATA_DIR?.trim());
}

export function getUserDataDirectory(): string {
  if (process.env.FLO_USER_DATA_DIR?.trim()) {
    return path.resolve(process.env.FLO_USER_DATA_DIR.trim());
  }
  if (usesElectronUserDataPath() && app?.getPath) {
    try {
      return app.getPath('userData');
    } catch {}
  }
  return path.join(__dirname, '../');
}

export function getDbPath(): string {
  return path.join(getUserDataDirectory(), 'flo.db');
}

function getBackupDir(): string {
  return path.join(getUserDataDirectory(), 'backups');
}

export function initDatabase(): void {
  const dbPath = getDbPath();
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // If database does not exist yet on target machine, check for bundled initial template
  if (!fs.existsSync(dbPath)) {
    const bundledTemplatePath = app?.isPackaged
      ? path.join(process.resourcesPath, 'initial-flo.db')
      : path.join(__dirname, '../flo.db');

    if (fs.existsSync(bundledTemplatePath) && path.resolve(bundledTemplatePath) !== path.resolve(dbPath)) {
      try {
        console.log(`[DB] First run: Initializing database from bundled template ${bundledTemplatePath}`);
        fs.copyFileSync(bundledTemplatePath, dbPath);
      } catch (err: any) {
        console.warn('[DB] Could not copy initial template:', err.message);
      }
    }
  }

  console.log(`[DB] Opening database at: ${dbPath}`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // Off during migrations

  runMigrations();

  db.pragma('foreign_keys = ON');
  startWalCheckpointDaemon();
}

let walCheckpointTimer: NodeJS.Timeout | null = null;

export function startWalCheckpointDaemon(): void {
  if (walCheckpointTimer) return;
  walCheckpointTimer = setInterval(() => {
    try {
      if (db) {
        db.exec('PRAGMA wal_checkpoint(PASSIVE);');
      }
    } catch {}
  }, 5 * 60 * 1000); // Checkpoint every 5 minutes in background
}

export function stopWalCheckpointDaemon(): void {
  if (walCheckpointTimer) {
    clearInterval(walCheckpointTimer);
    walCheckpointTimer = null;
  }
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDatabase(): void {
  stopWalCheckpointDaemon();
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      db.exec('PRAGMA optimize;');
    } catch (err: any) {
      console.warn('[DB] Checkpoint on close warning:', err.message);
    }
    db.close();
    console.log('[DB] Database closed cleanly');
  }
}

export async function createBackup(): Promise<string> {
  console.log('[DB] createBackup: Starting...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(getBackupDir(), `flo-backup-${timestamp}.db`);
  console.log('[DB] createBackup: Target path:', backupPath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {}
  await db.backup(backupPath);
  console.log(`[DB] Backup created: ${backupPath}`);
  return backupPath;
}

export function restoreBackup(backupPath: string): void {
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {}
    db.close();
  }
  const dbPath = getDbPath();
  // Remove companion WAL & SHM files so old transaction logs don't contaminate the restored database
  if (fs.existsSync(dbPath + '-wal')) {
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
  }
  if (fs.existsSync(dbPath + '-shm')) {
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  }
  fs.copyFileSync(backupPath, dbPath);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');
  runMigrations();
  db.pragma('foreign_keys = ON');
  console.log(`[DB] Restored and auto-migrated from: ${backupPath}`);
}

function getCurrentSchemaVersion(): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() as any;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

function tableExists(tableName: string): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    return !!row;
  } catch {
    return false;
  }
}

function columnExists(tableName: string, columnName: string): boolean {
  try {
    if (!tableExists(tableName)) return false;
    const columns = db.pragma(`table_info(${tableName})`) as any[];
    return columns.some((col: any) => col.name === columnName);
  } catch {
    return false;
  }
}

function dropAllTables(): void {
  console.log('[DB] Dropping all tables for schema migration...');
  const tables = [
    'salary_deductions', 'stock_movements',
    'loyalty_ledger', 'bills', 'order_items', 'orders',
    'addon_group_product', 'addons', 'addon_groups',
    'printers', 'kds_pairing_tokens', 'settings',
    'users', 'staff',  // handle both old and new name
    'customers', 'tables', 'kitchen_stations',
    'products', 'categories',
  ];
  for (const t of tables) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
}

function runMigrations(): void {
  console.log('[DB] Running migrations...');

  // Bootstrap: create settings table to check version
  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  if (!columnExists('settings', 'updated_at')) {
    try {
      db.exec(`ALTER TABLE settings ADD COLUMN updated_at TEXT`);
    } catch {}
  }

  const currentVersion = getCurrentSchemaVersion();
  console.log(`[DB] Schema version: ${currentVersion} → ${SCHEMA_VERSION}`);

  if (currentVersion === 0) {
    // Fresh install - create everything
    createSchema();
    seedData();
  } else if (currentVersion < SCHEMA_VERSION) {
    // Incremental migrations
    runIncrementalMigrations(currentVersion);
  }

  // Self-healing: Ensure users table has password & pin columns and at least 1 active user
  try {
    if (!columnExists('users', 'password')) {
      console.log('[DB] Adding missing password column to users table...');
      db.exec(`ALTER TABLE users ADD COLUMN password TEXT NOT NULL DEFAULT ''`);
    }
    if (!columnExists('users', 'pin')) {
      console.log('[DB] Adding missing pin column to users table...');
      db.exec(`ALTER TABLE users ADD COLUMN pin TEXT DEFAULT '1234'`);
    }

    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').get() as any)?.c || 0;
    if (userCount === 0) {
      console.log('[DB] Seeding default cooperative user accounts...');
      const hashedAdmin = bcrypt.hashSync('admin123', 10);
      const hashedKasir = bcrypt.hashSync('kasir123', 10);

      db.prepare(`
        INSERT OR REPLACE INTO users (id, name, email, password, pin, role, is_active, created_at, updated_at)
        VALUES ('user-owner-1', 'Pengelola Koperasi', 'admin@koperasi.local', ?, '1234', 'owner', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(hashedAdmin);

      db.prepare(`
        INSERT OR REPLACE INTO users (id, name, email, password, pin, role, is_active, created_at, updated_at)
        VALUES ('user-cashier-1', 'Kasir Utama', 'kasir@koperasi.local', ?, '1234', 'cashier', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(hashedKasir);

      db.prepare(`
        INSERT OR REPLACE INTO users (id, name, email, password, pin, role, is_active, created_at, updated_at)
        VALUES ('user-manager-1', 'Manajer Operasional', 'manager@koperasi.local', ?, '1234', 'manager', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(hashedAdmin);
    }

    // Deactivate legacy default account if present to prevent backdoors
    db.prepare(`UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE email IN ('admin@flo.local', 'chef@flo.local', 'kitchen@flo.local')`).run();
  } catch (err: any) {
    console.warn('[DB] User self-healing notice:', err.message);
  }

  // Ensure default country/currency are IDR/Rp/ID for POS Koperasi (non-destructive)
  try {
    db.prepare(`
      UPDATE settings
      SET value = CASE key
        WHEN 'country' THEN 'ID'
        WHEN 'currency' THEN 'IDR'
        WHEN 'currency_symbol' THEN 'Rp'
        WHEN 'timezone' THEN 'Asia/Jakarta'
      END,
      updated_at = CURRENT_TIMESTAMP
      WHERE key IN ('country', 'currency', 'currency_symbol', 'timezone')
        AND value IN ('IN', 'INR', '₹', 'Asia/Kolkata')
    `).run();
  } catch {
    // Safe fallback if settings table query fails
  }

  // Self-healing: Ensure all essential tables and columns exist in POS Koperasi
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tables (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        capacity INTEGER DEFAULT 4,
        status TEXT DEFAULT 'available',
        floor TEXT,
        section TEXT,
        position_x REAL,
        position_y REAL,
        kitchen_station_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        nik TEXT NULL,
        member_no TEXT NULL,
        employee_id TEXT NULL,
        name TEXT NOT NULL,
        department TEXT NULL,
        email TEXT,
        phone TEXT,
        country_code TEXT DEFAULT '+62',
        address TEXT,
        loyalty_points INTEGER DEFAULT 0,
        is_member INTEGER NOT NULL DEFAULT 1 CHECK(is_member IN (0, 1)),
        salary_deduction_enabled INTEGER NOT NULL DEFAULT 1 CHECK(salary_deduction_enabled IN (0, 1)),
        monthly_deduction_limit INTEGER NOT NULL DEFAULT 0 CHECK(monthly_deduction_limit >= 0),
        outstanding_deduction_limit INTEGER NOT NULL DEFAULT 0 CHECK(outstanding_deduction_limit >= 0),
        notes TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        table_id TEXT,
        customer_id TEXT,
        user_id TEXT,
        type TEXT DEFAULT 'takeaway',
        guest_count INTEGER,
        special_instructions TEXT,
        packaging_charge REAL DEFAULT 0,
        delivery_charge REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        subtotal REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        tax_breakdown TEXT,
        discount_amount REAL DEFAULT 0,
        discount_type TEXT,
        discount_value REAL,
        discount_reason TEXT,
        round_off REAL DEFAULT 0,
        total REAL DEFAULT 0,
        cooking_started_at TEXT,
        ready_at TEXT,
        served_at TEXT,
        completed_at TEXT,
        cancelled_at TEXT,
        cancellation_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        product_sku TEXT,
        unit_price REAL NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        subtotal REAL NOT NULL,
        tax_amount REAL DEFAULT 0,
        tax_breakdown TEXT,
        tax_type TEXT,
        discount_amount REAL DEFAULT 0,
        total REAL NOT NULL,
        variant_selection TEXT,
        modifier_selection TEXT,
        addons TEXT,
        special_instructions TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );

      CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bill_number TEXT UNIQUE NOT NULL,
        order_id INTEGER NOT NULL,
        customer_id TEXT,
        subtotal REAL DEFAULT 0,
        tax_amount REAL DEFAULT 0,
        tax_breakdown TEXT,
        discount_amount REAL DEFAULT 0,
        discount_type TEXT,
        discount_value REAL,
        discount_reason TEXT,
        delivery_charge REAL DEFAULT 0,
        packaging_charge REAL DEFAULT 0,
        round_off REAL DEFAULT 0,
        total REAL DEFAULT 0,
        paid_amount REAL DEFAULT 0,
        balance REAL DEFAULT 0,
        payment_status TEXT DEFAULT 'unpaid',
        payment_details TEXT,
        paid_at TEXT,
        printed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );

      CREATE TABLE IF NOT EXISTS salary_deductions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deduction_number TEXT NOT NULL UNIQUE,
        member_id TEXT NOT NULL,
        order_id INTEGER NOT NULL,
        bill_id INTEGER NOT NULL,
        amount INTEGER NOT NULL CHECK(amount > 0),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
        period_month TEXT NOT NULL,
        notes TEXT,
        rejection_reason TEXT,
        cancellation_reason TEXT,
        created_by TEXT NOT NULL,
        confirmed_by TEXT,
        rejected_by TEXT,
        cancelled_by TEXT,
        confirmed_at TEXT,
        rejected_at TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES customers(id),
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (bill_id) REFERENCES bills(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id),
        FOREIGN KEY (rejected_by) REFERENCES users(id),
        FOREIGN KEY (cancelled_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS loyalty_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        bill_id INTEGER,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS printers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        connection_type TEXT NOT NULL CHECK (connection_type IN ('network', 'usb', 'webusb')),
        ip_address TEXT,
        port INTEGER DEFAULT 9100,
        usb_device_path TEXT,
        is_default INTEGER DEFAULT 0,
        paper_width TEXT DEFAULT '80mm',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS addon_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category_name TEXT,
        description TEXT,
        promo_start_date TEXT,
        promo_end_date TEXT,
        is_forever INTEGER DEFAULT 1,
        bundle_price REAL,
        is_required INTEGER DEFAULT 0,
        min_selection INTEGER DEFAULT 0,
        max_selection INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS addons (
        id TEXT PRIMARY KEY,
        addon_group_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (addon_group_id) REFERENCES addon_groups(id)
      );

      CREATE TABLE IF NOT EXISTS addon_group_product (
        product_id TEXT NOT NULL,
        addon_group_id TEXT NOT NULL,
        PRIMARY KEY (product_id, addon_group_id)
      );
    `);

    // Ensure missing columns in customers
    if (!columnExists('customers', 'monthly_deduction_limit')) {
      db.exec(`ALTER TABLE customers ADD COLUMN monthly_deduction_limit INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columnExists('customers', 'outstanding_deduction_limit')) {
      db.exec(`ALTER TABLE customers ADD COLUMN outstanding_deduction_limit INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columnExists('customers', 'nik')) {
      db.exec(`ALTER TABLE customers ADD COLUMN nik TEXT NULL`);
    }
    if (!columnExists('customers', 'member_no')) {
      db.exec(`ALTER TABLE customers ADD COLUMN member_no TEXT NULL`);
    }
    if (!columnExists('customers', 'employee_id')) {
      db.exec(`ALTER TABLE customers ADD COLUMN employee_id TEXT NULL`);
    }
    if (!columnExists('customers', 'department')) {
      db.exec(`ALTER TABLE customers ADD COLUMN department TEXT NULL`);
    }
    if (!columnExists('customers', 'notes')) {
      db.exec(`ALTER TABLE customers ADD COLUMN notes TEXT NULL`);
    }
    if (!columnExists('customers', 'address')) {
      db.exec(`ALTER TABLE customers ADD COLUMN address TEXT NULL`);
    }
    if (!columnExists('customers', 'is_member')) {
      db.exec(`ALTER TABLE customers ADD COLUMN is_member INTEGER NOT NULL DEFAULT 1`);
    }
    if (!columnExists('customers', 'salary_deduction_enabled')) {
      db.exec(`ALTER TABLE customers ADD COLUMN salary_deduction_enabled INTEGER NOT NULL DEFAULT 1`);
    }
    if (!columnExists('customers', 'is_active')) {
      db.exec(`ALTER TABLE customers ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
    }

    // 6. Invariant enforcement: Permanently drop unique barcode indexes across all databases
    try {
      db.exec(`DROP INDEX IF EXISTS idx_products_barcode_unique`);
      db.exec(`DROP INDEX IF EXISTS idx_products_barcode_clean`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL AND trim(barcode) != ''`);
    } catch (err: any) {
      console.warn('[DB] Self-healing barcode index notice:', err.message);
    }
  } catch (err: any) {
    console.warn('[DB] Self-healing table check notice:', err.message);
  }

  console.log('[DB] Migrations complete');
}

function runIncrementalMigrations(fromVersion: number): void {
  const insert = (key: string, value: string) =>
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);

  // Migration from version 7 to 8
  if (fromVersion < 8) {
    console.log('[DB] Running migration to v8...');

    // Add printers table if it doesn't exist
    db.exec(`CREATE TABLE IF NOT EXISTS printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL CHECK (connection_type IN ('network', 'usb', 'webusb')),
      ip_address TEXT,
      port INTEGER DEFAULT 9100,
      usb_device_path TEXT,
      is_default INTEGER DEFAULT 0,
      paper_width TEXT DEFAULT '80mm',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add default printer if none exists
    const existingPrinter = db.prepare('SELECT COUNT(*) as count FROM printers').get() as any;
    if (!existingPrinter || existingPrinter.count === 0) {
      db.prepare(`
        INSERT INTO printers (id, name, connection_type, paper_width, is_default)
        VALUES (?, ?, ?, ?, ?)
      `).run('printer-1', 'Thermal Printer', 'usb', '80mm', 1);
      console.log('[DB] Added default printer');
    }
  }

  // Migration from version 8 to 9 (POS Koperasi Sembako)
  if (fromVersion < 9) {
    console.log('[DB] Running migration to v9 (POS Koperasi Sembako)...');

    const migrationV9 = db.transaction(() => {
      // 1. Update products table columns
      if (!columnExists('products', 'unit')) {
        db.exec(`ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'pcs' CHECK(unit IN ('pcs','kg','gram','liter','ml','pack','pouch','box','sak','tray'))`);
      }
      if (!columnExists('products', 'allow_decimal')) {
        db.exec(`ALTER TABLE products ADD COLUMN allow_decimal INTEGER NOT NULL DEFAULT 0 CHECK(allow_decimal IN (0, 1))`);
      }
      if (!columnExists('products', 'member_price')) {
        db.exec(`ALTER TABLE products ADD COLUMN member_price INTEGER NULL CHECK(member_price IS NULL OR member_price >= 0)`);
      }
      if (!columnExists('products', 'min_reorder_qty')) {
        db.exec(`ALTER TABLE products ADD COLUMN min_reorder_qty REAL NOT NULL DEFAULT 0 CHECK(min_reorder_qty >= 0)`);
      }

      // 2. Update customers table columns
      if (!columnExists('customers', 'member_no')) {
        db.exec(`ALTER TABLE customers ADD COLUMN member_no TEXT NULL`);
      }
      if (!columnExists('customers', 'employee_id')) {
        db.exec(`ALTER TABLE customers ADD COLUMN employee_id TEXT NULL`);
      }
      if (!columnExists('customers', 'department')) {
        db.exec(`ALTER TABLE customers ADD COLUMN department TEXT NULL`);
      }
      if (!columnExists('customers', 'is_member')) {
        db.exec(`ALTER TABLE customers ADD COLUMN is_member INTEGER NOT NULL DEFAULT 0 CHECK(is_member IN (0, 1))`);
      }
      if (!columnExists('customers', 'salary_deduction_enabled')) {
        db.exec(`ALTER TABLE customers ADD COLUMN salary_deduction_enabled INTEGER NOT NULL DEFAULT 1 CHECK(salary_deduction_enabled IN (0, 1))`);
      }
      if (!columnExists('customers', 'monthly_deduction_limit')) {
        db.exec(`ALTER TABLE customers ADD COLUMN monthly_deduction_limit INTEGER NOT NULL DEFAULT 0 CHECK(monthly_deduction_limit >= 0)`);
      }
      if (!columnExists('customers', 'outstanding_deduction_limit')) {
        db.exec(`ALTER TABLE customers ADD COLUMN outstanding_deduction_limit INTEGER NOT NULL DEFAULT 0 CHECK(outstanding_deduction_limit >= 0)`);
      }

      // 3. Customer partial unique indexes & active index
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_member_no_unique ON customers(member_no) WHERE member_no IS NOT NULL`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_employee_id_unique ON customers(employee_id) WHERE employee_id IS NOT NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_is_member_active ON customers(is_member, is_active)`);

      // 4. Create stock_movements table & indexes
      db.exec(`CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        movement_type TEXT NOT NULL CHECK (
          movement_type IN ('initial', 'purchase', 'sale', 'adjustment', 'refund', 'opname', 'void')
        ),
        quantity REAL NOT NULL,
        balance_before REAL NOT NULL,
        balance_after REAL NOT NULL,
        unit_cost INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
        reference_type TEXT,
        reference_id TEXT,
        notes TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created ON stock_movements(product_id, created_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference_type, reference_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_movements_created_by ON stock_movements(created_by)`);

      // 5. Create salary_deductions table & indexes
      db.exec(`CREATE TABLE IF NOT EXISTS salary_deductions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deduction_number TEXT NOT NULL UNIQUE,
        member_id TEXT NOT NULL,
        order_id INTEGER NOT NULL,
        bill_id INTEGER NOT NULL,
        amount INTEGER NOT NULL CHECK(amount > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
        period_month TEXT NOT NULL,
        notes TEXT,
        rejection_reason TEXT,
        cancellation_reason TEXT,
        created_by TEXT NOT NULL,
        confirmed_by TEXT,
        rejected_by TEXT,
        cancelled_by TEXT,
        confirmed_at TEXT,
        rejected_at TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES customers(id),
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (bill_id) REFERENCES bills(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id),
        FOREIGN KEY (rejected_by) REFERENCES users(id),
        FOREIGN KEY (cancelled_by) REFERENCES users(id)
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_salary_deductions_member_status_period ON salary_deductions(member_id, status, period_month)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_salary_deductions_status_created ON salary_deductions(status, created_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_salary_deductions_bill ON salary_deductions(bill_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_salary_deductions_order ON salary_deductions(order_id)`);

      // 6. Insert new default cooperative settings (without overwriting existing)
      insert('business_type', 'cooperative');
      insert('currency', 'IDR');
      insert('currency_symbol', 'Rp');
      insert('timezone', 'Asia/Jakarta');
      insert('tax_scheme', 'none');
      insert('tax_registered', 'false');
      insert('tax_rate', '0');
      insert('salary_deduction_monthly_limit_enabled', 'true');
      insert('salary_deduction_outstanding_limit_enabled', 'true');
      insert('salary_deduction_cutoff_day', '25');
      insert('allow_negative_stock', 'false');
      insert('stock_opname_require_pin', 'true');
    });

    migrationV9();
    console.log('[DB] Migration to v9 complete');
  }

  if (fromVersion < 10) {
    console.log('[DB] Applying migration to v10 (NIK member identifier & audit logs)...');
    const migrationV10 = db.transaction(() => {
      // 1. Add nik column to customers if not exists
      if (!columnExists('customers', 'nik')) {
        db.exec(`ALTER TABLE customers ADD COLUMN nik TEXT`);
      }

      // 2. Add partial unique index for nik (single-tenant schema)
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_nik_unique
        ON customers(nik) WHERE nik IS NOT NULL AND nik != ''`);

      // 3. Create audit_logs table and indexes
      db.exec(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
      )`);

      db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON audit_logs(action, created_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id)`);
    });

    migrationV10();
    console.log('[DB] Migration to v10 complete');
  }

  // Migration to version 11 (Product Barcode Unique Index)
  if (fromVersion < 11) {
    console.log('[DB] Applying migration to v11 (Product Barcode unique index & SKU index)...');
    const migrationV11 = db.transaction(() => {
      // 1. Ensure barcode column exists on products table
      if (!columnExists('products', 'barcode')) {
        db.exec(`ALTER TABLE products ADD COLUMN barcode TEXT`);
      }

      // 2. Partial unique index on barcode (single-tenant schema)
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
        ON products(barcode) WHERE barcode IS NOT NULL AND trim(barcode) != ''`);

      // 3. Index on SKU
      db.exec(`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)`);
    });

    migrationV11();
    console.log('[DB] Migration to v11 complete');
  }

  // Migration to version 12 (Universal Salary Deduction Privilege for All Koperasi Members)
  if (fromVersion < 12) {
    console.log('[DB] Applying migration to v12 (Universal Salary Deduction Privilege for All Koperasi Members)...');
    const migrationV12 = db.transaction(() => {
      db.exec(`UPDATE customers SET is_member = 1, salary_deduction_enabled = 1 WHERE is_active IS NULL OR is_active = 1`);
    });

    migrationV12();
    console.log('[DB] Migration to v12 complete');
  }

  // Migration to version 13 (Update business_name to 'Koperasi')
  if (fromVersion < 13) {
    console.log('[DB] Applying migration to v13 (Update business_name to Koperasi)...');
    const migrationV13 = db.transaction(() => {
      db.exec(`UPDATE settings SET value = 'Koperasi', updated_at = CURRENT_TIMESTAMP WHERE key = 'business_name'`);
    });

    migrationV13();
    console.log('[DB] Migration to v13 complete');
  }

  // Migration to version 14 (Add-ons Bundling/Promo Schema & QRIS/Bank Settings)
  if (fromVersion < 14) {
    console.log('[DB] Applying migration to v14 (Add-ons Bundling/Promo & Payment Settings)...');
    const migrationV14 = db.transaction(() => {
      // 1. Ensure addon_groups, addons, and addon_group_product tables exist
      db.exec(`CREATE TABLE IF NOT EXISTS addon_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category_name TEXT,
        description TEXT,
        promo_start_date TEXT,
        promo_end_date TEXT,
        is_forever INTEGER DEFAULT 1,
        bundle_price REAL,
        is_required INTEGER DEFAULT 0,
        min_selection INTEGER DEFAULT 0,
        max_selection INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS addons (
        id TEXT PRIMARY KEY,
        addon_group_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (addon_group_id) REFERENCES addon_groups(id)
      )`);

      db.exec(`CREATE TABLE IF NOT EXISTS addon_group_product (
        product_id TEXT NOT NULL,
        addon_group_id TEXT NOT NULL,
        PRIMARY KEY (product_id, addon_group_id)
      )`);

      // Add columns if addon_groups was pre-existing from an earlier schema without these fields
      if (!columnExists('addon_groups', 'category_name')) {
        db.exec(`ALTER TABLE addon_groups ADD COLUMN category_name TEXT`);
      }
      if (!columnExists('addon_groups', 'promo_start_date')) {
        db.exec(`ALTER TABLE addon_groups ADD COLUMN promo_start_date TEXT`);
      }
      if (!columnExists('addon_groups', 'promo_end_date')) {
        db.exec(`ALTER TABLE addon_groups ADD COLUMN promo_end_date TEXT`);
      }
      if (!columnExists('addon_groups', 'is_forever')) {
        db.exec(`ALTER TABLE addon_groups ADD COLUMN is_forever INTEGER DEFAULT 1`);
      }
      if (!columnExists('addon_groups', 'bundle_price')) {
        db.exec(`ALTER TABLE addon_groups ADD COLUMN bundle_price REAL`);
      }

      // 2. Default settings for QRIS and Bank Transfer if not exist
      const defaultSettings = [
        ['qris_merchant_name', 'Koperasi Karyawan Tehang'],
        ['qris_image_url', ''],
        ['bank_name', 'Bank BCA'],
        ['bank_account_number', '1234567890'],
        ['bank_account_holder', 'Koperasi Tehang'],
      ];
      const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      for (const [k, v] of defaultSettings) {
        insertSetting.run(k, v);
      }
    });

    migrationV14();
    console.log('[DB] Migration to v14 complete');
  }

  // Migration to version 15 (WhatsApp Official Campaign, Opt-in Consent & Templates)
  if (fromVersion < 15) {
    console.log('[DB] Applying migration to v15 (WhatsApp Campaign & Consent Schema)...');
    const migrationV15 = db.transaction(() => {
      // 1. Add marketing consent columns to customers table
      if (!columnExists('customers', 'whatsapp_marketing_opt_in')) {
        db.exec(`ALTER TABLE customers ADD COLUMN whatsapp_marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(whatsapp_marketing_opt_in IN (0, 1))`);
      }
      if (!columnExists('customers', 'whatsapp_marketing_opt_in_at')) {
        db.exec(`ALTER TABLE customers ADD COLUMN whatsapp_marketing_opt_in_at TEXT NULL`);
      }
      if (!columnExists('customers', 'whatsapp_marketing_opt_in_source')) {
        db.exec(`ALTER TABLE customers ADD COLUMN whatsapp_marketing_opt_in_source TEXT NULL`);
      }
      if (!columnExists('customers', 'whatsapp_marketing_policy_version')) {
        db.exec(`ALTER TABLE customers ADD COLUMN whatsapp_marketing_policy_version TEXT NULL`);
      }
      if (!columnExists('customers', 'whatsapp_marketing_opt_out_at')) {
        db.exec(`ALTER TABLE customers ADD COLUMN whatsapp_marketing_opt_out_at TEXT NULL`);
      }
      if (!columnExists('customers', 'whatsapp_marketing_opt_out_reason')) {
        db.exec(`ALTER TABLE customers ADD COLUMN whatsapp_marketing_opt_out_reason TEXT NULL`);
      }

      // 2. Index for fast opt-in segment filtering
      db.exec(`CREATE INDEX IF NOT EXISTS idx_customers_wa_optin ON customers(whatsapp_marketing_opt_in, is_active)`);

      // 3. Consent logs table
      db.exec(`CREATE TABLE IF NOT EXISTS customer_consent_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('OPT_IN', 'OPT_OUT')),
        source TEXT NOT NULL,
        policy_version TEXT,
        actor_user_id TEXT NULL,
        reason TEXT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (actor_user_id) REFERENCES users(id)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_consent_logs_customer ON customer_consent_logs(customer_id, created_at)`);

      // 4. WhatsApp Templates table
      db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id TEXT PRIMARY KEY,
        provider_template_id TEXT NULL,
        template_name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL CHECK(category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
        language TEXT NOT NULL DEFAULT 'id',
        status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'approved', 'rejected', 'paused')),
        header_type TEXT NULL CHECK(header_type IN ('TEXT', 'IMAGE', 'DOCUMENT', 'NONE')),
        header_content TEXT NULL,
        body_text TEXT NOT NULL,
        footer_text TEXT NULL,
        buttons_json TEXT NULL,
        variable_schema_json TEXT NULL,
        rejection_reason TEXT NULL,
        synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_templates_status ON whatsapp_templates(status)`);

      // 5. WhatsApp Campaigns table
      db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template_id TEXT NOT NULL,
        template_variables_json TEXT NOT NULL DEFAULT '{}',
        target_criteria_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
        scheduled_at_utc TEXT NULL,
        scheduled_at_wib_label TEXT NULL,
        started_at TEXT NULL,
        completed_at TEXT NULL,
        created_by TEXT NOT NULL,
        approved_by TEXT NULL,
        cancelled_by TEXT NULL,
        recipient_count_estimate INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        delivered_count INTEGER NOT NULL DEFAULT 0,
        read_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id),
        FOREIGN KEY (cancelled_by) REFERENCES users(id)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_campaigns_status_sched ON whatsapp_campaigns(status, scheduled_at_utc)`);

      // 6. WhatsApp Campaign Recipients table
      db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_campaign_recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        phone_e164 TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'opted_out')),
        provider_message_id TEXT NULL,
        error_code TEXT NULL,
        error_category TEXT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT NULL,
        delivered_at TEXT NULL,
        read_at TEXT NULL,
        failed_at TEXT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES whatsapp_campaigns(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        UNIQUE(campaign_id, customer_id)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_recipients_camp_status ON whatsapp_campaign_recipients(campaign_id, status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_wa_recipients_prov_msg ON whatsapp_campaign_recipients(provider_message_id)`);

      // 7. Seed standard approved cooperative marketing templates
      const seedTemplate = db.prepare(`
        INSERT OR IGNORE INTO whatsapp_templates (
          id, template_name, category, language, status, header_type, body_text, footer_text, buttons_json, variable_schema_json, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      seedTemplate.run(
        'tpl-promo-sembako-1',
        'koperasi_promo_sembako',
        'MARKETING',
        'id',
        'approved',
        'TEXT',
        'Halo {{1}}, ada kabar gembira dari {{2}}! Nikmati promo {{3}} khusus anggota aktif. Promo berlaku hingga {{4}}. Kunjungi toko koperasi kami atau hubungi pengurus.',
        'Balas STOP untuk berhenti menerima info promo.',
        JSON.stringify([{ type: 'QUICK_REPLY', text: 'Lihat Promo' }, { type: 'QUICK_REPLY', text: 'STOP' }]),
        JSON.stringify(['recipient_name', 'business_name', 'promo_title', 'valid_until'])
      );

      seedTemplate.run(
        'tpl-bazar-hemat-2',
        'koperasi_bazar_hemat',
        'MARKETING',
        'id',
        'approved',
        'TEXT',
        'Salam hangat {{1}}, {{2}} mengadakan program {{3}} dengan penawaran spesial untuk kebutuhan harian Anda. Berlaku sampai {{4}}. Jangan lewatkan kesempatan ini!',
        'Balas STOP untuk berhenti berlangganan.',
        JSON.stringify([{ type: 'QUICK_REPLY', text: 'Info Lengkap' }, { type: 'QUICK_REPLY', text: 'STOP' }]),
        JSON.stringify(['recipient_name', 'business_name', 'promo_title', 'valid_until'])
      );

      seedTemplate.run(
        'tpl-voucher-spesial-3',
        'koperasi_voucher_belanja',
        'MARKETING',
        'id',
        'approved',
        'TEXT',
        'Yth. {{1}}, dapatkan keuntungan belanja di {{2}} dengan kode voucher {{3}} untuk {{4}}. Berlaku sampai {{5}} di gerai Koperasi.',
        'Balas STOP untuk berhenti menerima pesan promo.',
        JSON.stringify([{ type: 'QUICK_REPLY', text: 'Gunakan Voucher' }, { type: 'QUICK_REPLY', text: 'STOP' }]),
        JSON.stringify(['recipient_name', 'business_name', 'promo_code', 'promo_title', 'valid_until'])
      );
    });

    migrationV15();
    console.log('[DB] Migration to v15 complete');
  }

  if (fromVersion < 16) {
    console.log('[DB] Applying migration to v16 (Staff Granular Section Access Permissions)...');
    const migrationV16 = db.transaction(() => {
      // 1. Add permissions column to users table if not exists
      if (!columnExists('users', 'permissions')) {
        db.exec(`ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]'`);
      }

      // 2. Initialize default permissions for existing users
      const allUsers = db.prepare(`SELECT id, role, permissions FROM users`).all() as any[];
      const updatePerms = db.prepare(`UPDATE users SET permissions = ? WHERE id = ?`);

      for (const u of allUsers) {
        let perms: string[] = [];
        try {
          perms = JSON.parse(u.permissions || '[]');
        } catch {
          perms = [];
        }

        if (perms.length === 0) {
          if (u.role === 'owner') {
            perms = ['pos', 'dashboard', 'orders', 'products', 'addon_groups', 'customers', 'reports', 'whatsapp', 'staff', 'settings', 'salary_deductions', 'stock_movements', 'db_backup'];
          } else if (u.role === 'manager' || u.role === 'admin') {
            perms = ['pos', 'dashboard', 'orders', 'products', 'addon_groups', 'customers', 'reports', 'whatsapp', 'staff', 'salary_deductions', 'stock_movements'];
          } else if (u.role === 'office_hr') {
            perms = ['dashboard', 'customers', 'salary_deductions', 'reports'];
          } else if (u.role === 'office_inventory') {
            perms = ['products', 'stock_movements', 'reports'];
          } else if (u.role === 'cashier' || u.role === 'waiter') {
            perms = ['pos', 'orders', 'customers'];
          } else if (u.role === 'chef') {
            perms = ['pos', 'orders'];
          } else {
            perms = ['pos'];
          }
          updatePerms.run(JSON.stringify(perms), u.id);
        }
      }
    });

    migrationV16();
    console.log('[DB] Migration to v16 complete');
  }

  // Migration to version 17 (Print Jobs Queue, HOLD mechanism & Offline Resilience)
  if (fromVersion < 17) {
    console.log('[DB] Applying migration to v17 (Print Jobs Queue & Persistence)...');
    const migrationV17 = db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        bill_id INTEGER NOT NULL,
        receipt_data TEXT,
        printer_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'printing', 'completed', 'failed', 'cancelled')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 10,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (bill_id) REFERENCES bills(id)
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, created_at)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_print_jobs_bill_id ON print_jobs(bill_id)`);
    });

    migrationV17();
    console.log('[DB] Migration to v17 complete');
  }

  // Migration to version 18 (Component-Based Bundle & POS Add-Ons)
  if (fromVersion < 18) {
    console.log('[DB] Applying migration to v18 (Component-Based Bundling & POS Add-Ons)...');
    const migrationV18 = db.transaction(() => {
      // 1. Add product_id and quantity to addons
      if (!columnExists('addons', 'product_id')) {
        db.exec(`ALTER TABLE addons ADD COLUMN product_id TEXT REFERENCES products(id)`);
      }
      if (!columnExists('addons', 'quantity')) {
        db.exec(`ALTER TABLE addons ADD COLUMN quantity REAL NOT NULL DEFAULT 1`);
      }

      // 2. Add show_in_pos to addon_groups
      if (!columnExists('addon_groups', 'show_in_pos')) {
        db.exec(`ALTER TABLE addon_groups ADD COLUMN show_in_pos INTEGER NOT NULL DEFAULT 0`);
      }

      // 3. Performance indexes for component lookup and POS bundle listing
      db.exec(`CREATE INDEX IF NOT EXISTS idx_addons_product_id ON addons(product_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_addons_group_active ON addons(addon_group_id, is_active)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_addon_groups_pos ON addon_groups(show_in_pos, is_active)`);
    });

    migrationV18();
    console.log('[DB] Migration to v18 complete');
  }

  // Migration to version 19 (Non-unique Barcodes & Product Units Reference & Flexible Units)
  if (fromVersion < 19) {
    console.log('[DB] Applying migration to v19 (Non-unique Barcodes & Product Units Reference)...');
    const migrationV19 = db.transaction(() => {
      // 1. Relax unit column CHECK constraint in products table if present
      const productsTableInfo = (db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='products'`).get() as any)?.sql || '';
      if (productsTableInfo.includes('CHECK(unit IN') || productsTableInfo.includes('CHECK (unit IN')) {
        db.exec(`PRAGMA foreign_keys = OFF;`);
        db.exec(`
          CREATE TABLE products_v19_tmp (
            id TEXT PRIMARY KEY,
            category_id TEXT,
            name TEXT NOT NULL,
            description TEXT,
            unit TEXT NOT NULL DEFAULT 'pcs',
            allow_decimal INTEGER NOT NULL DEFAULT 0 CHECK(allow_decimal IN (0, 1)),
            price REAL NOT NULL DEFAULT 0,
            member_price INTEGER NULL CHECK(member_price IS NULL OR member_price >= 0),
            cost REAL DEFAULT 0,
            sku TEXT,
            barcode TEXT,
            image_url TEXT,
            is_active INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            track_inventory INTEGER DEFAULT 0,
            stock_quantity REAL DEFAULT 0,
            low_stock_threshold REAL DEFAULT 5,
            min_reorder_qty REAL NOT NULL DEFAULT 0 CHECK(min_reorder_qty >= 0),
            tax_type TEXT DEFAULT 'none',
            tax_rate REAL DEFAULT 0,
            cb_percent REAL DEFAULT 0,
            tags TEXT,
            deleted_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
        `);
        const existingCols = (db.prepare(`PRAGMA table_info(products)`).all() as any[]).map(c => c.name);
        const targetCols = [
          'id', 'category_id', 'name', 'description', 'unit', 'allow_decimal',
          'price', 'member_price', 'cost', 'sku', 'barcode', 'image_url',
          'is_active', 'sort_order', 'track_inventory', 'stock_quantity',
          'low_stock_threshold', 'min_reorder_qty', 'tax_type', 'tax_rate',
          'cb_percent', 'tags', 'deleted_at', 'created_at', 'updated_at'
        ];
        const commonCols = targetCols.filter(c => existingCols.includes(c));
        const colList = commonCols.join(', ');
        db.exec(`INSERT INTO products_v19_tmp (${colList}) SELECT ${colList} FROM products;`);
        db.exec(`
          DROP TABLE products;
          ALTER TABLE products_v19_tmp RENAME TO products;
          CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
          CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
          CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
        `);
        db.exec(`PRAGMA foreign_keys = ON;`);
      }

      // 2. Drop existing unique barcode indexes (verified via PRAGMA index_list)
      db.exec(`DROP INDEX IF EXISTS idx_products_barcode_unique`);
      db.exec(`DROP INDEX IF EXISTS idx_products_barcode_clean`);

      // 3. Create non-unique barcode index for fast lookup
      db.exec(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL AND trim(barcode) != ''`);

      // 4. Create product_units table for flexible unit suggestions
      db.exec(`CREATE TABLE IF NOT EXISTS product_units (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);

      // 5. Seed initial standard units (as starting suggestions, not a restrictive whitelist)
      const standardUnits = [
        'pcs', 'kg', 'gram', 'liter', 'ml', 'pack', 'pouch', 'box', 'sak', 'tray',
        'dus', 'renceng', 'botol', 'ikat', 'bungkus', 'butir', 'karton', 'kaleng', 'sachet', 'lusin', 'galon'
      ];
      const insertUnitStmt = db.prepare(`INSERT OR IGNORE INTO product_units (id, name, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`);
      for (const u of standardUnits) {
        insertUnitStmt.run(uuidv4(), u);
      }

      // 6. Populate any existing custom units from products table
      const existingUnits = db.prepare(`SELECT DISTINCT unit FROM products WHERE unit IS NOT NULL AND trim(unit) != ''`).all() as any[];
      for (const row of existingUnits) {
        const clean = String(row.unit).trim();
        if (clean) {
          insertUnitStmt.run(uuidv4(), clean);
        }
      }
    });

    migrationV19();
    console.log('[DB] Migration to v19 complete');
  }

  // Update schema version
  if (columnExists('settings', 'updated_at')) {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(String(SCHEMA_VERSION));
  } else {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(SCHEMA_VERSION));
  }
  console.log('[DB] Incremental migration complete');
}

function createSchema(): void {
  db.exec(`
    -- ── Master data tables ──────────────────────────────────────────────

    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      parent_id TEXT,
      slug TEXT,
      color TEXT,
      icon TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      unit TEXT NOT NULL DEFAULT 'pcs',
      allow_decimal INTEGER NOT NULL DEFAULT 0
        CHECK(allow_decimal IN (0, 1)),
      price REAL NOT NULL DEFAULT 0,
      member_price INTEGER NULL
        CHECK(member_price IS NULL OR member_price >= 0),
      cost REAL DEFAULT 0,
      sku TEXT,
      barcode TEXT,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      track_inventory INTEGER DEFAULT 0,
      stock_quantity REAL DEFAULT 0,
      low_stock_threshold REAL DEFAULT 5,
      min_reorder_qty REAL NOT NULL DEFAULT 0
        CHECK(min_reorder_qty >= 0),
      tax_type TEXT DEFAULT 'none',
      tax_rate REAL DEFAULT 0,
      cb_percent REAL DEFAULT 0,
      tags TEXT,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE addon_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_name TEXT,
      description TEXT,
      promo_start_date TEXT,
      promo_end_date TEXT,
      is_forever INTEGER DEFAULT 1,
      bundle_price REAL,
      is_required INTEGER DEFAULT 0,
      min_selection INTEGER DEFAULT 0,
      max_selection INTEGER DEFAULT 1,
      show_in_pos INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE addons (
      id TEXT PRIMARY KEY,
      addon_group_id TEXT NOT NULL,
      product_id TEXT,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (addon_group_id) REFERENCES addon_groups(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE addon_group_product (
      product_id TEXT NOT NULL,
      addon_group_id TEXT NOT NULL,
      PRIMARY KEY (product_id, addon_group_id)
    );

    CREATE TABLE kitchen_stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category_ids TEXT,
      printer_ip TEXT,
      printer_port INTEGER DEFAULT 9100,
      printer_name TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tables (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      capacity INTEGER DEFAULT 4,
      status TEXT DEFAULT 'available',
      floor TEXT,
      section TEXT,
      position_x REAL,
      position_y REAL,
      kitchen_station_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      nik TEXT NULL,
      member_no TEXT NULL,
      employee_id TEXT NULL,
      name TEXT NOT NULL,
      department TEXT NULL,
      email TEXT,
      phone TEXT,
      country_code TEXT DEFAULT '+62',
      address TEXT,
      loyalty_points INTEGER DEFAULT 0,
      is_member INTEGER NOT NULL DEFAULT 0
        CHECK(is_member IN (0, 1)),
      salary_deduction_enabled INTEGER NOT NULL DEFAULT 1
        CHECK(salary_deduction_enabled IN (0, 1)),
      monthly_deduction_limit INTEGER NOT NULL DEFAULT 0
        CHECK(monthly_deduction_limit >= 0),
      outstanding_deduction_limit INTEGER NOT NULL DEFAULT 0
        CHECK(outstanding_deduction_limit >= 0),
      notes TEXT,
      whatsapp_marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(whatsapp_marketing_opt_in IN (0, 1)),
      whatsapp_marketing_opt_in_at TEXT NULL,
      whatsapp_marketing_opt_in_source TEXT NULL,
      whatsapp_marketing_policy_version TEXT NULL,
      whatsapp_marketing_opt_out_at TEXT NULL,
      whatsapp_marketing_opt_out_reason TEXT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Stock Movements (Inventory Audit Ledger) ─────────────────────────

    CREATE TABLE stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      movement_type TEXT NOT NULL CHECK (
        movement_type IN (
          'initial',
          'purchase',
          'sale',
          'adjustment',
          'refund',
          'opname',
          'void'
        )
      ),
      quantity REAL NOT NULL,
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      unit_cost INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
      reference_type TEXT,
      reference_id TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- ── Salary Deductions (Internal Cooperative Receivables) ─────────────

    CREATE TABLE salary_deductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deduction_number TEXT NOT NULL UNIQUE,
      member_id TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      amount INTEGER NOT NULL CHECK(amount > 0),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
      period_month TEXT NOT NULL,
      notes TEXT,
      rejection_reason TEXT,
      cancellation_reason TEXT,
      created_by TEXT NOT NULL,
      confirmed_by TEXT,
      rejected_by TEXT,
      cancelled_by TEXT,
      confirmed_at TEXT,
      rejected_at TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_id) REFERENCES customers(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (bill_id) REFERENCES bills(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (confirmed_by) REFERENCES users(id),
      FOREIGN KEY (rejected_by) REFERENCES users(id),
      FOREIGN KEY (cancelled_by) REFERENCES users(id)
    );

    -- ── Users (authentication + roles) ──────────────────────────────────
    -- Roles: owner, manager, cashier, waiter, chef
    -- KDS is operated by the chef role.

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier'
        CHECK (role IN ('owner', 'admin', 'manager', 'cashier', 'office_hr', 'office_inventory', 'waiter', 'chef')),
      permissions TEXT NOT NULL DEFAULT '[]',
      pin TEXT,
      category_ids TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Transactional tables ─────────────────────────────────────────────

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      table_id TEXT,
      customer_id TEXT,
      user_id TEXT,
      type TEXT DEFAULT 'takeaway',
      guest_count INTEGER,
      special_instructions TEXT,
      packaging_charge REAL DEFAULT 0,
      delivery_charge REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      subtotal REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL,
      discount_reason TEXT,
      round_off REAL DEFAULT 0,
      total REAL DEFAULT 0,
      cooking_started_at TEXT,
      ready_at TEXT,
      served_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      cancellation_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_sku TEXT,
      unit_price REAL NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      subtotal REAL NOT NULL,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      tax_type TEXT,
      discount_amount REAL DEFAULT 0,
      total REAL NOT NULL,
      variant_selection TEXT,
      modifier_selection TEXT,
      addons TEXT,
      special_instructions TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_number TEXT UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      customer_id TEXT,
      subtotal REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      tax_breakdown TEXT,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL,
      discount_reason TEXT,
      delivery_charge REAL DEFAULT 0,
      packaging_charge REAL DEFAULT 0,
      round_off REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid',
      payment_details TEXT,
      paid_at TEXT,
      printed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE loyalty_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      bill_id INTEGER,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Config tables ────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE kds_pairing_tokens (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      station_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE printers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_type TEXT NOT NULL CHECK (connection_type IN ('network', 'usb', 'webusb')),
      ip_address TEXT,
      port INTEGER DEFAULT 9100,
      usb_device_path TEXT,
      is_default INTEGER DEFAULT 0,
      paper_width TEXT DEFAULT '80mm',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );

    -- ── Indexes ──────────────────────────────────────────────────────────

    CREATE INDEX idx_products_category ON products(category_id);
    CREATE INDEX idx_products_active   ON products(is_active);
    CREATE INDEX idx_orders_status     ON orders(status);
    CREATE INDEX idx_orders_created    ON orders(created_at);
    CREATE INDEX idx_orders_user       ON orders(user_id);
    CREATE INDEX idx_order_items_order ON order_items(order_id);
    CREATE INDEX idx_bills_order       ON bills(order_id);

    -- ── Schema v9 Indexes (POS Koperasi) ──────────────────────────────────
    CREATE UNIQUE INDEX idx_customers_member_no_unique
      ON customers(member_no) WHERE member_no IS NOT NULL;
    CREATE UNIQUE INDEX idx_customers_employee_id_unique
      ON customers(employee_id) WHERE employee_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_customers_nik_unique
      ON customers(nik) WHERE nik IS NOT NULL AND nik != '';
    CREATE INDEX idx_customers_is_member_active
      ON customers(is_member, is_active);

    CREATE INDEX idx_stock_movements_product_created
      ON stock_movements(product_id, created_at);
    CREATE INDEX idx_stock_movements_reference
      ON stock_movements(reference_type, reference_id);
    CREATE INDEX idx_stock_movements_created_by
      ON stock_movements(created_by);

    CREATE INDEX idx_salary_deductions_member_status_period
      ON salary_deductions(member_id, status, period_month);
    CREATE INDEX idx_salary_deductions_status_created
      ON salary_deductions(status, created_at);
    CREATE INDEX idx_salary_deductions_bill
      ON salary_deductions(bill_id);
    CREATE INDEX idx_salary_deductions_order
      ON salary_deductions(order_id);

    -- ── Schema v10 Indexes (Audit Logs) ──────────────────────────────────
    CREATE INDEX idx_audit_logs_action_created
      ON audit_logs(action, created_at);
    CREATE INDEX idx_audit_logs_actor
      ON audit_logs(actor_user_id);

    -- ── Schema v11 & v19 Indexes (Product Barcode & SKU) ─────────────────
    CREATE INDEX IF NOT EXISTS idx_products_barcode
      ON products(barcode) WHERE barcode IS NOT NULL AND trim(barcode) != '';
    CREATE INDEX IF NOT EXISTS idx_products_sku
      ON products(sku);

    -- ── Schema v19 Product Units Table ───────────────────────────────────
    CREATE TABLE IF NOT EXISTS product_units (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Schema v15 (WhatsApp Official Campaign & Consent) ─────────────────
    CREATE TABLE IF NOT EXISTS customer_consent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK(event_type IN ('OPT_IN', 'OPT_OUT')),
      source TEXT NOT NULL,
      policy_version TEXT,
      actor_user_id TEXT NULL,
      reason TEXT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_consent_logs_customer ON customer_consent_logs(customer_id, created_at);

    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id TEXT PRIMARY KEY,
      provider_template_id TEXT NULL,
      template_name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL CHECK(category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
      language TEXT NOT NULL DEFAULT 'id',
      status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'approved', 'rejected', 'paused')),
      header_type TEXT NULL CHECK(header_type IN ('TEXT', 'IMAGE', 'DOCUMENT', 'NONE')),
      header_content TEXT NULL,
      body_text TEXT NOT NULL,
      footer_text TEXT NULL,
      buttons_json TEXT NULL,
      variable_schema_json TEXT NULL,
      rejection_reason TEXT NULL,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_wa_templates_status ON whatsapp_templates(status);

    CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template_id TEXT NOT NULL,
      template_variables_json TEXT NOT NULL DEFAULT '{}',
      target_criteria_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
      scheduled_at_utc TEXT NULL,
      scheduled_at_wib_label TEXT NULL,
      started_at TEXT NULL,
      completed_at TEXT NULL,
      created_by TEXT NOT NULL,
      approved_by TEXT NULL,
      cancelled_by TEXT NULL,
      recipient_count_estimate INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      read_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id),
      FOREIGN KEY (cancelled_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wa_campaigns_status_sched ON whatsapp_campaigns(status, scheduled_at_utc);

    CREATE TABLE IF NOT EXISTS whatsapp_campaign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      phone_e164 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'opted_out')),
      provider_message_id TEXT NULL,
      error_code TEXT NULL,
      error_category TEXT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT NULL,
      delivered_at TEXT NULL,
      read_at TEXT NULL,
      failed_at TEXT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES whatsapp_campaigns(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      UNIQUE(campaign_id, customer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wa_recipients_prov_msg ON whatsapp_campaign_recipients(provider_message_id);
    CREATE INDEX IF NOT EXISTS idx_customers_wa_optin ON customers(whatsapp_marketing_opt_in, is_active);

    -- ── Schema v17 (Print Jobs Queue & Persistence) ─────────────────────
    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      bill_id INTEGER NOT NULL,
      receipt_data TEXT,
      printer_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'printing', 'completed', 'failed', 'cancelled')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 10,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      FOREIGN KEY (bill_id) REFERENCES bills(id)
    );
    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_bill_id ON print_jobs(bill_id);
  `);
}

function seedData(): void {
  const insert = (key: string, value: string) =>
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);

  insert('schema_version',      String(SCHEMA_VERSION));
  insert('business_name',       'Koperasi');
  insert('country',             'ID');
  insert('currency',            'IDR');
  insert('currency_symbol',     'Rp');
  insert('timezone',            'Asia/Jakarta');
  insert('address',             '');
  insert('phone',               '');
  insert('email',               '');
  insert('tax_registered',      'false');
  insert('gstin',               '');
  insert('state_code',          '');
  insert('tax_scheme',          'regular');
  insert('billing_type',        'postpaid');
  insert('loyalty_expiry_days', '365');
  insert('cloud_server_url',    '');
  insert('cloud_connected',     'false');

  // Default owner account
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  const ownerPerms = JSON.stringify(['pos', 'dashboard', 'orders', 'products', 'addon_groups', 'customers', 'reports', 'whatsapp', 'staff', 'settings', 'salary_deductions', 'stock_movements', 'db_backup']);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, permissions)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('user-1', 'Pengelola Koperasi', 'admin@koperasi.local', hashedPassword, 'owner', ownerPerms);

  // Default staff accounts (Koperasi roles)
  const kasirPassword = bcrypt.hashSync('kasir123', 10);
  const cashierPerms = JSON.stringify(['pos', 'orders', 'customers']);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, permissions)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('user-2', 'Kasir Koperasi', 'kasir@koperasi.local', kasirPassword, 'cashier', cashierPerms);

  const managerPerms = JSON.stringify(['pos', 'dashboard', 'orders', 'products', 'addon_groups', 'customers', 'reports', 'whatsapp', 'staff', 'salary_deductions', 'stock_movements']);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role, permissions)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('user-3', 'Manajer Koperasi', 'manager@koperasi.local', hashedPassword, 'manager', managerPerms);

  // Default printer (will be detected on first run)
  db.prepare(`
    INSERT OR IGNORE INTO printers (id, name, connection_type, paper_width, is_default)
    VALUES (?, ?, ?, ?, ?)
  `).run('printer-1', 'Thermal Printer', 'usb', '80mm', 1);

  // Sample categories (Koperasi Sembako)
  const cats = [
    ['cat-1', 'Beras & Minyak',            '#0F766E', '🌾', 1],
    ['cat-2', 'Sembako Pokok',             '#2563EB', '📦', 2],
    ['cat-3', 'Bumbu & Dapur',             '#D97706', '🧂', 3],
    ['cat-4', 'Minuman Kemasan',           '#0284C7', '🥤', 4],
    ['cat-5', 'Perlengkapan Rumah Tangga', '#7C3AED', '🧼', 5],
  ];
  for (const [id, name, color, icon, sort] of cats) {
    db.prepare(`
      INSERT OR IGNORE INTO categories (id, name, color, icon, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, color, icon, sort);
  }

  // Sample products (Koperasi Sembako)
  // [id, catId, name, price, member_price, unit, stock, sort]
  const products = [
    ['prod-1', 'cat-1', 'Beras Ramos 5 kg',        72000.00, 68000.00, 'sak',   50, 1],
    ['prod-2', 'cat-1', 'Minyak Goreng 2 L',       34000.00, 32000.00, 'pouch', 80, 2],
    ['prod-3', 'cat-2', 'Gula Pasir 1 kg',         17500.00, 16500.00, 'kg',    100, 1],
    ['prod-4', 'cat-2', 'Telur Ayam 1 kg',         28000.00, 26000.00, 'kg',    40, 2],
    ['prod-5', 'cat-2', 'Tepung Terigu 1 kg',      12500.00, 11500.00, 'kg',    60, 3],
    ['prod-6', 'cat-2', 'Mi Instan Goreng',         3500.00,  3000.00, 'pcs',   240, 4],
    ['prod-7', 'cat-3', 'Bumbu Racik Sachet',       2500.00,  2000.00, 'pcs',   150, 1],
    ['prod-8', 'cat-4', 'Teh Celup Kotak',          8500.00,  8000.00, 'box',   75, 1],
    ['prod-9', 'cat-5', 'Sabun Cuci Piring 750 ml',14000.00, 13000.00, 'pouch', 50, 1],
  ];
  for (const [id, catId, name, price, memberPrice, unit, stock, sort] of products) {
    db.prepare(`
      INSERT OR IGNORE INTO products (id, category_id, name, price, member_price, unit, stock_quantity, track_inventory, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
    `).run(id, catId, name, price, memberPrice, unit, stock, sort);
  }

  // Sample tables (Preserved for compatibility)
  const tables = [
    ['tbl-1', 'T1', 4], ['tbl-2', 'T2', 4],  ['tbl-3', 'T3', 6],
    ['tbl-4', 'T4', 2], ['tbl-5', 'T5', 4],  ['tbl-6', 'T6', 8],
  ];
  for (const [id, number, capacity] of tables) {
    db.prepare(`
      INSERT OR IGNORE INTO tables (id, number, capacity)
      VALUES (?, ?, ?)
    `).run(id, number, capacity);
  }

  // Sample member (Koperasi Member with dummy test NIK)
  db.prepare(`
    INSERT OR IGNORE INTO customers (
      id, nik, member_no, employee_id, name, department, phone, country_code, is_member, salary_deduction_enabled, monthly_deduction_limit, outstanding_deduction_limit, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'cust-1',
    '3273010101900001',
    'MBR-0001',
    'EMP-001',
    'Budi Santoso',
    'Divisi Operasional',
    '081234567890',
    '+62',
    1,
    1,
    2500000,
    5000000,
    1
  );

  console.log('[DB] Seed data loaded');
}

export function getLocalBusinessDateCompact(date: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date).replace(/-/g, ''); // '20260825'
  } catch {
    const d = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }
}

export function generateOrderNumber(): string {
  const date = getLocalBusinessDateCompact();
  const prefix = `ORD-${date}-%`;
  const result = db.prepare(
    "SELECT COUNT(*) + 1 as next FROM orders WHERE order_number LIKE ?"
  ).get(prefix) as { next: number };
  return `ORD-${date}-${String(result.next).padStart(4, '0')}`;
}

export function generateBillNumber(): string {
  const date = getLocalBusinessDateCompact();
  const prefix = `INV-${date}-%`;
  const result = db.prepare(
    "SELECT COUNT(*) + 1 as next FROM bills WHERE bill_number LIKE ?"
  ).get(prefix) as { next: number };
  return `INV-${date}-${String(result.next).padStart(4, '0')}`;
}

export function now(): string {
  return new Date().toISOString();
}

/** Parse JSON string fields on order_item rows returned from SQLite.
 *  Stored as JSON.stringify(value) — may be "null", "[...]", "{...}" etc.
 *  Returns actual JS value (array / object / null) so the frontend can map/iterate. */
export function parseItemJson(item: any): any {
  const tryParse = (val: any) => {
    if (typeof val !== 'string') return val;
    try { return JSON.parse(val); } catch { return val; }
  };
  return {
    ...item,
    addons: tryParse(item.addons),
    variant_selection: tryParse(item.variant_selection),
    modifier_selection: tryParse(item.modifier_selection),
    tax_breakdown: tryParse(item.tax_breakdown),
  };
}
