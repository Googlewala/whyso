import { resolve } from 'node:path';

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

function toBool(value, dflt) {
  if (value === undefined || value === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function toInt(value, dflt) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

const port = toInt(process.env.PORT, 12000);

export const config = {
  env,
  isProd,
  isTest,
  port,
  host: process.env.HOST || '0.0.0.0',
  appUrl: (process.env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  dbPath: process.env.WHYSO_DB || resolve(process.cwd(), 'data/whyso.db'),
  logLevel: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  trustProxy: toBool(process.env.TRUST_PROXY, isProd),
  // Seeds the shared demo workspace on first boot. Off by default in production.
  demoMode: toBool(process.env.WHYSO_DEMO, !isProd),
  allowSignup: toBool(process.env.WHYSO_ALLOW_SIGNUP, true),
  sessionTtlDays: toInt(process.env.SESSION_TTL_DAYS, 30),
  cookieName: process.env.SESSION_COOKIE || 'whyso_session',
  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    max: toInt(process.env.RATE_LIMIT_MAX, 240),
    authMax: toInt(process.env.RATE_LIMIT_AUTH_MAX, 20),
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    proPriceId: process.env.STRIPE_PRICE_PRO || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  },
};

config.billingEnabled = Boolean(config.stripe.secretKey && config.stripe.proPriceId);

export const configWarnings = [];
if (isProd) {
  if (!process.env.APP_URL) configWarnings.push('APP_URL is not set; payment redirects will fall back to a localhost URL.');
  if (!config.billingEnabled) configWarnings.push('Stripe is not configured; paid plans are disabled.');
  if (config.demoMode) configWarnings.push('WHYSO_DEMO is on in production; demo accounts will be seeded.');
}

/** Rejects configurations that would be silently broken in production. */
export function assertConfig() {
  if (!isProd) return;
  if (config.billingEnabled && !process.env.APP_URL) {
    throw new Error('APP_URL is required in production when billing is enabled.');
  }
}
