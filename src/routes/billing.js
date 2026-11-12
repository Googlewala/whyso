import express from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { get, run } from '../db.js';
import {
  applyStripeEvent, billingStatus, createBillingPortalSession,
  createCheckoutSession, verifyStripeSignature,
} from '../billing.js';

export const billingRouter = express.Router();

const ok = (res, data, status = 200) => res.status(status).json(data);
const bad = (res, error, status = 400) => res.status(status).json({ error });

billingRouter.get('/billing/status', (req, res) => {
  if (!req.user) return bad(res, 'Not signed in.', 401);
  ok(res, billingStatus(req.user));
});

billingRouter.post('/billing/checkout', async (req, res, next) => {
  if (!req.user) return bad(res, 'Not signed in.', 401);
  if (!config.billingEnabled) return bad(res, 'Billing is not configured on this server.', 503);
  try {
    const successUrl = req.body?.success_url || `${config.appUrl}/#billing?status=success`;
    const cancelUrl = req.body?.cancel_url || `${config.appUrl}/#billing?status=cancelled`;
    const session = await createCheckoutSession(req.user, { successUrl, cancelUrl });
    logger.info('checkout started', { userId: req.user.id });
    ok(res, session, 201);
  } catch (err) { next(err); }
});

billingRouter.post('/billing/portal', async (req, res, next) => {
  if (!req.user) return bad(res, 'Not signed in.', 401);
  if (!config.billingEnabled) return bad(res, 'Billing is not configured on this server.', 503);
  try {
    const session = await createBillingPortalSession(req.user, {
      returnUrl: req.body?.return_url || `${config.appUrl}/#billing`,
    });
    ok(res, session, 201);
  } catch (err) { next(err); }
});

/**
 * Stripe webhook. Mounted with a raw body parser by the server, so
 * req.body is a Buffer here and the signature can be verified exactly.
 */
export async function stripeWebhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const check = verifyStripeSignature(raw, req.get('stripe-signature'));
  if (!check.ok) {
    logger.warn('stripe webhook rejected', { reason: check.reason });
    return res.status(400).json({ error: `Invalid signature: ${check.reason}` });
  }
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  try {
    applyStripeEvent(event);
  } catch (err) {
    logger.error('stripe webhook failed', { error: err.message, type: event?.type });
    return res.status(500).json({ error: 'Failed to apply event' });
  }
  res.json({ received: true });
}

/**
 * Development-only plan switcher so the upgrade flow is testable without
 * Stripe. Hard-disabled in production.
 */
billingRouter.post('/billing/dev-activate', (req, res) => {
  if (config.isProd) return bad(res, 'Not available in production.', 403);
  if (!req.user) return bad(res, 'Not signed in.', 401);
  const plan = req.body?.plan === 'pro' ? 'pro' : 'free';
  run(`UPDATE users SET plan = :p, plan_status = :s WHERE id = :u`,
    { p: plan, s: plan === 'pro' ? 'active' : 'inactive', u: req.user.id });
  const fresh = get(`SELECT * FROM users WHERE id = :u`, { u: req.user.id });
  logger.info('dev plan switch', { userId: req.user.id, plan });
  ok(res, { plan, billing: billingStatus(fresh) });
});
