import { api } from '../api.js';
import {
  $, h, frag, table, inr, inrShort, fdate, toast, modal, field, confirmDialog,
  emptyState, progress, pctPill, relDays, todayISO, statCard, hbar,
} from '../ui.js';
import { app, navigate } from '../app.js';
import { openExpenseForm } from './expenses.js';

const TYPES = ['festival', 'trip', 'event', 'goal', 'wedding', 'birthday', 'other'];
const TYPE_ICON = { festival: '🪔', trip: '🏝️', event: '🎊', goal: '🎯', wedding: '💍', birthday: '🎂', other: '📌' };

export function occasionsView({ actions }) {
  const wrap = h('div');

  actions.append(h('button', { class: 'btn btn-primary', onclick: () => openOccasionForm(null, load), text: '＋ Plan an occasion' }));
  wrap.append(h('div', { class: 'grid g-3', id: 'occ-grid' }, ...Array.from({ length: 3 }, () => h('div', { class: 'card' }, h('div', { class: 'skeleton', style: 'height:90px' })))));

  async function load() {
    try {
      const occ = await api.occasions();
      const grid = $('#occ-grid', wrap);
      if (!occ.length) {
        grid.replaceChildren(emptyState('🎉', 'No occasions planned', 'Plan a festival, trip or event and track spend against the budget'));
        return;
      }
      grid.replaceChildren(...occ.map((o) => h('div', { class: 'card occ-card' },
        h('div', { class: 'accent', style: `background:${o.color}` }),
        h('div', { class: 'row-tight', style: 'justify-content:space-between' },
          h('span', { style: 'font-size:22px', text: TYPE_ICON[o.type] || '📌' }),
          h('span', { class: `pill ${o.status === 'done' ? 'green' : o.status === 'active' ? 'amber' : 'grey'}`, text: o.status }),
        ),
        h('div', { style: 'font-weight:700;font-size:14px;margin-top:8px', text: o.title }),
        h('div', { class: 'tiny muted', text: `${fdate(o.date)} · ${relDays(o.days_left)}` }),
        h('div', { style: 'margin-top:12px' },
          h('div', { class: 'row-tight', style: 'justify-content:space-between;margin-bottom:4px' },
            h('span', { class: 'tiny muted', text: `${inrShort(o.spent)} of ${inrShort(o.budget)}` }),
            pctPill(o.pct),
          ),
          progress(o.pct, o.color),
        ),
        h('div', { class: 'row-tight', style: 'justify-content:space-between;margin-top:10px' },
          h('span', { class: 'tiny', style: `color:${o.remaining < 0 ? '#dc2626' : '#16a34a'};font-weight:650`, text: o.remaining < 0 ? `Over by ${inr(-o.remaining)}` : `${inr(o.remaining)} left` }),
          o.days_left > 0 ? h('span', { class: 'tiny muted', text: `${inr(o.per_day_allowance)}/day` }) : null,
        ),
        h('div', { class: 'row-tight', style: 'margin-top:12px' },
          h('button', { class: 'btn btn-sm btn-primary', text: '＋ Spend', onclick: (e) => { e.stopPropagation(); openExpenseForm(null, load, { occasion_id: o.id, merchant: '', note: o.title }); } }),
          h('button', { class: 'btn btn-sm', text: 'Details', onclick: (e) => { e.stopPropagation(); showDetail(o, load); } }),
          h('button', { class: 'btn btn-sm', text: '✏️', onclick: (e) => { e.stopPropagation(); openOccasionForm(o, load); } }),
        ),
      )));

      // Planning summary
      const planned = occ.reduce((s, o) => s + o.budget, 0);
      const spent = occ.reduce((s, o) => s + o.spent, 0);
      const upcoming = occ.filter((o) => o.days_left >= 0);
      wrap.append(h('div', { class: 'grid g-4', style: 'margin-top:14px' },
        statCard({ label: 'Total planned budget', value: inr(planned, { paise: false }), sub: `${occ.length} occasions`, spark: '🎯' }),
        statCard({ label: 'Spent against occasions', value: inr(spent, { paise: false }), sub: `${planned ? Math.round((spent / planned) * 100) : 0}% of plan`, spark: '💸' }),
        statCard({ label: 'Upcoming', value: String(upcoming.length), sub: upcoming[0] ? `Next: ${upcoming.sort((a, b) => a.days_left - b.days_left)[0].title}` : 'Nothing scheduled', spark: '📅' }),
        statCard({ label: 'Remaining to allocate', value: inr(Math.max(0, planned - spent), { paise: false }), sub: 'Across all occasions', spark: '🏦' }),
      ));
    } catch (e) { toast(e.message, 'err'); }
  }

  load();
  return wrap;
}

