import { api, statementUrl } from '../api.js';
import {
  $, h, frag, table, inr, inrShort, pct, fdate, toast, emptyState,
  statCard, hbar, monthChart, donut, progress, pctPill, firstOfMonth, lastOfMonth, downloadText, csvEscape,
} from '../ui.js';
import { app, navigate } from '../app.js';

const PRESETS = [
  { id: 'this-month', label: 'This month', from: firstOfMonth(0), to: lastOfMonth(0) },
  { id: 'last-month', label: 'Last month', from: firstOfMonth(-1), to: lastOfMonth(-1) },
  { id: '3m', label: 'Last 3 months', from: firstOfMonth(-2), to: lastOfMonth(0) },
  { id: '6m', label: 'Last 6 months', from: firstOfMonth(-5), to: lastOfMonth(0) },
  { id: 'fy', label: 'This year', from: `${new Date().getFullYear()}-01-01`, to: lastOfMonth(0) },
  { id: 'all', label: 'All time', from: '', to: '' },
];

let activePreset = '3m';
let groupFilter = '';

export function analyticsView({ actions }) {
  const wrap = h('div');
  const body = h('div', { id: 'analytics-body' });

  const presetSel = h('select', {}, ...PRESETS.map((p) => h('option', { value: p.id, text: p.label, selected: p.id === activePreset })));
  const groupSel = h('select', {}, h('option', { value: '', text: 'All expenses' }), ...(app.data.groups || []).map((g) => h('option', { value: g.id, text: `${g.emoji} ${g.name} only` })));
  presetSel.addEventListener('change', () => { activePreset = presetSel.value; load(); });
  groupSel.addEventListener('change', () => { groupFilter = groupSel.value; load(); });

  actions.append(
    h('div', { class: 'row-tight' }, presetSel, groupSel),
    h('button', { class: 'btn', onclick: () => exportAnalyticsCsv(), text: '⬇ CSV' }),
    h('a', { class: 'btn btn-primary', href: '#', onclick: (e) => { e.preventDefault(); const p = PRESETS.find((x) => x.id === activePreset); window.open(statementUrl({ from: p.from, to: p.to, group_id: groupFilter || undefined }), '_blank'); }, text: '🧾 PDF' }),
  );

  wrap.append(body);

  async function load() {
    const p = PRESETS.find((x) => x.id === activePreset);
    body.replaceChildren(h('div', { class: 'grid g-4' }, ...Array.from({ length: 4 }, () => h('div', { class: 'card' }, h('div', { class: 'skeleton', style: 'height:50px' })))));
    try {
      const s = await api.summary({ from: p.from, to: p.to, group_id: groupFilter || undefined });
      render(s, p);
    } catch (e) { toast(e.message, 'err'); }
  }

  function render(s, preset) {
    const t = s.totals;
    const spend = t.spend || 1;

    body.replaceChildren(
      h('div', { class: 'grid g-4' },
        statCard({ label: 'Total spend', value: inr(t.spend, { paise: false }), sub: `${t.count} transactions`, spark: '💸' }),
        statCard({ label: 'Total income', value: inr(t.income, { paise: false }), sub: 'Credits in period', spark: '💰' }),
        statCard({ label: 'Net', value: inr(t.net, { paise: false }), sub: t.net >= 0 ? 'You saved money' : 'You spent more than you earned', spark: t.net >= 0 ? '📈' : '📉', grad: t.net < 0 }),
        statCard({ label: 'Avg ticket', value: inr(t.avgTicket), sub: `${preset.label} · ${s.byMonth.length} month(s)`, spark: '🧮' }),
      ),

      s.forecast ? h('div', { class: 'card', style: 'margin-top:14px;background:linear-gradient(135deg,#eef2ff,#f5f3ff);border-color:#c7d2fe' },
        h('div', { class: 'row-tight', style: 'justify-content:space-between' },
          h('div', {},
            h('div', { style: 'font-weight:700', text: `Projected ${s.forecast.month} spend: ${inr(s.forecast.projected)}` }),
            h('div', { class: 'tiny muted', text: `Spent ${inr(s.forecast.spent)} in ${s.forecast.day} of ${s.forecast.daysInMonth} days — pace suggests ${inr(s.forecast.projected)} by month end.` }),
          ),
          h('span', { class: 'pill', text: `🔮 ${s.forecast.remainingDays} days left` }),
        ),
      ) : null,

      h('div', { class: 'grid g-2', style: 'margin-top:14px' },
        h('div', { class: 'card' }, h('div', { class: 'card-title', text: 'Spend vs income' }), h('div', { class: 'card-sub', text: 'Month by month' }), s.byMonth.length ? monthChart(s.byMonth) : emptyState('📈', 'No data in this range')),
        h('div', { class: 'card' }, h('div', { class: 'card-title', text: 'Category split' }), h('div', { class: 'card-sub', text: 'Share of every rupee spent' }), s.byCategory.length ? donut(s.byCategory) : emptyState('🥧', 'No spending in this range')),
      ),

      h('div', { class: 'grid g-2', style: 'margin-top:14px' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Category breakdown' }), h('div', { class: 'card-sub', text: 'With share of total spend' }),
          s.byCategory.length ? table(['Category', 'Txns', 'Total', 'Share'],
            s.byCategory.map((c) => h('tr', {},
              h('td', {}, h('span', { class: 'cat-chip' }, c.icon, c.name)),
              h('td', { class: 'num tiny', text: String(c.count) }),
              h('td', { class: 'num', text: inr(c.total) }),
              h('td', { class: 'num' }, h('span', { class: 'pill grey', text: pct(c.pct) })),
            )), { aligns: [null, 'right', 'right', 'right'] }) : emptyState('🗂️', 'Nothing to break down'),
        ),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Top payees' }), h('div', { class: 'card-sub', text: 'Where the money keeps going' }),
          s.byMerchant.length ? table(['Payee', 'UPI handle', 'Txns', 'Total'],
            s.byMerchant.slice(0, 12).map((m) => h('tr', {},
              h('td', { style: 'font-weight:600', text: m.merchant }),
              h('td', { class: 'tiny mono muted', text: m.vpa || '—' }),
              h('td', { class: 'num tiny', text: String(m.count) }),
              h('td', { class: 'num', text: inr(m.total) }),
            )), { aligns: [null, null, 'right', 'right'] }) : emptyState('🏪', 'No payees yet'),
        ),
      ),

      h('div', { class: 'grid g-2', style: 'margin-top:14px' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Payment methods' }), h('div', { class: 'card-sub', text: 'UPI vs card vs cash' }),
          s.byMethod.length ? hbar(s.byMethod.map((m) => ({ name: m.method.toUpperCase(), total: m.total })), { valueFmt: inr }) : emptyState('💳', 'No methods recorded'),
        ),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'UPI app (PSP) split' }), h('div', { class: 'card-sub', text: 'Which UPI handles you pay most' }),
          s.byPsp.length ? hbar(s.byPsp.map((p) => ({ name: '@' + p.psp, total: p.total })), { valueFmt: inr }) : emptyState('📱', 'No UPI transactions'),
        ),
      ),

      h('div', { class: 'grid g-2', style: 'margin-top:14px' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Spending by weekday' }), h('div', { class: 'card-sub', text: 'Are weekends pricier?' }),
          hbar(s.byDayOfWeek.map((d) => ({ name: d.day, total: d.total })), { valueFmt: inr }),
        ),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Spending by hour' }), h('div', { class: 'card-sub', text: 'When money leaves your account' }),
          hbar(s.byHour.filter((x) => x.total > 0).map((x) => ({ name: `${String(x.hour).padStart(2, '0')}:00`, total: x.total })), { valueFmt: inrShort }),
        ),
      ),

      s.byOccasion.length ? h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-title', text: 'Occasion spend' }), h('div', { class: 'card-sub', text: 'Money tagged to planned occasions' }),
        table(['Occasion', 'Txns', 'Total'], s.byOccasion.map((o) => h('tr', {}, h('td', { style: 'font-weight:600', text: o.title }), h('td', { class: 'num tiny', text: String(o.count) }), h('td', { class: 'num', text: inr(o.total) }))), { aligns: [null, 'right', 'right'] }),
      ) : null,

      h('div', { class: 'grid g-2', style: 'margin-top:14px' },
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-title', text: 'Unusual transactions' }), h('div', { class: 'card-sub', text: 'Outliers vs your normal spend per category' }))),
          s.anomalies.length ? frag(s.anomalies.map((a) => h('div', { class: 'insight warn' }, h('div', { class: 'ib' }), h('div', {},
            h('div', { class: 'it', text: `${a.merchant} — ${inr(a.amount)}` }),
            h('div', { class: 'ib2', text: `${a.message} (typical ${a.category} spend is ${inr(a.median)})` }),
          )))) : emptyState('✅', 'Nothing unusual', 'No transactions stand out statistically'),
        ),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-title', text: 'Insights' }), h('div', { class: 'card-sub', text: 'What Whyso noticed' }))),
          s.insights.length ? frag(s.insights.map((i) => h('div', { class: `insight ${i.type}` }, h('div', { class: 'ib' }), h('div', {}, h('div', { class: 'it', text: i.title }), i.body ? h('div', { class: 'ib2', text: i.body }) : null)))) : emptyState('🔍', 'Not enough history yet'),
        ),
      ),

      h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-title', text: 'Largest single expenses' }), h('div', { class: 'card-sub', text: 'The big-ticket items' }),
        s.topExpenses.length ? table(['Date', 'Merchant', 'Category', 'Method', 'Amount'],
          s.topExpenses.map((r) => h('tr', {},
            h('td', { class: 'tiny muted', text: fdate(r.occurred_at) }),
            h('td', { style: 'font-weight:600', text: r.merchant }),
            h('td', {}, h('span', { class: 'cat-chip' }, r.icon || '', r.category || '—')),
            h('td', {}, h('span', { class: 'pill grey', text: (r.method || '').toUpperCase() })),
            h('td', { class: 'num debit', text: inr(r.amount) }),
          )), { aligns: [null, null, null, null, 'right'] }) : emptyState('💥', 'No expenses in range'),
      ),
    );
    void spend;
  }

  async function exportAnalyticsCsv() {
    const p = PRESETS.find((x) => x.id === activePreset);
    try {
      const s = await api.summary({ from: p.from, to: p.to, group_id: groupFilter || undefined });
      const lines = [];
      lines.push(`Whyso analytics,${p.label}`);
      lines.push('');
      lines.push('Totals');
      lines.push(`Spend,${s.totals.spend}`);
      lines.push(`Income,${s.totals.income}`);
      lines.push(`Net,${s.totals.net}`);
      lines.push(`Transactions,${s.totals.count}`);
      lines.push('');
      lines.push('Category,Transactions,Total,Percent');
      for (const c of s.byCategory) lines.push([c.name, c.count, c.total, c.pct].map(csvEscape).join(','));
      lines.push('');
      lines.push('Month,Spend,Income,Net');
      for (const m of s.byMonth) lines.push([m.month, m.total, m.income, m.net].map(csvEscape).join(','));
      lines.push('');
      lines.push('Payee,UPI,Txns,Total');
      for (const m of s.byMerchant) lines.push([m.merchant, m.vpa || '', m.count, m.total].map(csvEscape).join(','));
      downloadText(`whyso-analytics-${activePreset}.csv`, lines.join('\n'));
      toast('Analytics CSV exported', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  load();
  return wrap;
}
