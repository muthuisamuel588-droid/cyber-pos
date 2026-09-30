'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, str, bad, notFound } = require('../util');

const router = express.Router();
router.use(auth.requireAuth);

router.get(
  '/',
  wrap((req, res) => {
    const orders = req.db.prepare('SELECT id, label, user_name, created_at FROM held_orders ORDER BY id DESC LIMIT 200').all();
    res.json({ orders });
  })
);

router.get(
  '/:id',
  wrap((req, res) => {
    const order = req.db.prepare('SELECT * FROM held_orders WHERE id = ?').get(Number(req.params.id));
    if (!order) throw notFound('Held sale not found');
    try {
      order.cart = JSON.parse(order.payload);
    } catch {
      throw bad('That held sale is damaged and cannot be reopened');
    }
    res.json({ order });
  })
);

/** Parks the current cart so the cashier can serve the next customer. */
router.post(
  '/',
  wrap((req, res) => {
    const label = str(req.body?.label);
    if (!label) throw bad('Give the held sale a name');
    const cart = req.body?.cart;
    if (!cart || !Array.isArray(cart.lines) || !cart.lines.length) throw bad('Nothing to hold');

    const info = req.db
      .prepare('INSERT INTO held_orders (label, payload, user_id, user_name) VALUES (?, ?, ?, ?)')
      .run(label, JSON.stringify(cart), req.userId, req.user.username);

    auth.log(req.db, req, 'order_hold', label);
    res.status(201).json({ order: { id: Number(info.lastInsertRowid), label } });
  })
);

router.delete(
  '/:id',
  wrap((req, res) => {
    const id = Number(req.params.id);
    const order = req.db.prepare('SELECT label FROM held_orders WHERE id = ?').get(id);
    if (!order) throw notFound('Held sale not found');
    req.db.prepare('DELETE FROM held_orders WHERE id = ?').run(id);
    auth.log(req.db, req, 'order_discard', order.label);
    res.json({ ok: true });
  })
);

module.exports = router;