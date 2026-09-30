'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const auth = require('../auth');
const { DB_PATH, open, DEFAULT_SETTINGS } = require('../db');
const { wrap, str, bad } = require('../util');

const router = express.Router();
router.use(auth.requireAuth, auth.requireRole('admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const TABLES = [
  'users', 'settings', 'categories', 'suppliers', 'customers', 'products',
  'stock_movements', 'sales', 'sale_items', 'purchases', 'purchase_items',
  'expenses', 'held_orders', 'activity_log',
];

router.get(
  '/info',
  wrap((req, res) => {
    const counts = {};
    for (const table of TABLES) {
      counts[table] = req.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
    }
    let size = 0;
    try {
      size = fs.statSync(DB_PATH).size;
    } catch {
      size = 0;
    }
    res.json({ path: DB_PATH, size, counts, sqlite: req.db.prepare('SELECT sqlite_version() AS v').get().v });
  })
);

/** Streams a consistent copy of the live database. */
router.get(
  '/download',
  wrap((req, res) => {
    if (!fs.existsSync(DB_PATH)) throw bad('Database file not found');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="cyberpos-backup-${stamp}.db"`);
    fs.createReadStream(DB_PATH).pipe(res);
  })
);

/** JSON export - readable anywhere, and easy to move between tills. */
router.get(
  '/export.json',
  wrap((req, res) => {
    const payload = { exported_at: new Date().toISOString(), version: 1, data: {} };
    for (const table of TABLES) {
      payload.data[table] = req.db.prepare(`SELECT * FROM ${table}`).all();
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cyberpos-export.json"');
    res.send(JSON.stringify(payload, null, 2));
  })
);

function applySnapshot(db, data) {
  db.exec('BEGIN');
  try {
    for (const table of TABLES) {
      if (!Array.isArray(data[table])) continue;
      db.prepare(`DELETE FROM ${table}`).run();
    }
    for (const table of TABLES) {
      const rows = data[table];
      if (!Array.isArray(rows) || !rows.length) continue;
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const usable = columns.filter((c) => c in rows[0]);
      if (!usable.length) continue;
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${usable.join(', ')}) VALUES (${usable.map(() => '?').join(', ')})`
      );
      for (const row of rows) stmt.run(...usable.map((c) => row[c] ?? null));
    }
    // Settings that the snapshot did not carry still need valid values.
    const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) upsert.run(key, value);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Replaces every table with the contents of an uploaded JSON export. */
router.post(
  '/restore.json',
  upload.single('file'),
  wrap((req, res) => {
    const raw = req.file ? req.file.buffer.toString('utf8') : str(req.body?.json);
    if (!raw) throw bad('Attach a Cyber POS export file');

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw bad('That file is not valid JSON');
    }
    const data = payload?.data;
    if (!data || !Array.isArray(data.products)) throw bad('That file is not a Cyber POS export');

    const backupPath = `${DB_PATH}.before-restore`;
    try {
      fs.copyFileSync(DB_PATH, backupPath);
    } catch {
      /* first run, nothing to keep */
    }

    applySnapshot(req.db, data);
    auth.log(req.db, req, 'backup_restore', `restored ${data.products.length} products from JSON`);
    res.json({ ok: true, backup_file: backupPath, counts: Object.fromEntries(TABLES.map((t) => [t, Array.isArray(data[t]) ? data[t].length : 0])) });
  })
);

/**
 * Replaces the live database file with an uploaded .db copy. Requires a restart
 * because the running connection still points at the old file.
 */
router.post(
  '/restore.db',
  upload.single('file'),
  wrap((req, res) => {
    if (!req.file) throw bad('Attach a .db backup file');

    // Validate before overwriting anything: open the upload and check it looks
    // like our schema.
    const probePath = path.join(path.dirname(DB_PATH), '.restore-probe.db');
    fs.writeFileSync(probePath, req.file.buffer);
    let probe;
    try {
      probe = open(probePath);
      const tables = probe
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name);
      if (!tables.includes('products') || !tables.includes('sales')) {
        throw bad('That file is not a Cyber POS database');
      }
    } finally {
      try {
        probe?.close();
      } catch {
        /* ignore */
      }
      fs.rmSync(probePath, { force: true });
    }

    try {
      fs.copyFileSync(DB_PATH, `${DB_PATH}.before-restore`);
    } catch {
      /* first run */
    }

    // Close our own connection, swap the file, then point the process at it again.
    req.app.locals.db.close();
    fs.copyFileSync(DB_PATH, `${DB_PATH}.replaced`);
    fs.writeFileSync(DB_PATH, req.file.buffer);
    const db = open(DB_PATH);
    req.app.locals.db = db;
    req.db = db;

    auth.log(req.db, req, 'backup_restore_db', 'restored from .db file');
    res.json({ ok: true, restart_recommended: true });
  })
);

/** Wipes all trading data but keeps users and settings. */
router.post(
  '/reset',
  wrap((req, res) => {
    const confirm = str(req.body?.confirm);
    if (confirm !== 'RESET') throw bad('Type RESET to confirm');

    const db = req.db;
    db.exec('BEGIN');
    try {
      for (const table of ['sale_items', 'sales', 'purchase_items', 'purchases', 'expenses', 'stock_movements', 'held_orders']) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      db.prepare('UPDATE products SET stock = 0').run();
      auth.log(req.db, req, 'data_reset', 'cleared all trading data');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.json({ ok: true });
  })
);

module.exports = router;