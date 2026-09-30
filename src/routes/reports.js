'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, money, str, today, toCsv } = require('../util');

const router = express.Router();
router.use(auth.requireAuth, auth.requireRole('admin', 'manager'));

function range(query) {
  const to = str(query.to) || today();
  const from = str(query.from) || to;
  return { from, to, start: `${from} 00:00:00`, end: `${to} 23:59:59` };
}

function salesTotals(db, start, end, extra = '') {
  return db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(total), 0) AS total,
              COALESCE(SUM(tax_amount), 0) AS tax,
              COALESCE(SUM(discount), 0) AS discount,
              COALESCE(SUM(paid), 0) AS paid
       FROM sales WHERE status = 'completed' AND created_at BETWEEN ? AND ? ${extra}`
    )
    .get(start, end);
}

function costOfSales(db, start, end) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(si.cost * si.qty), 0) AS cost
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?`
    )
    .get(start, end);
  return money(row.cost);
}


router.get(
  '/sales',
  wrap((req, res) => {
    const db = req.db;
    const { from, to, start, end } = range(req.query);
    const totals = salesTotals(db, start, end);
    const cost = costOfSales(db, start, end);
    const net = money(totals.total - totals.tax);

    const byDay = db
      .prepare(
        `SELECT date(s.created_at) AS day,
                COUNT(DISTINCT s.id) AS count,
                COALESCE(SUM(s.total), 0) AS total,
                COALESCE(SUM(s.tax_amount), 0) AS tax,
                COALESCE((SELECT SUM(si.cost * si.qty)
                          FROM sale_items si JOIN sales s2 ON s2.id = si.sale_id
                          WHERE s2.status = 'completed'
                            AND date(s2.created_at) = date(s.created_at)), 0) AS cost
         FROM sales s WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
         GROUP BY day ORDER BY day`
      )
      .all(start, end)
      .map((row) => ({
        day: row.day,
        count: row.count,
        total: money(row.total),
        tax: money(row.tax),
        cost: money(row.cost),
        profit: money(row.total - row.tax - row.cost),
      }));

    const byMethod = db
      .prepare(
        `SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
         FROM sales WHERE status = 'completed' AND created_at BETWEEN ? AND ?
         GROUP BY payment_method ORDER BY total DESC`
      )
      .all(start, end)
      .map((row) => ({ ...row, total: money(row.total) }));

    const byUser = db
      .prepare(
        `SELECT user_name, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
         FROM sales WHERE status = 'completed' AND created_at BETWEEN ? AND ?
         GROUP BY user_name ORDER BY total DESC`
      )
      .all(start, end)
      .map((row) => ({ ...row, total: money(row.total) }));

    res.json({
      from,
      to,
      count: totals.count,
      total: money(totals.total),
      tax: money(totals.tax),
      discount: money(totals.discount),
      net: net,
      cost,
      profit: money(net - cost),
      average_sale: totals.count ? money(totals.total / totals.count) : 0,
      by_day: byDay,
      by_method: byMethod,
      by_user: byUser,
    });
  })
);

router.get(
  '/top-products',
  wrap((req, res) => {
    const { from, to, start, end } = range(req.query);
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const rows = req.db
      .prepare(
        `SELECT si.product_id, si.name, si.sku,
                SUM(si.qty) AS qty,
                SUM(si.total) AS revenue,
                SUM(si.cost * si.qty) AS cost
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
         GROUP BY si.product_id, si.name, si.sku
         ORDER BY qty DESC LIMIT ?`
      )
      .all(start, end, limit);
    res.json({
      products: rows.map((r) => ({
        ...r,
        qty: money(r.qty),
        revenue: money(r.revenue),
        cost: money(r.cost),
        profit: money(r.revenue - r.cost),
      })),
    });
  })
);

router.get(
  '/by-category',
  wrap((req, res) => {
    const { start, end } = range(req.query);
    const rows = req.db
      .prepare(
        `SELECT COALESCE(c.name, 'Uncategorised') AS category,
                SUM(si.qty) AS qty, SUM(si.total) AS revenue
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
         GROUP BY category ORDER BY revenue DESC`
      )
      .all(start, end);
    res.json({
      categories: rows.map((r) => ({ ...r, qty: money(r.qty), revenue: money(r.revenue) })),
    });
  })
);

router.get(
  '/expenses',
  wrap((req, res) => {
    const { from, to, start, end } = range(req.query);
    const byCategory = req.db
      .prepare(
        `SELECT category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
         FROM expenses WHERE expense_date BETWEEN ? AND ?
         GROUP BY category ORDER BY total DESC`
      )
      .all(from, to)
      .map((r) => ({ ...r, total: money(r.total) }));

    const byDay = req.db
      .prepare(
        `SELECT expense_date AS day, COALESCE(SUM(amount), 0) AS total
         FROM expenses WHERE expense_date BETWEEN ? AND ?
         GROUP BY day ORDER BY day`
      )
      .all(from, to)
      .map((r) => ({ ...r, total: money(r.total) }));

    res.json({ from, to, by_category: byCategory, by_day: byDay });
  })
);

router.get(
  '/profit',
  wrap((req, res) => {
    const db = req.db;
    const { from, to, start, end } = range(req.query);
    const sales = salesTotals(db, start, end);
    const cost = costOfSales(db, start, end);
    const expenses = db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE expense_date BETWEEN ? AND ?')
      .get(from, to);
    const purchases = db
      .prepare('SELECT COALESCE(SUM(total), 0) AS v FROM purchases WHERE created_at BETWEEN ? AND ?')
      .get(start, end);

    const revenue = money(sales.total - sales.tax);
    const gross = money(revenue - cost);
    res.json({
      from,
      to,
      revenue,
      cost_of_goods: cost,
      gross_profit: gross,
      expenses: money(expenses.v),
      net_profit: money(gross - expenses.v),
      purchases: money(purchases.v),
      margin_pct: revenue ? money((gross / revenue) * 100) : 0,
    });
  })
);

router.get(
  '/export.csv',
  wrap((req, res) => {
    const { from, to, start, end } = range(req.query);
    const rows = req.db
      .prepare(
        `SELECT invoice_no, created_at, customer_name, user_name, payment_method,
                subtotal, discount, tax_amount, total, status
         FROM sales WHERE created_at BETWEEN ? AND ? ORDER BY id`
      )
      .all(start, end);
    const csv = toCsv(
      [
        { key: 'invoice_no', label: 'Invoice' },
        { key: 'created_at', label: 'Date' },
        { key: 'customer_name', label: 'Customer' },
        { key: 'user_name', label: 'Served By' },
        { key: 'payment_method', label: 'Payment' },
        { key: 'subtotal', label: 'Subtotal' },
        { key: 'discount', label: 'Discount' },
        { key: 'tax_amount', label: 'Tax' },
        { key: 'total', label: 'Total' },
        { key: 'status', label: 'Status' },
      ],
      rows
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cyberpos-sales-${from}_to_${to}.csv"`);
    res.send(csv);
  })
);

module.exports = router;
