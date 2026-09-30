import { api } from '../api.js';
import {
  el, clear, money, qty as fmtQty, table, toast, modal, field, input, select, stat, dateTime,
} from '../ui.js';

export default async function inventoryView() {
  const wrap = el('div');
  let tab = 'low';

  const tabs = el('div.tabs');
  const content = el('div');

  wrap.append(tabs, content);

  const TABS = [
    { key: 'low', label: 'Needs restocking' },
    { key: 'valuation', label: 'Stock valuation' },
    { key: 'movements', label: 'Movement history' },
  ];

  function renderTabs() {
    clear(tabs);
    for (const t of TABS) {
      tabs.appendChild(el('button.tab', {
        class: tab === t.key ? 'active' : '',
        onclick: () => { tab = t.key; renderTabs(); load(); },
      }, t.label));
    }
  }

  async function load() {
    clear(content);
    content.appendChild(el('div.empty', el('p', 'Loading…')));
    if (tab === 'low') return loadLow();
    if (tab === 'valuation') return loadValuation();
    return loadMovements();
  }

  async function loadLow() {
    const { products } = await api.get('/api/stock/low');
    clear(content);
    content.appendChild(el('div.card',
      el('div.card-head',
        el('h3', 'Needs restocking'),
        el('div.spacer'),
        el('button.btn.btn-primary.btn-sm', { onclick: () => adjust(null) }, 'Adjust stock')
      ),
      el('div.card-body.tight',
        table([
          { label: 'Product', render: (p) => el('div', el('div', { style: { fontWeight: '500' } }, p.name), p.category ? el('div.muted', { style: { fontSize: '11.5px' } }, p.category) : null) },
          { label: 'In stock', num: true, render: (p) => el('span', { style: { color: Number(p.stock) <= 0 ? 'var(--danger)' : 'var(--warn)', fontWeight: '600' } }, `${fmtQty(p.stock)} ${p.unit || ''}`) },
          { label: 'Minimum', num: true, render: (p) => fmtQty(p.min_stock) },
          { label: 'Short by', num: true, render: (p) => fmtQty(Number(p.min_stock) - Number(p.stock)) },
          { label: '', actions: true, render: (p) => el('button.btn.btn-sm', { onclick: () => adjust(p) }, 'Adjust') },
        ], products, {
          empty: 'Everything is above its minimum',
          emptyHint: 'Products appear here as soon as stock reaches the minimum you set.',
        })
      )
    ));
  }

  async function loadValuation() {
    const data = await api.get('/api/stock/valuation');
    clear(content);
    content.append(
      el('div.stat-row',
        stat('Stock at cost', money(data.cost_value), 'what you paid'),
        stat('Stock at retail', money(data.retail_value), 'if it all sells'),
        stat('Potential profit', money(data.potential_profit), '', 'accent')
      ),
      el('div.card',
        el('div.card-head', el('h3', 'Stock valuation')),
        el('div.card-body.tight',
          table([
            { label: 'Product', render: (r) => el('div', el('div', { style: { fontWeight: '500' } }, r.name), r.category ? el('div.muted', { style: { fontSize: '11.5px' } }, r.category) : null) },
            { label: 'In stock', num: true, render: (r) => `${fmtQty(r.stock)} ${r.unit || ''}` },
            { label: 'Cost value', num: true, render: (r) => money(r.cost_value) },
            { label: 'Retail value', num: true, render: (r) => money(r.retail_value) },
            { label: 'Expected profit', num: true, render: (r) => money(r.retail_value - r.cost_value) },
          ], data.rows, { empty: 'No stock to value' })
        )
      )
    );
  }

  async function loadMovements() {
    const { movements } = await api.get('/api/stock/movements?limit=300');
    clear(content);
    content.appendChild(el('div.card',
      el('div.card-head', el('h3', 'Recent stock movements')),
      el('div.card-body.tight',
        table([
          { label: 'When', render: (m) => dateTime(m.created_at) },
          { label: 'Product', render: (m) => m.product_name },
          {
            label: 'Change',
            num: true,
            render: (m) => el('span', {
              style: { color: Number(m.change) > 0 ? 'var(--ok)' : 'var(--danger)', fontWeight: '600' },
            }, `${Number(m.change) > 0 ? '+' : ''}${fmtQty(m.change)}`),
          },
          { label: 'Balance', num: true, render: (m) => fmtQty(m.balance) },
          { label: 'Reason', render: (m) => m.reason || '—' },
          { label: 'By', render: (m) => m.user_name || '—' },
        ], movements, { empty: 'No stock has moved yet' })
      )
    ));
  }

  async function adjust(preset) {
    const { products } = await api.get('/api/products?limit=1000');
    const productSelect = select(products.map((p) => ({ value: p.id, label: `${p.name} (${fmtQty(p.stock)} ${p.unit || ''})` })),
      { value: preset?.id ?? products[0]?.id });
    const modeSelect = select([
      { value: 'add', label: 'Add or remove (difference)' },
      { value: 'set', label: 'Set to a counted quantity' },
    ]);
    const qtyInput = input({ type: 'number', step: 'any', value: preset ? String(Math.max(Number(preset.stock), 0)) : '0' });
    const reasonInput = input({ value: '', placeholder: 'e.g. Stock count, breakage, expiry' });

    const preview = el('div.hint');
    function updatePreview() {
      const product = products.find((p) => String(p.id) === productSelect.value);
      if (!product) return;
      const current = Number(product.stock);
      const next = modeSelect.value === 'set' ? Number(qtyInput.value) || 0 : current + (Number(qtyInput.value) || 0);
      const delta = next - current;
      preview.textContent = `${product.name}: ${fmtQty(current)} → ${fmtQty(next)} (${delta >= 0 ? '+' : ''}${fmtQty(delta)})`;
      preview.style.color = delta === 0 ? 'var(--text-3)' : delta > 0 ? 'var(--ok)' : 'var(--danger)';
    }
    [productSelect, modeSelect, qtyInput].forEach((n) => n.addEventListener('change', updatePreview));
    qtyInput.addEventListener('input', updatePreview);
    setTimeout(updatePreview, 0);

    const save = async (close) => {
      try {
        const result = await api.post('/api/stock/adjust', {
          product_id: Number(productSelect.value),
          mode: modeSelect.value,
          quantity: Number(qtyInput.value) || 0,
          reason: reasonInput.value.trim(),
        });
        toast(`${result.product.name} now has ${fmtQty(result.balance)}`);
        close(true);
        await load();
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    await modal({
      title: 'Adjust stock',
      build: () => el('div',
        field('Product', productSelect),
        field('How', modeSelect),
        field('Quantity', qtyInput),
        field('Reason', reasonInput, 'Recorded in the movement history'),
        preview
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => save(close) }, 'Save adjustment'),
      ],
    });
  }

  renderTabs();
  await load();
  return wrap;
}