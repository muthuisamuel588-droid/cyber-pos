'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, money, num, str, today, bad, notFound, toCsv } = require('../util');

const router = express.Router();
router.use(auth.requireAuth);

router.get(
  '/',
  wrap((req, res) => {
    const from = str(req.query.from);
    const to = str(req.query.to);
    const where = [];
    const params = [];
    if (from) {
      where.push('expense_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('expense_date <= ?');
      params.push(to);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const expenses = req.db
      .prepare(`SELECT * FROM expenses ${clause} ORDER BY expense_date DESC, id DESC LIMIT 1000`)
      .all(...params);
    const { total } = req.db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses ${clause}`).get(...params);
    res.json({ expenses, total: money(total) });
  })
);

router.get(
  '/export.csv',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const rows = req.db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC').all();
    const csv = toCsv(
      [
        { key: 'expense_date', label: 'Date' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount' },
        { key: 'payment_method', label: 'Payment Method' },
        { key: 'user_name', label: 'Recorded By' },
        { key: 'note', label: 'Note' },
      ],
      rows
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cyberpos-expenses.csv"');
    res.send(csv);
  })
);

router.post(
  '/',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const description = str(req.body?.description);
    if (!description) throw bad('Describe what the money was spent on');
    const amount = money(num(req.body?.amount, 0));
    if (amount <= 0) throw bad('Enter an amount greater than zero');

    const info = req.db
      .prepare(
        `INSERT INTO expenses (category, description, amount, payment_method, expense_date, user_id, user_name, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        str(req.body?.category) || 'General',
        description,
        amount,
        str(req.body?.payment_method) || 'cash',
        str(req.body?.expense_date) || today(),
        req.userId,
        req.user.username,
        str(req.body?.note) || null
      );

    auth.log(req.db, req, 'expense_create', `${description} ${amount}`);
    res.status(201).json({ expense: req.db.prepare('SELECT * FROM expenses WHERE id = ?').get(Number(info.lastInsertRowid)) });
  })
);

router.delete(
  '/:id',
  auth.requireRole('admin', 'manager'),
  wrap((req, res) => {
    const id = int(req.params.id);
    const expense = req.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!expense) throw notFound('Expense not found');
    req.db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    auth.log(req.db, req, 'expense_delete', `${expense.description} ${expense.amount}`);
    res.json({ ok: true });
  })
);

module.exports = router;