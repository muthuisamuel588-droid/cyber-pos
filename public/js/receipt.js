// Receipt rendering and thermal printing.

import { el, money, dateTime, getCurrency } from './ui.js';

function line(char = '-', width = 32) {
  return char.repeat(width);
}

export function receiptHtml(sale, settings) {
  const width = 32;
  const out = [];
  const centre = (text) => {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
  };

  out.push(centre(settings.store_name || 'Cyber POS').toUpperCase());
  if (settings.store_address) out.push(centre(settings.store_address));
  if (settings.store_phone) out.push(centre(`Tel: ${settings.store_phone}`));
  if (settings.store_email) out.push(centre(settings.store_email));
  out.push(line('='));

  out.push(`Invoice: ${sale.invoice_no}`);
  out.push(`Date   : ${dateTime(sale.created_at)}`);
  out.push(`Served : ${sale.user_name || '-'}`);
  if (sale.customer_name) out.push(`Customer: ${sale.customer_name}`);
  out.push(line());

  out.push('ITEM'.padEnd(14) + 'QTY'.padStart(5) + 'TOTAL'.padStart(13));
  out.push(line());
  for (const item of sale.items) {
    const qty = String(item.qty);
    const total = money(item.total, false);
    if (item.name.length <= 14) {
      out.push(item.name.padEnd(14) + qty.padStart(5) + total.padStart(13));
    } else {
      // Long names get their own line rather than being cut - losing the size or
      // unit ("Maize Flour 2kg" -> "Maize Flour ~") makes the receipt useless.
      out.push(item.name);
      out.push('  '.padEnd(14) + qty.padStart(5) + total.padStart(13));
    }
    if (Number(item.qty) > 1) {
      out.push(`  @ ${money(item.price, false)}`.padEnd(width));
    }
  }

  out.push(line());
  const pad = (label, value) => `${label}`.padEnd(20) + `${value}`.padStart(12);
  out.push(pad('Subtotal', money(sale.subtotal, false)));
  if (Number(sale.discount) > 0) {
    out.push(pad(`Discount${sale.discount_type === 'percent' ? ` (${sale.discount}%)` : ''}`, `-${money(sale.discount, false)}`));
  }
  if (Number(sale.tax_amount) > 0) out.push(pad(`Tax (${sale.tax_rate}%)`, money(sale.tax_amount, false)));
  out.push(line('='));
  out.push(pad('TOTAL', money(sale.total, false)));
  out.push(pad(`Paid (${sale.payment_method})`, money(sale.paid, false)));
  if (Number(sale.change_due) > 0) out.push(pad('Change', money(sale.change_due, false)));
  out.push(line('='));

  const units = sale.items.reduce((s, i) => s + Number(i.qty), 0);
  out.push(`Units: ${units}${sale.items.length === 1 ? '' : `   Products: ${sale.items.length}`}`);
  out.push('');
  if (sale.status === 'void') {
    out.push(centre('*** VOIDED ***'));
    out.push('');
  }
  out.push(centre(settings.receipt_footer || 'Thank you!'));
  out.push(centre('Powered by Cyber POS'));

  return out.join('\n');
}

/** Shows the receipt in a modal with a print button. */
export function showReceipt(sale, settings) {
  const paper = el('pre.receipt-paper', receiptHtml(sale, settings));
  const area = el('div#print-area', paper);

  const modalEl = el('div.modal-backdrop', { onclick: () => area.remove() },
    el('div.modal', { onclick: (e) => e.stopPropagation() },
      el('div.modal-head', el('h3', `Receipt ${sale.invoice_no}`)),
      el('div.modal-body', area),
      el('div.modal-foot',
        el('button.btn', { onclick: () => area.remove() }, 'Close'),
        el('button.btn.btn-primary', { onclick: () => printArea(area) }, 'Print')
      )
    )
  );

  document.getElementById('modal-root').appendChild(modalEl);
}

export function printArea(area) {
  const existing = document.getElementById('print-holder');
  if (existing) existing.remove();

  // Park the receipt off-screen rather than display:none - a hidden ancestor can
  // never be made visible again by the print stylesheet.
  const parent = area.parentNode;
  const holder = el('div#print-holder', {
    style: { position: 'absolute', left: '-9999px', top: '0', width: '72mm' },
  }, area);
  document.body.appendChild(holder);

  const restore = () => {
    if (area.parentNode === holder && parent) parent.appendChild(area);
    holder.remove();
  };

  window.addEventListener('afterprint', restore, { once: true });
  setTimeout(restore, 1500);
  window.print();
}

export function currencySymbol() {
  return getCurrency();
}