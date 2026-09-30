'use strict';

const express = require('express');
const auth = require('../auth');
const { DEFAULT_SETTINGS } = require('../db');
const { wrap, str, bad } = require('../util');

const router = express.Router();
router.use(auth.requireAuth);

function readAll(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

router.get(
  '/',
  wrap((req, res) => {
    res.json({ settings: readAll(req.db) });
  })
);

/** Store details are readable by everyone (the till needs them); the rest is admin-only. */
router.put(
  '/',
  auth.requireRole('admin'),
  wrap((req, res) => {
    const body = req.body || {};
    const editable = Object.keys(DEFAULT_SETTINGS);
    const unknown = Object.keys(body).filter((key) => !editable.includes(key));
    if (unknown.length) throw bad(`Unknown setting: ${unknown.join(', ')}`);

    const storeName = str(body.store_name);
    if (storeName === undefined || !storeName) throw bad('Store name is required');
    if (str(body.decimals) && !/^\d$/.test(str(body.decimals))) throw bad('Decimals must be a single digit 0-9');
    if (numRate(body.tax_rate) < 0 || numRate(body.tax_rate) > 100) throw bad('Tax rate must be between 0 and 100');

    const upsert = req.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    req.db.exec('BEGIN');
    try {
      for (const key of editable) {
        if (body[key] === undefined) continue;
        upsert.run(key, str(body[key]));
      }
      req.db.exec('COMMIT');
    } catch (err) {
      req.db.exec('ROLLBACK');
      throw err;
    }

    auth.log(req.db, req, 'settings_update', Object.keys(body).join(', '));
    res.json({ settings: readAll(req.db) });
  })
);

function numRate(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = router;
module.exports.readAll = readAll;