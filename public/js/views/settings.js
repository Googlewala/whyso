import { api } from '../api.js';
import { $, h, frag, table, inr, fdate, toast, modal, field, confirmDialog, emptyState, inrShort, progress, pctPill } from '../ui.js';
import { app, refreshShell, navigate } from '../app.js';

export function settingsView({ actions }) {
  const wrap = h('div');
  const body = h('div', { id: 'settings-body' });

  actions.append(h('button', {
    class: 'btn', text: '↺ Re-seed demo data',
    onclick: async () => {
      if (!(await confirmDialog('Add the demo dataset again? This only inserts if the database is empty.', { okLabel: 'Re-seed' }))) return;
      const r = await api.seed();
      toast(r.seeded ? 'Demo data seeded' : 'Data already present — nothing to do', r.seeded ? 'ok' : '');
      if (r.seeded) { await refreshShell(); load(); }
    },
  }));

  wrap.append(body);

  async function load() {
    const [budgets, rec, cats, s] = await Promise.all([api.budgets(), api.recurring(), api.categories(), api.summary()]);
    const recs = await api.budgetRecommendations();
    const recByCat = new Map(recs.map((r) => [r.category_id, r]));

    body.replaceChildren(
      /* ---------------- budgets ---------------- */
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {}, h('div', { class: 'card-title', text: 'Monthly budgets' }), h('div', { class: 'card-sub', text: 'Suggested values come from your last 3 complete months (+10% headroom)' })),
          h('button', { class: 'btn btn-sm', text: '💾 Save budgets', onclick: () => saveBudgets() }),
        ),
        table(
          ['Category', 'Budget', 'Spent this month', 'Used', 'Suggested'],
          cats.map((c) => {
            const b = budgets.find((x) => x.category_id === c.id);
            const st = s.budgets.find((x) => x.category_id === c.id);
            const inp = h('input', { type: 'number', step: '100', min: '0', value: b?.amount ?? '', 'data-cat': c.id, style: 'max-width:130px' });
            return h('tr', {},
              h('td', {}, h('span', { class: 'cat-chip' }, c.icon, c.name)),
              h('td', {}, inp),
              h('td', { class: 'num', text: st ? inr(st.spent) : inr(0) }),
              h('td', {}, st ? pctPill(st.pct) : h('span', { class: 'muted tiny', text: '—' })),
              h('td', {}, recByCat.has(c.id)
                ? h('button', { class: 'btn btn-sm', text: `use ${inrShort(recByCat.get(c.id).suggested)}`, onclick: () => { inp.value = recByCat.get(c.id).suggested; } })
                : h('span', { class: 'muted tiny', text: 'not enough history' })),
            );
          }),
          { aligns: [null, null, 'right', null, null] },
        ),
      ),

      /* ---------------- recurring ---------------- */
      h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-head' },
          h('div', {}, h('div', { class: 'card-title', text: 'Recurring payments' }), h('div', { class: 'card-sub', text: 'Subscriptions and fixed monthly outflows' })),
          h('button', { class: 'btn btn-sm btn-primary', text: '＋ Add', onclick: () => openRecurringForm(load) }),
        ),
        rec.length ? frag([
          table(
            ['Merchant', 'UPI handle', 'Amount', 'Frequency', 'Next due', ''],
            rec.map((r) => h('tr', {},
              h('td', {}, h('span', { class: 'cat-chip' }, r.icon || '🔁', r.merchant)),
              h('td', { class: 'tiny mono muted', text: r.vpa || '—' }),
              h('td', { class: 'num', text: inr(r.amount) }),
              h('td', {}, h('span', { class: 'pill grey', text: r.frequency })),
              h('td', { class: 'tiny muted', text: r.next_due ? fdate(r.next_due) : '—' }),
              h('td', {}, h('button', { class: 'btn btn-sm btn-danger', text: '🗑', onclick: async () => { if (await confirmDialog(`Remove ${r.merchant}?`, { okLabel: 'Remove', danger: true })) { await api.deleteRecurring(r.id); toast('Removed', 'ok'); load(); } } })),
            )),
            { aligns: [null, null, 'right', null, null, null] },
          ),
          h('div', { class: 'row-tight', style: 'margin-top:10px' },
            h('span', { class: 'pill', text: `${rec.length} active` }),
            h('span', { class: 'pill amber', text: `${inr(rec.filter((r) => r.frequency === 'monthly').reduce((a, b) => a + b.amount, 0))} / month` }),
          ),
        ]) : emptyState('🔁', 'No recurring payments', 'Add subscriptions to see them here'),
      ),

      /* ---------------- categories ---------------- */
      h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-head' },
          h('div', {}, h('div', { class: 'card-title', text: 'Categories' }), h('div', { class: 'card-sub', text: 'Keywords drive automatic categorisation' })),
          h('button', { class: 'btn btn-sm btn-primary', text: '＋ Add category', onclick: () => openCategoryForm(load) }),
        ),
        table(
          ['', 'Category', 'Keywords used for auto-detection'],
          cats.map((c) => h('tr', {},
            h('td', { style: 'font-size:16px', text: c.icon }),
            h('td', { style: 'font-weight:600', text: c.name }),
            h('td', { class: 'tiny muted', text: c.keywords || '—' }),
          )),
        ),
      ),

      /* ---------------- user ---------------- */
      h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-title', text: 'Your profile' }),
        h('div', { class: 'card-sub', text: 'The UPI ID here is used on statements and pay links' }),
        h('div', { class: 'grid g-2' },
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Name' }), h('span', { class: 'v', text: app.data.user.name })),
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'UPI ID' }), h('span', { class: 'v mono', text: app.data.user.vpa || '—' })),
        ),
        h('div', { class: 'tiny muted', style: 'margin-top:10px', text: 'Switch users from the sidebar to view the app as another member.' }),
      ),
    );
  }

  async function saveBudgets() {
    const items = [...body.querySelectorAll('input[data-cat]')]
      .filter((i) => i.value !== '')
      .map((i) => ({ category_id: Number(i.dataset.cat), amount: i.value, period: 'monthly' }));
    try { await api.saveBudgets(items); toast('Budgets saved', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
  }

  load();
  return wrap;
}

function openRecurringForm(onDone) {
  const merchant = h('input', { type: 'text', placeholder: 'e.g. Netflix' });
  const vpa = h('input', { type: 'text', placeholder: 'netflix@axl' });
  const amount = h('input', { type: 'number', step: '0.01', placeholder: '0.00' });
  const freq = h('select', {}, ...['monthly', 'weekly', 'quarterly', 'yearly'].map((f) => h('option', { value: f, text: f })));
  const next = h('input', { type: 'date' });

  const save = h('button', {
    class: 'btn btn-primary', text: 'Add recurring payment',
    onclick: async () => {
      if (!merchant.value.trim() || !amount.value) { toast('Merchant and amount are required', 'err'); return; }
      try {
        await api.createRecurring({ merchant: merchant.value.trim(), vpa: vpa.value.trim() || null, amount: amount.value, frequency: freq.value, next_due: next.value || null });
        toast('Recurring payment added', 'ok'); m.close(); onDone?.();
      } catch (e) { toast(e.message, 'err'); }
    },
  });

  const m = modal({
    title: 'Add recurring payment',
    body: frag(
      h('div', { class: 'grid g-2' }, field('Merchant', merchant), field('UPI handle', vpa)),
      h('div', { class: 'grid g-3', style: 'margin-top:12px' }, field('Amount (₹)', amount), field('Frequency', freq), field('Next due', next)),
    ),
    footer: [h('button', { class: 'btn', text: 'Cancel', onclick: () => m.close() }), save],
  });
}

function openCategoryForm(onDone) {
  const name = h('input', { type: 'text', placeholder: 'e.g. Pets' });
  const icon = h('input', { type: 'text', placeholder: '🐕', value: '🏷️', style: 'max-width:90px' });
  const color = h('input', { type: 'text', placeholder: '#6366f1', value: '#6366f1', style: 'max-width:110px' });
  const keywords = h('input', { type: 'text', placeholder: 'vet, petfood, petco (comma separated)' });

  const save = h('button', {
    class: 'btn btn-primary', text: 'Create category',
    onclick: async () => {
      if (!name.value.trim()) { toast('Name is required', 'err'); return; }
      try {
        await api.createCategory({ name: name.value.trim(), icon: icon.value, color: color.value, keywords: keywords.value });
        toast('Category created', 'ok'); m.close();
        await refreshShell(); onDone?.();
      } catch (e) { toast(e.message, 'err'); }
    },
  });

  const m = modal({
    title: 'New category',
    body: frag(
      h('div', { class: 'grid g-3' }, field('Name', name), field('Icon', icon), field('Colour', color)),
      h('div', { style: 'margin-top:12px' }, field('Keywords for auto-detection', keywords, 'Comma separated. If a merchant name contains one of these, this category is chosen.')),
    ),
    footer: [h('button', { class: 'btn', text: 'Cancel', onclick: () => m.close() }), save],
  });
}
