import { api } from '../api.js';
import { app, refreshShell } from '../app.js';
import { h, frag, toast, inr, emptyState } from '../ui.js';

const limitText = (v) => (v === null || v === undefined ? 'Unlimited' : String(v));

function planCard(plan, { current, onChoose, billingEnabled }) {
  const isPro = plan.id === 'pro';
  const isCurrent = current === plan.id;
  return h('div', { class: `plan-card ${isPro ? 'pro' : ''} ${isCurrent ? 'current' : ''}` },
    isPro ? h('div', { class: 'plan-flag', text: 'Most popular' }) : null,
    h('div', { class: 'plan-name', text: plan.name }),
    h('div', { class: 'plan-price' },
      plan.price === 0 ? h('span', { class: 'amt', text: '₹0' }) : h('span', { class: 'amt', text: inr(plan.price / 100, { paise: false }) }),
      h('span', { class: 'per', text: plan.price === 0 ? 'forever' : '/month' }),
    ),
    h('div', { class: 'plan-tagline muted', text: plan.tagline }),
    h('ul', { class: 'plan-features' }, plan.features.map((f) => h('li', { text: f }))),
    h('div', { class: 'plan-limits' },
      h('div', {}, h('span', { class: 'muted', text: 'Expenses/mo' }), h('b', { text: limitText(plan.limits.expenses_per_month) })),
      h('div', {}, h('span', { class: 'muted', text: 'Groups' }), h('b', { text: limitText(plan.limits.groups) })),
      h('div', {}, h('span', { class: 'muted', text: 'Statements/mo' }), h('b', { text: limitText(plan.limits.statement_per_month) })),
    ),
    isCurrent
      ? h('button', { class: 'btn', disabled: true, text: 'Current plan' })
      : h('button', {
        class: `btn ${isPro ? 'btn-primary' : ''}`,
        text: isPro ? (billingEnabled ? 'Upgrade to Pro' : 'Upgrade to Pro') : 'Downgrade',
        onclick: () => onChoose(plan),
      }),
  );
}

export function billingView({ actions }) {
  const root = h('div', { class: 'grid' });
  let status = null;

  if (actions) actions.append(h('button', { class: 'btn', text: '↻ Refresh', onclick: () => load(true) }));

  async function load(force = false) {
    root.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'skeleton', style: 'height:120px' })));
    status = await api.billingStatus();
    if (app.data) app.data.billing = status;
    render();
  }

  function render() {
    const current = status.plan;
    const usage = status.usage || {};

    root.replaceChildren(
      h('div', { class: 'card span-2' },
        h('div', { class: 'card-head' },
          h('h3', { text: 'Your plan' }),
          h('span', { class: `pill ${current === 'pro' ? 'green' : 'amber'}`, text: status.plan_name }),
        ),
        h('div', { class: 'usage-grid' },
          usageCard('Expenses this month', usage.expense),
          usageCard('PDF statements this month', usage.statement),
        ),
        status.renews_at ? h('p', { class: 'muted tiny', text: `Renews on ${status.renews_at.slice(0, 10)}.` }) : null,
        !status.billing_enabled ? h('div', { class: 'notice' },
          h('span', { class: 'em', text: 'ℹ️' }),
          h('div', {}, h('div', { style: 'font-weight:650', text: 'Payments are not configured on this server' }),
            h('div', { class: 'tiny muted', text: 'Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO to enable checkout. You can still try Pro below.' })),
        ) : null,
        !status.billing_enabled ? h('div', { style: 'margin-top:10px;display:flex;gap:8px' },
          h('button', { class: 'btn btn-sm', text: '🧪 Activate Pro (dev)', onclick: () => devSwitch('pro') }),
          h('button', { class: 'btn btn-sm', text: 'Revert to Free (dev)', onclick: () => devSwitch('free') }),
        ) : h('div', { style: 'margin-top:10px' },
          current === 'pro' ? h('button', { class: 'btn btn-sm', text: 'Manage billing', onclick: openPortal }) : null,
        ),
      ),
      h('div', { class: 'plans span-2' }, status.plans.map((p) => planCard(p, { current, onChoose: choose, billingEnabled: status.billing_enabled }))),
      h('div', { class: 'card span-2' },
        h('h3', { text: 'Frequently asked' }),
        faq('What counts as an expense?', 'Every transaction you record or import, including group expenses and credits.'),
        faq('Can I cancel anytime?', 'Yes. Cancelling keeps your data and returns you to the Free plan at the end of the period.'),
        faq('Is my data private?', 'Each account is isolated. Group members only see the expenses they are part of.'),
      ),
    );
  }

  function usageCard(label, u) {
    if (!u) return null;
    const unlimited = u.limit === null || u.limit === Infinity || !Number.isFinite(u.limit);
    const pct = unlimited ? 0 : Math.min(100, (u.used / u.limit) * 100);
    return h('div', { class: 'usage-card' },
      h('div', { class: 'muted tiny', text: label }),
      h('div', { class: 'usage-val' }, h('b', { text: String(u.used) }), h('span', { class: 'muted', text: unlimited ? ' / Unlimited' : ` / ${u.limit}` })),
      h('div', { class: 'progress' }, h('span', { style: `width:${pct}%;background:${pct > 85 ? '#dc2626' : '#4f46e5'}` })),
    );
  }

  function faq(q, a) {
    return h('details', { class: 'faq' }, h('summary', { text: q }), h('p', { class: 'muted', text: a }));
  }

  async function choose(plan) {
    if (plan.id === 'free') {
      if (!status.billing_enabled) return devSwitch('free');
      try { await openPortal(); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (!status.billing_enabled) return devSwitch('pro');
    try {
      const { url } = await api.checkout();
      location.href = url;
    } catch (err) { toast(err.message, 'error'); }
  }

  async function openPortal() {
    const { url } = await api.portal();
    location.href = url;
  }

  async function devSwitch(plan) {
    try {
      await api.devActivate(plan);
      await refreshShell();
      await load();
      toast(plan === 'pro' ? 'Pro activated (dev mode)' : 'Reverted to Free', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  load();
  return root;
}

export default billingView;
void frag;
void emptyState;
