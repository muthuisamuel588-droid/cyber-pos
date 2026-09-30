'use strict';

const express = require('express');
const auth = require('../auth');
const { priceCart } = require('../pricing');
const { applyStockChange } = require('../stock');
const { wrap, money, num, int, str, bad, notFound } = require('../util');

const router = express.Router();
router.use(auth.requireAuth, auth.requireRole('admin', 'manager'));

function purchaseWithItems(db, id) {
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
  if (!purchase) return null;
  purchase.items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(id);
  return purchase;
}

router.post(
  '/',
  wrap((req, res) => {
    const db = req.db;
    const body = req.body || {};
    const lines = body.lines || [];
    if (!lines.length) throw bad('Add at least one product to the purchase');

    // A purchase line is bought at a cost, never a sale price, and is not taxed
    // on the way in (tax is charged when the goods are sold).
    const priced = priceCart(lines, { discount: 0, tax_rate: 0 });
    const paid = money(num(body.paid, 0));
    if (paid < 0) throw bad('Amount paid cannot be negative');
    if (paid > priced.total) throw bad('Amount paid is more than the purchase total');

    let supplierName = str(body.supplier_name);
    if (int(body.supplier_id, 0)) {
      const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(int(body.supplier_id, 0));
      if (!supplier) throw bad('Supplier not found');
      supplierName = supplier.name;
    }

    let purchaseId;
    db.exec('BEGIN');
    try {
      const info = db
        .prepare(
          `INSERT INTO purchases (reference, supplier_id, supplier_name, user_id, user_name,
             subtotal, discount, tax_amount, total, paid, status, note)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
        )
        .run(
          str(body.reference) || null,
          int(body.supplier_id, 0) || null,
          supplierName || null,
          req.userId,
          req.user.username,
          priced.subtotal,
          priced.total,
          paid,
          money(priced.total - paid) > 0 ? 'partial' : 'received',
          str(body.note) || null
        );
      purchaseId = Number(info.lastInsertRowid);

      const insertItem = db.prepare(
        `INSERT INTO purchase_items (purchase_id, product_id, name, sku, cost, qty, total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const line of priced.lines) {
        if (!line.product_id) throw bad(`"${line.name}" is not a known product - pick it from the list`);
        insertItem.run(purchaseId, line.product_id, line.name, line.sku || null, line.price, line.qty, line.total);

        applyStockChange(db, {
          productId: line.product_id,
          change: line.qty,
          reason: `Purchase #${purchaseId}`,
          refType: 'purchase',
          refId: purchaseId,
          user: req.user,
        });

        // Keep the recorded cost current so profit reporting stays honest.
        db.prepare(
          "UPDATE products SET cost = ?, updated_at = datetime('now','localtime') WHERE id = ? AND ? > 0"
        ).run(line.price, line.product_id, line.price);
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    auth.log(req.db, req, 'purchase_create', `#${purchaseId} total ${priced.total}`);
    res.status(201).json({ purchase: purchaseWithItems(db, purchaseId) });
  })
);

router.post(
  '/quote',
  wrap((req, res) => {
    res.json({ quote: priceCart(req.body?.lines || [], { discount: 0, tax_rate: 0 }) });
  })
);

router.get(
  '/',
  wrap((req, res) => {
    const from = str(req.query.from);
    const to = str(req.query.to);
    const where = [];
    const params = [];
    if (from) {
      where.push('created_at >= ?');
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      where.push('created_at <= ?');
      params.push(`${to} 23:59:59`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const purchases = req.db.prepare(`SELECT * FROM purchases ${clause} ORDER BY id DESC LIMIT 500`).all(...params);
    res.json({ purchases });
  })
);

router.get(
  '/:id',
  wrap((req, res) => {
    const purchase = purchaseWithItems(req.db, int(req.params.id));
    if (!purchase) throw notFound('Purchase not found');
    res.json({ purchase });
  })
);

/** Records a payment against what is owed to a supplier. */
router.post(
  '/:id/pay',
  wrap((req, res) => {
    const db = req.db;
    const id = int(req.params.id);
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
    if (!purchase) throw notFound('Purchase not found');

    const amount = money(num(req.body?.amount, 0));
    if (amount <= 0) throw bad('Enter an amount greater than zero');
    const due = money(purchase.total - purchase.paid);
    if (amount > due + 0.001) throw bad(`That is more than the ${due.toFixed(2)} still owed`);

    const paid = money(purchase.paid + amount);
    db.prepare('UPDATE purchases SET paid = ?, status = ? WHERE id = ?').run(
      paid,
      money(purchase.total - paid) > 0 ? 'partial' : 'paid',
      id
    );

    auth.log(req.db, req, 'purchase_payment', `#${id} paid ${amount}`);
    res.json({ purchase: purchaseWithItems(db, id) });
  })
);

module.exports = router;