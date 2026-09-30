'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, money, today } = require('../util');

const router = express.Router();

// Every signed-in user gets a home screen. Cashiers see takings and their own
// numbers; profit and expense figures are admin/manager only.
router.use(auth.requireAuth);

function salesTotals(db, start, end) {
  return db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(tax_amount), 0) AS tax
       FROM sales WHERE status = 'completed' AND created_at BETWEEN ? AND ?`
    )
    .get(start, end);
}

function costOfSales(db, start, end) {
  return money(
    db
      .prepare(
        `SELECT COALESCE(SUM(si.cost * si.qty), 0) AS cost
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?`
      )
      .get(start, end).cost
  );
}

router.get(
  '/',
  wrap((req, res) => {
    const db = req.db;
    const isManager = req.user.role === 'admin' || req.user.role === 'manager';
    const start = `${today()} 00:00:00`;
    const end = `${today()} 23:59:59`;

    const totals = salesTotals(db, start, end);
    const cost = costOfSales(db, start, end);

    const recent = db
      .prepare(
        `SELECT id, invoice_no, customer_name, user_name, total, payment_method, created_at
         FROM sales WHERE status = 'completed' ORDER BY id DESC LIMIT 8`
      )
      .all();

    const payload = {
      today: {
        count: totals.count,
        total: money(totals.total),
        tax: money(totals.tax),
        cost,
        profit: money(totals.total - totals.tax - cost),
      },
      recent_sales: recent,
      held_orders: db.prepare('SELECT COUNT(*) AS c FROM held_orders').get().c,
    };

    if (isManager) {
      const expenses = db
        .prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE expense_date = ?")
        .get(today());
      payload.today.expenses = money(expenses.v);
      payload.today.net = money(totals.total - totals.tax - cost - expenses.v);
      payload.low_stock_count = db
        .prepare('SELECT COUNT(*) AS c FROM products WHERE active = 1 AND stock <= min_stock')
        .get().c;
      payload.stock_value = money(
        db.prepare('SELECT COALESCE(SUM(stock * cost), 0) AS v FROM products WHERE active = 1').get().v
      );
      payload.hourly = db
        .prepare(
          `SELECT strftime('%H', created_at) AS hour, COALESCE(SUM(total), 0) AS total
           FROM sales WHERE status = 'completed' AND created_at BETWEEN ? AND ?
           GROUP BY hour ORDER BY hour`
        )
        .all(start, end)
        .map((r) => ({ ...r, total: money(r.total) }));
    }

    res.json(payload);
  })
);

module.exports = router;