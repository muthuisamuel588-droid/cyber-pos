import { api, qs } from '../api.js';
import {
  el, clear, money, qty as fmtQty, table, stat, toast, modal, dateTime, dateOnly,
  input, todayISO, startOfMonthISO, icon, ICONS,
} from '../ui.js';
import { showReceipt } from '../receipt.js';
import { state, can } from '../store.js';

const TABS = [
  { key: 'sales', label: 'Sales' },
  { key: 'profit', label: 'Profit' },
  { key: 'products', label: 'Top products' },
  { key: 'categories', label: 'By category' },
  { key: 'transactions', label: 'Transactions' },
];

export default async function reportsView() {
  const wrap = el('div');
  let tab = 'sales';

  const fromInput = input({ type: 'date', value: startOfMonthISO() });
  const toInput = input({ type: 'date', value: todayISO() });
  const tabs = el('div.tabs');
  const content = el('div');

  wrap.append(
    el('div.toolbar',
      el('span.muted', { style: { fontSize: '12.5px' } }, 'From'),
      fromInput,
      el('span.muted', { style: { fontSize: '12.5px' } }, 'to'),
      toInput,
      el('button.btn.btn-sm', {
        onclick: () => {
          fromInput.value = todayISO();
          toInput.value = todayISO();
          load();
        },
      }, 'Today'),
      el('button.btn.btn-sm', {
        onclick: () => {
          fromInput.value = startOfMonthISO();
          toInput.value = todayISO();
          load();
        },
      }, 'This month'),
      el('div.spacer'),
      el('button.btn', { onclick: exportSales }, icon(ICONS.download), 'Export sales CSV')
    ),
    tabs,
    content
  );

  function renderTabs() {
    clear(tabs);
    for (const t of TABS) {
      tabs.appendChild(el('button.tab', {
        class: tab === t.key ? 'active' : '',
        onclick: () => { tab = t.key; renderTabs(); load(); },
      }, t.label));
    }
  }

  function range() {
    return qs({ from: fromInput.value, to: toInput.value });
  }

  async function load() {
    clear(content);
    content.appendChild(el('div.empty', el('p', 'Crunching the numbers…')));

    if (tab === 'sales') return loadSales();
    if (tab === 'profit') return loadProfit();
    if (tab === 'products') return loadTopProducts();
    if (tab === 'categories') return loadCategories();
    return loadTransactions();
  }

  async function loadSales() {
    const data = await api.get(`/api/reports/sales${range()}`);
    clear(content);
    content.append(
      el('div.stat-row',
        stat('Revenue', money(data.total), `${data.count} sales`),
        stat('Net of tax', money(data.net), `tax ${money(data.tax)}`),
        stat('Cost of goods', money(data.cost)),
        stat('Gross profit', money(data.profit), `avg sale ${money(data.average_sale)}`, 'accent'),
        data.discount > 0 ? stat('Discounts given', money(data.discount), '', 'warn') : null
      ),
      el('div.grid.grid-2',
        el('div.card',
          el('div.card-head', el('h3', 'Day by day')),
          el('div.card-body.tight',
            table([
              { label: 'Day', render: (r) => dateOnly(r.day) },
              { label: 'Sales', num: true, render: (r) => r.count },
              { label: 'Total', num: true, render: (r) => money(r.total) },
              { label: 'Profit', num: true, render: (r) => el('span', { style: { color: r.profit >= 0 ? 'var(--ok)' : 'var(--danger)' } }, money(r.profit)) },
            ], data.by_day, { empty: 'No sales in this period' })
          )
        ),
        el('div',
          el('div.card', { style: { marginBottom: '16px' } },
            el('div.card-head', el('h3', 'By payment method')),
            el('div.card-body.tight',
              table([
                { label: 'Method', render: (r) => el('span.badge-pill', r.payment_method) },
                { label: 'Sales', num: true, render: (r) => r.count },
                { label: 'Total', num: true, render: (r) => money(r.total) },
              ], data.by_method, { empty: 'Nothing sold yet' })
            )
          ),
          el('div.card',
            el('div.card-head', el('h3', 'By staff member')),
            el('div.card-body.tight',
              table([
                { label: 'Served by', render: (r) => r.user_name || '—' },
                { label: 'Sales', num: true, render: (r) => r.count },
                { label: 'Total', num: true, render: (r) => money(r.total) },
              ], data.by_user, { empty: 'Nothing sold yet' })
            )
          )
        )
      )
    );
  }

  async function loadProfit() {
    const data = await api.get(`/api/reports/profit${range()}`);
    clear(content);
    content.append(
      el('div.stat-row',
        stat('Revenue', money(data.revenue), 'excluding tax'),
        stat('Cost of goods', money(data.cost_of_goods)),
        stat('Gross profit', money(data.gross_profit), `${data.margin_pct}% margin`, 'accent'),
        stat('Expenses', money(data.expenses), '', 'warn'),
        stat('Net profit', money(data.net_profit), '', data.net_profit >= 0 ? 'accent' : 'danger')
      ),
      el('div.card',
        el('div.card-head', el('h3', 'How this is worked out')),
        el('div.card-body',
          el('p', { style: { margin: '0 0 10px', color: 'var(--text-2)', lineHeight: '1.75' } },
            'Profit uses the cost price recorded on each product at the moment it was sold, not today’s cost price. ',
            'Voided sales are excluded everywhere.'),
          el('p', { style: { margin: 0, color: 'var(--text-3)', fontSize: '12.5px' } },
            `Stock bought in this period: ${money(data.purchases)} (shown for reference - it is not an expense until those goods sell).`)
        )
      )
    );
  }

  async function loadTopProducts() {
    const { products } = await api.get(`/api/reports/top-products${range()}`);
    clear(content);
    content.appendChild(el('div.card',
      el('div.card-head', el('h3', 'Best selling products')),
      el('div.card-body.tight',
        table([
          { label: '#', render: (r, i) => i + 1, cls: 'muted' },
          { label: 'Product', render: (r) => el('div', el('div', { style: { fontWeight: '500' } }, r.name), r.sku ? el('div.muted', { style: { fontSize: '11.5px' } }, r.sku) : null) },
          { label: 'Sold', num: true, render: (r) => fmtQty(r.qty) },
          { label: 'Revenue', num: true, render: (r) => money(r.revenue) },
          { label: 'Profit', num: true, render: (r) => el('span', { style: { color: r.profit >= 0 ? 'var(--ok)' : 'var(--danger)' } }, money(r.profit)) },
        ], products, { empty: 'No sales in this period' })
      )
    ));
  }

  async function loadCategories() {
    const { categories } = await api.get(`/api/reports/by-category${range()}`);
    clear(content);
    content.appendChild(el('div.card',
      el('div.card-head', el('h3', 'Sales by category')),
      el('div.card-body.tight',
        table([
          { label: 'Category', render: (c) => c.category },
          { label: 'Items sold', num: true, render: (c) => fmtQty(c.qty) },
          { label: 'Revenue', num: true, render: (c) => money(c.revenue) },
        ], categories, { empty: 'No sales in this period' })
      )
    ));
  }

  async function loadTransactions() {
    const { sales } = await api.get(`/api/sales${range()}`);
    clear(content);
    content.appendChild(el('div.card',
      el('div.card-head', el('h3', 'Every transaction')),
      el('div.card-body.tight',
        table([
          { label: 'Invoice', render: (s) => el('code', s.invoice_no) },
          { label: 'When', render: (s) => dateTime(s.created_at) },
          { label: 'Customer', render: (s) => s.customer_name || el('span.muted', 'Walk-in') },
          { label: 'Served by', render: (s) => s.user_name || '—' },
          { label: 'Payment', render: (s) => el('span.badge-pill', s.payment_method) },
          { label: 'Total', num: true, render: (s) => money(s.total) },
          {
            label: 'Status',
            render: (s) => s.status === 'void'
              ? el('span.badge-pill.danger', 'Voided')
              : el('span.badge-pill.ok', 'Completed'),
          },
          {
            label: '',
            actions: true,
            render: (s) => el('button.btn.btn-sm.btn-ghost', { onclick: () => showSale(s.id) }, 'Receipt'),
          },
        ], sales, { empty: 'No transactions in this period' })
      )
    ));
  }

  async function showSale(id) {
    const { sale } = await api.get(`/api/sales/${id}`);
    await modal({
      title: `Sale ${sale.invoice_no}`,
      wide: true,
      build: () => el('div',
        table([
          { label: 'Item', render: (i) => i.name },
          { label: 'Price', num: true, render: (i) => money(i.price) },
          { label: 'Qty', num: true, render: (i) => fmtQty(i.qty) },
          { label: 'Discount', num: true, render: (i) => money(i.discount) },
          { label: 'Total', num: true, render: (i) => money(i.total) },
        ], sale.items),
        el('div.stat-row', { style: { marginTop: '16px', marginBottom: '0' } },
          stat('Subtotal', money(sale.subtotal)),
          stat('Tax', money(sale.tax_amount)),
          stat('Total', money(sale.total), '', 'accent'),
          stat('Paid', money(sale.paid), `change ${money(sale.change_due)}`)
        ),
        sale.note ? el('div.alert.warn', { style: { marginTop: '14px', marginBottom: '0' } }, sale.note) : null
      ),
      actions: (close) => [
        can('canVoidSales') && sale.status === 'completed'
          ? el('button.btn.btn-danger', { onclick: () => voidSale(sale, close) }, 'Void sale')
          : null,
        el('button.btn.btn-primary', { onclick: () => { close(true); showReceipt(sale, state.settings); } }, 'Show receipt'),
      ].filter(Boolean),
    });
  }

  async function voidSale(sale, close) {
    const reasonInput = el('textarea.input', { placeholder: 'Why is this sale being voided?' });
    await modal({
      title: `Void ${sale.invoice_no}`,
      narrow: true,
      build: () => el('div',
        el('div.alert.warn', 'Voiding puts the stock back on the shelf. The sale stays in the records marked as voided.'),
        el('div.field', el('label', 'Reason'), reasonInput)
      ),
      actions: (closeVoid) => [
        el('button.btn', { onclick: () => closeVoid(false) }, 'Cancel'),
        el('button.btn.btn-danger', {
          onclick: async () => {
            try {
              await api.post(`/api/sales/${sale.id}/void`, { reason: reasonInput.value.trim() });
              toast(`${sale.invoice_no} voided`);
              closeVoid(true);
              close(true);
              await load();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        }, 'Void this sale'),
      ],
    });
  }

  async function exportSales() {
    try {
      const text = await fetch(`/api/reports/export.csv${range()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('cyberpos_token')}` },
      }).then((r) => r.text());
      const blob = new Blob([text], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `cyberpos-sales-${fromInput.value}_to_${toInput.value}.csv` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Sales exported');
    } catch {
      toast('Could not export sales', 'err');
    }
  }

  fromInput.addEventListener('change', load);
  toInput.addEventListener('change', load);

  renderTabs();
  await load();
  return wrap;
}