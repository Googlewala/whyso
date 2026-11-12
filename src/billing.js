import { createHmac, timingSafeEqual } from 'node:crypto';
import { all, get, run } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';

/*
 * Plan definitions live here so entitlement checks and the pricing UI read
 * from one source of truth.
 */
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'INR',
    tagline: 'Everything you need to get started',
    limits: {
      expenses_per_month: 150,
      groups: 2,
      occasions: 2,
      members_per_group: 4,
      statement_per_month: 3,
      csv_import_rows: 200,
    },
    features: [
      'UPI QR scanning & pay links',
      'Bank SMS + CSV import',
      'Split bills and settle up',
      'Spending analytics & insights',
      '3 PDF statements a month',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 14900, // paise, INR 149/month
    currency: 'INR',
    tagline: 'For people who track everything',
    limits: {
      expenses_per_month: Infinity,
      groups: Infinity,
      occasions: Infinity,
      members_per_group: 50,
      statement_per_month: Infinity,
      csv_import_rows: 5000,
    },
    features: [
      'Everything in Free',
      'Unlimited expenses, groups & occasions',
      'Unlimited PDF statements',
      'Large CSV imports (5,000 rows)',
      'Priority email support',
    ],
  },
};

export const METRICS = ['expense', 'statement', 'csv_row', 'scan'];

/** Maps a usage metric to the plan limit that governs it. */
const METRIC_LIMIT_KEY = {
  expense: 'expenses_per_month',
  statement: 'statement_per_month',
  csv_row: 'csv_import_rows',
};

export function limitKeyFor(metric) {
  return METRIC_LIMIT_KEY[metric] || `${metric}_per_month`;
}

export function planFor(user) {
  if (!user) return PLANS.free;
  if (user.plan === 'pro' && user.plan_status === 'active') return PLANS.pro;
  return PLANS.free;
}

export function isPro(user) {
  return planFor(user).id === 'pro';
}

export function limitFor(user, key) {
  return planFor(user).limits[key] ?? Infinity;
}

/* ---------------- usage metering ---------------- */

export function periodKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function usage(userId, metric, period = periodKey()) {
  const row = get(`SELECT count FROM usage_counters WHERE user_id = :u AND metric = :m AND period = :p`,
    { u: userId, m: metric, p: period });
  return row ? row.count : 0;
}

export function incrementUsage(userId, metric, by = 1, period = periodKey()) {
  run(
    `INSERT INTO usage_counters (user_id, metric, period, count) VALUES (:u, :m, :p, :by)
     ON CONFLICT (user_id, metric, period) DO UPDATE SET count = count + :by`,
    { u: userId, m: metric, p: period, by },
  );
  return usage(userId, metric, period);
}

export function usageSummary(user) {
  const period = periodKey();
  const plan = planFor(user);
  const out = {};
  for (const metric of ['expense', 'statement']) {
    out[metric] = { used: usage(user.id, metric, period), limit: plan.limits[limitKeyFor(metric)] ?? Infinity, period };
  }
  return out;
}

/**
 * Returns null when the action is allowed, or an object describing the block.
 * Counters that are unlimited (Infinity) never block.
 */
export function checkQuota(user, metric, { amount = 1, limitKey = limitKeyFor(metric) } = {}) {
  const limit = limitFor(user, limitKey);
  if (!Number.isFinite(limit)) return null;
  const used = usage(user.id, metric);
  if (used + amount <= limit) return null;
  return {
    error: `You've reached the ${planFor(user).name} plan limit of ${limit} ${limit === 1 ? metric : `${metric}s`} this month.`,
    metric,
    limit,
    used,
    plan: planFor(user).id,
    upgrade: true,
  };
}

/** Counts an existing resource against a plan limit (used for created rows). */
export function checkCountLimit(user, key, currentCount, label) {
  const limit = limitFor(user, key);
  if (!Number.isFinite(limit) || currentCount < limit) return null;
  return {
    error: `The ${planFor(user).name} plan allows ${limit} ${label}. Upgrade for unlimited.`,
    limit,
    used: currentCount,
    plan: planFor(user).id,
    upgrade: true,
  };
}

/* ---------------- Stripe adapter ---------------- */

function stripeConfigured() {
  return Boolean(config.stripe.secretKey);
}

