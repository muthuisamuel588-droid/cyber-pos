'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, money, num, int, str, bad, notFound, toCsv, parseCsv } = require('../util');

const router = express.Router();
router.use(auth.requireAuth);

const SELECT_PRODUCT = `
  SELECT p.*, c.name AS category, s.name AS supplier
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers  s ON s.id = p.supplier_id
`;

function readBody(db, body, existing = {}) {
  const name = str(body.name) || str(existing.name);
  if (!name) throw bad('Product name is required');

  const selfId = existing.id ?? -1;
  const sku = str(body.sku);
  if (sku) {
    const clash = db.prepare('SELECT name FROM products WHERE sku = ? AND id <> ?').get(sku, selfId);
    if (clash) throw bad(`SKU ${sku} is already used by ${clash.name}`, 'DUPLICATE_SKU');
  }

  const barcode = str(body.barcode);
  if (barcode) {
    const clash = db.prepare('SELECT name FROM products WHERE barcode = ? AND id <> ?').get(barcode, selfId);
    if (clash) throw bad(`Barcode ${barcode} is already used by ${clash.name}`, 'DUPLICATE_BARCODE');
  }

  return {
    name,
    sku,
    barcode,
    category_id: int(body.category_id, 0) || null,
    supplier_id: int(body.supplier_id, 0) || null,
    price: money(num(body.price, 0)),
    cost: money(num(body.cost, 0)),
    stock: money(num(body.stock, 0)),
    min_stock: money(num(body.min_stock, 0)),
    unit: str(body.unit) || 'pc',
    tax_rate: money(num(body.tax_rate, 0)),
    active: body.active === undefined ? (existing.active ?? 1) : (body.active ? 1 : 0),
  };
}

