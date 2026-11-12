import { api, statementUrl } from '../api.js';
import { h, frag, toast, field, firstOfMonth, lastOfMonth, statCard, inr, emptyState, table, fdate } from '../ui.js';
import { app } from '../app.js';

const SECTIONS = [
  ['categories', 'Category breakdown', 'Bar chart of every category'],
  ['trend', 'Month-on-month trend', 'Spend vs income bars'],
  ['insights', 'Insights', 'Auto-generated observations'],
  ['anomalies', 'Unusual transactions', 'Statistical outliers'],
  ['budgets', 'Budgets vs actual', 'This month against your budgets'],
  ['merchants', 'Top payees', 'Ranked with UPI handles'],
  ['occasions', 'Occasion planning', 'Budget vs spend per occasion'],
  ['transactions', 'Full ledger', 'Every transaction, newest first'],
];

export function statementView({ actions }) {
  const wrap = h('div');

  const preset = h('select', {}, ...[
    ['this-month', 'This month', firstOfMonth(0), lastOfMonth(0)],
    ['last-month', 'Last month', firstOfMonth(-1), lastOfMonth(-1)],
    ['3m', 'Last 3 months', firstOfMonth(-2), lastOfMonth(0)],
    ['6m', 'Last 6 months', firstOfMonth(-5), lastOfMonth(0)],
    ['fy', 'This year', `${new Date().getFullYear()}-01-01`, lastOfMonth(0)],
    ['all', 'All time', '', ''],
  ].map(([v, l]) => h('option', { value: v, text: l, selected: v === '3m' })));

  const from = h('input', { type: 'date', value: firstOfMonth(-2) });
  const to = h('input', { type: 'date', value: lastOfMonth(0) });
  const group = h('select', {}, h('option', { value: '', text: 'All my expenses' }), ...(app.data.groups || []).map((g) => h('option', { value: g.id, text: `${g.emoji} ${g.name} only` })));

  preset.addEventListener('change', () => {
    const p = { 'this-month': [firstOfMonth(0), lastOfMonth(0)], 'last-month': [firstOfMonth(-1), lastOfMonth(-1)], '3m': [firstOfMonth(-2), lastOfMonth(0)], '6m': [firstOfMonth(-5), lastOfMonth(0)], fy: [`${new Date().getFullYear()}-01-01`, lastOfMonth(0)], all: ['', ''] }[preset.value];
    from.value = p[0]; to.value = p[1];
    updatePreview();
  });

  const checks = new Map(SECTIONS.map(([key, label, desc]) => {
    const input = h('input', { type: 'checkbox', checked: true, style: 'width:auto' });
    input.addEventListener('change', updatePreview);
    return [key, { input, label, desc }];
  }));

  const preview = h('div', { id: 'stmt-preview' });

  const url = () => statementUrl({
    from: from.value || undefined,
    to: to.value || undefined,
    group_id: group.value || undefined,
    ...Object.fromEntries([...checks].map(([k, v]) => [k, v.input.checked ? undefined : '0'])),
  });

  actions.append(
    h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(location.origin + url()).then(() => toast('Link copied', 'ok'), () => toast('Copy failed', 'err')); }, text: '🔗 Copy link' }),
    h('a', { class: 'btn btn-primary', href: url(), target: '_blank', rel: 'noopener', text: '📄 Open PDF' }),
    h('a', { class: 'btn', href: url(), download: 'whyso-statement.pdf', text: '⬇ Download' }),
  );

  [from, to, group].forEach((el) => el.addEventListener('change', updatePreview));

  wrap.append(h('div', { class: 'grid g-2', style: 'align-items:start' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-title', text: 'Statement builder' }), h('div', { class: 'card-sub', text: 'Choose a period and the sections to include' }))),
      h('div', { class: 'grid g-2' }, field('Period', preset), field('Group', group)),
      h('div', { class: 'grid g-2', style: 'margin-top:12px' }, field('From', from), field('To', to)),
      h('div', { style: 'margin-top:16px' },
        h('div', { class: 'tiny muted', style: 'font-weight:650;margin-bottom:8px' }, 'SECTIONS'),
        frag([...checks.values()].map(({ input, label, desc }) => h('label', { class: 'row-tight', style: 'padding:7px 0;border-bottom:1px solid #f1f4f9;cursor:pointer' },
          input,
          h('div', {}, h('div', { style: 'font-weight:600;font-size:12.5px', text: label }), h('div', { class: 'tiny muted', text: desc })),
        ))),
      ),
    ),
    h('div', {},
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-title', text: 'What you get' }), h('div', { class: 'card-sub', text: 'A branded multi-page PDF' }))),
        h('ul', { style: 'margin:0;padding-left:18px;font-size:12.5px;color:#334155;line-height:1.9' },
          h('li', { text: 'Header with your name, UPI ID and the date range' }),
          h('li', { text: 'Summary cards: spend, income, net, monthly average, average ticket' }),
          h('li', { text: 'Charts drawn directly in the PDF (no images needed)' }),
          h('li', { text: 'Forecast, insights and anomaly callouts' }),
          h('li', { text: 'Group settlement maths when a group is selected' }),
          h('li', { text: 'A complete transaction ledger with debit/credit colouring' }),
        ),
      ),
      preview,
    ),
  ));

  async function updatePreview() {
    const a = $('a[download]', actions);
    if (a) a.href = url();
    const openLink = actions.querySelector('a[target="_blank"]');
    if (openLink) openLink.href = url();
    try {
      const s = await api.summary({ from: from.value || undefined, to: to.value || undefined, group_id: group.value || undefined });
      preview.replaceChildren(h('div', { class: 'grid g-2', style: 'margin-top:14px' },
        statCard({ label: 'Rows in ledger', value: String(s.totals.count), sub: 'Transactions in this range' }),
        statCard({ label: 'Spend', value: inr(s.totals.spend, { paise: false }), sub: `Income ${inr(s.totals.income, { paise: false })}` }),
        statCard({ label: 'Categories', value: String(s.byCategory.length), sub: s.byCategory[0] ? `Top: ${s.byCategory[0].name}` : '—' }),
        statCard({ label: 'Months covered', value: String(s.byMonth.length), sub: s.byMonth.length ? `${s.byMonth[0].month} → ${s.byMonth[s.byMonth.length - 1].month}` : '—' }),
      ));
    } catch (e) { toast(e.message, 'err'); }
  }

  updatePreview();
  return wrap;
}
