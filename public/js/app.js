// App shell: login screen, sidebar navigation and the hash router.

import { api, setUnauthorizedHandler, getToken } from './api.js';
import { state, signIn, restoreSession, signOut, loadSettings, can } from './store.js';
import { el, clear, icon, ICONS, toast, field, input, modal } from './ui.js';

import dashboard from './views/dashboard.js';
import pos from './views/pos.js';
import products from './views/products.js';
import inventory from './views/inventory.js';
import customers from './views/customers.js';
import suppliers from './views/suppliers.js';
import orders from './views/orders.js';
import purchases from './views/purchases.js';
import expenses from './views/expenses.js';
import reports from './views/reports.js';
import users from './views/users.js';
import settingsView from './views/settings.js';
import activity from './views/activity.js';

const ROUTES = [
  { path: 'dashboard', title: 'Dashboard', icon: 'dashboard', group: 'Main', view: dashboard, show: () => true },
  { path: 'pos', title: 'New Sale', icon: 'cart', group: 'Main', view: pos, show: () => true, noPad: true },

  { path: 'products', title: 'Products', icon: 'box', group: 'Stock', view: products, show: () => can('canManageProducts') },
  { path: 'inventory', title: 'Inventory', icon: 'layers', group: 'Stock', view: inventory, show: () => can('canManageProducts') },
  { path: 'purchases', title: 'Purchases', icon: 'truck', group: 'Stock', view: purchases, show: () => can('canPurchase') },

  { path: 'customers', title: 'Customers', icon: 'users', group: 'Records', view: customers, show: () => true },
  { path: 'suppliers', title: 'Suppliers', icon: 'truck', group: 'Records', view: suppliers, show: () => can('canManageProducts') },
  { path: 'orders', title: 'Held Sales', icon: 'clock', group: 'Records', view: orders, show: () => true },
  { path: 'expenses', title: 'Expenses', icon: 'wallet', group: 'Records', view: expenses, show: () => can('canManageExpenses') },

  { path: 'reports', title: 'Reports', icon: 'chart', group: 'Insight', view: reports, show: () => can('canViewReports') },

  { path: 'users', title: 'Users', icon: 'key', group: 'System', view: users, show: () => can('canManageUsers') },
  { path: 'activity', title: 'Activity Log', icon: 'clock', group: 'System', view: activity, show: () => can('canManageUsers') },
  { path: 'settings', title: 'Settings', icon: 'cog', group: 'System', view: settingsView, show: () => true },
];

const app = document.getElementById('app');
let currentRoute = null;

// ---------------------------------------------------------------- login

function renderLogin() {
  const username = input({ name: 'username', value: '', placeholder: 'e.g. admin', autocomplete: 'username' });
  const password = input({ type: 'password', name: 'password', placeholder: 'Your password', autocomplete: 'current-password' });
  const errorBox = el('div.alert.danger', { style: { display: 'none' } });
  const submit = el('button.btn.btn-primary.btn-lg', { type: 'submit', style: { width: '100%' } }, 'Sign in');

  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        await signIn(username.value.trim(), password.value);
        await boot();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = '';
        password.value = '';
        password.focus();
      } finally {
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    },
  },
    errorBox,
    field('Username', username),
    field('Password', password),
    submit
  );

  clear(app).className = '';
  app.appendChild(el('div.login-wrap',
    el('div.login-card',
      el('div.login-brand',
        el('div.mark', 'CP'),
        el('h1', 'Cyber POS'),
        el('p', 'Sign in to open the till')
      ),
      form,
      el('div.login-hint',
        'First time here? Sign in with ',
        el('code', 'admin'), ' / ', el('code', 'admin123'),
        ' and change it from Settings straight away.'
      )
    )
  ));
  setTimeout(() => username.focus(), 60);
}

// ---------------------------------------------------------------- shell

function visibleRoutes() {
  return ROUTES.filter((r) => r.show());
}

