import { api } from '../api.js';
import { el, clear, table, dateTime, input, icon, ICONS } from '../ui.js';

export default async function activityView() {
  const wrap = el('div');
  const listHost = el('div.card-body.tight');
  const searchInput = input({ placeholder: 'Filter by user, action or detail…', autocomplete: 'off' });

  wrap.append(
    el('div.toolbar',
      el('div.search-box', icon(ICONS.search), searchInput),
      el('div.spacer'),
      el('span.muted', { style: { fontSize: '12.5px' } }, 'Last 300 events')
    ),
    el('div.card', el('div.card-head', el('h3', 'Activity log')), listHost)
  );

  let logs = [];

  async function load() {
    const data = await api.get('/api/activity');
    logs = data.activity;
    render();
  }

  function render() {
    const term = searchInput.value.trim().toLowerCase();
    const filtered = term
      ? logs.filter((l) => `${l.user_name || ''} ${l.action} ${l.detail || ''}`.toLowerCase().includes(term))
      : logs;

    clear(listHost);
    listHost.appendChild(table([
      { label: 'When', render: (l) => dateTime(l.created_at) },
      { label: 'User', render: (l) => l.user_name || el('span.muted', 'system') },
      { label: 'Action', render: (l) => el('span.badge-pill', l.action.replace(/_/g, ' ')) },
      { label: 'Detail', render: (l) => l.detail || el('span.muted', '—') },
    ], filtered, {
      empty: term ? 'Nothing matches that filter' : 'No activity recorded yet',
      emptyHint: term ? '' : 'Everything that changes shop data is written here.',
    }));
  }

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(render, 180);
  });

  await load();
  return wrap;
}