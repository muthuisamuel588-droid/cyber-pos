'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, money, num, str, bad, notFound } = require('../util');

const router = express.Router();
router.use(auth.requireAuth);

function readBody(body, existing = {}) {
  const name = str(body.name) || str(existing.name);
  if (!name) throw bad('Name is required');
  return {
    name,
    phone: str(body.phone),
    email: str(body.email),
    address: str(body.address),
    credit: money(num(body.credit, existing.credit ?? 0)),
    notes: str(body.notes),
  };
}

router.get(
  '/',
  wrap((req, res) => {
    const q = str(req.query.q);
    const params = [];
    let clause = '';
    if (q) {
      clause = 'WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const customers = req.db.prepare(`SELECT * FROM customers ${clause} ORDER BY name LIMIT 1000`).all(...params);
    res.json({ customers });
  })
);

router.get(
  '/:id',
  wrap((req, res) => {
    const customer = req.db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(req.params.id));
    if (!customer) throw notFound('Customer not found');
    const sales = req.db
      .prepare(
        `SELECT id, invoice_no, total, created_at FROM sales
         WHERE customer_id = ? ORDER BY id DESC LIMIT 20`
      )
      .all(customer.id);
    res.json({ customer, sales });
  })
);

router.post(
  '/',
  auth.requireRole('admin', 'manager', 'cashier'),
  wrap((req, res) => {
    const data = readBody(req.body || {});
    const info = req.db
      .prepare('INSERT INTO customers (name, phone, email, address, credit, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(data.name, data.phone, data.email, data.address, data.credit, data.notes);
    auth.log(req.db, req, 'customer_create', data.name);
    res.status(201).json({ customer: req.db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(info.lastInsertRowid)) });
  })
);

router.put(
  '/:id',
  auth.requireRole('admin', 'manager', 'cashier'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!existing) throw notFound('Customer not found');
    const data = readBody(req.body || {}, existing);
    req.db
      .prepare('UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, credit = ?, notes = ? WHERE id = ?')
      .run(data.name, data.phone, data.email, data.address, data.credit, data.notes, id);
    auth.log(req.db, req, 'customer_update', data.name);
    res.json({ customer: req.db.prepare('SELECT * FROM customers WHERE id = ?').get(id) });
  })
);

router.delete(
  '/:id',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!existing) throw notFound('Customer not found');
    req.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    auth.log(req.db, req, 'customer_delete', existing.name);
    res.json({ ok: true });
  })
);

module.exports = router;