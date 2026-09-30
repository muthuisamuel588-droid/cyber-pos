'use strict';

const express = require('express');
const auth = require('../auth');
const { priceCart } = require('../pricing');
const { applyStockChange } = require('../stock');
const { wrap, money, num, int, str, today, bad, notFound } = require('../util');

const router = express.Router();
router.use(auth.requireAuth);

const PAYMENT_METHODS = ['cash', 'card', 'mobile', 'credit', 'split'];

function nextInvoiceNo(db) {
  const prefix = (db.prepare("SELECT value FROM settings WHERE key = 'invoice_prefix'").get()?.value || 'INV').trim();
  const day = today().replace(/-/g, '');
  const like = `${prefix}-${day}-%`;
  const last = db
    .prepare('SELECT invoice_no FROM sales WHERE invoice_no LIKE ? ORDER BY invoice_no DESC LIMIT 1')
    .get(like);
  const seq = last ? int(last.invoice_no.split('-').pop(), 0) + 1 : 1;
  return `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
}

function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

function saleWithItems(db, id) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) return null;
  sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(id);
  return sale;
}

/** Prices a cart without saving it, so the till can show the live total. */
router.post(
  '/quote',
  wrap((req, res) => {
    const taxRate = num(req.body?.tax_rate, num(getSetting(req.db, 'tax_rate', 0), 0));
    res.json({ quote: priceCart(req.body?.lines || [], {
      discount: req.body?.discount,
      discount_type: req.body?.discount_type,
      tax_rate: taxRate,
    }) });
  })
);

router.post(
  '/',
  wrap((req, res) => {
    const db = req.db;
    const body = req.body || {};
    const defaultTax = num(getSetting(db, 'tax_rate', 0), 0);

    const priced = priceCart(body.lines || [], {
      discount: body.discount,
      discount_type: body.discount_type,
      tax_rate: num(body.tax_rate, defaultTax),
    });

    const method = str(body.payment_method) || 'cash';
    if (!PAYMENT_METHODS.includes(method)) throw bad('Unknown payment method');

    const paid = money(num(body.paid, method === 'cash' ? priced.total : 0));
    if (method !== 'credit' && paid + 0.001 < priced.total) {
      throw bad(`Payment is short by ${(priced.total - paid).toFixed(2)}`);
    }
    if (method === 'credit' && !int(body.customer_id, 0)) throw bad('On-account sales need a customer');

    let customerName = str(body.customer_name);
    if (int(body.customer_id, 0)) {
      const customer = db.prepare('SELECT name FROM customers WHERE id = ?').get(int(body.customer_id, 0));
      if (!customer) throw bad('Customer not found');
      customerName = customer.name;
    }

    const created = runCheckout(db, req, {
      priced,
      method,
      paid,
      taxRate: num(body.tax_rate, defaultTax),
      customerId: int(body.customer_id, 0) || null,
      customerName,
      note: str(body.note),
    });

    auth.log(req.db, req, 'sale_create', `${created.sale.invoice_no} total ${created.sale.total}`);
    res.status(201).json(created);
  })
);

function runCheckout(db, req, { priced, method, paid, taxRate, customerId, customerName, note }) {
  let saleId;
  let invoiceNo;

  db.exec('BEGIN');
  try {
    invoiceNo = nextInvoiceNo(db);
    const changeDue = method === 'cash' ? money(Math.max(paid - priced.total, 0)) : 0;

    const info = db
      .prepare(
        `INSERT INTO sales (invoice_no, customer_id, customer_name, user_id, user_name, subtotal, discount,
           discount_type, tax_rate, tax_amount, total, paid, change_due, payment_method, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        invoiceNo,
        customerId,
        customerName || null,
        req.userId,
        req.user.username,
        priced.subtotal,
        priced.discount,
        priced.discount_type,
        taxRate,
        priced.tax_amount,
        priced.total,
        paid,
        changeDue,
        method,
        note || null
      );
    saleId = Number(info.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, name, sku, price, cost, qty, discount, tax_rate, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const line of priced.lines) {
      // `discount` on the item row is the line's share of the order discount plus
      // its own per-unit discount, so re-printing a receipt adds up correctly.
      const itemDiscount = money(line.gross - line.net);
      insertItem.run(
        saleId,
        line.product_id,
        line.name,
        line.sku || null,
        line.price,
        line.cost,
        line.qty,
        itemDiscount,
        line.tax_rate,
        line.total
      );

      if (line.product_id) {
        applyStockChange(db, {
          productId: line.product_id,
          change: -line.qty,
          reason: `Sale ${invoiceNo}`,
          refType: 'sale',
          refId: saleId,
          user: req.user,
        });
      }
    }

    if (method === 'credit' && customerId) {
      db.prepare('UPDATE customers SET credit = credit + ? WHERE id = ?').run(priced.total - paid, customerId);
    }

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }

  return { sale: saleWithItems(db, saleId) };
}

router.get(
  '/',
  wrap((req, res) => {
    const from = str(req.query.from);
    const to = str(req.query.to);
    const status = str(req.query.status);
    const q = str(req.query.q);

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
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (q) {
      where.push('(invoice_no LIKE ? OR customer_name LIKE ? OR user_name LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(int(req.query.limit, 100), 1000);
    const offset = int(req.query.offset, 0);

    const sales = req.db.prepare(`SELECT * FROM sales ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const { total } = req.db.prepare(`SELECT COUNT(*) AS total FROM sales ${clause}`).get(...params);
    res.json({ sales, total });
  })
);

router.get(
  '/:id',
  wrap((req, res) => {
    const sale = saleWithItems(req.db, int(req.params.id));
    if (!sale) throw notFound('Sale not found');
    res.json({ sale });
  })
);

/** Cancels a sale and puts the stock back on the shelf. */
router.post(
  '/:id/void',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const db = req.db;
    const id = int(req.params.id);
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
    if (!sale) throw notFound('Sale not found');
    if (sale.status === 'void') throw bad('That sale is already voided');

    const reason = str(req.body?.reason);
    if (!reason) throw bad('Give a reason for voiding this sale');

    db.exec('BEGIN');
    try {
      db.prepare("UPDATE sales SET status = 'void', note = ? WHERE id = ?").run(
        `${sale.note ? `${sale.note} | ` : ''}Voided: ${reason}`,
        id
      );
      const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(id);
      for (const item of items) {
        if (!item.product_id) continue;
        applyStockChange(db, {
          productId: item.product_id,
          change: item.qty,
          reason: `Void ${sale.invoice_no}`,
          refType: 'sale_void',
          refId: id,
          user: req.user,
        });
      }
      if (sale.payment_method === 'credit' && sale.customer_id) {
        const outstanding = money(sale.total - sale.paid);
        db.prepare('UPDATE customers SET credit = MAX(credit - ?, 0) WHERE id = ?').run(outstanding, sale.customer_id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    auth.log(req.db, req, 'sale_void', `${sale.invoice_no}: ${reason}`);
    res.json({ sale: saleWithItems(db, id) });
  })
);

module.exports = router;
module.exports.nextInvoiceNo = nextInvoiceNo;