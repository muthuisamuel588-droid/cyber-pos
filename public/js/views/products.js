import { api, qs } from '../api.js';
import { can } from '../store.js';
import {
  el, clear, money, qty as fmtQty, table, toast, modal, confirmDialog,
  field, input, select, icon, ICONS,
} from '../ui.js';

export default async function productsView() {
  const wrap = el('div');
  let categories = [];
  let suppliers = [];
  let showArchived = false;

  const listHost = el('div.card-body.tight');

  const searchInput = input({ placeholder: 'Search name, SKU or barcode…', autocomplete: 'off' });
  const categoryFilter = select([{ value: '', label: 'All categories' }]);
  const countLabel = el('span.muted', { style: { fontSize: '12.5px' } });

  const toolbar = el('div.toolbar',
    el('div.search-box', icon(ICONS.search), searchInput),
    categoryFilter,
    el('label.checkbox',
      el('input', { type: 'checkbox', onchange: (e) => { showArchived = e.target.checked; load(); } }),
      'Show archived'
    ),
    el('div.spacer'),
    countLabel,
    el('button.btn', { onclick: importCsv }, icon(ICONS.upload), 'Import CSV'),
    el('button.btn', { onclick: exportCsv }, icon(ICONS.download), 'Export'),
    el('button.btn.btn-primary', { onclick: () => openProduct(null) }, icon(ICONS.plus), 'New product')
  );

  wrap.append(toolbar, el('div.card', el('div.card-head', el('h3', 'Products')), listHost));

  // ---------------------------------------------------------------- data

  async function loadReference() {
    const [cats, sups] = await Promise.all([api.get('/api/categories'), api.get('/api/suppliers')]);
    categories = cats.categories;
    suppliers = sups.suppliers;

    clear(categoryFilter);
    categoryFilter.appendChild(el('option', { value: '' }, 'All categories'));
    for (const c of categories) categoryFilter.appendChild(el('option', { value: c.id }, `${c.name} (${c.product_count})`));
    categoryFilter.value = categoryFilter.value;
  }

  async function load() {
    const term = searchInput.value.trim();
    const data = await api.get(`/api/products${qs({
      q: term, category_id: categoryFilter.value, include_inactive: showArchived ? '1' : '', limit: 1000,
    })}`);

    countLabel.textContent = `${data.total} product${data.total === 1 ? '' : 's'}`;

    clear(listHost);
    listHost.appendChild(table([
      {
        label: 'Product',
        render: (p) => el('div',
          el('div', { style: { fontWeight: '500' } }, p.name, p.active ? null : el('span.badge-pill', { style: { marginLeft: '7px' } }, 'archived')),
          p.sku || p.barcode ? el('div.muted', { style: { fontSize: '11.5px' } }, [p.sku, p.barcode].filter(Boolean).join(' · ')) : null
        ),
      },
      { label: 'Category', render: (p) => p.category || el('span.muted', '—') },
      { label: 'Cost', num: true, render: (p) => money(p.cost) },
      { label: 'Price', num: true, render: (p) => money(p.price) },
      {
        label: 'Stock',
        num: true,
        render: (p) => {
          const low = Number(p.stock) <= Number(p.min_stock);
          return el('span', {
            style: { color: low ? 'var(--danger)' : Number(p.stock) <= 0 ? 'var(--text-3)' : 'inherit', fontWeight: low ? '600' : '400' },
            title: `Minimum ${fmtQty(p.min_stock)}`,
          }, `${fmtQty(p.stock)} ${p.unit || ''}`);
        },
      },
      {
        label: 'Margin',
        num: true,
        render: (p) => {
          const margin = Number(p.price) - Number(p.cost);
          const pct = Number(p.price) ? Math.round((margin / Number(p.price)) * 100) : 0;
          return el('span', { style: { color: margin > 0 ? 'var(--ok)' : margin < 0 ? 'var(--danger)' : 'var(--text-3)' } },
            `${money(margin)} (${pct}%)`);
        },
      },
      {
        label: '',
        actions: true,
        render: (p) => el('div',
          el('button.btn.btn-sm.btn-ghost', { title: 'Edit', onclick: () => openProduct(p) }, icon(ICONS.edit)),
          el('button.btn.btn-sm.btn-ghost', {
            title: p.active ? 'Archive' : 'Restore',
            style: { color: p.active ? 'var(--danger)' : 'var(--accent-dark)' },
            onclick: () => toggleActive(p),
          }, p.active ? 'Archive' : 'Restore')
        ),
      },
    ], data.products, {
      empty: searchInput.value ? 'No product matches' : 'No products yet',
      emptyHint: searchInput.value ? 'Try a different search.' : 'Add your first product to start selling.',
    }));
  }

  // ---------------------------------------------------------------- actions

  async function toggleActive(product) {
    if (product.active) {
      const ok = await confirmDialog({
        title: `Archive ${product.name}?`,
        message: 'It stays in your sales history but will not show up at the till or in searches.',
        confirmLabel: 'Archive',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/api/products/${product.id}`);
        toast(`${product.name} archived`);
        await loadReference();
        await load();
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }
    try {
      await api.put(`/api/products/${product.id}`, { name: product.name, active: true });
      toast(`${product.name} restored`);
      await loadReference();
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function openProduct(product) {
    const isNew = !product;
    const data = {
      name: input({ value: product?.name || '' }),
      sku: input({ value: product?.sku || '' }),
      barcode: input({ value: product?.barcode || '' }),
      category_id: select([{ value: '', label: 'No category' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
        { value: product?.category_id ?? '' }),
      supplier_id: select([{ value: '', label: 'No supplier' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))],
        { value: product?.supplier_id ?? '' }),
      price: input({ type: 'number', step: '0.01', min: '0', value: product?.price ?? 0 }),
      cost: input({ type: 'number', step: '0.01', min: '0', value: product?.cost ?? 0 }),
      stock: input({ type: 'number', step: 'any', min: '0', value: product?.stock ?? 0 }),
      min_stock: input({ type: 'number', step: 'any', min: '0', value: product?.min_stock ?? 0 }),
      unit: input({ value: product?.unit || 'pc' }),
      tax_rate: input({ type: 'number', step: '0.01', min: '0', value: product?.tax_rate ?? 0 }),
    };

    const marginLabel = el('div.hint');

    function updateMargin() {
      const price = Number(data.price.value) || 0;
      const cost = Number(data.cost.value) || 0;
      const margin = price - cost;
      const pct = price ? Math.round((margin / price) * 100) : 0;
      marginLabel.textContent = `Margin ${money(margin)} (${pct}%)`;
      marginLabel.style.color = margin > 0 ? 'var(--ok)' : margin < 0 ? 'var(--danger)' : 'var(--text-3)';
    }
    data.price.addEventListener('input', updateMargin);
    data.cost.addEventListener('input', updateMargin);
    updateMargin();

    const save = async (close) => {
      const payload = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.value]));
      payload.price = Number(payload.price) || 0;
      payload.cost = Number(payload.cost) || 0;
      payload.tax_rate = Number(payload.tax_rate) || 0;
      payload.min_stock = Number(payload.min_stock) || 0;
      payload.stock = Number(data.stock.value) || 0;
      // Stock on an existing product is managed from Inventory so the movement
      // history stays complete; only new products seed it here.
      if (!isNew) delete payload.stock;

      try {
        if (isNew) {
          await api.post('/api/products', payload);
          toast(`${payload.name} added`);
        } else {
          payload.active = true;
          await api.put(`/api/products/${product.id}`, payload);
          toast(`${payload.name} updated`);
        }
        close(true);
        await loadReference();
        await load();
      } catch (err) {
        toast(err.message, 'err', 4500);
      }
    };

    await modal({
      title: isNew ? 'New product' : `Edit ${product.name}`,
      wide: true,
      build: () => el('div',
        field('Name', data.name),
        el('div.row', field('SKU', data.sku), field('Barcode', data.barcode)),
        el('div.row', field('Category', data.category_id), field('Supplier', data.supplier_id)),
        el('div.row', field('Cost price', data.cost), field('Selling price', data.price, null)),
        isNew ? field('Opening stock', data.stock) : el('div.alert.info', 'Change stock from the Inventory page so every movement is recorded.'),
        el('div.row', field('Minimum stock', data.min_stock), field('Unit', data.unit)),
        field('Tax rate %', data.tax_rate),
        marginLabel
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => save(close) }, isNew ? 'Add product' : 'Save changes'),
      ],
    });
  }

  async function exportCsv() {
    if (!can('canManageProducts')) return;
    try {
      const text = await fetch('/api/products/export.csv', {
        headers: { Authorization: `Bearer ${localStorage.getItem('cyberpos_token')}` },
      }).then((r) => r.text());
      const blob = new Blob([text], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'cyberpos-products.csv' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Products exported');
    } catch {
      toast('Could not export products', 'err');
    }
  }

  async function importCsv() {
    const fileInput = el('input', { type: 'file', accept: '.csv,text/csv' });
    const status = el('div.hint', 'Expected columns: name, sku, barcode, category, cost, price, stock, min_stock, unit, tax_rate');

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const result = await api.post('/api/products/import', { csv: text });
        toast(`Imported ${result.imported} rows (${result.created} new, ${result.updated} updated)`);
        await loadReference();
        await load();
      } catch (err) {
        toast(err.message, 'err', 5000);
      }
    });

    await modal({
      title: 'Import products from CSV',
      build: () => el('div', field('Choose a CSV file', fileInput), status),
      actions: (close) => [el('button.btn', { onclick: () => close(false) }, 'Close')],
    });
  }

  // ---------------------------------------------------------------- go

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 220);
  });
  categoryFilter.addEventListener('change', load);

  await loadReference();
  await load();
  return wrap;
}