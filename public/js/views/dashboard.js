import { api } from '../api.js';
import { state, isManager } from '../store.js';
import { el, money, dateTime, stat } from '../ui.js';

export default async function dashboardView() {
  const wrap = el('div');
  const data = await api.get('/api/dashboard');

  const stats = el('div.stat-row');
  stats.append(
    stat("Today's sales", money(data.today.total), `${data.today.count} transaction${data.today.count === 1 ? '' : 's'}`),
    stat('Average sale', money(data.today.count ? data.today.total / data.today.count : 0), 'per transaction')
  );

  if (isManager()) {
    stats.append(
      stat('Gross profit', money(data.today.profit), `after ${money(data.today.tax)} tax`),
      stat("Today's expenses", money(data.today.expenses || 0), `net ${money(data.today.net || 0)}`, (data.today.expenses || 0) > 0 ? 'warn' : ''),
      stat('Stock value', money(data.stock_value || 0), 'at cost price'),
      stat('Needs restocking', String(data.low_stock_count || 0), 'at or below minimum', data.low_stock_count ? 'danger' : '')
    );
  } else {
    stats.append(stat('Held sales', String(data.held_orders || 0), 'waiting to be finished'));
  }

  wrap.appendChild(stats);

  const grid = el('div.grid', { style: { gridTemplateColumns: isManager() ? '2fr 1fr' : '1fr' } });

  // recent sales
  const recentCard = el('div.card',
    el('div.card-head', el('h3', 'Recent sales')),
    el('div.card-body.tight',
      data.recent_sales.length
        ? el('div.table-wrap', el('table.data',
            el('thead', el('tr',
              el('th', 'Invoice'), el('th', 'Customer'), el('th', 'Served by'),
              el('th', 'Payment'), el('th.num', 'Total'), el('th', 'When')
            )),
            el('tbody', data.recent_sales.map((s) => el('tr',
              el('td', el('code', s.invoice_no)),
              el('td', s.customer_name || el('span.muted', 'Walk-in')),
              el('td', s.user_name || '—'),
              el('td', el('span.badge-pill', s.payment_method)),
              el('td.num', money(s.total)),
              el('td.muted', dateTime(s.created_at))
            )))
          ))
        : el('div.empty', el('div.icon', '🧾'), el('p', 'No sales yet today'), el('small', 'Sales you ring up will appear here.'))
    )
  );
  grid.appendChild(recentCard);

  // hourly chart for managers
  if (isManager() && data.hourly?.length) {
    const peak = Math.max(...data.hourly.map((h) => h.total), 1);
    const chart = el('div.bar-chart', data.hourly.map((h) => {
      const pct = Math.round((h.total / peak) * 100);
      return el('div.bar', { style: { height: `${Math.max(pct, 2)}%` }, title: `${h.hour}:00 - ${money(h.total)}` });
    }));
    grid.appendChild(el('div.card',
      el('div.card-head', el('h3', 'Sales by hour')),
      el('div.card-body', chart,
        el('div', { style: { display: 'flex', justifyContent: 'space-between', color: 'var(--text-3)', fontSize: '11px', marginTop: '6px' } },
          el('span', `${data.hourly[0].hour}:00`), el('span', `${data.hourly[data.hourly.length - 1].hour}:00`)))
    ));
  } else if (!isManager()) {
    grid.appendChild(el('div.card',
      el('div.card-head', el('h3', 'Shift summary')),
      el('div.card-body',
        el('p', { style: { margin: 0, color: 'var(--text-2)', lineHeight: '1.7' } },
          'You are signed in as ', el('b', state.user.username), '. Use ',
          el('b', 'New Sale'), ' to open the till.'),
        el('p', { style: { margin: '12px 0 0', color: 'var(--text-3)', fontSize: '12.5px' } },
          'Reports, stock and expenses are handled by a manager.')
      )
    ));
  }

  wrap.appendChild(grid);
  return wrap;
}