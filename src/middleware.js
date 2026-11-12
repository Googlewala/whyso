import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

/** Attaches a request id and logs one line per completed request. */
export function requestContext() {
  return (req, res, next) => {
    req.id = req.get('x-request-id') || randomUUID();
    res.setHeader('X-Request-Id', req.id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug';
      logger[level]('request', {
        id: req.id, method: req.method, path: req.path,
        status: res.statusCode, ms: Math.round(ms * 10) / 10,
        userId: req.user?.id ?? null,
      });
    });
    next();
  };
}

/** Conservative security headers; avoids a helmet dependency. */
export function securityHeaders() {
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');

  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

/**
 * Fixed-window rate limiter keyed by IP (or user once authenticated).
 * In-memory by design: correct for a single instance, and a shared store is
 * the documented upgrade path for horizontal scaling.
 */
export function rateLimit({ windowMs = config.rateLimit.windowMs, max = config.rateLimit.max, keyFn } = {}) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs).unref();

  const middleware = (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.reset - now) / 1000)));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    next();
  };

  middleware.stop = () => clearInterval(sweep);
  middleware.reset = () => hits.clear();
  return middleware;
}

/** Rejects cross-site state-changing requests using the Origin header. */
export function requireSameOrigin() {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next(); // non-browser client (CLI, tests, server-to-server)
    let host;
    try { host = new URL(origin).host; } catch { return res.status(403).json({ error: 'Invalid origin' }); }
    const expected = req.get('host');
    if (host !== expected) return res.status(403).json({ error: 'Cross-origin request blocked' });
    next();
  };
}

/** Tracks in-flight requests so shutdown can drain instead of cutting off. */
export function createDrain() {
  let active = 0;
  let draining = false;
  const middleware = (req, res, next) => {
    if (draining) {
      res.setHeader('Connection', 'close');
      return res.status(503).json({ error: 'Server is shutting down' });
    }
    active += 1;
    res.on('finish', () => { active -= 1; });
    res.on('close', () => { active -= 1; });
    next();
  };
  return { middleware, begin: () => { draining = true; }, get active() { return active; } };
}
