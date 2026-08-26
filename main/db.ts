import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';

// Bump this whenever the schema changes incompatibly
const SCHEMA_VERSION = 13;

let db: Database.Database;

function usesElectronUserDataPath(): boolean {
  return Boolean(app?.isPackaged) || Boolean(process.env.FLO_USER_DATA_DIR?.trim());
}

export function getDbPath(): string {
  const userDataPath = usesElectronUserDataPath() && app?.getPath
    ? app.getPath('userData')
    : path.join(__dirname, '../');

  return path.join(userDataPath, 'flo.db');
}

function getBackupDir(): string {
  const userDataPath = usesElectronUserDataPath() && app?.getPath
    ? app.getPath('userData')
    : path.join(__dirname, '../');
  return path.join(userDataPath, 'backups');
}

export function initDatabase(): void {
  const dbPath = getDbPath();
  const backupDir = getBackupDir();

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`[DB] Opening database at: ${dbPath}`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // Off during migrations

  runMigrations();

  db.pragma('foreign_keys = ON');
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    console.log('[DB] Database closed');
  }
}

export async function createBackup(): Promise<string> {
  console.log('[DB] createBackup: Starting...');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(getBackupDir(), `flo-backup-${timestamp}.db`);
  console.log('[DB] createBackup: Target path:', backupPath);
  await db.backup(backupPath);
  console.log(`[DB] Backup created: ${backupPath}`);
  return backupPath;
}

export function restoreBackup(backupPath: string): void {
  db.close();
  const dbPath = getDbPath();
  fs.copyFileSync(backupPath, dbPath);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  console.log(`[DB] Restored from: ${backupPath}`);
}

function getCurrentSchemaVersion(): number {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() as any;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

function columnExists(tableName: string, columnName: string): boolean {
  try {
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

  // Update schema version
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(String(SCHEMA_VERSION));
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
      unit TEXT NOT NULL DEFAULT 'pcs'
        CHECK(unit IN ('pcs','kg','gram','liter','ml','pack','pouch','box','sak','tray')),
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
      description TEXT,
      is_required INTEGER DEFAULT 0,
      min_selection INTEGER DEFAULT 0,
      max_selection INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE addons (
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
        CHECK (role IN ('owner', 'manager', 'cashier', 'waiter', 'chef')),
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

    -- ── Schema v11 Indexes (Product Barcode & SKU) ────────────────────────
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
      ON products(barcode) WHERE barcode IS NOT NULL AND trim(barcode) != '';
    CREATE INDEX IF NOT EXISTS idx_products_sku
      ON products(sku);
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
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('user-1', 'Pengelola Koperasi', 'admin@flo.local', hashedPassword, 'owner');

  // Default staff accounts (Koperasi roles)
  const chefPassword = bcrypt.hashSync('chef123', 10);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('user-2', 'Kasir Koperasi', 'chef@flo.local', chefPassword, 'chef');

  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, password, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('user-3', 'Staf Operasional', 'kitchen@flo.local', chefPassword, 'manager');

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
