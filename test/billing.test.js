import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'whyso-billing-'));
process.env.WHYSO_DB = join(dir, 'test.db');
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

const billing = await import('../src/billing.js');
const auth = await import('../src/auth.js');
const { initSchema, get, run } = await import('../src/db.js');

before(() => initSchema());

function freshUser(plan = 'free') {
  const user = auth.createUser({ name: `Billing ${Date.now()}`, email: `bill-${Date.now()}-${Math.random()}@example.com`, password: 'passw0rd1' });
  if (plan === 'pro') run(`UPDATE users SET plan = 'pro', plan_status = 'active' WHERE id = :u`, { u: user.id });
  return get(`SELECT * FROM users WHERE id = :u`, { u: user.id });
}

/* ---------------- plan resolution ---------------- */

test('a free user resolves to the free plan', () => {
  const user = freshUser('free');
  assert.equal(billing.planFor(user).id, 'free');
  assert.equal(billing.isPro(user), false);
});

test('a pro user with an active subscription resolves to pro', () => {
  const user = freshUser('pro');
  assert.equal(billing.planFor(user).id, 'pro');
  assert.equal(billing.isPro(user), true);
});

test('a pro user whose subscription lapsed falls back to free', () => {
  const user = freshUser('free');
  run(`UPDATE users SET plan = 'pro', plan_status = 'past_due' WHERE id = :u`, { u: user.id });
  const reloaded = get(`SELECT * FROM users WHERE id = :u`, { u: user.id });
  assert.equal(billing.planFor(reloaded).id, 'free', 'past_due is not entitled');
});

test('an anonymous user is treated as free, not a crash', () => {
  assert.equal(billing.planFor(null).id, 'free');
});

/* ---------------- usage metering ---------------- */

test('incrementUsage accumulates within a period', () => {
  const user = freshUser();
  assert.equal(billing.usage(user.id, 'expense'), 0);
  billing.incrementUsage(user.id, 'expense');
  billing.incrementUsage(user.id, 'expense', 2);
  assert.equal(billing.usage(user.id, 'expense'), 3);
});

test('usageSummary reports used and limit for the current period', () => {
  const user = freshUser();
  billing.incrementUsage(user.id, 'expense', 5);
  const summary = billing.usageSummary(user);
  assert.equal(summary.expense.used, 5);
  assert.equal(summary.expense.limit, billing.PLANS.free.limits.expenses_per_month);
});

/* ---------------- quota enforcement ---------------- */

test('a free user is blocked once the monthly expense limit is reached', () => {
  const user = freshUser();
  const limit = billing.PLANS.free.limits.expenses_per_month;
  billing.incrementUsage(user.id, 'expense', limit);
  const blocked = billing.checkQuota(user, 'expense');
  assert.ok(blocked, 'the next expense is blocked');
  assert.equal(blocked.upgrade, true);
  assert.match(blocked.error, /Free plan limit/i);
});

test('a free user under the limit is allowed', () => {
  const user = freshUser();
  billing.incrementUsage(user.id, 'expense', 10);
  assert.equal(billing.checkQuota(user, 'expense'), null);
});

test('a pro user is never blocked (unlimited)', () => {
  const user = freshUser('pro');
  billing.incrementUsage(user.id, 'expense', 100_000);
  assert.equal(billing.checkQuota(user, 'expense'), null);
});

test('a batch import that would cross the limit is blocked as a whole', () => {
  const user = freshUser();
  const limit = billing.PLANS.free.limits.expenses_per_month;
  billing.incrementUsage(user.id, 'expense', limit - 1);
  assert.equal(billing.checkQuota(user, 'expense', { amount: 1 }), null, 'one more fits');
  assert.ok(billing.checkQuota(user, 'expense', { amount: 5 }), 'five more do not');
});

/* ---------------- count limits ---------------- */

test('checkCountLimit blocks at the cap and allows below it', () => {
  const user = freshUser();
  assert.equal(billing.checkCountLimit(user, 'groups', 0, 'groups'), null);
  assert.equal(billing.checkCountLimit(user, 'groups', 1, 'groups'), null);
  const blocked = billing.checkCountLimit(user, 'groups', 2, 'groups');
  assert.ok(blocked);
  assert.match(blocked.error, /allows 2 groups/);
});

/* ---------------- Stripe signature verification ---------------- */

function sign(body, secret = 'whsec_test_secret', timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

test('verifyStripeSignature accepts a correctly signed body', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const result = billing.verifyStripeSignature(body, sign(body));
  assert.equal(result.ok, true);
});

test('verifyStripeSignature rejects a tampered body', () => {
  const body = JSON.stringify({ id: 'evt_1' });
  const result = billing.verifyStripeSignature(`${body} `, sign(body));
  assert.equal(result.ok, false);
});

test('verifyStripeSignature rejects a stale timestamp', () => {
  const body = '{}';
  const old = Math.floor(Date.now() / 1000) - 4000;
  const result = billing.verifyStripeSignature(body, sign(body, 'whsec_test_secret', old));
  assert.equal(result.ok, false);
  assert.match(result.reason, /tolerance/);
});

test('verifyStripeSignature rejects a missing header', () => {
  assert.equal(billing.verifyStripeSignature('{}', undefined).ok, false);
});

/* ---------------- event application ---------------- */

test('a checkout.session.completed event upgrades the matching user', () => {
  const user = freshUser();
  run(`UPDATE users SET stripe_customer_id = 'cus_test_1' WHERE id = :u`, { u: user.id });
  const event = {
    id: `evt_${Date.now()}`,
    type: 'checkout.session.completed',
    data: { object: { customer: 'cus_test_1', status: 'active', subscription: 'sub_1' } },
  };
  const result = billing.applyStripeEvent(event);
  assert.equal(result.applied, true);
  const updated = get(`SELECT * FROM users WHERE id = :u`, { u: user.id });
  assert.equal(updated.plan, 'pro');
  assert.equal(updated.plan_status, 'active');
});

test('the same Stripe event applied twice is a no-op', () => {
  const user = freshUser();
  run(`UPDATE users SET stripe_customer_id = 'cus_dup' WHERE id = :u`, { u: user.id });
  const event = { id: `evt_dup_${Date.now()}`, type: 'checkout.session.completed', data: { object: { customer: 'cus_dup', status: 'active' } } };
  assert.equal(billing.applyStripeEvent(event).applied, true);
  const second = billing.applyStripeEvent(event);
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'duplicate');
});

test('a subscription.deleted event marks the plan cancelled', () => {
  const user = freshUser('pro');
  run(`UPDATE users SET stripe_customer_id = 'cus_del' WHERE id = :u`, { u: user.id });
  billing.applyStripeEvent({ id: `evt_del_${Date.now()}`, type: 'customer.subscription.deleted', data: { object: { customer: 'cus_del' } } });
  const updated = get(`SELECT * FROM users WHERE id = :u`, { u: user.id });
  assert.equal(updated.plan_status, 'canceled');
  assert.equal(billing.planFor(updated).id, 'free');
});

/* ---------------- status payload ---------------- */

test('billingStatus exposes the plan catalogue and current usage', () => {
  const user = freshUser();
  const status = billing.billingStatus(user);
  assert.equal(status.plan, 'free');
  assert.ok(Array.isArray(status.plans));
  assert.ok(status.plans.find((p) => p.id === 'pro'));
  assert.ok(status.usage.expense);
  assert.equal(typeof status.billing_enabled, 'boolean');
});