function renderShell() {
  const content = el('main.content');
  const title = el('h2');
  const storeLine = el('span.store');
  const clock = el('span.clock');

  const nav = el('nav.nav');
  const groups = [...new Set(visibleRoutes().map((r) => r.group))];
  for (const group of groups) {
    nav.appendChild(el('div.nav-group', el('div.nav-group-label', group)));
    for (const route of visibleRoutes().filter((r) => r.group === group)) {
      nav.appendChild(el('button.nav-item', {
        dataset: { path: route.path },
        onclick: () => navigate(route.path),
      }, icon(ICONS[route.icon]), el('span', route.title)));
    }
  }

  const shell = el('div.shell',
    el('aside.sidebar',
      el('div.sidebar-brand',
        el('div.mark', 'CP'),
        el('div', el('div.name', state.settings.store_name || 'Cyber POS'), el('div.sub', 'Cyber POS'))
      ),
      nav,
      el('div.sidebar-foot',
        el('div.user-chip',
          el('div.avatar', (state.user?.username || '?').slice(0, 2).toUpperCase()),
          el('div.who', el('b', state.user?.full_name || state.user?.username), el('span', state.user?.role)),
          el('button.btn.btn-ghost.btn-icon', { title: 'Sign out', onclick: doSignOut }, icon(ICONS.logout))
        )
      )
    ),
    el('div.main',
      el('header.topbar', title, storeLine, el('div.spacer'), clock),
      content
    )
  );

  clear(app).className = '';
  app.appendChild(shell);

  const tick = () => {
    clock.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
  };
  tick();
  setInterval(tick, 1000);

  if (state.settings.store_address) storeLine.textContent = `· ${state.settings.store_address}`;

  return { content, title, nav };
}

async function doSignOut() {
  await signOut();
  toast('Signed out');
  renderLogin();
}

// ---------------------------------------------------------------- routing

function navigate(path) {
  if (location.hash === `#/${path}`) {
    renderRoute(path);
    return;
  }
  location.hash = `#/${path}`;
}

async function renderRoute(path) {
  const route = visibleRoutes().find((r) => r.path === path);
  if (!route) {
    const fallback = visibleRoutes()[0]?.path || 'dashboard';
    if (path !== fallback) return navigate(fallback);
    return undefined;
  }

  const content = document.querySelector('.content');
  const titleNode = document.querySelector('.topbar h2');
  if (!content) return undefined;

  for (const item of document.querySelectorAll('.nav-item')) {
    item.classList.toggle('active', item.dataset.path === route.path);
  }

  titleNode.textContent = route.title;
  content.className = `content${route.noPad ? ' no-pad' : ''}`;
  currentRoute = route.path;

  // Keep a stale view from answering a newer one.
  const runId = Symbol('render');
  renderRoute.token = runId;
  clear(content);
  content.appendChild(el('div.empty', el('div.icon', '⋯'), el('p', `Loading ${route.title.toLowerCase()}…`)));

  try {
    const view = await route.view();
    if (renderRoute.token !== runId) return undefined;
    clear(content);
    content.appendChild(view);
    return view;
  } catch (err) {
    if (renderRoute.token !== runId) return undefined;
    clear(content);
    content.appendChild(el('div.alert.danger', err.message));
    return undefined;
  }
}

function onHashChange() {
  const path = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
  renderRoute(path);
}

// ---------------------------------------------------------------- boot

async function boot() {
  const ok = await restoreSession();
  if (!ok) {
    renderLogin();
    return;
  }
  renderShell();
  const defaultRoute = state.user?.role === 'cashier' ? 'pos' : 'dashboard';
  if (!location.hash) {
    location.hash = `#/${defaultRoute}`;
    onHashChange();
  } else {
    onHashChange();
  }
}

setUnauthorizedHandler(() => {
  if (state.user) {
    toast('Your session expired - sign in again', 'err');
    renderLogin();
  }
});

window.addEventListener('hashchange', onHashChange);

// Keep two tills on the same browser tab from fighting over the token.
window.addEventListener('storage', (e) => {
  if (e.key === 'cyberpos_token' && e.newValue !== getToken()) {
    location.reload();
  }
});

// Quick refresh of shop settings (used by settings page, cheap enough anywhere).
window.addEventListener('cyberpos:settings-changed', async () => {
  await loadSettings();
  const brand = document.querySelector('.sidebar-brand .name');
  if (brand) brand.textContent = state.settings.store_name || 'Cyber POS';
});

api.get('/api/health').catch(() => {});
boot();

export { modal, navigate };