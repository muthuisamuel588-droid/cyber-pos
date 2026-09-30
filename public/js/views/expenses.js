import { api, qs } from '../api.js';
import { el, clear, money, table, toast, modal, confirmDialog, field, input, select, dateOnly, todayISO, startOfMonthISO, stat, icon, ICONS } from '../ui.js';

const CATEGORIES = ['General', 'Rent', 'Wages', 'Transport', 'Utilities', 'Marketing', 'Maintenance', 'Supplies', 'Bank fees', 'Other'];

export default async function expensesView() {
  const wrap = el('div');
  const fromInput = input({ type: 'date', value: startOfMonthISO() });
  const toInput = input({ type: 'date', value: todayISO() });
  const statsRow = el('div.stat-row');
  const listHost = el('div.card-body.tight');
  const totalLabel = el('span.muted', { style: { fontSize: '12.5px' } });

  wrap.append(
    el('div.toolbar',
      el('span.muted', { style: { fontSize: '12.5px' } }, 'From'),
      fromInput,
      el('span.muted', { style: { fontSize: '12.5px' } }, 'to'),
      toInput,
      el('button.btn.btn-sm', { onclick: () => { fromInput.value = startOfMonthISO(); toInput.value = todayISO(); load(); } }, 'This month'),
      el('div.spacer'),
      totalLabel,
      el('button.btn', { onclick: exportCsv }, icon(ICONS.download), 'Export'),
      el('button.btn.btn-primary', { onclick: () => openExpense() }, icon(ICONS.plus), 'Record expense')
    ),
    statsRow,
    el('div.card', el('div.card-head', el('h3', 'Expenses')), listHost)
  );

  async function load() {
    const range = qs({ from: fromInput.value, to: toInput.value });
    const [{ expenses, total }, report] = await Promise.all([
      api.get(`/api/expenses${range}`),
      api.get(`/api/reports/expenses${range}`),
    ]);

    totalLabel.textContent = `${expenses.length} entr${expenses.length === 1 ? 'y' : 'ies'}`;
    clear(statsRow);
    statsRow.append(
      stat('Total spent', money(total), `${fromInput.value} to ${toInput.value}`),
      ...report.by_category.slice(0, 4).map((c) => stat(c.category, money(c.total), `${c.count} entries`, 'warn'))
    );

    clear(listHost);
    listHost.appendChild(table([
      { label: 'Date', render: (e) => dateOnly(e.expense_date) },
      { label: 'Category', render: (e) => el('span.badge-pill', e.category) },
      { label: 'Description', render: (e) => el('div', e.description, e.note ? el('div.muted', { style: { fontSize: '11.5px' } }, e.note) : null) },
      { label: 'Paid by', render: (e) => e.payment_method },
      { label: 'Recorded by', render: (e) => e.user_name || '—' },
      { label: 'Amount', num: true, render: (e) => el('b', money(e.amount)) },
      { label: '', actions: true, render: (e) => el('button.btn.btn-sm.btn-ghost', { style: { color: 'var(--danger)' }, onclick: () => remove(e) }, icon(ICONS.trash)) },
    ], expenses, {
      empty: 'No expenses in this period',
      emptyHint: 'Record rent, transport and wages so profit figures are honest.',
    }));
  }

  async function openExpense() {
    const data = {
      description: input({ placeholder: 'e.g. Fuel for the delivery van' }),
      amount: input({ type: 'number', step: '0.01', min: '0', placeholder: '0.00' }),
      category: select(CATEGORIES.map((c) => ({ value: c, label: c })), { value: 'General' }),
      payment_method: select([
        { value: 'cash', label: 'Cash' },
        { value: 'card', label: 'Card' },
        { value: 'mobile', label: 'Mobile money' },
        { value: 'bank', label: 'Bank transfer' },
      ], { value: 'cash' }),
      expense_date: input({ type: 'date', value: todayISO() }),
      note: input({ placeholder: 'Optional' }),
    };

    const save = async (close) => {
      const payload = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.value]));
      try {
        await api.post('/api/expenses', payload);
        toast('Expense recorded');
        close(true);
        await load();
      } catch (err) {
        toast(err.message, 'err');
      }
    };

    await modal({
      title: 'Record an expense',
      build: () => el('div',
        field('Description', data.description),
        el('div.row', field('Amount', data.amount), field('Category', data.category)),
        el('div.row', field('Date', data.expense_date), field('Paid by', data.payment_method)),
        field('Note', data.note)
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => save(close) }, 'Save'),
      ],
    });
  }

  async function remove(expense) {
    const ok = await confirmDialog({
      title: 'Delete this expense?',
      message: `"${expense.description}" (${money(expense.amount)}) will be removed from your reports.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/expenses/${expense.id}`);
      toast('Expense deleted');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function exportCsv() {
    const text = await fetch(`/api/expenses/export.csv${qs({ from: fromInput.value, to: toInput.value })}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('cyberpos_token')}` },
    }).then((r) => r.text());
    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'cyberpos-expenses.csv' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Expenses exported');
  }

  fromInput.addEventListener('change', load);
  toInput.addEventListener('change', load);

  await load();
  return wrap;
}