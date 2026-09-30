import { api } from '../api.js';
import { el, clear, table, toast, modal, confirmDialog, field, input, select, dateOnly, icon, ICONS } from '../ui.js';
import { state } from '../store.js';

const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', cashier: 'Cashier' };

export default async function usersView() {
  const wrap = el('div');
  const listHost = el('div.card-body.tight');
  const currentUserId = state.user?.id;

  wrap.append(
    el('div.toolbar',
      el('div.spacer'),
      el('button.btn.btn-primary', { onclick: () => openUser(null) }, icon(ICONS.plus), 'Add user')
    ),
    el('div.card', el('div.card-head', el('h3', 'User accounts')), listHost)
  );

  async function load() {
    const { users } = await api.get('/api/users');
    clear(listHost);
    listHost.appendChild(table([
      { label: 'Username', render: (u) => el('div', el('span', { style: { fontWeight: '500' } }, u.username), u.id === currentUserId ? el('span.badge-pill', { style: { marginLeft: '7px' } }, 'you') : null) },
      { label: 'Full name', render: (u) => u.fullName || el('span.muted', '—') },
      { label: 'Role', render: (u) => el('span.badge-pill', { class: u.role === 'admin' ? 'info' : '' }, ROLE_LABELS[u.role] || u.role) },
      { label: 'Status', render: (u) => u.active ? el('span.badge-pill.ok', 'Active') : el('span.badge-pill.danger', 'Disabled') },
      { label: 'Added', render: (u) => dateOnly(u.created_at) },
      {
        label: '',
        actions: true,
        render: (u) => el('div',
          el('button.btn.btn-sm.btn-ghost', { title: 'Edit', onclick: () => openUser(u) }, icon(ICONS.edit)),
          el('button.btn.btn-sm.btn-ghost', { title: 'Reset password', onclick: () => resetPassword(u) }, icon(ICONS.key)),
          u.id !== currentUserId
            ? el('button.btn.btn-sm.btn-ghost', {
              title: u.active ? 'Disable' : 'Enable',
              style: { color: u.active ? 'var(--danger)' : 'var(--accent-dark)' },
              onclick: () => toggle(u),
            }, u.active ? 'Disable' : 'Enable')
            : null
        ),
      },
    ], users));
  }

  async function openUser(user) {
    const isNew = !user;
    const data = {
      username: input({ value: user?.username || '', disabled: !isNew }),
      full_name: input({ value: user?.fullName || '' }),
      role: select(Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })), { value: user?.role || 'cashier' }),
      password: input({ type: 'password', placeholder: isNew ? 'At least 6 characters' : 'Leave blank to keep current' }),
      active: el('input', { type: 'checkbox', checked: user ? user.active : true }),
    };

    const save = async (close) => {
      try {
        if (isNew) {
          await api.post('/api/users', {
            username: data.username.value.trim(),
            full_name: data.full_name.value.trim(),
            role: data.role.value,
            password: data.password.value,
          });
          toast(`${data.username.value.trim()} added`);
        } else {
          await api.put(`/api/users/${user.id}`, {
            full_name: data.full_name.value.trim(),
            role: data.role.value,
            active: data.active.checked,
          });
          if (data.password.value) {
            await api.post(`/api/users/${user.id}/reset-password`, { password: data.password.value });
          }
          toast(`${user.username} updated`);
        }
        close(true);
        await load();
      } catch (err) {
        toast(err.message, 'err', 4500);
      }
    };

    await modal({
      title: isNew ? 'Add a user' : `Edit ${user.username}`,
      build: () => el('div',
        field('Username', data.username, isNew ? 'Lowercase letters, numbers, dot, dash or underscore.' : 'Usernames cannot be changed.'),
        field('Full name', data.full_name),
        field('Role', data.role, 'Cashiers can only work the till and serve customers.'),
        isNew ? field('Password', data.password) : null,
        isNew ? null : el('label.checkbox', data.active, 'Account is active'),
        isNew ? null : field('New password', data.password, 'Only fill this in if you want to change it.')
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', { onclick: () => save(close) }, 'Save'),
      ],
    });
  }

  async function resetPassword(user) {
    const passwordInput = input({ type: 'password', placeholder: 'At least 6 characters' });
    await modal({
      title: `Reset password for ${user.username}`,
      narrow: true,
      build: () => el('div',
        el('div.alert.info', 'Tell the new password to this user directly, then ask them to change it.'),
        field('New password', passwordInput)
      ),
      actions: (close) => [
        el('button.btn', { onclick: () => close(false) }, 'Cancel'),
        el('button.btn.btn-primary', {
          onclick: async () => {
            try {
              await api.post(`/api/users/${user.id}/reset-password`, { password: passwordInput.value });
              toast('Password reset');
              close(true);
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        }, 'Reset password'),
      ],
    });
  }

  async function toggle(user) {
    const enabling = !user.active;
    const ok = await confirmDialog({
      title: `${enabling ? 'Enable' : 'Disable'} ${user.username}?`,
      message: enabling
        ? 'They will be able to sign in at the till again.'
        : 'They will not be able to sign in. Sales they already recorded stay in place.',
      confirmLabel: enabling ? 'Enable' : 'Disable',
      danger: !enabling,
    });
    if (!ok) return;
    try {
      await api.put(`/api/users/${user.id}`, { full_name: user.fullName, role: user.role, active: enabling });
      toast(`${user.username} ${enabling ? 'enabled' : 'disabled'}`);
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  await load();
  return wrap;
}