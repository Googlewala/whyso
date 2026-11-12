import express from 'express';
import { config } from '../config.js';
import { logger } from '../logger.js';
import {
  createSession, createUser, findUserByEmail, normalizeEmail, publicUser,
  revokeAllSessions, revokeSession, setPassword, validateSignup, verifyPassword,
} from '../auth.js';
import { get, run } from '../db.js';
import { billingStatus, isPro } from '../billing.js';

export const authRouter = express.Router();

const ok = (res, data, status = 200) => res.status(status).json(data);
const bad = (res, error, status = 400, extra = {}) => res.status(status).json({ error, ...extra });

function issueSession(res, user, req) {
  const { token, expiresAt } = createSession(user.id, { userAgent: req.get('user-agent'), ip: req.ip });
  res.cookie?.(config.cookieName, token, cookieOptions(expiresAt));
  return { token, expiresAt };
}

export function cookieOptions(expiresAt) {
  const expires = new Date(expiresAt.replace(' ', 'T') + 'Z');
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    expires,
  };
}

export function clearCookieOptions() {
  return { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/', expires: new Date(0) };
}

/* ---------------- signup ---------------- */

authRouter.post('/signup', (req, res) => {
  if (!config.allowSignup) return bad(res, 'Signups are currently disabled.', 403);
  const { name, email, password, vpa } = req.body || {};
  const check = validateSignup({ name, email, password, vpa });
  if (!check.ok) return bad(res, 'Please fix the highlighted fields.', 422, { fields: check.errors });

  let user;
  try {
    user = createUser({ name, email, password, vpa });
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') return bad(res, err.message, 409, { fields: { email: err.message } });
    if (err.code === 'VPA_TAKEN') return bad(res, err.message, 409, { fields: { vpa: err.message } });
    throw err;
  }

  const session = issueSession(res, user, req);
  logger.info('signup', { userId: user.id });
  ok(res, { user: publicUser(user), token: session.token, expires_at: session.expiresAt }, 201);
});

/* ---------------- login ---------------- */

authRouter.post('/login', (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = findUserByEmail(email);

  // Always compare against something so a missing user and a wrong password
  // take a similar amount of time.
  const stored = user?.password_hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
  const valid = verifyPassword(password, stored);
  if (!user || !valid) return bad(res, 'Incorrect email or password.', 401);
  if (user.status !== 'active') return bad(res, 'This account is suspended.', 403);

  run(`UPDATE users SET last_login_at = datetime('now') WHERE id = :u`, { u: user.id });
  const session = issueSession(res, user, req);
  logger.info('login', { userId: user.id });
  ok(res, { user: publicUser(user), token: session.token, expires_at: session.expiresAt });
});

/* ---------------- logout ---------------- */

authRouter.post('/logout', (req, res) => {
  revokeSession(req.sessionToken);
  res.clearCookie?.(config.cookieName, clearCookieOptions());
  ok(res, { ok: true });
});

authRouter.post('/logout-all', (req, res) => {
  if (!req.user) return bad(res, 'Not signed in.', 401);
  revokeAllSessions(req.user.id);
  res.clearCookie?.(config.cookieName, clearCookieOptions());
  ok(res, { ok: true });
});

/* ---------------- current user ---------------- */

authRouter.get('/me', (req, res) => {
  if (!req.user) return bad(res, 'Not signed in.', 401);
  const fresh = get(`SELECT * FROM users WHERE id = :u`, { u: req.user.id });
  ok(res, { user: publicUser(fresh), pro: isPro(fresh), billing: billingStatus(fresh) });
});

authRouter.patch('/me', (req, res) => {
  if (!req.user) return bad(res, 'Not signed in.', 401);
  const { name, vpa } = req.body || {};
  const fields = [];
  const params = { u: req.user.id };
  if (name !== undefined) {
    if (String(name).trim().length < 2) return bad(res, 'Enter your name.', 422, { fields: { name: 'Too short.' } });
    fields.push('name = :name'); params.name = String(name).trim();
  }
  if (vpa !== undefined) {
    const value = vpa ? String(vpa).trim() : null;
    if (value) {
      const clash = get(`SELECT id FROM users WHERE vpa = :v AND id != :u`, { v: value, u: req.user.id });
      if (clash) return bad(res, 'That UPI ID is already registered.', 409, { fields: { vpa: 'Already in use.' } });
    }
    fields.push('vpa = :vpa'); params.vpa = value;
  }
  if (!fields.length) return bad(res, 'Nothing to update.', 422);
  run(`UPDATE users SET ${fields.join(', ')} WHERE id = :u`, params);
  const fresh = get(`SELECT * FROM users WHERE id = :u`, { u: req.user.id });
  ok(res, { user: publicUser(fresh) });
});

authRouter.post('/change-password', (req, res) => {
  if (!req.user) return bad(res, 'Not signed in.', 401);
  const { current_password: current, new_password: next } = req.body || {};
  const user = get(`SELECT * FROM users WHERE id = :u`, { u: req.user.id });
  if (!verifyPassword(String(current || ''), user.password_hash)) {
    return bad(res, 'Current password is incorrect.', 403, { fields: { current_password: 'Incorrect.' } });
  }
  const check = validateSignup({ name: user.name, email: user.email, password: next });
  if (!check.ok) return bad(res, check.errors.password || 'Weak password.', 422, { fields: check.errors });
  setPassword(user.id, next);
  revokeAllSessions(user.id);
  const session = issueSession(res, user, req);
  logger.info('password changed', { userId: user.id });
  ok(res, { ok: true, token: session.token });
});

/* ---------------- demo sign-in ---------------- */

authRouter.post('/demo', (req, res) => {
  if (!config.demoMode) return bad(res, 'Demo mode is disabled.', 403);
  const user = get(`SELECT * FROM users WHERE is_demo = 1 ORDER BY id LIMIT 1`);
  if (!user) return bad(res, 'No demo account is available.', 404);
  const session = issueSession(res, user, req);
  ok(res, { user: publicUser(user), token: session.token, expires_at: session.expiresAt });
});
