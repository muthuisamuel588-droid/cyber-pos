'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.CYBERPOS_DB || path.join(DATA_DIR, 'cyberpos.db');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'cashier',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#64748b',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  credit     REAL NOT NULL DEFAULT 0,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  sku         TEXT,
  barcode     TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  price       REAL NOT NULL DEFAULT 0,
  cost        REAL NOT NULL DEFAULT 0,
  stock       REAL NOT NULL DEFAULT 0,
  min_stock   REAL NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'pc',
  tax_rate    REAL NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_name    ON products(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku) WHERE sku <> '';

CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change     REAL NOT NULL,
  balance    REAL NOT NULL,
  reason     TEXT,
  ref_type   TEXT,
  ref_id     INTEGER,
  user_id    INTEGER,
  user_name  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(product_id, id DESC);

CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no     TEXT NOT NULL UNIQUE,
  customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name  TEXT,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name      TEXT,
  subtotal       REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  discount_type  TEXT NOT NULL DEFAULT 'amount',
  tax_rate       REAL NOT NULL DEFAULT 0,
  tax_amount     REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  paid           REAL NOT NULL DEFAULT 0,
  change_due     REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  status         TEXT NOT NULL DEFAULT 'completed',
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status  ON sales(status);

CREATE TABLE IF NOT EXISTS sale_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  sku        TEXT,
  price      REAL NOT NULL DEFAULT 0,
  cost       REAL NOT NULL DEFAULT 0,
  qty        REAL NOT NULL DEFAULT 1,
  discount   REAL NOT NULL DEFAULT 0,
  tax_rate   REAL NOT NULL DEFAULT 0,
  total      REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reference    TEXT,
  supplier_id  INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name    TEXT,
  subtotal     REAL NOT NULL DEFAULT 0,
  discount     REAL NOT NULL DEFAULT 0,
  tax_amount   REAL NOT NULL DEFAULT 0,
  total        REAL NOT NULL DEFAULT 0,
  paid         REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'received',
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_purchases_created ON purchases(created_at);

CREATE TABLE IF NOT EXISTS purchase_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  sku        TEXT,
  cost       REAL NOT NULL DEFAULT 0,
  qty        REAL NOT NULL DEFAULT 1,
  total      REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  category       TEXT NOT NULL DEFAULT 'General',
  description    TEXT NOT NULL,
  amount         REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  expense_date   TEXT NOT NULL DEFAULT (date('now','localtime')),
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name      TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);

CREATE TABLE IF NOT EXISTS held_orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  payload    TEXT NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  user_name  TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(id DESC);
`;

const DEFAULT_SETTINGS = {
  store_name: 'Cyber POS',
  store_address: '',
  store_phone: '',
  store_email: '',
  currency: 'KES',
  currency_symbol: 'KSh',
  tax_rate: '0',
  receipt_footer: 'Thank you for shopping with us!',
  invoice_prefix: 'INV',
  low_stock_alerts: '1',
  allow_negative_stock: '0',
  decimals: '2',
};

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function open() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  seed(db);
  return db;
}

/** Create the starting data a fresh install needs. Clean slate, no imported shop data. */
function seed(db) {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c === 0) {
    const addUser = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
    );
    addUser.run('admin', hashPassword('admin123'), 'Administrator', 'admin');
    addUser.run('manager', hashPassword('manager123'), 'Shop Manager', 'manager');
    addUser.run('cashier', hashPassword('cashier123'), 'Cashier', 'cashier');
  }

  const { c: catCount } = db.prepare('SELECT COUNT(*) AS c FROM categories').get();
  if (catCount === 0) {
    db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run('General', '#64748b');
  }
}

/** Transaction helper - rolls back on any throw. */
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

module.exports = { open, tx, hashPassword, DB_PATH, DATA_DIR, DEFAULT_SETTINGS };