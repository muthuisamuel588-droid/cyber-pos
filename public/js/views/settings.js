import { api } from '../api.js';
import { state, loadSettings, can } from '../store.js';
import { el, clear, toast, modal, confirmDialog, field, input, select, icon, ICONS } from '../ui.js';

export default async function settingsView() {
  const wrap = el('div');
  const { settings } = await api.get('/api/settings');

  const isAdmin = can('canChangeSettings');

  // ---------------------------------------------------------------- shop

  const fields = {
    store_name: input({ value: settings.store_name, disabled: !isAdmin }),
    store_address: input({ value: settings.store_address, disabled: !isAdmin }),
    store_phone: input({ value: settings.store_phone, disabled: !isAdmin }),
    store_email: input({ value: settings.store_email, disabled: !isAdmin }),
    currency: input({ value: settings.currency, disabled: !isAdmin, maxlength: '5' }),
    currency_symbol: input({ value: settings.currency_symbol, disabled: !isAdmin, maxlength: '6' }),
    tax_rate: input({ type: 'number', step: '0.01', min: '0', value: settings.tax_rate, disabled: !isAdmin }),
    invoice_prefix: input({ value: settings.invoice_prefix, disabled: !isAdmin, maxlength: '8' }),
    receipt_footer: input({ value: settings.receipt_footer, disabled: !isAdmin }),
    decimals: select([0, 1, 2].map((n) => ({ value: String(n), label: String(n) })), { value: settings.decimals, disabled: !isAdmin }),
  };

  const allowNegative = el('input', { type: 'checkbox', checked: settings.allow_negative_stock === '1', disabled: !isAdmin });
  const lowStockAlerts = el('input', { type: 'checkbox', checked: settings.low_stock_alerts === '1', disabled: !isAdmin });

  const shopCard = el('div.card',
    el('div.card-head', el('h3', 'Shop details')),
    el('div.card-body',
      isAdmin ? null : el('div.alert.info', 'Only an administrator can change these. Ask them if something needs fixing.'),
      field('Shop name', fields.store_name),
      field('Address', fields.store_address, 'Printed on every receipt.'),
      el('div.row', field('Phone', fields.store_phone), field('Email', fields.store_email)),
      el('div.row',
        field('Currency code', fields.currency, 'e.g. KES, UGX, USD'),
        field('Symbol', fields.currency_symbol, 'Shown before amounts')
      ),
      el('div.row', field('Default tax rate %', fields.tax_rate), field('Invoice prefix', fields.invoice_prefix)),
      field('Receipt footer', fields.receipt_footer),
      el('div.row',
        field('Decimal places', fields.decimals),
        el('div.field',
          el('label', 'Stock behaviour'),
          el('label.checkbox', { style: { marginTop: '6px' } }, allowNegative, 'Allow selling below zero stock'),
          el('label.checkbox', { style: { marginTop: '8px' } }, lowStockAlerts, 'Warn about low stock')
        )
      ),
      isAdmin
        ? el('button.btn.btn-primary', {
          onclick: async () => {
            try {
              const payload = {
                store_name: fields.store_name.value.trim(),
                store_address: fields.store_address.value.trim(),
                store_phone: fields.store_phone.value.trim(),
                store_email: fields.store_email.value.trim(),
                currency: fields.currency.value.trim(),
                currency_symbol: fields.currency_symbol.value.trim(),
                tax_rate: fields.tax_rate.value,
                invoice_prefix: fields.invoice_prefix.value.trim(),
                receipt_footer: fields.receipt_footer.value.trim(),
                decimals: fields.decimals.value,
                allow_negative_stock: allowNegative.checked ? '1' : '0',
                low_stock_alerts: lowStockAlerts.checked ? '1' : '0',
              };
              const result = await api.put('/api/settings', payload);
              state.settings = result.settings;
              await loadSettings();
              window.dispatchEvent(new Event('cyberpos:settings-changed'));
              toast('Settings saved');
            } catch (err) {
              toast(err.message, 'err', 4500);
            }
          },
        }, 'Save settings')
        : null
    )
  );

  // ---------------------------------------------------------------- password

  const pw = {
    current: input({ type: 'password', autocomplete: 'current-password' }),
    next: input({ type: 'password', autocomplete: 'new-password' }),
    confirm: input({ type: 'password', autocomplete: 'new-password' }),
  };

  const passwordCard = el('div.card',
    el('div.card-head', el('h3', 'Change my password')),
    el('div.card-body',
      field('Current password', pw.current),
      el('div.row', field('New password', pw.next), field('Confirm new password', pw.confirm)),
      el('button.btn', {
        onclick: async () => {
          if (pw.next.value !== pw.confirm.value) return toast('The new passwords do not match', 'err');
          try {
            await api.post('/api/auth/change-password', {
              current_password: pw.current.value,
              new_password: pw.next.value,
            });
            pw.current.value = '';
            pw.next.value = '';
            pw.confirm.value = '';
            toast('Password changed');
          } catch (err) {
            toast(err.message, 'err');
          }
          return undefined;
        },
      }, 'Change password')
    )
  );

  // ---------------------------------------------------------------- backup

  let info = null;
  const backupBody = el('div');

  async function loadBackup() {
    clear(backupBody);
    backupBody.appendChild(el('p', { style: { color: 'var(--text-3)' } }, 'Loading…'));
    try {
      info = await api.get('/api/backup/info');
    } catch (err) {
      clear(backupBody).appendChild(el('div.alert.danger', err.message));
      return;
    }

    clear(backupBody);
    backupBody.append(
      el('div.alert.info', 'Your whole shop lives in one file: ', el('code', info.path)),
      el('div.stat-row',
        el('div.stat', el('div.label', 'Database size'), el('div.value', `${Math.round(info.size / 1024)} KB`)),
        el('div.stat', el('div.label', 'Products'), el('div.value', info.counts.products)),
        el('div.stat', el('div.label', 'Sales'), el('div.value', info.counts.sales)),
        el('div.stat', el('div.label', 'Customers'), el('div.value', info.counts.customers))
      ),
      el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        el('button.btn.btn-primary', { onclick: downloadDb }, icon(ICONS.download), 'Download backup'),
        el('button.btn', { onclick: downloadJson }, icon(ICONS.download), 'Export as JSON'),
        can('canBackup') ? el('button.btn', { onclick: restoreJson }, icon(ICONS.upload), 'Restore from JSON') : null,
        can('canBackup') ? el('button.btn.btn-danger', { onclick: resetData }, icon(ICONS.trash), 'Erase trading data') : null
      ),
      el('p', { style: { color: 'var(--text-3)', fontSize: '12.5px', marginTop: '14px', marginBottom: 0 } },
        'A .db backup is a full copy you can restore on any computer. A JSON export is readable and easy to move between tills.')
    );
  }

  function tokenHeader() {
    return { Authorization: `Bearer ${localStorage.getItem('cyberpos_token')}` };
  }

  async function downloadDb() {
    try {
      const res = await fetch('/api/backup/download', { headers: tokenHeader() });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `cyberpos-backup-${new Date().toISOString().slice(0, 10)}.db` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Backup downloaded');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function downloadJson() {
    try {
      const res = await fetch('/api/backup/export.json', { headers: tokenHeader() });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `cyberpos-export-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('JSON export downloaded');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function restoreJson() {
    const fileInput = el('input', { type: 'file', accept: '.json,application/json' });
    const status = el('div.hint', 'The file is checked before anything is overwritten.');

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const confirmed = await confirmDialog({
        title: 'Replace everything with this file?',
        message: `Everything in the database now will be replaced by the contents of ${file.name}.`,
        confirmLabel: 'Replace data',
        danger: true,
      });
      if (!confirmed) {
        status.textContent = 'Cancelled - nothing was changed.';
        return;
      }

      const form = new FormData();
      form.append('file', file);
      status.textContent = 'Restoring…';
      try {
        const result = await api.post('/api/backup/restore.json', form);
        status.textContent = `Restored ${result.counts.products} products and ${result.counts.sales} sales.`;
        toast('Restore complete - reloading');
        setTimeout(() => window.location.reload(), 900);
      } catch (err) {
        status.textContent = err.message;
        status.style.color = 'var(--danger)';
      }
    });

    await modal({
      title: 'Restore from a JSON export',
      build: () => el('div',
        el('div.alert.danger', 'Everything currently in the database is replaced. Products, sales, customers and stock all go back to the contents of the file.'),
        field('Choose an export file', fileInput),
        status
      ),
      actions: (close) => [el('button.btn', { onclick: () => close(false) }, 'Close')],
    });
  }

  async function resetData() {
    const confirmInput = input({ placeholder: 'Type RESET to confirm' });
    const ok = await modal({
      title: 'Erase all trading data?',
      narrow: true,
      build: () => el('div',
        el('div.alert.danger', 'This permanently deletes every sale, purchase, expense and stock movement, and sets all stock back to zero. Users and settings are kept.'),
        el('p', { style: { color: 'var(--text-2)', fontSize: '13px' } }, 'Download a backup first if you are not certain.'),
        field('Confirm', confirmInput)
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-danger', {
          onclick: async () => {
            try {
              await api.post('/api/backup/reset', { confirm: confirmInput.value.trim() });
              toast('Trading data erased');
              close(true);
              await loadBackup();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        }, 'Erase everything'),
      ],
    });
    if (ok) window.location.reload();
  }

  const backupCard = el('div.card',
    el('div.card-head', el('h3', 'Backup & restore')),
    backupBody
  );

  wrap.append(
    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', alignItems: 'start' } },
      el('div', shopCard, can('canBackup') ? el('div', { style: { height: '16px' } }) : null, backupCard),
      el('div', passwordCard)
    )
  );

  if (can('canBackup')) await loadBackup();
  else {
    clear(backupBody).appendChild(el('p', { style: { color: 'var(--text-3)' } }, 'Only an administrator can manage backups.'));
  }

  return wrap;
}