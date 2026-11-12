import { api } from '../api.js';
import {
  $, h, frag, table, inr, fdate, toast, modal, field, confirmDialog,
  emptyState, initials, progress, inrShort,
} from '../ui.js';
import { app, navigate, refreshShell } from '../app.js';
import { openExpenseForm } from './expenses.js';

export function groupsView({ actions, params }) {
  const wrap = h('div');
  const detail = h('div', { id: 'group-detail' });
  const list = h('div', { id: 'group-list' });

  actions.append(
    h('button', { class: 'btn', onclick: () => openCreateGroup(), text: '＋ New group' }),
  );

  wrap.append(h('div', { class: 'grid g-3', id: 'groups-grid' }, ...Array.from({ length: 3 }, () => h('div', { class: 'card' }, h('div', { class: 'skeleton', style: 'height:80px' })))), list, detail);

  async function load() {
    try {
      const groups = await api.groups();
      const grid = $('#groups-grid', wrap);
      if (!groups.length) {
        grid.replaceChildren(emptyState('👥', 'No groups yet', 'Create a group to split bills with friends, flatmates or family'));
        return;
      }
      grid.replaceChildren(...groups.map((g) => h('div', { class: 'card grp-card', onclick: () => openGroup(g.id) },
        h('div', { class: 'row-tight', style: 'justify-content:space-between' },
          h('span', { class: 'grp-emoji', text: g.emoji }),
          h('span', { class: 'pill grey', text: g.kind }),
        ),
        h('div', { style: 'font-weight:700;font-size:14px;margin-top:8px', text: g.name }),
        h('div', { class: 'tiny muted', text: `${g.member_count} members · owned by ${g.owner_name}` }),
        h('div', { class: 'row-tight', style: 'justify-content:space-between;margin-top:10px' },
          h('span', { class: 'tiny muted' }, 'Total spend'),
          h('span', { style: 'font-weight:700', text: inr(g.total_spend, { paise: false }) }),
        ),
      )));
    } catch (e) { toast(e.message, 'err'); }
  }

  async function openGroup(id) {
    try {
      const d = await api.group(id);
      const bal = d.balances;
      const myId = app.data.user.id;
      const me = bal.find((b) => b.user_id === myId);

      const detailBox = $('#group-detail', wrap);
      detailBox.replaceChildren(h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-head' },
          h('div', {},
            h('div', { class: 'card-title', style: 'font-size:16px' }, `${d.group.emoji} ${d.group.name}`),
            h('div', { class: 'card-sub', text: `${d.members.length} members · total spend ${inr(d.total_spend)}` }),
          ),
          h('div', { class: 'row-tight' },
            h('button', { class: 'btn btn-sm btn-primary', text: '＋ Add expense', onclick: () => openExpenseForm(null, () => openGroup(id), { group_id: id, merchant: '' }) }),
            h('button', { class: 'btn btn-sm', text: '＋ Member', onclick: () => openAddMember(id, () => openGroup(id)) }),
            h('button', { class: 'btn btn-sm', text: '✕ Close', onclick: () => { detailBox.replaceChildren(); list.replaceChildren(); } }),
          ),
        ),

        me ? h('div', { class: `insight ${me.net > 0.005 ? 'info' : me.net < -0.005 ? 'danger' : ''}`, style: 'margin-bottom:14px' },
          h('div', { class: 'ib' }),
          h('div', {},
            h('div', { class: 'it', text: me.net > 0.005 ? `You are owed ${inr(me.net)}` : me.net < -0.005 ? `You owe ${inr(-me.net)}` : 'You are settled up' }),
            h('div', { class: 'ib2', text: `You paid ${inr(me.paid)} · your share ${inr(me.owed)}${me.settled ? ` · settled ${inr(me.settled)}` : ''}` }),
          ),
        ) : null,

        h('div', { class: 'grid g-2', style: 'align-items:start' },
          h('div', { class: 'card', style: 'box-shadow:none;background:#fafbff' },
            h('div', { style: 'font-weight:700;font-size:12.5px;margin-bottom:8px' }, 'Balances'),
            frag(bal.map((b) => h('div', { class: 'member-row' },
              h('span', { class: 'avatar-sm', text: initials(b.name) }),
              h('div', { style: 'flex:1;min-width:0' },
                h('div', { style: 'font-weight:600;font-size:12.5px', text: b.name + (b.user_id === myId ? ' (you)' : '') }),
                h('div', { class: 'tiny muted', text: `paid ${inrShort(b.paid)} · share ${inrShort(b.owed)}${b.settled ? ` · settled ${inrShort(b.settled)}` : ''}` }),
              ),
              h('span', { class: `pill ${b.net > 0.005 ? 'green' : b.net < -0.005 ? 'red' : 'grey'}`, text: b.net > 0.005 ? `+${inr(b.net)}` : b.net < -0.005 ? `−${inr(-b.net)}` : 'settled' }),
            ))),
          ),
          h('div', { class: 'card', style: 'box-shadow:none;background:#fafbff' },
            h('div', { class: 'row-tight', style: 'justify-content:space-between;margin-bottom:8px' },
              h('div', { style: 'font-weight:700;font-size:12.5px' }, 'Settle up (fewest transfers)'),
              d.transfers.length ? h('button', { class: 'btn btn-sm', text: '✓ Record', onclick: () => openSettle(id, d, () => openGroup(id)) }) : null,
            ),
            d.transfers.length
              ? frag(d.transfers.map((t) => h('div', { class: 'member-row' },
                  h('span', { class: 'avatar-sm', text: initials(t.from.name) }),
                  h('span', { class: 'tiny', text: '→' }),
                  h('span', { class: 'avatar-sm', text: initials(t.to.name) }),
                  h('div', { style: 'flex:1;min-width:0' },
                    h('div', { style: 'font-size:12.5px', text: `${t.from.name} pays ${t.to.name}` }),
                    t.to.vpa ? h('div', { class: 'tiny muted mono', text: t.to.vpa }) : null,
                  ),
                  h('span', { style: 'font-weight:700;font-size:12.5px', text: inr(t.amount) }),
                )))
              : emptyState('🎉', 'All settled up', 'Nobody owes anybody in this group'),
          ),
        ),

        h('div', { style: 'margin-top:14px' },
          h('div', { style: 'font-weight:700;font-size:13px;margin-bottom:8px' }, 'Shared expenses'),
          table(
            ['Date', 'Paid by', 'Merchant', 'Split', 'Amount', ''],
            d.expenses.map((e) => h('tr', {},
              h('td', { class: 'tiny muted', text: fdate(e.occurred_at) }),
              h('td', {}, h('span', { class: 'row-tight' }, h('span', { class: 'avatar-sm', text: initials(e.paid_by) }), h('span', { class: 'tiny', text: e.paid_by }))),
              h('td', {}, h('div', { style: 'font-weight:600', text: e.merchant }), e.note ? h('div', { class: 'tiny muted', text: e.note }) : null),
              h('td', {}, h('div', { class: 'chip-input' }, e.shares.map((s) => h('span', { class: 'chip', text: `${s.name.split(' ')[0]} ${inrShort(s.share)}` })))),
              h('td', { class: 'num', text: inr(e.amount) }),
              h('td', {}, h('button', { class: 'btn btn-sm', text: '✏️', onclick: () => openExpenseForm(e.id, () => openGroup(id)) })),
            )),
            { aligns: [null, null, null, null, 'right', null], empty: 'No shared expenses yet' },
          ),
        ),

        d.settlements.length ? h('div', { style: 'margin-top:14px' },
          h('div', { style: 'font-weight:700;font-size:13px;margin-bottom:8px' }, 'Settlement history'),
          table(
            ['Date', 'From', 'To', 'Amount', 'Note'],
            d.settlements.map((s) => h('tr', {},
              h('td', { class: 'tiny muted', text: fdate(s.settled_at) }),
              h('td', { class: 'tiny', text: s.from_name }),
              h('td', { class: 'tiny', text: s.to_name }),
              h('td', { class: 'num', text: inr(s.amount) }),
              h('td', { class: 'tiny muted', text: s.note || '—' }),
            )),
            { aligns: [null, null, null, 'right', null] },
          ),
        ) : null,
      ));
      detailBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { toast(e.message, 'err'); }
  }

  load();
  if (params?.open) setTimeout(() => openGroup(Number(params.open)), 250);
  return wrap;
}

