// DOM helpers, formatting, toasts, modals and confirm dialogs.

/** Hyperscript-ish element factory: el('div.card', { onclick }, child, 'text') */
export function el(spec, props = null, ...children) {
  // Supports `tag`, `.class`, `#id` and combinations such as 'div.card#total'.
  const [head, ...classes] = String(spec).split('.');
  const [tagPart, idPart] = head.split('#');
  const node = document.createElement(tagPart || 'div');
  if (idPart) node.id = idPart;
  if (classes.length) node.className = classes.join(' ');

  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = `${node.className} ${value}`.trim();
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
  } else if (props !== null && props !== undefined) {
    children.unshift(props);
  }

  appendAll(node, children);
  return node;
}

function appendAll(node, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Escapes text for safe interpolation into innerHTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let currency = 'KSh';
export function setCurrency(symbol) {
  currency = symbol || 'KSh';
}
export function getCurrency() {
  return currency;
}

export function money(value, withSymbol = true) {
  const n = Number(value) || 0;
  const text = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? `${currency} ${text}` : text;
}

export function qty(value) {
  const n = Number(value) || 0;
  return Number.isInteger(n) ? String(n) : n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function dateTime(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function dateOnly(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function toast(message, kind = 'ok', ms = 3200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div.toast', { class: kind }, message);
  host.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/**
 * Opens a modal. `build(close)` returns the body; `actions(close)` returns footer
 * buttons. Resolves with whatever `close(value)` is called with.
 */
export function modal({ title, build, actions, wide = false, narrow = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(undefined);
    };

    const body = el('div.modal-body');
    const foot = el('div.modal-foot');
    const dialog = el('div.modal', {
      class: `${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}`.trim(),
      onclick: (e) => e.stopPropagation(),
    },
      el('div.modal-head', el('h3', title), el('button.btn.btn-ghost.btn-icon.close', { onclick: () => close(undefined), title: 'Close', 'aria-label': 'Close' }, '✕')),
      body, foot
    );

    const backdrop = el('div.modal-backdrop', { onclick: () => close(undefined) }, dialog);

    const content = build(close);
    if (content) body.appendChild(content);
    const buttons = actions ? actions(close) : null;
    if (buttons) buttons.forEach((b) => foot.appendChild(b));

    clear(root).appendChild(backdrop);
    document.addEventListener('keydown', onKey);

    const focusTarget = dialog.querySelector('input:not([type=hidden]), select, textarea');
    if (focusTarget) setTimeout(() => focusTarget.focus(), 40);
  });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return modal({
    title,
    narrow: true,
    build: () => el('p', { style: { margin: 0, color: 'var(--text-2)', lineHeight: '1.6' } }, message),
    actions: (close) => [
      el('button.btn', { onclick: () => close(false) }, 'Cancel'),
      el('button.btn', {
        class: danger ? 'btn-danger' : 'btn-primary',
        onclick: () => close(true),
      }, confirmLabel),
    ],
  }).then((v) => v === true);
}

/** Builds a labelled form field. */
export function field(label, control, hint) {
  return el('div.field', el('label', label), control, hint ? el('div.hint', hint) : null);
}

export function input(props = {}) {
  return el('input.input', { type: 'text', ...props });
}

export function select(options, props = {}) {
  const node = el('select.input', props);
  for (const opt of options) {
    node.appendChild(el('option', { value: opt.value, selected: String(opt.value) === String(props.value) }, opt.label));
  }
  if (props.value !== undefined) node.value = props.value;
  return node;
}

export function table(columns, rows, { empty = 'Nothing to show', emptyHint = '' } = {}) {
  if (!rows.length) {
    return el('div.empty', el('div.icon', '—'), el('p', empty), emptyHint ? el('small', emptyHint) : null);
  }
  const thead = el('thead', el('tr', columns.map((c) => el('th', { class: c.num ? 'num' : '' }, c.label))));
  const tbody = el('tbody', rows.map((row, index) => {
    const tr = el('tr');
    for (const c of columns) {
      const value = c.render ? c.render(row, index) : row[c.key];
      tr.appendChild(el('td', {
        class: `${c.num ? 'num' : ''} ${c.cls || ''} ${c.actions ? 'actions' : ''}`.trim(),
      }, value === null || value === undefined ? '' : value));
    }
    return tr;
  }));
  return el('div.table-wrap', el('table.data', thead, tbody));
}

export function card(title, bodyContent, headExtra = null) {
  return el('div.card',
    title ? el('div.card-head', el('h3', title), headExtra ? el('div.spacer') : null, headExtra) : null,
    el('div.card-body', { class: bodyContent?.classList?.contains('tight') ? 'tight' : '' }, bodyContent)
  );
}

export function stat(label, value, sub, kind = '') {
  return el('div.stat', { class: kind }, el('div.label', label), el('div.value', value), sub ? el('div.sub', sub) : null);
}

/** Simple confirm-once helper for destructive buttons. */
export function dangerButton(label, onClick) {
  const btn = el('button.btn.btn-sm.btn-danger', onClick, label);
  return btn;
}

export function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = path;
  return svg;
}

export const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a1.5 1.5 0 0 0 1.5 1.1h8.5a1.5 1.5 0 0 0 1.5-1.2L21 8H6"/>',
  box: '<path d="M21 8v8a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/>',
  truck: '<rect x="1" y="6" width="12" height="10" rx="1"/><path d="M13 9h4l3 3v4h-7z"/><circle cx="6" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6"/><rect x="12" y="8" width="3" height="10"/><rect x="17" y="4" width="3" height="14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 17V5"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/>',
  receipt: '<path d="M5 3v18l2.5-1.6L10 21l2-1.6L14 21l2.5-1.6L19 21V3l-2.5 1.6L14 3l-2 1.6L10 3 7.5 4.6z"/><path d="M9 9h6M9 13h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9 2 2-2 2 2 2-3 3-2-2-2 2"/>',
  warning: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
};