function showDetail(o, onDone) {
  const body = frag(
    h('div', { class: 'grid g-2' },
      h('div', {}, h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Date' }), h('span', { class: 'v', text: fdate(o.date) })),
        h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Days left' }), h('span', { class: 'v', text: relDays(o.days_left) })),
        h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Budget' }), h('span', { class: 'v', text: inr(o.budget) })),
        h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Spent' }), h('span', { class: 'v', text: inr(o.spent) })),
        h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Remaining' }), h('span', { class: 'v', style: o.remaining < 0 ? 'color:#dc2626' : 'color:#16a34a', text: inr(o.remaining) })),
        h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Daily allowance' }), h('span', { class: 'v', text: o.days_left > 0 ? inr(o.per_day_allowance) : '—' })),
      ),
      o.byCategory.length ? h('div', {}, h('div', { class: 'tiny muted', style: 'font-weight:650;margin-bottom:6px' }, 'SPEND BY CATEGORY'), hbar(o.byCategory)) : h('div', { class: 'tiny muted', text: 'No spend recorded yet.' }),
    ),
    o.notes ? h('div', { class: 'insight info', style: 'margin-top:12px' }, h('div', { class: 'ib' }), h('div', { class: 'ib2', text: o.notes })) : null,
    o.items.length ? h('div', { style: 'margin-top:12px' },
      h('div', { class: 'tiny muted', style: 'font-weight:650;margin-bottom:6px' }, `TRANSACTIONS (${o.items.length})`),
      table(['Date', 'Merchant', 'Category', 'Amount'], o.items.map((i) => h('tr', {},
        h('td', { class: 'tiny muted', text: fdate(i.occurred_at) }),
        h('td', {}, h('div', { style: 'font-weight:600', text: i.merchant }), i.note ? h('div', { class: 'tiny muted', text: i.note }) : null),
        h('td', {}, h('span', { class: 'cat-chip' }, i.icon || '', i.category || '—')),
        h('td', { class: 'num', text: inr(i.amount) }),
      )), { aligns: [null, null, null, 'right'] }),
    ) : null,
  );

  const m = modal({
    title: `${TYPE_ICON[o.type] || '📌'} ${o.title}`,
    body,
    footer: [
      h('button', { class: 'btn btn-danger', text: 'Delete', onclick: async () => { if (await confirmDialog(`Delete "${o.title}"? Expenses stay but lose this tag.`, { okLabel: 'Delete', danger: true })) { await api.deleteOccasion(o.id); toast('Occasion deleted', 'ok'); m.close(); onDone?.(); } } }),
      h('button', { class: 'btn btn-primary', text: '＋ Add spend', onclick: () => { m.close(); openExpenseForm(null, onDone, { occasion_id: o.id, note: o.title }); } }),
    ],
    width: '720px',
  });
}

function openOccasionForm(existing, onDone) {
  const title = h('input', { type: 'text', placeholder: 'e.g. Diwali 2026', value: existing?.title ?? '' });
  const type = h('select', {}, ...TYPES.map((t) => h('option', { value: t, text: `${TYPE_ICON[t]} ${t}`, selected: existing?.type === t })));
  const date = h('input', { type: 'date', value: existing?.date ?? todayISO() });
  const budget = h('input', { type: 'number', step: '100', min: '0', placeholder: '0', value: existing?.budget ?? '' });
  const color = h('input', { type: 'text', value: existing?.color ?? '#f59e0b', style: 'max-width:90px' });
  const status = h('select', {}, ...['planning', 'active', 'done'].map((s) => h('option', { value: s, text: s, selected: (existing?.status || 'planning') === s })));
  const notes = h('textarea', { placeholder: 'What are you planning?', style: 'min-height:64px', text: existing?.notes ?? '' });

  const save = h('button', {
    class: 'btn btn-primary', text: existing ? 'Save changes' : 'Create occasion',
    onclick: async () => {
      if (!title.value.trim()) { toast('Give it a title', 'err'); return; }
      const payload = { title: title.value.trim(), type: type.value, date: date.value, budget: budget.value || 0, color: color.value, notes: notes.value.trim() || null, status: status.value };
      try {
        if (existing) await api.updateOccasion(existing.id, payload);
        else await api.createOccasion(payload);
        toast(existing ? 'Occasion updated' : 'Occasion created', 'ok');
        m.close();
        onDone?.();
      } catch (e) { toast(e.message, 'err'); }
    },
  });

  const m = modal({
    title: existing ? 'Edit occasion' : 'Plan an occasion',
    body: frag(
      h('div', { class: 'grid g-2' }, field('Title', title), field('Type', type)),
      h('div', { class: 'grid g-3', style: 'margin-top:12px' }, field('Date', date), field('Budget (₹)', budget), field('Accent colour', color)),
      h('div', { style: 'margin-top:12px' }, field('Status', status)),
      h('div', { style: 'margin-top:12px' }, field('Notes', notes)),
    ),
    footer: [h('button', { class: 'btn', text: 'Cancel', onclick: () => m.close() }), save],
    width: '640px',
  });
}
