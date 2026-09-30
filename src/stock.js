'use strict';

const { money, num } = require('./util');

/**
 * The only way stock is ever changed. Updates the product balance and writes the
 * matching audit row in the same call, so `products.stock` and the movement
 * history can never drift apart.
 */
function applyStockChange(db, { productId, change, reason, refType, refId, user }) {
  const delta = num(change, 0);
  if (delta === 0) return null;

  const product = db.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(productId);
  if (!product) return null;

  const allowNegative = db.prepare("SELECT value FROM settings WHERE key = 'allow_negative_stock'").get();
  const blocked = allowNegative && allowNegative.value === '0';
  const next = money(num(product.stock, 0) + delta);
  if (blocked && next < 0) {
    const err = new Error(`Not enough stock for ${product.name} (have ${product.stock})`);
    err.status = 400;
    throw err;
  }

  db.prepare(
    "UPDATE products SET stock = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(next, product.id);

  db.prepare(
    `INSERT INTO stock_movements (product_id, change, balance, reason, ref_type, ref_id, user_id, user_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    product.id,
    delta,
    next,
    reason || null,
    refType || null,
    refId || null,
    user?.userId ?? null,
    user?.username ?? null
  );

  return next;
}

module.exports = { applyStockChange };