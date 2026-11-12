import { api, statementUrl } from '../api.js';
import {
  $, h, frag, statCard, hbar, monthChart, table, inr, inrShort, fdate,
  toast, emptyState, progress, pctPill, firstOfMonth, lastOfMonth,
} from '../ui.js';
import { navigate } from '../app.js';

export function dashboardView({ actions }) {
  const wrap = h('div');
  const range = { from: firstOfMonth(-2), to: lastOfMonth() };

  actions.append(
    h('button', { class: 'btn', onclick: () => navigate('scan'), text: '📷 Scan & Pay' }),
    h('button', { class: 'btn', onclick: () => openQuickAdd(), text: '＋ Add expense' }),
    h('a', { class: 'btn btn-primary', href: statementUrl(range), target: '_blank', rel: 'noopener', text: '🧾 Statement' }),
  );

  wrap.append(
    h('div', { class: 'grid g-4', id: 'kpis' }, ...Array.from({ length: 4 }, () => h('div', { class: 'card' }, h('div', { class: 'skeleton', style: 'width:60%' }), h('div', { class: 'skeleton', style: 'height:26px;margin-top:10px' })))),
    h('div', { class: 'grid g-2', style: 'margin-top:14px' },
      h('div', { class: 'card', id: 'trend-card' }, h('div', { class: 'card-title', text: 'Cash flow' }), h('div', { class: 'card-sub', text: 'Spend vs income, last 6 months' }), h('div', { class: 'skeleton', style: 'height:130px' })),
      h('div', { class: 'card', id: 'cat-card' }, h('div', { class: 'card-title', text: 'Top categories' }), h('div', { class: 'card-sub', text: 'Where the money went' }), h('div', { class: 'skeleton', style: 'height:130px' })),
    ),
    h('div', { class: 'grid g-2', style: 'margin-top:14px' },
      h('div', { class: 'card', id: 'insights-card' }, h('div', { class: 'card-title', text: 'Insights' }), h('div', { class: 'card-sub', text: 'Automatically detected patterns' }), h('div', { class: 'skeleton', style: 'height:90px' })),
      h('div', { class: 'card', id: 'budget-card' }, h('div', { class: 'card-title', text: 'Budget health' }), h('div', { class: 'card-sub', text: 'This month vs your budgets' }), h('div', { class: 'skeleton', style: 'height:90px' })),
    ),
    h('div', { class: 'card', id: 'recent-card', style: 'margin-top:14px' }, h('div', { class: 'card-title', text: 'Recent transactions' }), h('div', { class: 'card-sub', text: 'Latest activity' }), h('div', { class: 'skeleton', style: 'height:120px' })),
    h('div', { id: 'groups-teaser' }),
  );

  (async () => {
    const [s, recent, groups] = await Promise.all([api.summary(), api.expenses({ limit: 8 }), api.groups()]);
    const t = s.totals;
    const monthFc = s.forecast;

    $('#kpis', wrap).replaceChildren(
      statCard({
        label: 'Spent this month', value: inr(t.thisMonth), grad: true,
        sub: t.momChange === null ? 'No prior month data' : `${t.momChange >= 0 ? '▲' : '▼'} ${Math.abs(t.momChange)}% vs last month`,
        spark: '💸',
      }),
      statCard({
        label: 'Projected month-end', value: monthFc ? inr(monthFc.projected) : '—',
        sub: monthFc ? `${monthFc.remainingDays} days left · ${inrShort(monthFc.projected - monthFc.spent)} to go` : 'Not enough data',
        spark: '🔮',
      }),
      statCard({ label: 'Net cash flow (3 mo)', value: inr(t.net), sub: `${inr(t.income)} in · ${inr(t.spend)} out`, spark: t.net >= 0 ? '📈' : '📉' }),
      statCard({ label: 'Avg ticket', value: inr(t.avgTicket), sub: `${t.count} transactions tracked`, spark: '🧮' }),
    );

    $('#trend-card', wrap).replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {}, h('div', { class: 'card-title', text: 'Cash flow' }), h('div', { class: 'card-sub', text: 'Spend vs income, last 6 months' })),
        h('button', { class: 'btn btn-sm', text: 'Analytics →', onclick: () => navigate('analytics') }),
      ),
      s.byMonth.length ? monthChart(s.byMonth.slice(-6)) : emptyState('📈', 'No history yet'),
    );

    $('#cat-card', wrap).replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-title', text: 'Top categories' }), h('div', { class: 'card-sub', text: 'Where the money went' }))),
      s.byCategory.length ? hbar(s.byCategory.slice(0, 6), { labelKey: 'name' }) : emptyState('🛒', 'No spending recorded'),
    );

    $('#insights-card', wrap).replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {}, h('div', { class: 'card-title', text: 'Insights' }), h('div', { class: 'card-sub', text: 'Automatically detected patterns' })),
        s.anomalies.length ? h('span', { class: 'pill amber', text: `${s.anomalies.length} unusual` }) : null,
      ),
      s.insights.length
        ? frag(s.insights.slice(0, 4).map((i) => h('div', { class: `insight ${i.type}` }, h('div', { class: 'ib' }), h('div', {}, h('div', { class: 'it', text: i.title }), i.body ? h('div', { class: 'ib2', text: i.body }) : null))))
        : emptyState('🔍', 'Add more transactions', 'Insights appear once there is history to analyse'),
    );

    const over = s.budgets.filter((b) => b.pct >= 85);
    $('#budget-card', wrap).replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {}, h('div', { class: 'card-title', text: 'Budget health' }), h('div', { class: 'card-sub', text: 'This month vs your budgets' })),
        h('button', { class: 'btn btn-sm', text: 'Edit', onclick: () => navigate('settings') }),
      ),
      s.budgets.length
        ? frag(s.budgets.slice(0, 5).map((b) => h('div', { style: 'margin-bottom:11px' },
            h('div', { class: 'row-tight', style: 'justify-content:space-between;margin-bottom:4px' },
              h('span', { style: 'font-weight:600;font-size:12px' }, `${b.icon} ${b.category}`),
              h('span', { class: 'row-tight' }, h('span', { class: 'tiny muted', text: `${inrShort(b.spent)} / ${inrShort(b.amount)}` }), pctPill(b.pct)),
            ),
            progress(b.pct, b.color),
          )))
        : emptyState('🎯', 'No budgets set', 'Set budgets in Settings to track this'),
      over.length ? h('div', { class: 'tiny muted', style: 'margin-top:6px', text: `${over.length} budget(s) at or over 85%` }) : null,
    );

    $('#recent-card', wrap).replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {}, h('div', { class: 'card-title', text: 'Recent transactions' }), h('div', { class: 'card-sub', text: 'Latest activity' })),
        h('button', { class: 'btn btn-sm', text: 'View all →', onclick: () => navigate('expenses') }),
      ),
      table(
        ['Date', 'Merchant', 'Category', 'Method', 'Amount'],
        recent.rows.map((r) => h('tr', {},
          h('td', { class: 'muted tiny', text: fdate(r.occurred_at) }),
          h('td', {}, h('div', { style: 'font-weight:600', text: r.merchant }), r.vpa ? h('div', { class: 'tiny muted mono', text: r.vpa }) : null),
          h('td', {}, h('span', { class: 'cat-chip' }, r.category_icon || '', r.category || '—')),
          h('td', {}, h('span', { class: 'pill grey', text: (r.method || 'manual').toUpperCase() })),
          h('td', { class: `num ${r.direction === 'debit' ? 'debit' : 'credit'}`, text: `${r.direction === 'debit' ? '−' : '+'}${inr(r.amount)}` }),
        )),
        { aligns: [null, null, null, null, 'right'], empty: 'No transactions yet' },
      ),
    );

    if (groups.length) {
      $('#groups-teaser', wrap).replaceChildren(h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-head' },
          h('div', {}, h('div', { class: 'card-title', text: 'Your groups' }), h('div', { class: 'card-sub', text: 'Shared spending' })),
          h('button', { class: 'btn btn-sm', text: 'Manage →', onclick: () => navigate('groups') }),
        ),
        h('div', { class: 'grid g-3' }, groups.slice(0, 3).map((g) => h('div', { class: 'card grp-card', style: 'box-shadow:none', onclick: () => navigate('groups', { open: g.id }) },
          h('div', { class: 'row-tight', style: 'justify-content:space-between' },
            h('span', { class: 'grp-emoji', text: g.emoji }),
            h('span', { class: 'pill grey', text: `${g.member_count} members` }),
          ),
          h('div', { style: 'font-weight:650;margin-top:6px', text: g.name }),
          h('div', { class: 'tiny muted', text: `Total ${inr(g.total_spend, { paise: false })}` }),
        ))),
      ));
    }
  })().catch((e) => toast(e.message, 'err'));

  return wrap;
}

async function openQuickAdd() {
  const { openExpenseForm } = await import('./expenses.js');
  openExpenseForm(null, () => navigate('expenses'));
}
