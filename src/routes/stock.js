'use strict';

const express = require('express');
const auth = require('../auth');
const { applyStockChange } = require('../stock');
const { wrap, money, num, int, str, bad } = require('../util');

const router = express.Router();
router.use(auth.requireAuth);

router.get(
  '/movements',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const productId = int(req.query.product_id, 0);
    const limit = Math.min(int(req.query.limit, 100), 1000);
    const where = productId ? 'WHERE m.product_id = ?' : '';
    const params = productId ? [productId, limit] : [limit];
    const movements = req.db
      .prepare(
        `SELECT m.*, p.name AS product_name, p.unit
         FROM stock_movements m JOIN products p ON p.id = m.product_id
         ${where} ORDER BY m.id DESC LIMIT ?`
      )
      .all(...params);
    res.json({ movements });
  })
);

/** Low stock list for the dashboard alert panel. */
router.get(
  '/low',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const products = req.db
      .prepare(
        `SELECT p.*, c.name AS category FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.active = 1 AND p.stock <= p.min_stock
         ORDER BY (p.min_stock - p.stock) DESC, p.name`
      )
      .all();
    res.json({ products });
  })
);

router.post(
  '/adjust',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const db = req.db;
    const productId = int(req.body?.product_id, 0);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) throw bad('Pick a product to adjust');

    const mode = str(req.body?.mode) === 'set' ? 'set' : 'add';
    const amount = num(req.body?.quantity, 0);
    const change = mode === 'set' ? money(amount - num(product.stock, 0)) : money(amount);

    if (change === 0) throw bad('That would not change the stock level');
    const reason = str(req.body?.reason) || (mode === 'set' ? 'Stock count' : 'Correction');
    const note = str(req.body?.note);

    db.exec('BEGIN');
    try {
      const balance = applyStockChange(db, {
        productId,
        change,
        reason: note ? `${reason}: ${note}` : reason,
        refType: 'adjustment',
        user: req.user,
      });
      db.exec('COMMIT');

      auth.log(req.db, req, 'stock_adjust', `${product.name} ${change > 0 ? '+' : ''}${change} (${balance})`);
      res.json({ ok: true, balance, product: db.prepare('SELECT * FROM products WHERE id = ?').get(productId) });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  })
);

router.get(
  '/valuation',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const rows = req.db
      .prepare(
        `SELECT p.id, p.name, p.sku, p.stock, p.cost, p.price, p.unit, c.name AS category,
                (p.stock * p.cost) AS cost_value, (p.stock * p.price) AS retail_value
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.active = 1 ORDER BY cost_value DESC`
      )
      .all();
    const costValue = money(rows.reduce((s, r) => s + r.cost_value, 0));
    const retailValue = money(rows.reduce((s, r) => s + r.retail_value, 0));
    res.json({ rows, cost_value: costValue, retail_value: retailValue, potential_profit: money(retailValue - costValue) });
  })
);

module.exports = router;