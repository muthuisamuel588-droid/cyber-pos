'use strict';

// End-to-end API smoke test. Boots the server on a throwaway database, exercises
// the main flows, and prints PASS/FAIL per check. Run with: node scripts/smoke-test.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const DB = path.join(os.tmpdir(), `cyberpos-smoke-${Date.now()}.db`);
// A fresh port per run so a lingering server from a previous run cannot collide.
const PORT = 13100 + (process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function api(token, method, url, body, isForm = false) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(server) {
  let lastError = '';
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early with code ${server.exitCode}`);
    }
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
      lastError = `health returned ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(250);
  }
  throw new Error(`last fetch error: ${lastError}`);
}

async function run() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), CYBERPOS_DB: DB },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  server.stdout.on('data', (d) => serverLog.push(d.toString()));
  server.stderr.on('data', (d) => serverLog.push(`[stderr] ${d.toString()}`));
  server.on('error', (err) => serverLog.push(`[spawn error] ${err.message}`));

  try {
    try {
      await waitForServer(server);
    } catch (err) {
      throw new Error(`${err.message}\n--- server output ---\n${serverLog.join('') || '(nothing)'}`);
    }

    console.log('\nHealth & auth');
    const health = await api(null, 'GET', '/api/health');
    check('health responds', health.status === 200 && health.body.app === 'Cyber POS');

    const noAuth = await api(null, 'GET', '/api/products');
    check('products blocked without a token', noAuth.status === 403);

    const badLogin = await api(null, 'POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
    check('wrong password rejected', badLogin.status === 400);

    const login = await api(null, 'POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    check('admin can sign in', login.status === 200 && !!login.body.token, JSON.stringify(login.body));
    const admin = login.body.token;

    const cashierLogin = await api(null, 'POST', '/api/auth/login', { username: 'cashier', password: 'cashier123' });
    check('cashier can sign in', cashierLogin.status === 200);
    const cashier = cashierLogin.body.token;

    const me = await api(cashier, 'GET', '/api/auth/me');
    check('me returns the signed-in user', me.body?.user?.role === 'cashier');
    check('cashier cannot manage products', me.body?.permissions?.canManageProducts === false);

    console.log('\nProducts');
    const cat = await api(admin, 'POST', '/api/categories', { name: 'Drinks', color: '#0ea5e9' });
    check('category created', cat.status === 201);

    const p1 = await api(admin, 'POST', '/api/products', {
      name: 'Cola 500ml', sku: 'DRK-001', barcode: '6001000001', category_id: cat.body.category.id,
      price: 100, cost: 60, stock: 20, min_stock: 5, unit: 'bottle', tax_rate: 16,
    });
    check('product created', p1.status === 201, JSON.stringify(p1.body));
    const cola = p1.body.product.id;

    const p2 = await api(admin, 'POST', '/api/products', {
      name: 'Bread', sku: 'BAK-001', price: 40, cost: 25, stock: 10, min_stock: 3, tax_rate: 0,
    });
    check('second product created', p2.status === 201);
    const bread = p2.body.product.id;

    const dupSku = await api(admin, 'POST', '/api/products', { name: 'Copy', sku: 'DRK-001', price: 1 });
    check('duplicate SKU rejected', dupSku.status === 400 && dupSku.body.code === 'DUPLICATE_SKU');

    const dupBarcode = await api(admin, 'POST', '/api/products', { name: 'Copy', barcode: '6001000001', price: 1 });
    check('duplicate barcode rejected', dupBarcode.status === 400 && dupBarcode.body.code === 'DUPLICATE_BARCODE');

    const noName = await api(admin, 'POST', '/api/products', { price: 10 });
    check('product without a name rejected', noName.status === 400);

    const scan = await api(cashier, 'GET', '/api/products/barcode/6001000001');
    check('barcode lookup works', scan.status === 200 && scan.body.product.id === cola);

    const search = await api(cashier, 'GET', '/api/products?q=Cola');
    check('product search works', search.body.products.length === 1);

    const cashNoEdit = await api(cashier, 'POST', '/api/products', { name: 'Nope', price: 1 });
    check('cashier cannot create products', cashNoEdit.status === 403);

    console.log('\nPricing');
    // 3 x 100 = 300 gross, +16% tax = 348
    const quote = await api(cashier, 'POST', '/api/sales/quote', {
      lines: [{ product_id: cola, name: 'Cola 500ml', sku: 'DRK-001', price: 100, cost: 60, qty: 3, tax_rate: 16 }],
    });
    check('quote totals 348', quote.body.quote.total === 348, JSON.stringify(quote.body.quote));
    check('quote tax is 48', quote.body.quote.tax_amount === 48);
    check('quote cost is 180', quote.body.quote.cost_total === 180);

    // 10% off the whole order: 270 + 43.20 = 313.20
    const quoteDisc = await api(cashier, 'POST', '/api/sales/quote', {
      lines: [{ product_id: cola, name: 'Cola 500ml', sku: 'DRK-001', price: 100, cost: 60, qty: 3, tax_rate: 16 }],
      discount: 10,
      discount_type: 'percent',
    });
    check('10% off gives 313.20', quoteDisc.body.quote.total === 313.2, JSON.stringify(quoteDisc.body.quote));

    const overDiscount = await api(cashier, 'POST', '/api/sales/quote', {
      lines: [{ product_id: cola, name: 'Cola 500ml', price: 100, qty: 1, tax_rate: 16 }],
      discount: 500,
    });
    check('discount larger than cart rejected', overDiscount.status === 400);

    const emptyCart = await api(cashier, 'POST', '/api/sales/quote', { lines: [] });
    check('empty cart rejected', emptyCart.status === 400);

    console.log('\nCheckout & stock');
    const shortPay = await api(cashier, 'POST', '/api/sales', {
      lines: [{ product_id: cola, name: 'Cola 500ml', sku: 'DRK-001', price: 100, cost: 60, qty: 1, tax_rate: 16 }],
      payment_method: 'cash',
      paid: 10,
    });
    check('underpayment rejected', shortPay.status === 400);

    const sale = await api(cashier, 'POST', '/api/sales', {
      customer_name: 'Walk-in',
      lines: [
        { product_id: cola, name: 'Cola 500ml', sku: 'DRK-001', price: 100, cost: 60, qty: 3, tax_rate: 16 },
        { product_id: bread, name: 'Bread', sku: 'BAK-001', price: 40, cost: 25, qty: 2, tax_rate: 0 },
      ],
      payment_method: 'cash',
      paid: 500,
    });
    check('sale completed', sale.status === 201, JSON.stringify(sale.body));
    check('sale total is 428', sale.body.sale?.total === 428, `got ${sale.body.sale?.total}`);
    check('change due is 72', sale.body.sale?.change_due === 72);
    check('invoice number issued', /^INV-\d{8}-\d{4}$/.test(sale.body.sale?.invoice_no || ''), sale.body.sale?.invoice_no);
    const saleId = sale.body.sale.id;

    const afterSale = await api(cashier, 'GET', `/api/products/${cola}`);
    check('stock went down by 3', afterSale.body.product.stock === 17, `got ${afterSale.body.product.stock}`);

    const oversell = await api(cashier, 'POST', '/api/sales', {
      lines: [{ product_id: bread, name: 'Bread', sku: 'BAK-001', price: 40, cost: 25, qty: 999, tax_rate: 0 }],
      payment_method: 'cash',
      paid: 100000,
    });
    check('overselling blocked', oversell.status === 400 && /Not enough stock/.test(oversell.body.error || ''), JSON.stringify(oversell.body));

    console.log('\nPurchases');
    const purchase = await api(admin, 'POST', '/api/purchases', {
      supplier_name: 'Wholesale Ltd', reference: 'PO-77',
      lines: [{ product_id: bread, name: 'Bread', sku: 'BAK-001', price: 30, qty: 20 }],
      paid: 200,
    });
    check('purchase recorded', purchase.status === 201, JSON.stringify(purchase.body));
    check('purchase total 600', purchase.body.purchase?.total === 600);
    check('purchase marked partial', purchase.body.purchase?.status === 'partial');

    const breadAfter = await api(admin, 'GET', `/api/products/${bread}`);
    // Bread was 10, the sale above took 2 and the oversell attempt rolled back,
    // so 10 - 2 + 20 = 28. The void later puts the 2 back.
    check('purchase added stock', breadAfter.body.product.stock === 28, `got ${breadAfter.body.product.stock}`);
    check('purchase updated cost', breadAfter.body.product.cost === 30, `got ${breadAfter.body.product.cost}`);

    const pay = await api(admin, 'POST', `/api/purchases/${purchase.body.purchase.id}/pay`, { amount: 400 });
    check('supplier payment recorded', pay.status === 200 && pay.body.purchase.status === 'paid');

    const overPay = await api(admin, 'POST', `/api/purchases/${purchase.body.purchase.id}/pay`, { amount: 1 });
    check('overpayment blocked when nothing is due', overPay.status === 400);

    console.log('\nStock adjustments');
    const adjust = await api(admin, 'POST', '/api/stock/adjust', {
      product_id: bread, mode: 'set', quantity: 25, reason: 'Stock count', note: 'damaged 5',
    });
    check('stock set to 25', adjust.status === 200 && adjust.body.balance === 25, JSON.stringify(adjust.body));

    const adjustAdd = await api(admin, 'POST', '/api/stock/adjust', { product_id: bread, mode: 'add', quantity: -5 });
    check('negative adjustment works', adjustAdd.body.balance === 20);

    const noChange = await api(admin, 'POST', '/api/stock/adjust', { product_id: bread, mode: 'add', quantity: 0 });
    check('no-op adjustment rejected', noChange.status === 400);

    const moves = await api(admin, 'GET', '/api/stock/movements');
    check('movement history recorded', moves.body.movements.length >= 4, `got ${moves.body.movements.length}`);

    const valuation = await api(admin, 'GET', '/api/stock/valuation');
    check('valuation totals', valuation.status === 200 && valuation.body.cost_value > 0);

    console.log('\nVoid');
    const voidNoReason = await api(admin, 'POST', `/api/sales/${saleId}/void`, {});
    check('void without a reason rejected', voidNoReason.status === 400);

    const voided = await api(admin, 'POST', `/api/sales/${saleId}/void`, { reason: 'Customer returned goods' });
    check('void succeeded', voided.status === 200 && voided.body.sale.status === 'void');

    const colaAfterVoid = await api(admin, 'GET', `/api/products/${cola}`);
    check('void restored stock', colaAfterVoid.body.product.stock === 20, `got ${colaAfterVoid.body.product.stock}`);

    const voidTwice = await api(admin, 'POST', `/api/sales/${saleId}/void`, { reason: 'again' });
    check('double void rejected', voidTwice.status === 400);

    const cashierVoid = await api(cashier, 'POST', `/api/sales/${saleId}/void`, { reason: 'nope' });
    check('cashier cannot void', cashierVoid.status === 403);

    console.log('\nCustomers, expenses, held orders');
    const customer = await api(cashier, 'POST', '/api/customers', { name: 'Amina', phone: '0700' });
    check('customer created', customer.status === 201);

    const creditSale = await api(cashier, 'POST', '/api/sales', {
      customer_id: customer.body.customer.id,
      lines: [{ product_id: bread, name: 'Bread', sku: 'BAK-001', price: 30, qty: 1, tax_rate: 0 }],
      payment_method: 'credit', paid: 0,
    });
    check('on-account sale allowed', creditSale.status === 201);

    const creditNoCustomer = await api(cashier, 'POST', '/api/sales', {
      lines: [{ product_id: bread, name: 'Bread', price: 30, qty: 1, tax_rate: 0 }],
      payment_method: 'credit', paid: 0,
    });
    check('on-account sale without a customer rejected', creditNoCustomer.status === 400);

    const expense = await api(admin, 'POST', '/api/expenses', { category: 'Transport', description: 'Fuel', amount: 1200 });
    check('expense recorded', expense.status === 201);

    const cashierExpense = await api(cashier, 'POST', '/api/expenses', { description: 'x', amount: 5 });
    check('cashier cannot record expenses', cashierExpense.status === 403);

    const badExpense = await api(admin, 'POST', '/api/expenses', { description: 'x', amount: 0 });
    check('zero expense rejected', badExpense.status === 400);

    const hold = await api(cashier, 'POST', '/api/orders', { label: 'Table 4', cart: { lines: [{ qty: 1 }] } });
    check('cart held', hold.status === 201);
    const held = await api(cashier, 'GET', `/api/orders/${hold.body.order.id}`);
    check('held cart reloads', held.body.order.cart.lines.length === 1);
    const discard = await api(cashier, 'DELETE', `/api/orders/${hold.body.order.id}`);
    check('held cart discarded', discard.status === 200);

    console.log('\nReports');
    const dash = await api(cashier, 'GET', '/api/dashboard');
    check('cashier can see the dashboard', dash.status === 200 && typeof dash.body.today.total === 'number');
    check('cashier dashboard hides profit', dash.body.today.net === undefined);
    const adminDash = await api(admin, 'GET', '/api/dashboard');
    check('manager dashboard includes profit figures', adminDash.body.today.net !== undefined);

    const salesReport = await api(admin, 'GET', '/api/reports/sales');
    check('sales report loads', salesReport.status === 200);
    check('voided sale excluded from revenue', salesReport.body.total === 30, `got ${salesReport.body.total}`);

    const profit = await api(admin, 'GET', '/api/reports/profit');
    check('profit report balances', profit.status === 200 && typeof profit.body.net_profit === 'number');

    const top = await api(admin, 'GET', '/api/reports/top-products');
    check('top products loads', top.status === 200);

    const cashierReports = await api(cashier, 'GET', '/api/reports/sales');
    check('cashier cannot see reports', cashierReports.status === 403);

    const csv = await api(admin, 'GET', '/api/reports/export.csv');
    check('sales CSV export works', csv.status === 200 && String(csv.body.raw).includes('Invoice'));

    console.log('\nUsers');
    const newUser = await api(admin, 'POST', '/api/users', {
      username: 'till2', password: 'secret123', role: 'cashier', full_name: 'Till Two',
    });
    check('admin can add a user', newUser.status === 201);

    const weakPw = await api(admin, 'POST', '/api/users', { username: 'weak', password: '123' });
    check('weak password rejected', weakPw.status === 400);

    const dupUser = await api(admin, 'POST', '/api/users', { username: 'till2', password: 'secret123' });
    check('duplicate username rejected', dupUser.status === 400);

    const selfDisable = await api(admin, 'DELETE', `/api/users/${login.body.user.id}`);
    check('cannot remove own account', selfDisable.status === 400);

    const lastAdmin = await api(admin, 'PUT', `/api/users/${login.body.user.id}`, { role: 'cashier' });
    check('cannot demote the only admin', lastAdmin.status === 400);

    const cashierUsers = await api(cashier, 'GET', '/api/users');
    check('cashier cannot list users', cashierUsers.status === 403);

    console.log('\nSettings');
    const settings = await api(admin, 'GET', '/api/settings');
    check('settings readable', settings.body.settings?.currency === 'KES');

    const update = await api(admin, 'PUT', '/api/settings', { store_name: 'Cyber Mart', currency: 'UGX', tax_rate: 16 });
    check('settings updated', update.status === 200 && update.body.settings.store_name === 'Cyber Mart');

    const badSetting = await api(admin, 'PUT', '/api/settings', { hacked: '1' });
    check('unknown setting rejected', badSetting.status === 400);

    const cashierSettings = await api(cashier, 'PUT', '/api/settings', { store_name: 'Nope' });
    check('cashier cannot change settings', cashierSettings.status === 403);

    console.log('\nCSV import');
    const csvImport = await api(admin, 'POST', '/api/products/import', {
      csv: 'name,sku,barcode,category,cost,price,stock,unit\nMango Juice,DRK-002,6001000002,Drinks,45,90,25,bottle\nSoap,CLN-001,,Cleaning,30,55,40,pc\n',
    });
    check('CSV import created 2', csvImport.body.created === 2, JSON.stringify(csvImport.body));
    const reImport = await api(admin, 'POST', '/api/products/import', {
      csv: 'name,sku,cost,price,stock\nMango Juice,DRK-002,45,95,25\n',
    });
    check('re-import updates instead of duplicating', reImport.body.updated === 1 && reImport.body.created === 0);

    const quotedCsv = await api(admin, 'POST', '/api/products/import', {
      csv: 'name,cost,price,stock\n"Widget, large",10,20,5\n"Gadget ""pro""",30,50,2\n',
    });
    check('quoted CSV fields parsed', quotedCsv.body.created === 2, JSON.stringify(quotedCsv.body));

    console.log('\nBackup');
    const backupInfo = await api(admin, 'GET', '/api/backup/info');
    check('backup info loads', backupInfo.status === 200 && backupInfo.body.counts.products > 0);

    const jsonExport = await api(admin, 'GET', '/api/backup/export.json');
    check('JSON export works', jsonExport.status === 200 && jsonExport.body.data.products.length > 0);

    const reset = await api(admin, 'POST', '/api/backup/reset', { confirm: 'RESET' });
    check('reset clears trading data', reset.status === 200);
    const afterReset = await api(admin, 'GET', '/api/reports/sales');
    check('no sales after reset', afterReset.body.total === 0);
    const stillHaveUsers = await api(admin, 'GET', '/api/users');
    check('reset keeps users', stillHaveUsers.body.users.length === 4, `got ${stillHaveUsers.body.users.length}`);

    const badRestore = await api(admin, 'POST', '/api/backup/restore.json', { json: '{"hello":1}' });
    check('invalid restore file rejected', badRestore.status === 400);

    console.log('\nRounding edge cases');
    // 3 x 33.33 = 99.99, 33.33% tax => 33.33; a 10% discount must not lose a cent.
    const odd = await api(admin, 'POST', '/api/sales/quote', {
      lines: [
        { product_id: cola, name: 'Odd', price: 33.33, qty: 3, tax_rate: 33.33 },
        { product_id: bread, name: 'Odd2', price: 19.99, qty: 1, tax_rate: 5 },
      ],
      discount: 7.77,
    });
    const lineSum = moneySum(odd.body.quote.lines.map((l) => l.total));
    check('line totals re-add to invoice total', lineSum === odd.body.quote.total, `${lineSum} vs ${odd.body.quote.total}`);
    check('no cents created or lost', odd.body.quote.total === moneySum([odd.body.quote.subtotal, -odd.body.quote.discount, odd.body.quote.tax_amount]));

    function moneySum(values) {
      return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
    }

    const logout = await api(admin, 'POST', '/api/auth/logout');
    check('logout works', logout.status === 200);
    const afterLogout = await api(admin, 'GET', '/api/products');
    check('token rejected after logout', afterLogout.status === 403);
  } finally {
    server.kill();
    await sleep(300);
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(`${DB}${suffix}`, { force: true });
    }
  }

  console.log(`\n${'-'.repeat(50)}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});