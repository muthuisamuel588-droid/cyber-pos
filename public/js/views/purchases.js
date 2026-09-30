import { api } from '../api.js';
import { el, clear, money, qty as fmtQty, table, toast, modal, field, input, select, dateTime, stat } from '../ui.js';

export default async function purchasesView() {
  const wrap = el('div');
  const listHost = el('div.card-body.tight');

  wrap.append(
    el('div.toolbar',
      el('div.spacer'),
      el('button.btn.btn-primary', { onclick: newPurchase }, 'Record purchase')
    ),
    el('div.card', el('div.card-head', el('h3', 'Purchase history')), listHost)
  );

  async function load() {
    const { purchases } = await api.get('/api/purchases');
    clear(listHost);
    listHost.appendChild(table([
      { label: 'Reference', render: (p) => el('code', p.reference || `#${p.id}`) },
      { label: 'Supplier', render: (p) => p.supplier_name || el('span.muted', '—') },
      { label: 'When', render: (p) => dateTime(p.created_at) },
      { label: 'By', render: (p) => p.user_name || '—' },
      { label: 'Total', num: true, render: (p) => money(p.total) },
      { label: 'Paid', num: true, render: (p) => money(p.paid) },
      {
        label: 'Status',
        render: (p) => {
          const due = Number(p.total) - Number(p.paid);
          if (due <= 0.001) return el('span.badge-pill.ok', 'Paid');
          return el('span.badge-pill.warn', `Owing ${money(due)}`);
        },
      },
      {
        label: '',
        actions: true,
        render: (p) => el('div',
          el('button.btn.btn-sm.btn-ghost', { onclick: () => showPurchase(p) }, 'View'),
          Number(p.total) - Number(p.paid) > 0.001
            ? el('button.btn.btn-sm', { onclick: () => pay(p) }, 'Pay')
            : null
        ),
      },
    ], purchases, {
      empty: 'No purchases recorded',
      emptyHint: 'Record a purchase when stock arrives so quantities and costs stay correct.',
    }));
  }

  async function newPurchase() {
    const [{ products }, { suppliers }] = await Promise.all([
      api.get('/api/products?limit=1000'),
      api.get('/api/suppliers'),
    ]);

    const lines = [];
    const productSelect = select([{ value: '', label: 'Choose a product…' }, ...products.map((p) => ({ value: p.id, label: `${p.name} (${fmtQty(p.stock)} in stock)` }))]);
    const costInput = input({ type: 'number', step: '0.01', min: '0', value: '' });
    const qtyInput = input({ type: 'number', step: 'any', min: '0', value: '1' });
    const supplierSelect = select([{ value: '', label: 'No supplier' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]);
    const referenceInput = input({ placeholder: 'e.g. PO-1042' });
    const paidInput = input({ type: 'number', step: '0.01', min: '0', value: '0' });

    productSelect.addEventListener('change', () => {
      const product = products.find((p) => String(p.id) === productSelect.value);
      if (product) costInput.value = String(product.cost);
    });

    const linesHost = el('div', { style: { border: '1px solid var(--border)', borderRadius: '7px', marginBottom: '14px', maxHeight: '220px', overflowY: 'auto' } });
    const totalsLine = el('div.field');

    function renderLines() {
      clear(linesHost);
      if (!lines.length) {
        linesHost.appendChild(el('div.empty', { style: { padding: '20px' } }, el('p', 'No items added yet')));
      } else {
        linesHost.appendChild(table([
          { label: 'Product', render: (l) => l.name },
          { label: 'Cost', num: true, render: (l) => money(l.cost) },
          { label: 'Qty', num: true, render: (l) => fmtQty(l.qty) },
          { label: 'Total', num: true, render: (l) => money(l.cost * l.qty) },
          {
            label: '',
            actions: true,
            render: (l) => el('button.btn.btn-sm.btn-ghost', {
              style: { color: 'var(--danger)' },
              onclick: () => { lines.splice(lines.indexOf(l), 1); renderLines(); },
            }, 'Remove'),
          },
        ], lines));
      }

      const total = lines.reduce((s, l) => s + l.cost * l.qty, 0);
      clear(totalsLine);
      totalsLine.appendChild(el('div.alert.info', { style: { margin: 0 } },
        `${lines.length} line${lines.length === 1 ? '' : 's'} · Total ${money(total)} · Still owing ${money(Math.max(total - (Number(paidInput.value) || 0), 0))}`));
    }

    paidInput.addEventListener('input', renderLines);
    renderLines();

    const addLine = () => {
      const product = products.find((p) => String(p.id) === productSelect.value);
      if (!product) return toast('Choose a product first', 'warn');
      const cost = Number(costInput.value) || 0;
      const qty = Number(qtyInput.value) || 0;
      if (qty <= 0) return toast('Quantity must be more than zero', 'warn');

      lines.push({ product_id: product.id, name: product.name, sku: product.sku, cost, qty });
      productSelect.value = '';
      costInput.value = '';
      qtyInput.value = '1';
      renderLines();
      return undefined;
    };

    const save = async (close) => {
      if (!lines.length) return toast('Add at least one product', 'warn');
      try {
        const { purchase } = await api.post('/api/purchases', {
          supplier_id: supplierSelect.value ? Number(supplierSelect.value) : null,
          reference: referenceInput.value.trim(),
          paid: Number(paidInput.value) || 0,
          lines,
        });
        toast(`Purchase #${purchase.id} recorded`);
        close(true);
        await load();
      } catch (err) {
        toast(err.message, 'err', 4500);
      }
      return undefined;
    };

    await modal({
      title: 'Record a purchase',
      wide: true,
      build: () => el('div',
        el('div.row', field('Supplier', supplierSelect), field('Reference', referenceInput)),
        el('div.row',
          field('Product', productSelect),
          field('Unit cost', costInput),
          field('Quantity', qtyInput)
        ),
        el('button.btn.btn-sm', { onclick: addLine, style: { marginBottom: '14px' } }, '+ Add to purchase'),
        linesHost,
        totalsLine,
        field('Amount paid now', paidInput, 'Anything left becomes an amount owed to the supplier.')
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => save(close) }, 'Save purchase'),
      ],
    });
  }

  async function showPurchase(purchase) {
    const { purchase: full } = await api.get(`/api/purchases/${purchase.id}`);
    await modal({
      title: `Purchase ${full.reference || `#${full.id}`}`,
      wide: true,
      build: () => el('div',
        el('div.alert.info', [
          full.supplier_name || 'No supplier',
          full.created_at ? `· ${dateTime(full.created_at)}` : '',
          full.user_name ? `· by ${full.user_name}` : '',
        ].filter(Boolean).join(' ')),
        table([
          { label: 'Product', render: (i) => i.name },
          { label: 'Unit cost', num: true, render: (i) => money(i.cost) },
          { label: 'Qty', num: true, render: (i) => fmtQty(i.qty) },
          { label: 'Total', num: true, render: (i) => money(i.total) },
        ], full.items),
        el('div.stat-row', { style: { marginTop: '16px', marginBottom: '0' } },
          stat('Total', money(full.total)),
          stat('Paid', money(full.paid)),
          stat('Owing', money(full.total - full.paid), '', Number(full.total - full.paid) > 0 ? 'danger' : '')
        )
      ),
      actions: (close) => [el('button.btn', { onclick: () => close(false) }, 'Close')],
    });
  }

  async function pay(purchase) {
    const due = Number(purchase.total) - Number(purchase.paid);
    const amountInput = input({ type: 'number', step: '0.01', min: '0', value: due.toFixed(2) });

    const save = async (close) => {
      try {
        await api.post(`/api/purchases/${purchase.id}/pay`, { amount: Number(amountInput.value) || 0 });
        toast('Payment recorded');
        close(true);
        await load();
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    await modal({
      title: `Pay ${purchase.supplier_name || 'supplier'}`,
      narrow: true,
      build: () => el('div', field(`Amount (owing ${money(due)})`, amountInput)),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => save(close) }, 'Record payment'),
      ],
    });
  }

  await load();
  return wrap;
}