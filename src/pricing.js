'use strict';

const { money, num, int, str, bad } = require('./util');

/**
 * Normalise and price one cart line.
 * Line discount is per-unit. Item tax is computed on the discounted line so the
 * header tax total always equals the sum of the line taxes.
 */
function priceLine(raw) {
  const qty = num(raw.qty, 0);
  if (qty <= 0) throw bad('Every line needs a quantity greater than zero');

  const price = money(num(raw.price, 0));
  const cost = money(num(raw.cost, 0));
  const taxRate = money(num(raw.tax_rate, 0));
  const discount = money(num(raw.discount, 0));
  const gross = money(price * qty);

  if (discount < 0) throw bad('Discount cannot be negative');
  if (discount > gross) throw bad('Line discount is larger than the line total');

  return {
    product_id: raw.product_id === null || raw.product_id === undefined ? null : int(raw.product_id),
    name: str(raw.name),
    sku: str(raw.sku),
    price,
    cost,
    qty,
    discount,
    tax_rate: taxRate,
    gross,
    tax_amount: money(((gross - discount) * taxRate) / 100),
    total: money(gross - discount + ((gross - discount) * taxRate) / 100),
  };
}

/**
 * Spread `amount` across `weights` so the parts always re-add up to the whole.
 * Uses largest-remainder so the pennies land on the biggest lines and no cent
 * is created or lost to rounding.
 */
function allocate(amount, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (amount * w) / totalWeight);
  const parts = exact.map(money);
  let drift = money(amount - parts.reduce((a, b) => a + b, 0));

  const byRemainder = exact
    .map((value, idx) => ({ idx, remainder: value - money(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);

  let cursor = 0;
  while (drift !== 0 && byRemainder.length) {
    const target = byRemainder[cursor % byRemainder.length].idx;
    const step = drift > 0 ? 0.01 : -0.01;
    parts[target] = money(parts[target] + step);
    drift = money(drift - step);
    cursor += 1;
  }
  return parts;
}

/**
 * Build the full basket summary. `options.tax_rate` is the default for lines
 * that do not carry their own rate.
 */
function priceCart(rawLines, options = {}) {
  const lines = (Array.isArray(rawLines) ? rawLines : []).map((line) =>
    priceLine({ ...line, tax_rate: line.tax_rate ?? options.tax_rate ?? 0 })
  );
  if (!lines.length) throw bad('The cart is empty');

  const subtotal = money(lines.reduce((sum, l) => sum + l.gross, 0));

  const discountType = options.discount_type === 'percent' ? 'percent' : 'amount';
  const discountInput = money(num(options.discount, 0));
  let discount;
  if (discountType === 'percent') {
    if (discountInput < 0 || discountInput > 100) throw bad('Percentage discount must be 0-100');
    discount = money((subtotal * discountInput) / 100);
  } else {
    discount = discountInput;
  }
  if (discount < 0) throw bad('Discount cannot be negative');
  if (discount > subtotal) throw bad('Discount is larger than the cart subtotal');

  // Push the order discount down onto the lines, then price tax on what is left.
  const nets = allocate(money(subtotal - discount), lines.map((l) => l.gross));
  const finalLines = lines.map((l, i) => {
    const net = nets[i];
    const tax = money((net * l.tax_rate) / 100);
    return { ...l, net, tax_amount: tax, total: money(net + tax) };
  });

  return {
    lines: finalLines,
    subtotal,
    discount,
    discount_type: discountType,
    tax_amount: money(finalLines.reduce((sum, l) => sum + l.tax_amount, 0)),
    total: money(subtotal - discount + finalLines.reduce((sum, l) => sum + l.tax_amount, 0)),
    cost_total: money(finalLines.reduce((sum, l) => sum + l.cost * l.qty, 0)),
  };
}

module.exports = { priceLine, priceCart, allocate };