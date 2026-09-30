'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, str, bad, notFound } = require('../util');

const router = express.Router();
router.use(auth.requireAuth, auth.requireRole('admin', 'manager'));

function readBody(body, existing = {}) {
  const name = str(body.name) || str(existing.name);
  if (!name) throw bad('Supplier name is required');
  return {
    name,
    phone: str(body.phone),
    email: str(body.email),
    address: str(body.address),
    notes: str(body.notes),
  };
}

router.get(
  '/',
  wrap((req, res) => {
    const suppliers = req.db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM products WHERE supplier_id = s.id AND active = 1) AS product_count,
                (SELECT COALESCE(SUM(total - paid), 0) FROM purchases WHERE supplier_id = s.id) AS due
         FROM suppliers s ORDER BY s.name`
      )
      .all();
    res.json({ suppliers });
  })
);

router.post(
  '/',
  wrap((req, res) => {
    const data = readBody(req.body || {});
    const info = req.db
      .prepare('INSERT INTO suppliers (name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?)')
      .run(data.name, data.phone, data.email, data.address, data.notes);
    auth.log(req.db, req, 'supplier_create', data.name);
    res.status(201).json({ supplier: req.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(info.lastInsertRowid)) });
  })
);

router.put(
  '/:id',
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    if (!existing) throw notFound('Supplier not found');
    const data = readBody(req.body || {}, existing);
    req.db
      .prepare('UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?')
      .run(data.name, data.phone, data.email, data.address, data.notes, id);
    auth.log(req.db, req, 'supplier_update', data.name);
    res.json({ supplier: req.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) });
  })
);

router.delete(
  '/:id',
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    if (!existing) throw notFound('Supplier not found');
    const { c } = req.db.prepare('SELECT COUNT(*) AS c FROM products WHERE supplier_id = ? AND active = 1').get(id);
    if (c > 0) throw bad(`${c} product(s) still use "${existing.name}"`);
    req.db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
    auth.log(req.db, req, 'supplier_delete', existing.name);
    res.json({ ok: true });
  })
);

module.exports = router;