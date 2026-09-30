'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, str, bad, notFound } = require('../util');

const router = express.Router();
router.use(auth.requireAuth);

router.get(
  '/',
  wrap((req, res) => {
    const rows = req.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id AND active = 1) AS product_count
         FROM categories c ORDER BY c.name`
      )
      .all();
    res.json({ categories: rows });
  })
);

router.post(
  '/',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const name = str(req.body?.name);
    if (!name) throw bad('Category name is required');
    if (req.db.prepare('SELECT id FROM categories WHERE name = ?').get(name)) {
      throw bad('That category already exists');
    }
    const info = req.db
      .prepare('INSERT INTO categories (name, color) VALUES (?, ?)')
      .run(name, str(req.body?.color) || '#64748b');
    auth.log(req.db, req, 'category_create', name);
    res.status(201).json({ category: req.db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(info.lastInsertRowid)) });
  })
);

router.put(
  '/:id',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) throw notFound('Category not found');
    const name = str(req.body?.name) || existing.name;
    req.db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(name, str(req.body?.color) || existing.color, id);
    auth.log(req.db, req, 'category_update', name);
    res.json({ category: req.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) });
  })
);

router.delete(
  '/:id',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) throw notFound('Category not found');
    const { c } = req.db.prepare('SELECT COUNT(*) AS c FROM products WHERE category_id = ? AND active = 1').get(id);
    if (c > 0) throw bad(`${c} product(s) still use "${existing.name}"`);
    req.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    auth.log(req.db, req, 'category_delete', existing.name);
    res.json({ ok: true });
  })
);

module.exports = router;