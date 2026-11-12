import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { config, assertConfig, configWarnings } from './config.js';
import { logger } from './logger.js';
import { initSchema, closeDb, get, run } from './db.js';
import { seedReferenceData, seedIfEmpty } from './seed.js';
import { purgeExpiredSessions, sessionFromToken, touchSession, usersWithEmails } from './auth.js';
import { buildUpiUri } from './upi.js';
import { createDrain, rateLimit, requestContext, requireSameOrigin, securityHeaders } from './middleware.js';
import { router as api } from './routes/api.js';
import { authRouter, clearCookieOptions } from './routes/auth.js';
import { billingRouter, stripeWebhook } from './routes/billing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // Behind a load balancer we need the real client IP for rate limiting.
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const drain = createDrain();

  app.use(requestContext());
  app.use(securityHeaders());
  app.use(drain.middleware);

  // Stripe needs the exact bytes it signed, so this route parses its own body
  // and must be registered before the JSON parser.
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhook);

  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));
  app.use(requireSameOrigin());

  // Minimal cookie parser: avoids a dependency for a single cookie.
  app.use((req, res, next) => {
    req.cookies = {};
    const raw = req.get('cookie');
    if (raw) {
      for (const part of raw.split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) req.cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
    next();
  });

  // Resolves the session token from the Authorization header, the cookie, or
  // an ?access_token= param (used by PDF/QR links opened in a new tab).
  app.use((req, res, next) => {
    const header = req.get('authorization') || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const token = bearer || req.cookies[config.cookieName] || req.query.access_token || null;
    req.sessionToken = token;
    if (token) {
      const user = sessionFromToken(token);
      if (user) {
        req.user = user;
        touchSession(user.session_id);
      }
    }
    next();
  });

  // Writes a Set-Cookie header without pulling in cookie-parser.
  app.use((req, res, next) => {
    res.cookie = (name, value, opts = {}) => {
      const bits = [`${name}=${encodeURIComponent(value)}`];
      if (opts.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
      if (opts.expires) bits.push(`Expires=${new Date(opts.expires).toUTCString()}`);
      bits.push(`Path=${opts.path || '/'}`);
      if (opts.httpOnly) bits.push('HttpOnly');
      if (opts.secure) bits.push('Secure');
      if (opts.sameSite) bits.push(`SameSite=${opts.sameSite}`);
      const prev = res.getHeader('Set-Cookie');
      const next = prev ? [...(Array.isArray(prev) ? prev : [prev]), bits.join('; ')] : [bits.join('; ')];
      res.setHeader('Set-Cookie', next);
      return res;
    };
    res.clearCookie = (name, opts = {}) => res.cookie(name, '', { ...opts, expires: new Date(0) });
    next();
  });

  /* ---------------- health probes ---------------- */

  const health = (req, res) => res.json({ ok: true, service: 'whyso', env: config.env, time: new Date().toISOString() });
  app.get('/health', health);
  app.get('/healthz', health);
  app.get('/readyz', (req, res) => {
    try {
      get(`SELECT 1 AS ok`);
      res.json({ ok: true, ready: true });
    } catch (err) {
      res.status(503).json({ ok: false, ready: false, error: err.message });
    }
  });

  /* ---------------- rate limiting ---------------- */

  const apiLimiter = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max });
  const authLimiter = rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.authMax, keyFn: (req) => `auth:${req.ip}` });
  app.locals.limiters = { apiLimiter, authLimiter };

  app.use('/api/auth', authLimiter, authRouter);
  app.use('/api', billingRouter);
  app.use('/api', apiLimiter, api);

  /* ---------------- QR image ---------------- */

  app.get('/qr.png', async (req, res) => {
    const { vpa, name, amount, note, ref } = req.query;
    try {
      const uri = req.query.uri || buildUpiUri({ vpa, name, amount, note, ref });
      const QRCode = (await import('qrcode')).default;
      const png = await QRCode.toBuffer(uri, { type: 'png', width: 420, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(png);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /* ---------------- static assets + SPA shell ---------------- */

  const staticOpts = { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 };
  app.use(express.static(join(__dirname, '..', 'public'), staticOpts));
  app.use('/assets', express.static(join(__dirname, '..', 'assets'), { maxAge: config.isProd ? '7d' : 0 }));

  app.use((req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Unknown API route' });
    res.sendFile(join(__dirname, '..', 'public', 'index.html'));
  });

  /* ---------------- errors ---------------- */

  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) logger.error('unhandled error', { id: req.id, error: err.message, stack: err.stack });
    else logger.warn('request error', { id: req.id, error: err.message });
    if (res.headersSent) return next(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong.' : err.message });
  });

  app.locals.drain = drain;
  return app;
}

/* ---------------- boot ---------------- */

export function bootstrapData() {
  initSchema();
  seedReferenceData();
  let demo = { seeded: false };
  if (config.demoMode) demo = seedIfEmpty();
  return demo;
}

export const app = createApp();

const demo = bootstrapData();
for (const warning of configWarnings) logger.warn('config warning', { warning });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertConfig();
  const server = app.listen(config.port, config.host, () => {
    logger.info('server listening', { port: config.port, host: config.host, env: config.env, demo: demo.seeded, billing: config.billingEnabled });
    if (config.demoMode && demo.seeded) {
      logger.info('demo accounts ready', { accounts: usersWithEmails().map((u) => u.email) });
    }
  });

  server.headersTimeout = 65_000;
  server.requestTimeout = 120_000;

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown started', { signal });
    app.locals.drain.begin();
    server.close(() => {
      closeDb();
      logger.info('shutdown complete');
      process.exit(0);
    });
    // Hard deadline so a stuck connection cannot block a deploy forever.
    setTimeout(() => {
      logger.warn('forcing exit after drain timeout');
      closeDb();
      process.exit(1);
    }, 15_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { reason: String(reason) }));
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });

  // Housekeeping: drop expired sessions so the table cannot grow forever.
  setInterval(() => {
    try { purgeExpiredSessions(); } catch (err) { logger.warn('session purge failed', { error: err.message }); }
  }, 6 * 60 * 60 * 1000).unref();
}

export default app;
void clearCookieOptions;
void run;