function openCreateGroup() {
  const name = h('input', { type: 'text', placeholder: 'e.g. Goa Trip 2026' });
  const emoji = h('input', { type: 'text', placeholder: '🏝️', value: '👥', style: 'max-width:80px' });
  const kind = h('select', {}, ...['trip', 'household', 'occasion', 'team', 'couple', 'other'].map((k) => h('option', { value: k, text: k })));
  const memberBox = h('div', { class: 'chip-input', style: 'margin-top:8px' });
  const nameInput = h('input', { type: 'text', placeholder: 'Name, e.g. Diya Sharma' });
  const vpaInput = h('input', { type: 'text', placeholder: 'diya@ybl (optional)' });
  const pending = [];

  const chips = h('div', { class: 'chip-input', style: 'margin-top:8px' });
  function renderPending() {
    chips.replaceChildren(...pending.map((p, i) => h('button', {
      class: 'chip', type: 'button', style: 'cursor:pointer;background:#fee2e2;color:#b91c1c',
      text: `${p.name} ✕`,
      onclick: () => { pending.splice(i, 1); renderPending(); },
    })));
  }
  renderPending();
  void memberBox;

  const addPerson = h('button', {
    class: 'btn btn-sm', type: 'button', text: '＋ Add person',
    onclick: () => {
      const name = nameInput.value.trim();
      if (!name) { toast('Type a name first', 'err'); return; }
      pending.push({ name, vpa: vpaInput.value.trim() || null });
      nameInput.value = '';
      vpaInput.value = '';
      renderPending();
    },
  });

  const save = h('button', {
    class: 'btn btn-primary', text: 'Create group',
    onclick: async () => {
      if (!name.value.trim()) { toast('Give the group a name', 'err'); return; }
      try {
        const { group } = await api.createGroup({ name: name.value.trim(), emoji: emoji.value.trim() || '👥', kind: kind.value, member_ids: [] });
        for (const p of pending) await api.addMember(group.id, { name: p.name, vpa: p.vpa });
        toast('Group created', 'ok');
        m.close();
        await refreshShell();
        navigate('groups', { open: group.id });
      } catch (e) { toast(e.message, 'err'); }
    },
  });

  const m = modal({
    title: 'Create a group',
    body: frag(
      h('div', { class: 'grid g-2' }, field('Group name', name), field('Emoji', emoji)),
      h('div', { style: 'margin-top:12px' }, field('Type', kind)),
      h('div', { style: 'margin-top:12px' },
        h('label', { class: 'tiny muted', style: 'font-weight:600' }, 'Members (you are added automatically)'),
        h('div', { class: 'grid g-2', style: 'margin-top:6px' }, nameInput, vpaInput),
        h('div', { style: 'margin-top:8px' }, addPerson),
        chips,
      ),
    ),
    footer: [h('button', { class: 'btn', text: 'Cancel', onclick: () => m.close() }), save],
  });
}

