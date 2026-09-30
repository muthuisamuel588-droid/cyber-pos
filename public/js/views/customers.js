import { api } from '../api.js';
import { el, clear, money, table, toast, modal, confirmDialog, field, input, dateOnly, icon, ICONS } from '../ui.js';

export default async function customersView() {
  const wrap = el('div');
  const listHost = el('div.card-body.tight');
  const searchInput = input({ placeholder: 'Search name, phone or email…', autocomplete: 'off' });
  const countLabel = el('span.muted', { style: { fontSize: '12.5px' } });

  wrap.append(
    el('div.toolbar',
      el('div.search-box', icon(ICONS.search), searchInput),
      el('div.spacer'),
      countLabel,
      el('button.btn.btn-primary', { onclick: () => openCustomer(null) }, icon(ICONS.plus), 'New customer')
    ),
    el('div.card', el('div.card-head', el('h3', 'Customers')), listHost)
  );

  async function load() {
    const { customers } = await api.get(`/api/customers?q=${encodeURIComponent(searchInput.value.trim())}`);
    countLabel.textContent = `${customers.length} customer${customers.length === 1 ? '' : 's'}`;

    clear(listHost);
    listHost.appendChild(table([
      { label: 'Name', render: (c) => el('div', el('div', { style: { fontWeight: '500' } }, c.name), c.email ? el('div.muted', { style: { fontSize: '11.5px' } }, c.email) : null) },
      { label: 'Phone', render: (c) => c.phone || el('span.muted', '—') },
      { label: 'Address', render: (c) => c.address || el('span.muted', '—') },
      {
        label: 'On account',
        num: true,
        render: (c) => Number(c.credit) > 0
          ? el('span', { style: { color: 'var(--danger)', fontWeight: '600' } }, money(c.credit))
          : el('span.muted', money(0)),
      },
      { label: 'Since', render: (c) => dateOnly(c.created_at) },
      {
        label: '',
        actions: true,
        render: (c) => el('div',
          el('button.btn.btn-sm.btn-ghost', { title: 'History', onclick: () => showHistory(c) }, 'History'),
          el('button.btn.btn-sm.btn-ghost', { title: 'Edit', onclick: () => openCustomer(c) }, icon(ICONS.edit)),
          el('button.btn.btn-sm.btn-ghost', { title: 'Remove', style: { color: 'var(--danger)' }, onclick: () => remove(c) }, icon(ICONS.trash))
        ),
      },
    ], customers, {
      empty: searchInput.value ? 'No matching customer' : 'No customers yet',
      emptyHint: searchInput.value ? '' : 'Customers are optional at the till - add them to keep a buying history.',
    }));
  }

  async function openCustomer(customer) {
    const isNew = !customer;
    const data = {
      name: input({ value: customer?.name || '' }),
      phone: input({ value: customer?.phone || '', type: 'tel' }),
      email: input({ value: customer?.email || '', type: 'email' }),
      address: input({ value: customer?.address || '' }),
      credit: input({ type: 'number', step: '0.01', value: customer?.credit ?? 0 }),
      notes: input({ value: customer?.notes || '' }),
    };

    const save = async (close) => {
      const payload = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.value]));
      try {
        if (isNew) await api.post('/api/customers', payload);
        else await api.put(`/api/customers/${customer.id}`, payload);
        toast(`${payload.name} saved`);
        close(true);
        await load();
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    await modal({
      title: isNew ? 'New customer' : `Edit ${customer.name}`,
      build: () => el('div',
        field('Name', data.name),
        el('div.row', field('Phone', data.phone), field('Email', data.email)),
        field('Address', data.address),
        field('On account balance', data.credit, 'Only adjust this when settling a debt by hand.'),
        field('Notes', data.notes)
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => save(close) }, 'Save'),
      ],
    });
  }

  async function remove(customer) {
    const ok = await confirmDialog({
      title: `Remove ${customer.name}?`,
      message: 'Their past sales stay in the reports, but the customer record is deleted.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/customers/${customer.id}`);
      toast('Customer removed');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function showHistory(customer) {
    const data = await api.get(`/api/customers/${customer.id}`);
    await modal({
      title: `${customer.name} · buying history`,
      wide: true,
      build: () => el('div',
        customer.phone || customer.email || customer.address
          ? el('div.alert.info', [customer.phone, customer.email, customer.address].filter(Boolean).join(' · '))
          : null,
        Number(customer.credit) > 0 ? el('div.alert.warn', `Outstanding on account: ${money(customer.credit)}`) : null,
        table([
          { label: 'Invoice', render: (s) => el('code', s.invoice_no) },
          { label: 'Date', render: (s) => dateOnly(s.created_at) },
          { label: 'Total', num: true, render: (s) => money(s.total) },
        ], data.sales, { empty: 'No purchases recorded', emptyHint: 'Sales rung up against this customer will appear here.' })
      ),
      actions: (close) => [el('button.btn', { onclick: () => close(false) }, 'Close')],
    });
  }

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(load, 220);
  });

  await load();
  return wrap;
}