import { api } from '../api.js';
import {
  $, h, frag, table, inr, fdate, fdatetime, toast, modal, field, confirmDialog,
  emptyState, debounce, todayISO, downloadText, csvEscape,
} from '../ui.js';
import { app } from '../app.js';

let filters = { q: '', category_id: '', group_id: '', occasion_id: '', method: '', from: '', to: '', direction: '' };

export function expensesView({ actions }) {
  const wrap = h('div');
  const results = h('div', { id: 'exp-results' });

  actions.append(
    h('button', { class: 'btn', onclick: () => exportCsv(), text: '⬇ CSV' }),
    h('button', { class: 'btn btn-primary', onclick: () => openExpenseForm(null, () => load()), text: '＋ Add expense' }),
  );

  const search = h('input', { type: 'search', placeholder: 'Search merchant, note or UPI ID…', value: filters.q });
  search.addEventListener('input', debounce(() => { filters.q = search.value; load(); }, 320));

  const catSel = h('select', {}, h('option', { value: '', text: 'All categories' }),
    ...(app.data.categories || []).map((c) => h('option', { value: c.id, text: `${c.icon} ${c.name}`, selected: String(filters.category_id) === String(c.id) })));
  catSel.addEventListener('change', () => { filters.category_id = catSel.value; load(); });

  const grpSel = h('select', {}, h('option', { value: '', text: 'All groups' }),
    ...(app.data.groups || []).map((g) => h('option', { value: g.id, text: `${g.emoji} ${g.name}`, selected: String(filters.group_id) === String(g.id) })));
  grpSel.addEventListener('change', () => { filters.group_id = grpSel.value; load(); });

  const occSel = h('select', {}, h('option', { value: '', text: 'All occasions' }),
    ...(app.data.occasions || []).map((o) => h('option', { value: o.id, text: o.title, selected: String(filters.occasion_id) === String(o.id) })));
  occSel.addEventListener('change', () => { filters.occasion_id = occSel.value; load(); });

  const methodSel = h('select', {}, ...['', 'upi', 'card', 'bank', 'imps', 'neft', 'cash', 'manual']
    .map((m) => h('option', { value: m, text: m ? m.toUpperCase() : 'All methods', selected: filters.method === m })));
  methodSel.addEventListener('change', () => { filters.method = methodSel.value; load(); });

  const dirSel = h('select', {}, ...['', 'debit', 'credit'].map((d) => h('option', { value: d, text: d ? (d === 'debit' ? 'Debits only' : 'Credits only') : 'Debit + credit', selected: filters.direction === d })));
  dirSel.addEventListener('change', () => { filters.direction = dirSel.value; load(); });

  const fromI = h('input', { type: 'date', value: filters.from, onchange: (e) => { filters.from = e.target.value; load(); } });
  const toI = h('input', { type: 'date', value: filters.to, onchange: (e) => { filters.to = e.target.value; load(); } });

  wrap.append(
    h('div', { class: 'card', style: 'margin-bottom:14px' },
      h('div', { class: 'row' },
        h('div', { class: 'field', style: 'flex:2 1 240px' }, h('label', { text: 'Search' }), search),
        h('div', { class: 'field' }, h('label', { text: 'Category' }), catSel),
        h('div', { class: 'field' }, h('label', { text: 'Group' }), grpSel),
        h('div', { class: 'field' }, h('label', { text: 'Occasion' }), occSel),
        h('div', { class: 'field' }, h('label', { text: 'Method' }), methodSel),
        h('div', { class: 'field' }, h('label', { text: 'Type' }), dirSel),
        h('div', { class: 'field' }, h('label', { text: 'From' }), fromI),
        h('div', { class: 'field' }, h('label', { text: 'To' }), toI),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'btn btn-sm', text: '↺ Reset', onclick: () => {
            filters = { q: '', category_id: '', group_id: '', occasion_id: '', method: '', from: '', to: '', direction: '' };
            search.value = ''; catSel.value = ''; grpSel.value = ''; occSel.value = ''; methodSel.value = ''; dirSel.value = ''; fromI.value = ''; toI.value = '';
            load();
          },
        }),
      ),
      h('div', { class: 'row-tight', id: 'exp-summary', style: 'margin-top:10px' }),
    ),
    h('div', { class: 'card pad-0' }, results),
  );

  async function load() {
    results.replaceChildren(h('div', { style: 'padding:16px' }, h('div', { class: 'skeleton', style: 'height:60px' })));
    try {
      const d = await api.expenses({ ...filters, limit: 400 });
      $('#exp-summary', wrap).replaceChildren(
        h('span', { class: 'pill grey', text: `${d.total} transactions` }),
        h('span', { class: 'pill red', text: `Spend ${inr(d.spend)}` }),
        h('span', { class: 'pill green', text: `Income ${inr(d.income)}` }),
        h('span', { class: 'pill', text: `Net ${inr(d.income - d.spend)}` }),
      );
      results.replaceChildren(table(
        ['Date', 'Merchant', 'Category', 'Group / Occasion', 'Method', 'Amount', ''],
        d.rows.map(rowEl),
        { aligns: [null, null, null, null, null, 'right', null], empty: 'No transactions match these filters' },
      ));
    } catch (e) { toast(e.message, 'err'); }
  }

  function rowEl(r) {
    return h('tr', {},
      h('td', {}, h('div', { class: 'tiny', text: fdate(r.occurred_at) }), h('div', { class: 'tiny muted', text: String(r.occurred_at).slice(11, 16) })),
      h('td', {}, h('div', { style: 'font-weight:600', text: r.merchant }), r.vpa ? h('div', { class: 'tiny muted mono', text: r.vpa }) : (r.note ? h('div', { class: 'tiny muted', text: r.note }) : null)),
      h('td', {}, h('span', { class: 'cat-chip' }, r.category_icon || '💸', r.category || '—')),
      h('td', {}, r.group_name ? h('span', { class: 'pill', text: `${r.group_emoji} ${r.group_name}` }) : (r.occasion_title ? h('span', { class: 'pill amber', text: `🎉 ${r.occasion_title}` }) : h('span', { class: 'muted tiny', text: '—' }))),
      h('td', {}, h('span', { class: 'pill grey', text: (r.method || 'manual').toUpperCase() })),
      h('td', { class: `num ${r.direction === 'debit' ? 'debit' : 'credit'}`, text: `${r.direction === 'debit' ? '−' : '+'}${inr(r.amount)}` }),
      h('td', {}, h('div', { class: 'row-tight' },
        h('button', { class: 'btn btn-sm', text: '✏️', title: 'Edit', onclick: () => openExpenseForm(r.id, () => load()) }),
        h('button', {
          class: 'btn btn-sm btn-danger', text: '🗑', title: 'Delete',
          onclick: async () => {
            if (!(await confirmDialog(`Delete "${r.merchant}" — ${inr(r.amount)}?`, { okLabel: 'Delete', danger: true }))) return;
            try { await api.deleteExpense(r.id); toast('Expense deleted', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          },
        }),
      )),
    );
  }

  async function exportCsv() {
    try {
      const d = await api.expenses({ ...filters, limit: 1000 });
      const head = ['Date', 'Merchant', 'VPA', 'Category', 'Group', 'Occasion', 'Method', 'Direction', 'Amount', 'Note', 'Ref'];
      const lines = [head.join(',')];
      for (const r of d.rows) {
        lines.push([r.occurred_at, r.merchant, r.vpa || '', r.category || '', r.group_name || '', r.occasion_title || '', r.method, r.direction, r.amount, r.note || '', r.txn_ref || ''].map(csvEscape).join(','));
      }
      downloadText(`whyso-expenses-${todayISO()}.csv`, lines.join('\n'));
      toast('CSV exported', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  }

  load();
  return wrap;
}

/* ------------------------------------------------------------------ *
 * Shared expense form (used by Dashboard, Expenses and Scan views)
 * ------------------------------------------------------------------ */

export async function openExpenseForm(id, onSaved, preset = {}) {
  const isEdit = id != null;
  const existing = isEdit ? await api.expense(id) : null;
  const base = existing || preset;
  const groups = app.data.groups || [];
  const occasions = app.data.occasions || [];
  const categories = app.data.categories || [];
  const users = app.data.users || [];

  const splitState = {
    group_id: base.group_id ? String(base.group_id) : '',
    mode: base.split_mode || 'equal',
    participants: new Map(),
  };
  if (existing?.shares?.length) {
    for (const s of existing.shares) splitState.participants.set(s.user_id, { user_id: s.user_id, name: s.name, value: s.share, include: true });
  }

  const amount = h('input', { type: 'number', step: '0.01', min: '0', placeholder: '0.00', value: base.amount ?? '' });
  const merchant = h('input', { type: 'text', placeholder: 'e.g. Swiggy, Blinkit, Landlord', value: base.merchant ?? '' });
  const vpa = h('input', { type: 'text', placeholder: 'name@bank (optional)', value: base.vpa ?? '' });
  const note = h('input', { type: 'text', placeholder: 'What was this for?', value: base.note ?? '' });
  const when = h('input', { type: 'datetime-local', value: (base.occurred_at ? String(base.occurred_at).replace(' ', 'T').slice(0, 16) : new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)) });
  const direction = h('select', {}, h('option', { value: 'debit', text: 'Debit (money out)', selected: (base.direction || 'debit') === 'debit' }), h('option', { value: 'credit', text: 'Credit (money in)', selected: base.direction === 'credit' }));
  const method = h('select', {}, ...['upi', 'card', 'bank', 'imps', 'neft', 'cash', 'manual'].map((m) => h('option', { value: m, text: m.toUpperCase(), selected: (base.method || 'upi') === m })));
  const catSel = h('select', {}, h('option', { value: '', text: 'Auto-detect from merchant' }), ...categories.map((c) => h('option', { value: c.id, text: `${c.icon} ${c.name}`, selected: String(base.category_id) === String(c.id) })));
  const grpSel = h('select', {}, h('option', { value: '', text: 'Not part of a group' }), ...groups.map((g) => h('option', { value: g.id, text: `${g.emoji} ${g.name}`, selected: String(base.group_id) === String(g.id) })));
  const occSel = h('select', {}, h('option', { value: '', text: 'No occasion' }), ...occasions.map((o) => h('option', { value: o.id, text: o.title, selected: String(base.occasion_id) === String(o.id) })));

  const splitBox = h('div', { id: 'split-box' });
  const errorBox = h('div', { class: 'pill red', style: 'display:none;margin-bottom:10px' });

  async function renderSplit() {
    if (!splitState.group_id) { splitBox.replaceChildren(); return; }
    const gid = Number(splitState.group_id);
    let detail;
    try { detail = await api.group(gid); } catch { splitBox.replaceChildren(); return; }

    // Seed participants from group membership on first render
    if (!splitState.participants.size || ![...splitState.participants.keys()].every((k) => detail.members.some((m) => m.id === k))) {
      splitState.participants = new Map(detail.members.map((m) => [m.id, { user_id: m.id, name: m.name, value: 1, include: true }]));
    }

    const rows = [...splitState.participants.values()].map((p) => {
      const valInput = h('input', { type: 'number', step: '0.01', min: '0', value: p.value, disabled: splitState.mode === 'equal' });
      valInput.addEventListener('input', () => { p.value = Number(valInput.value || 0); updateSplitSummary(); });
      const chk = h('input', { type: 'checkbox', checked: p.include, style: 'width:auto' });
      chk.addEventListener('change', () => { p.include = chk.checked; renderSplit(); });
      return h('div', { class: 'split-row' },
        h('label', { class: 'row-tight', style: 'cursor:pointer' }, chk, h('span', { class: 'avatar-sm', text: p.name.slice(0, 2).toUpperCase() }), h('span', { style: 'font-weight:600;font-size:12.5px', text: p.name })),
        valInput,
      );
    });

    const summary = h('div', { id: 'split-summary', class: 'tiny muted', style: 'margin-top:6px' });
    const modeSel = h('select', {}, ...[
      ['equal', 'Split equally'],
      ['shares', 'By shares (ratio)'],
      ['percent', 'By percentage'],
      ['exact', 'Exact amounts'],
    ].map(([v, l]) => h('option', { value: v, text: l, selected: splitState.mode === v })));
    modeSel.addEventListener('change', () => { splitState.mode = modeSel.value; renderSplit(); });

    splitBox.replaceChildren(
      h('div', { class: 'card', style: 'background:#fafbff;box-shadow:none;margin-top:4px' },
        h('div', { class: 'row-tight', style: 'justify-content:space-between;margin-bottom:8px' },
          h('div', { style: 'font-weight:700;font-size:12.5px' }, `Split across ${detail.members.length} members`),
          modeSel,
        ),
        h('div', { class: 'row-tight', style: 'gap:14px;margin-bottom:8px' },
          h('span', { class: 'tiny muted' }, splitState.mode === 'equal' ? 'Everyone shares the total equally.'
            : splitState.mode === 'shares' ? 'Enter each person’s share weight.'
            : splitState.mode === 'percent' ? 'Enter each person’s percentage.'
            : 'Enter the exact rupee amount each person owes.'),
        ),
        ...rows,
        summary,
      ),
    );
    updateSplitSummary();
  }

  function updateSplitSummary() {
    const el = $('#split-summary', splitBox);
    if (!el) return;
    const amt = Number(amount.value || 0);
    const included = [...splitState.participants.values()].filter((p) => p.include);
    if (!included.length) { el.textContent = 'Select at least one participant.'; return; }
    let txt;
    if (splitState.mode === 'equal') {
      const per = amt / included.length;
      txt = `${included.length} people × ${inr(per)} = ${inr(per * included.length)}`;
    } else if (splitState.mode === 'shares') {
      const total = included.reduce((s, p) => s + Number(p.value || 0), 0) || 1;
      txt = included.map((p) => `${p.name.split(' ')[0]} ${inr((amt * Number(p.value || 0)) / total)}`).join(' · ');
    } else if (splitState.mode === 'percent') {
      const total = included.reduce((s, p) => s + Number(p.value || 0), 0);
      txt = `${included.map((p) => `${p.name.split(' ')[0]} ${p.value || 0}%`).join(' · ')} — total ${total}%${Math.abs(total - 100) > 0.01 ? ' ⚠ must equal 100%' : ''}`;
    } else {
      const total = included.reduce((s, p) => s + Number(p.value || 0), 0);
      txt = `Allocated ${inr(total)} of ${inr(amt)}${Math.abs(total - amt) > 0.01 ? ` ⚠ off by ${inr(Math.abs(total - amt))}` : ' ✓'}`;
    }
    el.textContent = txt;
  }

  amount.addEventListener('input', updateSplitSummary);
  grpSel.addEventListener('change', () => {
    splitState.group_id = grpSel.value;
    splitState.participants = new Map();
    renderSplit();
  });
  if (splitState.group_id) renderSplit();

  const body = frag(
    errorBox,
    h('div', { class: 'grid g-2' },
      field('Amount (₹)', amount),
      field('Date & time', when),
    ),
    h('div', { class: 'grid g-2', style: 'margin-top:12px' },
      field('Merchant / payee', merchant, 'Category is auto-detected from this name'),
      field('UPI ID', vpa, 'Optional — enables a pay link and PSP analytics'),
    ),
    h('div', { class: 'grid g-2', style: 'margin-top:12px' },
      field('Direction', direction),
      field('Payment method', method),
    ),
    h('div', { class: 'grid g-2', style: 'margin-top:12px' },
      field('Category', catSel),
      field('Note', note),
    ),
    h('div', { class: 'grid g-2', style: 'margin-top:12px' },
      field('Group (split this expense)', grpSel),
      field('Occasion', occSel),
    ),
    splitBox,
  );

  const save = h('button', {
    class: 'btn btn-primary', text: isEdit ? 'Save changes' : 'Add expense',
    onclick: async () => {
      errorBox.style.display = 'none';
      const payload = {
        amount: amount.value,
        merchant: merchant.value.trim() || 'Unknown',
        vpa: vpa.value.trim() || null,
        note: note.value.trim() || null,
        occurred_at: when.value ? when.value.replace('T', ' ') : null,
        direction: direction.value,
        method: method.value,
        category_id: catSel.value || undefined,
        group_id: grpSel.value || null,
        occasion_id: occSel.value || null,
      };
      if (grpSel.value) {
        payload.split_mode = splitState.mode;
        payload.participants = [...splitState.participants.values()]
          .filter((p) => p.include)
          .map((p) => ({ user_id: p.user_id, value: Number(p.value) || 0 }));
        if (!payload.participants.length) { errorBox.textContent = 'Pick at least one participant for the split.'; errorBox.style.display = 'inline-flex'; return; }
      }
      save.disabled = true;
      try {
        if (isEdit) await api.updateExpense(id, payload);
        else await api.createExpense(payload);
        toast(isEdit ? 'Expense updated' : 'Expense added', 'ok');
        m.close();
        onSaved?.();
      } catch (e) {
        errorBox.textContent = e.message;
        errorBox.style.display = 'inline-flex';
      } finally { save.disabled = false; }
    },
  });

  const m = modal({
    title: isEdit ? 'Edit expense' : 'Add expense',
    body,
    footer: [h('button', { class: 'btn', text: 'Cancel', onclick: () => m.close() }), save],
    width: '680px',
  });
  setTimeout(() => amount.focus(), 50);
}
