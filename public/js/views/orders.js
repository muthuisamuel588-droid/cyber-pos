import { api } from '../api.js';
import { el, clear, table, toast, modal, confirmDialog, dateTime } from '../ui.js';

export default async function ordersView() {
  const wrap = el('div');
  const listHost = el('div.card-body.tight');

  wrap.append(
    el('div.card',
      el('div.card-head', el('h3', 'Held sales')),
      listHost
    )
  );

  async function load() {
    const { orders } = await api.get('/api/orders');
    clear(listHost);
    listHost.appendChild(table([
      { label: 'Name', render: (o) => el('span', { style: { fontWeight: '500' } }, o.label) },
      { label: 'Held by', render: (o) => o.user_name || '—' },
      { label: 'Held at', render: (o) => dateTime(o.created_at) },
      {
        label: '',
        actions: true,
        render: (o) => el('div',
          el('button.btn.btn-sm.btn-primary', { onclick: () => resume(o) }, 'Resume'),
          el('button.btn.btn-sm.btn-ghost', { style: { color: 'var(--danger)' }, onclick: () => discard(o) }, 'Discard')
        ),
      },
    ], orders, {
      empty: 'No sales are on hold',
      emptyHint: 'On the till, press Hold to park the current cart and serve the next customer.',
    }));
  }

  async function resume(order) {
    const { order: full } = await api.get(`/api/orders/${order.id}`);
    // Resume by dropping the parked cart back onto the till via the hash route.
    sessionStorage.setItem('cyberpos_resume', JSON.stringify(full.cart));
    location.hash = '#/pos';
    toast(`Resumed ${order.label}`);
  }

  async function discard(order) {
    const ok = await confirmDialog({
      title: `Discard "${order.label}"?`,
      message: 'The parked cart is thrown away and cannot be recovered.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/orders/${order.id}`);
      toast('Held sale discarded');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  await load();
  return wrap;
}