router.get(
  '/',
  wrap((req, res) => {
    const q = str(req.query.q);
    const categoryId = int(req.query.category_id, 0);
    const includeInactive = req.query.include_inactive === '1';
    const lowOnly = req.query.low_stock === '1';
    const limit = Math.min(int(req.query.limit, 500), 2000);
    const offset = int(req.query.offset, 0);

    const where = [];
    const params = [];
    if (!includeInactive) where.push('p.active = 1');
    if (q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (categoryId) {
      where.push('p.category_id = ?');
      params.push(categoryId);
    }
    if (lowOnly) where.push('p.stock <= p.min_stock');

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = req.db.prepare(`${SELECT_PRODUCT} ${clause} ORDER BY p.name LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const { total } = req.db.prepare(`SELECT COUNT(*) AS total FROM products p ${clause}`).get(...params);

    res.json({ products: rows, total });
  })
);

router.get(
  '/barcode/:code',
  wrap((req, res) => {
    const code = str(req.params.code);
    const row =
      req.db.prepare(`${SELECT_PRODUCT} WHERE p.barcode = ? AND p.active = 1`).get(code) ||
      req.db.prepare(`${SELECT_PRODUCT} WHERE p.sku = ? AND p.active = 1`).get(code);
    if (!row) throw notFound('No product with that barcode');
    res.json({ product: row });
  })
);

router.get(
  '/export.csv',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const rows = req.db.prepare(`${SELECT_PRODUCT} ORDER BY p.name`).all();
    const csv = toCsv(
      [
        { key: 'name', label: 'Name' },
        { key: 'sku', label: 'SKU' },
        { key: 'barcode', label: 'Barcode' },
        { key: 'category', label: 'Category' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'cost', label: 'Cost' },
        { key: 'price', label: 'Price' },
        { key: 'stock', label: 'Stock' },
        { key: 'min_stock', label: 'Min Stock' },
        { key: 'unit', label: 'Unit' },
        { key: 'tax_rate', label: 'Tax Rate' },
      ],
      rows
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cyberpos-products.csv"');
    res.send(csv);
  })
);

router.post(
  '/import',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const rows = parseCsv(str(req.body?.csv));
    if (!rows.length) throw bad('The CSV file has no product rows');

    const created = [];
    const skipped = [];
    const categoryByName = new Map(
      req.db.prepare('SELECT id, name FROM categories').all().map((c) => [c.name.toLowerCase(), c.id])
    );

    const insert = req.db.prepare(`
      INSERT INTO products (name, sku, barcode, category_id, price, cost, stock, min_stock, unit, tax_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    req.db.exec('BEGIN');
    try {
      rows.forEach((row, index) => {
        const name = str(row.name);
        if (!name) {
          skipped.push({ line: index + 2, reason: 'missing name' });
          return;
        }
        const categoryName = str(row.category).toLowerCase();
        let categoryId = null;
        if (categoryName) {
          if (!categoryByName.has(categoryName)) {
            const info = req.db
              .prepare('INSERT INTO categories (name, color) VALUES (?, ?)')
              .run(str(row.category), '#64748b');
            categoryByName.set(categoryName, Number(info.lastInsertRowid));
          }
          categoryId = categoryByName.get(categoryName);
        }

        // Re-importing the same file should update the line, not duplicate it.
        const sku = str(row.sku);
        const existing = sku
          ? req.db.prepare('SELECT id FROM products WHERE sku = ?').get(sku)
          : null;

        const values = [
          categoryId,
          num(row.price, 0),
          num(row.cost, 0),
          num(row.stock, 0),
          num(row.min_stock, 0),
          str(row.unit) || 'pc',
          num(row.tax_rate, 0),
        ];

        if (existing) {
          req.db
            .prepare(
              `UPDATE products SET name = ?, barcode = ?, category_id = ?, price = ?, cost = ?,
               stock = ?, min_stock = ?, unit = ?, tax_rate = ?, updated_at = datetime('now','localtime')
               WHERE id = ?`
            )
            .run(name, str(row.barcode), ...values, existing.id);
          created.push({ name, updated: true });
        } else {
          insert.run(name, sku, str(row.barcode), ...values);
          created.push({ name, updated: false });
        }
      });
      req.db.exec('COMMIT');
    } catch (err) {
      req.db.exec('ROLLBACK');
      throw err;
    }

    auth.log(req.db, req, 'product_import', `imported ${created.length} rows`);
    res.json({ imported: created.length, created: created.filter((c) => !c.updated).length, updated: created.filter((c) => c.updated).length, skipped });
  })
);

router.get(
  '/:id',
  wrap((req, res) => {
    const row = req.db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(int(req.params.id));
    if (!row) throw notFound('Product not found');
    res.json({ product: row });
  })
);

router.post(
  '/',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const data = readBody(req.db, req.body || {});
    const info = req.db
      .prepare(
        `INSERT INTO products (name, sku, barcode, category_id, supplier_id, price, cost, stock, min_stock, unit, tax_rate, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.name,
        data.sku,
        data.barcode,
        data.category_id,
        data.supplier_id,
        data.price,
        data.cost,
        data.stock,
        data.min_stock,
        data.unit,
        data.tax_rate,
        data.active
      );

    const id = Number(info.lastInsertRowid);
    if (data.stock !== 0) {
      req.db
        .prepare(
          `INSERT INTO stock_movements (product_id, change, balance, reason, ref_type, user_id, user_name)
           VALUES (?, ?, ?, ?, 'opening', ?, ?)`
        )
        .run(id, data.stock, data.stock, 'Opening stock', req.userId, req.user.username);
    }

    auth.log(req.db, req, 'product_create', `${data.name} @ ${data.price}`);
    const product = req.db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id);
    res.status(201).json({ product });
  })
);

router.put(
  '/:id',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = int(req.params.id);
    const existing = req.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) throw notFound('Product not found');

    const data = readBody(req.db, req.body || {}, existing);

    // Stock is only ever changed through /stock/adjust so movements stay complete.
    req.db
      .prepare(
        `UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?, supplier_id = ?,
         price = ?, cost = ?, min_stock = ?, unit = ?, tax_rate = ?, active = ?,
         updated_at = datetime('now','localtime')
         WHERE id = ?`
      )
      .run(
        data.name,
        data.sku,
        data.barcode,
        data.category_id,
        data.supplier_id,
        data.price,
        data.cost,
        data.min_stock,
        data.unit,
        data.tax_rate,
        data.active,
        id
      );

    auth.log(req.db, req, 'product_update', `${data.name} (was ${existing.name})`);
    res.json({ product: req.db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id) });
  })
);

router.delete(
  '/:id',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = int(req.params.id);
    const product = req.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) throw notFound('Product not found');

    // Keep history intact: products that have ever sold are archived, not deleted.
    const { c } = req.db.prepare('SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?').get(id);
    if (c > 0) {
      req.db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
      auth.log(req.db, req, 'product_archive', `${product.name} (has sales history)`);
      return res.json({ ok: true, archived: true });
    }

    req.db.prepare('DELETE FROM products WHERE id = ?').run(id);
    auth.log(req.db, req, 'product_delete', product.name);
    res.json({ ok: true, archived: false });
  })
);

module.exports = router;