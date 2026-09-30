// The till: scan or tap products, build a cart, take payment, print.

import { api } from '../api.js';
import { state, taxRate } from '../store.js';
import { el, clear, money, qty as fmtQty, toast, modal, confirmDialog, field, input, select, ICONS } from '../ui.js';

function icon(name) {
  return el('span', { class: 'icon' }, name);
}
import { showReceipt } from '../receipt.js';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'mobile', label: 'Mobile money' },
  { value: 'credit', label: 'On account' },
];

export default async function posView() {
  const container = el('div.pos');

  const cart = {
    lines: [],
    discount: 0,
    discountType: 'amount',
    paymentMethod: 'cash',
    customerId: null,
    customerName: '',
    note: '',
  };

  // ---- left: search + product grid
  const searchInput = input({ placeholder: 'Scan a barcode or search products…', autocomplete: 'off' });
  const results = el('div.pos-results');
  const searchBox = el('div.pos-search',
    el('div.row',
      el('div.search-box', icon(ICONS.search), searchInput),
      el('button.btn', { onclick: () => openQuickFind(searchInput, searchInput.value.trim()) }, 'Advanced')
    )
  );

  container.appendChild(el('div.pos-left', searchBox, results));
  const right = el('div.pos-right');
  container.appendChild(right);

  // ---- right: customer, cart, totals, actions
  const cartItems = el('div.cart-items');
  const totals = el('div.cart-totals');
  const customerBar = el('div.cart-customer');
  const actions = el('div.cart-actions');
  right.append(el('div.cart-head', el('h3', 'Current Sale'), el('div.spacer', { style: { flex: '1' } })), customerBar, cartItems, totals, actions);

  // ---------------------------------------------------------------- data

  let products = [];

  async function loadProducts() {
    const data = await api.get('/api/products?limit=500');
    products = data.products;
    return products;
  }

  function findByBarcode(code) {
    return products.find((p) => p.barcode === code) || products.find((p) => p.sku === code) || null;
  }

  function renderResults(term = '') {
    const needle = term.trim().toLowerCase();
    const matches = (needle
      ? products.filter((p) => p.name.toLowerCase().includes(needle) || (p.sku || '').toLowerCase().includes(needle) || (p.barcode || '').includes(needle))
      : products
    ).slice(0, 60);

    clear(results);
    if (!matches.length) {
      results.appendChild(el('div.empty',
        el('div.icon', '⌕'),
        el('p', products.length ? 'No product matches that' : 'No products yet'),
        el('small', products.length ? 'Try a different search.' : 'Add products on the Products page first.')
      ));
      return;
    }

    const grid = el('div.pos-grid');
    for (const p of matches) {
      const out = Number(p.stock) <= 0;
      const low = Number(p.stock) <= Number(p.min_stock);
      grid.appendChild(el('button.product-tile', {
        disabled: out,
        onclick: () => addToCart(p),
        title: out ? 'Out of stock' : `${p.name} - ${money(p.price)}`,
      },
        el('div.name', p.name),
        el('div.price', money(p.price)),
        el('div.stock', { class: out ? 'low' : low ? 'low' : '' },
          out ? 'Out of stock' : `${fmtQty(p.stock)} ${p.unit || 'pc'} in stock`)
      ));
    }
    results.appendChild(grid);
    if (needle && matches.length > 1) {
      results.appendChild(el('div.hint', { style: { marginTop: '12px', textAlign: 'center' } },
        `${matches.length} matches - keep typing to narrow it down`));
    }
  }

  // ---------------------------------------------------------------- cart

  function addToCart(product, qtyOverride) {
    const existing = cart.lines.find((l) => l.product_id === product.id);
    const wanted = qtyOverride ?? (existing ? Number(existing.qty) + 1 : 1);

    if (Number(product.stock) < wanted && state.settings.allow_negative_stock !== '1') {
      toast(`Only ${fmtQty(product.stock)} ${product.unit || 'pc'} of ${product.name} in stock`, 'err');
      return;
    }

    if (existing) {
      existing.qty = wanted;
    } else {
      cart.lines.push({
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        price: Number(product.price),
        cost: Number(product.cost),
        tax_rate: Number(product.tax_rate) || taxRate(),
        qty: wanted,
        discount: 0,
        unit: product.unit,
        stock: Number(product.stock),
      });
    }
    renderCart();
  }

  function setQty(line, value) {
    const next = Number(value);
    if (!Number.isFinite(next) || next <= 0) {
      removeLine(line);
      return;
    }
    if (state.settings.allow_negative_stock !== '1' && next > line.stock) {
      toast(`Only ${fmtQty(line.stock)} ${line.unit || 'pc'} in stock`, 'warn');
      return;
    }
    line.qty = next;
    renderCart();
  }

  function removeLine(line) {
    cart.lines = cart.lines.filter((l) => l !== line);
    renderCart();
  }

  function clearCart() {
    cart.lines = [];
    cart.discount = 0;
    cart.discountType = 'amount';
    cart.customerId = null;
    cart.customerName = '';
    cart.note = '';
    renderCart();
  }

  async function computeTotals() {
    if (!cart.lines.length) {
      return { subtotal: 0, discount: 0, tax_amount: 0, total: 0, lines: [] };
    }
    const { quote } = await api.post('/api/sales/quote', {
      lines: cart.lines.map((l) => ({
        product_id: l.product_id, name: l.name, sku: l.sku,
        price: l.price, cost: l.cost, qty: l.qty,
        discount: l.discount, tax_rate: l.tax_rate,
      })),
      discount: cart.discount,
      discount_type: cart.discountType,
      tax_rate: taxRate(),
    });
    return quote;
  }

  let renderToken = 0;

  async function renderCart() {
    const token = ++renderToken;

    // customer bar
    clear(customerBar);
    if (cart.customerId) {
      customerBar.append(
        el('span', `👤 ${cart.customerName}`),
        el('div', { style: { flex: '1' } }),
        el('button.btn.btn-sm', { onclick: clearCustomer }, 'Clear')
      );
    } else {
      customerBar.append(
        el('span', { style: { color: 'var(--text-3)' } }, 'Walk-in customer'),
        el('div', { style: { flex: '1' } }),
        el('button.btn.btn-sm', { onclick: pickCustomer }, 'Choose customer')
      );
    }

    // lines
    clear(cartItems);
    if (!cart.lines.length) {
      cartItems.appendChild(el('div.empty', el('div.icon', '🛒'), el('p', 'Cart is empty'),
        el('small', 'Scan a barcode or tap a product to begin.')));
    } else {
      for (const line of cart.lines) {
        const qtyInput = input({
          type: 'number', value: line.qty, min: '0', step: 'any',
          style: { width: '58px', padding: '3px 5px', textAlign: 'center' },
          onchange: (e) => setQty(line, e.target.value),
        });
        cartItems.appendChild(el('div.cart-line',
          el('div.info',
            el('div.name', line.name),
            el('div.unit', `${money(line.price)} each${line.tax_rate ? ` · tax ${line.tax_rate}%` : ''}`),
            el('div.cart-qty', { style: { marginTop: '5px' } },
              el('button', { onclick: () => setQty(line, line.qty - 1), title: 'Decrease' }, '−'),
              qtyInput,
              el('button', { onclick: () => setQty(line, line.qty + 1), title: 'Increase' }, '+'),
              el('button', { onclick: () => removeLine(line), title: 'Remove line', style: { marginLeft: '4px', color: 'var(--danger)' } }, '✕')
            )
          ),
          el('div.side', el('b', money(line.price * line.qty)))
        ));
      }
    }

    // totals (server-priced)
    const summary = await computeTotals();
    if (token !== renderToken) return;

    clear(totals);
    totals.append(
      el('div.row-line', el('span', `Subtotal (${cart.lines.length} lines)`), el('span', money(summary.subtotal))),
      el('div.row-line',
        el('span',
          el('button.btn.btn-sm.btn-ghost', { onclick: openDiscount, title: 'Apply a discount' }, 'Discount'),
          cart.discount ? ` (${cart.discountType === 'percent' ? `${cart.discount}%` : money(cart.discount, false)})` : ''
        ),
        el('span', cart.discount ? `−${money(summary.discount)}` : money(0))
      ),
      el('div.row-line', el('span', 'Tax'), el('span', money(summary.tax_amount))),
      el('div.row-line.grand', el('span', 'TOTAL'), el('b', money(summary.total)))
    );
    cart.lastTotal = summary.total;
    cart.lastSummary = summary;

    // actions
    clear(actions);
    actions.append(
      el('button.btn', { onclick: holdSale, disabled: !cart.lines.length }, 'Hold'),
      el('button.btn', { onclick: clearCartIfAny, disabled: !cart.lines.length }, 'Clear'),
      el('button.btn.btn-primary.btn-lg.pay', { onclick: takePayment, disabled: !cart.lines.length }, `Charge ${money(cart.lastTotal || 0)}`)
    );
  }

  function clearCartIfAny() {
    confirmDialog({
      title: 'Clear the cart?',
      message: 'This removes every line from the current sale.',
      confirmLabel: 'Clear cart',
      danger: true,
    }).then((ok) => {
      if (ok) clearCart();
    });
  }

  async function openDiscount() {
    const amount = input({ type: 'number', step: '0.01', min: '0', value: cart.discount || '' });
    const type = select([
      { value: 'amount', label: 'Fixed amount' },
      { value: 'percent', label: 'Percentage' },
    ], { value: cart.discountType });

    const result = await modal({
      title: 'Apply a discount',
      narrow: true,
      build: () => el('div', field('Discount', el('div.row', amount, type))),
      actions: (close) => [
        el('button.btn', { onclick: () => close(undefined) }, 'Cancel'),
        el('button.btn.btn-primary', {
          onclick: () => close({ amount: Number(amount.value) || 0, type: type.value }),
        }, 'Apply'),
      ],
    });

    if (!result) return;
    if (result.amount === 0) {
      cart.discount = 0;
      cart.discountType = 'amount';
    } else {
      cart.discount = result.amount;
      cart.discountType = result.type;
    }
    renderCart();
  }

  async function pickCustomer() {
    const nameInput = input({ placeholder: 'Search or type a name…', autocomplete: 'off' });
    const list = el('div', { style: { maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '7px' } });
    let picked = null;

    async function refresh() {
      const term = nameInput.value.trim();
      const { customers } = await api.get(`/api/customers?q=${encodeURIComponent(term)}`);
      clear(list);
      if (!customers.length) {
        list.appendChild(el('div.empty', { style: { padding: '22px' } }, el('p', 'No matching customer')));
        return;
      }
      for (const c of customers) {
        list.appendChild(el('button.nav-item', {
          type: 'button',
          style: { color: 'var(--text)', borderRadius: '0', borderBottom: '1px solid var(--border)' },
          onclick: () => { picked = c; closeFn(true); },
        }, el('span', c.name), c.phone ? el('span', { style: { marginLeft: 'auto', color: 'var(--text-3)', fontSize: '12px' } }, c.phone) : null));
      }
    }

    nameInput.addEventListener('input', refresh);
    setTimeout(refresh, 60);

    async function addNew() {
      const name = nameInput.value.trim();
      if (!name) return toast('Type a name first', 'warn');
      try {
        const { customer } = await api.post('/api/customers', { name });
        picked = customer;
        closeFn(true);
      } catch (err) {
        toast(err.message, 'err');
      }
      return undefined;
    }

    let closeFn = () => {};

    await modal({
      title: 'Choose a customer',
      build: (close) => {
        closeFn = close;
        return el('div',
          field('Search', nameInput),
          list,
          el('button.btn.btn-sm', { style: { marginTop: '12px' }, onclick: addNew }, '+ Add new customer')
        );
      },
      actions: (close) => {
        closeFn = close;
        return [el('button.btn', { onclick: () => close(false) }, 'Cancel')];
      },
    });

    if (picked) {
      cart.customerId = picked.id;
      cart.customerName = picked.name;
      renderCart();
    }
  }

  function clearCustomer() {
    cart.customerId = null;
    cart.customerName = '';
    renderCart();
  }

  // ---------------------------------------------------------------- payment

  async function takePayment() {
    const total = Number(cart.lastTotal) || 0;
    let method = cart.paymentMethod;
    let paid = total;

    const methodGrid = el('div.pay-grid');
    const paidInput = input({ type: 'number', step: '0.01', min: '0', value: total, style: { fontSize: '20px', fontWeight: '600', textAlign: 'center' } });
    const changeLine = el('div.row-line', { style: { fontSize: '15px', marginTop: '8px' } });

    const quick = el('div.quick-cash');
    function buildQuick() {
      clear(quick);
      const notes = [total, 50, 100, 200, 500, 1000, 2000, 5000].filter((n, i, arr) => n >= total && arr.indexOf(n) === i).slice(0, 8);
      for (const note of notes) {
        quick.appendChild(el('button.btn.btn-sm', { onclick: () => { paidInput.value = note; updateChange(); } }, money(note, false)));
      }
    }

    function updateChange() {
      const value = Number(paidInput.value) || 0;
      const change = value - total;
      clear(changeLine);
      changeLine.append(
        el('span', 'Change due'),
        el('b', { style: { color: change < 0 ? 'var(--danger)' : 'var(--accent-dark)' } }, money(change))
      );
    }

    function buildMethods() {
      clear(methodGrid);
      for (const pm of PAYMENT_METHODS) {
        if (pm.value === 'credit' && !cart.customerId) continue;
        methodGrid.appendChild(el('button', {
          class: method === pm.value ? 'active' : '',
          onclick: () => {
            method = pm.value;
            buildMethods();
            buildQuick();
            paidInput.value = method === 'cash' ? total : 0;
            updateChange();
          },
        }, pm.label));
      }
    }

    buildMethods();
    buildQuick();
    paidInput.addEventListener('input', updateChange);
    updateChange();

    const ok = await modal({
      title: `Take payment · ${money(total)}`,
      narrow: true,
      build: () => el('div',
        el('div.field', el('label', 'Payment method'), methodGrid),
        cart.customerId ? null : el('div.alert.info', 'Pick a customer first if this sale is on account.'),
        el('div.field', el('label', 'Amount received'), paidInput, el('div.hint', 'F2 opens quick cash, Enter confirms')),
        changeLine,
        quick
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => close(true) }, 'Complete sale'),
      ],
    });

    if (!ok) return;
    paid = Number(paidInput.value) || 0;

    try {
      const { sale } = await api.post('/api/sales', {
        customer_id: cart.customerId,
        customer_name: cart.customerName,
        lines: cart.lines.map((l) => ({
          product_id: l.product_id, name: l.name, sku: l.sku,
          price: l.price, cost: l.cost, qty: l.qty, discount: l.discount, tax_rate: l.tax_rate,
        })),
        discount: cart.discount,
        discount_type: cart.discountType,
        tax_rate: taxRate(),
        payment_method: method,
        paid,
        note: cart.note,
      });

      const change = Number(sale.change_due) || 0;
      clearCart();
      await loadProducts();
      renderResults(searchInput.value);
      showReceipt(sale, state.settings);
      toast(change > 0 ? `Sale ${sale.invoice_no} - change ${money(change)}` : `Sale ${sale.invoice_no} complete`);
    } catch (err) {
      toast(err.message, 'err', 5000);
    }
  }

  async function holdSale() {
    const labelInput = input({ placeholder: 'e.g. Table 4 or John', value: `Sale ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` });
    const result = await modal({
      title: 'Hold this sale',
      narrow: true,
      build: () => el('div', field('Name for this sale', labelInput)),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => close(true) }, 'Hold'),
      ],
    });
    if (!result) return;

    try {
      await api.post('/api/orders', {
        label: labelInput.value.trim() || 'Held sale',
        cart: {
          lines: cart.lines, discount: cart.discount, discountType: cart.discountType,
          customerId: cart.customerId, customerName: cart.customerName, note: cart.note,
        },
      });
      clearCart();
      toast('Sale held');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function openQuickFind(inputEl, term) {
    if (term) {
      const found = findByBarcode(term);
      if (found) {
        addToCart(found);
        inputEl.value = '';
        renderResults('');
        return;
      }
    }

    const nameInput = input({ placeholder: 'Product name', value: term });
    const skuInput = input({ placeholder: 'SKU' });
    const priceInput = input({ type: 'number', step: '0.01', min: '0', value: '0' });
    const costInput = input({ type: 'number', step: '0.01', min: '0', value: '0' });
    const stockInput = input({ type: 'number', step: 'any', min: '0', value: '1' });
    const taxInput = input({ type: 'number', step: '0.01', min: '0', value: taxRate() });
    const unitInput = input({ value: 'pc' });
    const barcodeInput = input({ placeholder: 'Optional' });
    let createdId = null;
    let closeFn = () => {};

    const addBtn = el('button.btn.btn-primary', 'Add & sell');

    async function createAndAdd() {
      if (!nameInput.value.trim()) return toast('Enter a product name', 'warn');
      addBtn.disabled = true;
      try {
        let product;
        if (createdId) {
          const { product: updated } = await api.put(`/api/products/${createdId}`, {
            name: nameInput.value.trim(), price: Number(priceInput.value) || 0,
            cost: Number(costInput.value) || 0, unit: unitInput.value.trim() || 'pc',
            tax_rate: Number(taxInput.value) || 0, barcode: barcodeInput.value.trim(),
          });
          product = updated;
        } else {
          const { product: created } = await api.post('/api/products', {
            name: nameInput.value.trim(), price: Number(priceInput.value) || 0,
            cost: Number(costInput.value) || 0, stock: Number(stockInput.value) || 0,
            min_stock: 0, unit: unitInput.value.trim() || 'pc',
            tax_rate: Number(taxInput.value) || 0, barcode: barcodeInput.value.trim(),
          });
          product = created;
          createdId = created.id;
          products.push(created);
          renderResults(searchInput.value);
        }
        addToCart(product, Number(stockInput.value) || 1);
        closeFn();
      } catch (err) {
        toast(err.message, 'err', 5000);
      } finally {
        addBtn.disabled = false;
      }
    }

    nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && createAndAdd());

    const result = await modal({
      title: 'Quick add product',
      build: (close) => {
        closeFn = close;
        return el('div',
          el('div.alert.info', 'For a one-off sale. Add it properly on the Products page if it will sell often.'),
          field('Name', nameInput),
          el('div.row', field('Price', priceInput), field('Cost', costInput)),
          el('div.row', field('Quantity to sell', stockInput), field('Unit', unitInput)),
          el('div.row', field('Tax %', taxInput), field('Barcode', barcodeInput))
        );
      },
      actions: (close) => {
        closeFn = close;
        return [
          el('button.btn', { onclick: () => close(false) }, 'Cancel'),
          Object.assign(addBtn, { onclick: createAndAdd }),
        ];
      },
    });
  }

  // ---------------------------------------------------------------- keyboard

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const term = searchInput.value.trim();
      const found = findByBarcode(term);
      if (found) {
        addToCart(found);
        searchInput.value = '';
        renderResults('');
        return;
      }
      const matches = products.filter((p) => p.name.toLowerCase().includes(term.toLowerCase()));
      if (matches.length === 1) {
        addToCart(matches[0]);
        searchInput.value = '';
        renderResults('');
        return;
      }
      if (term) openQuickFind(searchInput, term);
    }
  });

  // Barcode scanners act like fast typists ending in Enter. When the search box
  // is empty and digits arrive quickly, treat the burst as a scan.
  let burst = '';
  let burstTimer = null;
  document.addEventListener('keydown', scannerHandler);

  function scannerHandler(e) {
    if (e.key === 'F2') {
      e.preventDefault();
      return openQuickFind(searchInput, '');
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return undefined;

    if (e.key === 'Enter') {
      burst = '';
      return undefined;
    }
    if (e.key.length !== 1) return undefined;
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && document.activeElement !== searchInput) {
      return undefined;
    }

    burst += e.key;
    clearTimeout(burstTimer);
    burstTimer = setTimeout(() => {
      const code = burst;
      burst = '';
      if (code.length < 4) return;
      const found = findByBarcode(code);
      if (found) {
        addToCart(found);
        toast(`Added ${found.name}`, 'ok', 1200);
      }
    }, 120);

    return undefined;
  }

  function teardown() {
    document.removeEventListener('keydown', scannerHandler);
  }
  container.addEventListener('view:teardown', teardown);

  // ---------------------------------------------------------------- go

  await loadProducts();
  renderResults('');

  // A held sale handed over from the Held Sales page arrives via sessionStorage.
  const resumeRaw = sessionStorage.getItem('cyberpos_resume');
  if (resumeRaw) {
    sessionStorage.removeItem('cyberpos_resume');
    try {
      const parked = JSON.parse(resumeRaw);
      cart.lines = Array.isArray(parked.lines) ? parked.lines : [];
      cart.discount = Number(parked.discount) || 0;
      cart.discountType = parked.discountType === 'percent' ? 'percent' : 'amount';
      cart.customerId = parked.customerId ?? null;
      cart.customerName = parked.customerName || '';
      cart.note = parked.note || '';
      // Refresh stock figures so an outdated parked cart cannot oversell.
      cart.lines = cart.lines
        .map((line) => {
          const product = products.find((p) => p.id === line.product_id);
          return product
            ? { ...line, stock: Number(product.stock), unit: product.unit, cost: Number(product.cost) }
            : { ...line, stock: Number(line.stock ?? 0) };
        })
        .filter((line) => line.product_id && products.some((p) => p.id === line.product_id));
      if (cart.lines.length) toast(`Resumed a held sale (${cart.lines.length} lines)`);
    } catch {
      toast('That held sale could not be reopened', 'err');
    }
  }

  await renderCart();
  setTimeout(() => searchInput.focus(), 80);

  return container;
}