async function stripeRequest(path, { method = 'POST', body } = {}) {
  if (!stripeConfigured()) throw new Error('Billing is not configured on this server.');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `Stripe request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export async function createCheckoutSession(user, { successUrl, cancelUrl }) {
  if (!stripeConfigured() || !config.stripe.proPriceId) {
    throw new Error('Billing is not configured on this server.');
  }
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripeRequest('customers', {
      body: { email: user.email || '', name: user.name, 'metadata[user_id]': String(user.id) },
    });
    customerId = customer.id;
    run(`UPDATE users SET stripe_customer_id = :c WHERE id = :u`, { c: customerId, u: user.id });
  }
  const session = await stripeRequest('checkout/sessions', {
    body: {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': config.stripe.proPriceId,
      'line_items[0][quantity]': '1',
      success_url: successUrl,
      cancel_url: cancelUrl,
      'subscription_data[metadata][user_id]': String(user.id),
      'metadata[user_id]': String(user.id),
    },
  });
  return { url: session.url, id: session.id };
}

export async function createBillingPortalSession(user, { returnUrl }) {
  if (!user.stripe_customer_id) throw new Error('No billing profile yet. Subscribe to Pro first.');
  const session = await stripeRequest('billing_portal/sessions', {
    body: { customer: user.stripe_customer_id, return_url: returnUrl },
  });
  return { url: session.url };
}

/** Constant-time check of the Stripe-Signature header. */
export function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = config.stripe.webhookSecret;
  if (!secret) return { ok: false, reason: 'webhook secret not configured' };
  if (!signatureHeader) return { ok: false, reason: 'missing signature' };

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => kv.split('=').map((s) => s.trim())).filter((p) => p.length === 2),
  );
  const timestamp = parts.t;
  const provided = parts.v1;
  if (!timestamp || !provided) return { ok: false, reason: 'malformed signature' };

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return { ok: false, reason: 'timestamp outside tolerance' };

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true };
}

/** Applies a verified Stripe event to local subscription state. Idempotent. */
export function applyStripeEvent(event) {
  const id = event?.id;
  if (id && get(`SELECT id FROM billing_events WHERE event_id = :e`, { e: id })) {
    return { applied: false, reason: 'duplicate' };
  }

  const obj = event?.data?.object || {};
  const metaUserId = Number(obj?.metadata?.user_id || obj?.subscription_details?.metadata?.user_id || 0);
  let user = metaUserId ? get(`SELECT * FROM users WHERE id = :u`, { u: metaUserId }) : null;
  if (!user && obj.customer) user = get(`SELECT * FROM users WHERE stripe_customer_id = :c`, { c: obj.customer });

  let result = { applied: false };
  switch (event?.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      if (user) {
        const active = ['active', 'trialing'].includes(obj.status) || event.type === 'checkout.session.completed';
        const renews = obj.current_period_end
          ? new Date(obj.current_period_end * 1000).toISOString().slice(0, 19).replace('T', ' ')
          : null;
        run(
          `UPDATE users SET plan = 'pro', plan_status = :ps, plan_renews_at = :r,
                  stripe_subscription_id = COALESCE(:sub, stripe_subscription_id),
                  stripe_customer_id = COALESCE(:cust, stripe_customer_id)
            WHERE id = :u`,
          { ps: active ? 'active' : 'past_due', r: renews, sub: obj.subscription || obj.id || null, cust: obj.customer || null, u: user.id },
        );
        result = { applied: true, userId: user.id, plan: 'pro' };
      }
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      if (user) {
        const renews = obj.lines?.data?.[0]?.period?.end
          ? new Date(obj.lines.data[0].period.end * 1000).toISOString().slice(0, 19).replace('T', ' ')
          : null;
        run(`UPDATE users SET plan = 'pro', plan_status = 'active', plan_renews_at = COALESCE(:r, plan_renews_at) WHERE id = :u`,
          { r: renews, u: user.id });
        result = { applied: true, userId: user.id, plan: 'pro' };
      }
      break;
    }
    case 'customer.subscription.deleted':
    case 'invoice.payment_failed': {
      if (user) {
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : 'past_due';
        run(`UPDATE users SET plan_status = :ps WHERE id = :u`, { ps: status, u: user.id });
        result = { applied: true, userId: user.id, plan_status: status };
      }
      break;
    }
    default:
      result = { applied: false, reason: 'unhandled type' };
  }

  run(`INSERT OR IGNORE INTO billing_events (provider, event_id, type, user_id, payload)
       VALUES ('stripe', :id, :type, :u, :payload)`,
    { id: id || null, type: event?.type || null, u: user?.id ?? null, payload: JSON.stringify(event).slice(0, 200_000) });
  logger.info('billing event', { type: event?.type, userId: user?.id ?? null, applied: result.applied });
  return result;
}

export function billingStatus(user) {
  const plan = planFor(user);
  return {
    plan: plan.id,
    plan_name: plan.name,
    plan_status: user.plan_status,
    renews_at: user.plan_renews_at || null,
    billing_enabled: config.billingEnabled,
    plans: Object.values(PLANS).map((p) => ({
      id: p.id, name: p.name, price: p.price, currency: p.currency, tagline: p.tagline, features: p.features, limits: serialiseLimits(p.limits),
    })),
    usage: usageSummary(user),
  };
}

function serialiseLimits(limits) {
  const out = {};
  for (const [k, v] of Object.entries(limits)) out[k] = Number.isFinite(v) ? v : null; // null = unlimited
  return out;
}
