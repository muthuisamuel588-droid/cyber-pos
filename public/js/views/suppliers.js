import { api } from '../api.js';
import { el, clear, money, table, toast, modal, confirmDialog, field, input, dateOnly, icon, ICONS } from '../ui.js';

export default async function suppliersView() {
  const wrap = el('div');
  const listHost = el('div.card-body.tight');
  const countLabel = el('span.muted', { style: { fontSize: '12.5px' } });

  wrap.append(
    el('div.toolbar',
      el('div.spacer'),
      countLabel,
      el('button.btn.btn-primary', { onclick: () => openSupplier(null) }, icon(ICONS.plus), 'New supplier')
    ),
    el('div.card', el('div.card-head', el('h3', 'Suppliers')), listHost)
  );

  async function load() {
    const { suppliers } = await api.get('/api/suppliers');
    countLabel.textContent = `${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'}`;

    clear(listHost);
    listHost.appendChild(table([
      { label: 'Name', render: (s) => el('div', el('div', { style: { fontWeight: '500' } }, s.name), s.email ? el('div.muted', { style: { fontSize: '11.5px' } }, s.email) : null) },
      { label: 'Phone', render: (s) => s.phone || el('span.muted', '—') },
      { label: 'Products', num: true, render: (s) => s.product_count || el('span.muted', '0') },
      {
        label: 'Owed',
        num: true,
        render: (s) => Number(s.due) > 0
          ? el('span', { style: { color: 'var(--danger)', fontWeight: '600' } }, money(s.due))
          : el('span.muted', money(0)),
      },
      { label: 'Since', render: (s) => dateOnly(s.created_at) },
      {
        label: '',
        actions: true,
        render: (s) => el('div',
          el('button.btn.btn-sm.btn-ghost', { title: 'Edit', onclick: () => openSupplier(s) }, icon(ICONS.edit)),
          el('button.btn.btn-sm.btn-ghost', { title: 'Remove', style: { color: 'var(--danger)' }, onclick: () => remove(s) }, icon(ICONS.trash))
        ),
      },
    ], suppliers, {
      empty: 'No suppliers yet',
      emptyHint: 'Add the businesses you buy stock from so purchases can be tracked.',
    }));
  }

  async function openSupplier(supplier) {
    const isNew = !supplier;
    const data = {
      name: input({ value: supplier?.name || '' }),
      phone: input({ value: supplier?.phone || '', type: 'tel' }),
      email: input({ value: supplier?.email || '', type: 'email' }),
      address: input({ value: supplier?.address || '' }),
      notes: input({ value: supplier?.notes || '' }),
    };

    const save = async (close) => {
      const payload = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.value]));
      try {
        if (isNew) await api.post('/api/suppliers', payload);
        else await api.put(`/api/suppliers/${supplier.id}`, payload);
        toast(`${payload.name} saved`);
        close(true);
        await load();
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    await modal({
      title: isNew ? 'New supplier' : `Edit ${supplier.name}`,
      build: () => el('div',
        field('Name', data.name),
        el('div.row', field('Phone', data.phone), field('Email', data.email)),
        field('Address', data.address),
        field('Notes', data.notes)
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => save(close) }, 'Save'),
      ],
    });
  }

  async function remove(supplier) {
    const ok = await confirmDialog({
      title: `Remove ${supplier.name}?`,
      message: 'Purchases already recorded against this supplier are kept.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/suppliers/${supplier.id}`);
      toast('Supplier removed');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  await load();
  return wrap;
}