function openAddMember(gid, onDone) {
  const name = h('input', { type: 'text', placeholder: 'Member name, e.g. Kabir Singh' });
  const vpa = h('input', { type: 'text', placeholder: 'their@upi (optional)' });

  const save = h('button', {
    class: 'btn btn-primary', text: 'Add member',
    onclick: async () => {
      try {
        if (!name.value.trim()) { toast('Type a name', 'err'); return; }
        await api.addMember(gid, { name: name.value.trim(), vpa: vpa.value.trim() || null });
        toast('Member added', 'ok');
        m.close();
        await refreshShell();
        onDone?.();
      } catch (e) { toast(e.message, 'err'); }
    },
  });

  const m = modal({
    title: 'Add a member',
    body: frag(field('Name', name), h('div', { style: 'margin-top:12px' }, field('UPI ID', vpa, 'Lets Whyso build a settle-up pay link for them.'))),
    footer: [h('button', { class: 'btn', text: 'Cancel', onclick: () => m.close() }), save],
  });
}

function openSettle(gid, d, onDone) {
  const transfers = d.transfers;
  const idx = h('select', {}, ...transfers.map((t, i) => h('option', { value: i, text: `${t.from.name} → ${t.to.name} (${inr(t.amount)})` })));
  const amount = h('input', { type: 'number', step: '0.01', value: transfers[0]?.amount ?? '' });
  const note = h('input', { type: 'text', placeholder: 'e.g. Goa villa share' });
  const result = h('div', { style: 'margin-top:10px' });

  idx.addEventListener('change', () => { amount.value = transfers[idx.value].amount; });

  const save = h('button', {
    class: 'btn btn-primary', text: 'Record settlement',
    onclick: async () => {
      const t = transfers[idx.value];
      try {
        const res = await api.settle(gid, { from_user: t.from.user_id, to_user: t.to.user_id, amount: amount.value, note: note.value.trim() || null });
        toast('Settlement recorded', 'ok');
        if (res.pay_link) {
          result.replaceChildren(h('div', { class: 'insight info' }, h('div', { class: 'ib' }), h('div', {},
            h('div', { class: 'it', text: 'Pay link ready' }),
            h('a', { href: res.pay_link, class: 'tiny', style: 'word-break:break-all', text: res.pay_link }),
          )));
        }
        onDone?.();
        if (!res.pay_link) m.close();
      } catch (e) { toast(e.message, 'err'); }
    },
  });

  const m = modal({
    title: 'Record a settlement',
    body: frag(
      h('div', { class: 'insight info' }, h('div', { class: 'ib' }), h('div', { class: 'ib2', text: 'Whyso computes the fewest possible transfers to clear every balance in this group.' })),
      field('Suggested transfer', idx),
      h('div', { class: 'grid g-2', style: 'margin-top:12px' }, field('Amount settled (₹)', amount), field('Note', note)),
      result,
    ),
    footer: [h('button', { class: 'btn', text: 'Close', onclick: () => m.close() }), save],
  });
}
