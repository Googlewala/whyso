import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { all, get, run } from './db.js';
import { config } from './config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const VPA_RE = /^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9]{1,31}$/i;

/* ---------------- password hashing ---------------- */

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  let actual;
  try {
    actual = scryptSync(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---------------- validation ---------------- */

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateSignup({ name, email, password, vpa }) {
  const errors = {};
  if (!name || String(name).trim().length < 2) errors.name = 'Enter your name.';
  if (!EMAIL_RE.test(normalizeEmail(email))) errors.email = 'Enter a valid email address.';
  if (!password || String(password).length < 8) errors.password = 'Use at least 8 characters.';
  else if (!/[a-z]/i.test(password) || !/\d/.test(password)) errors.password = 'Mix letters and numbers.';
  if (vpa && !VPA_RE.test(String(vpa).trim())) errors.vpa = 'UPI ID should look like name@bank.';
  return { ok: Object.keys(errors).length === 0, errors };
}

/* ---------------- sessions ---------------- */

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId, { userAgent, ip } = {}) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000)
    .toISOString().replace('T', ' ').slice(0, 19);
  run(
    `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip)
     VALUES (:t, :u, :e, :ua, :ip)`,
    { t: hashToken(token), u: userId, e: expiresAt, ua: userAgent || null, ip: ip || null },
  );
  return { token, expiresAt };
}

export function sessionFromToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = :t`,
    { t: hashToken(token) },
  );
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) return null;
  return row;
}

export function touchSession(sessionId) {
  run(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = :id`, { id: sessionId });
}

export function revokeSession(token) {
  if (!token) return;
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = :t`, { t: hashToken(token) });
}

export function revokeAllSessions(userId) {
  run(`UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = :u AND revoked_at IS NULL`, { u: userId });
}

export function purgeExpiredSessions() {
  return run(`DELETE FROM sessions WHERE expires_at < datetime('now') OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days'))`).changes;
}

/* ---------------- users ---------------- */

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email || null,
    vpa: user.vpa || null,
    plan: user.plan || 'free',
    plan_status: user.plan_status || 'inactive',
    plan_renews_at: user.plan_renews_at || null,
    is_demo: Boolean(user.is_demo),
    created_at: user.created_at,
  };
}

export function findUserByEmail(email) {
  return get(`SELECT * FROM users WHERE email = :e`, { e: normalizeEmail(email) });
}

export function createUser({ name, email, password, vpa = null, plan = 'free', isDemo = false }) {
  const normalized = normalizeEmail(email);
  if (findUserByEmail(normalized)) {
    const err = new Error('An account with that email already exists.');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }
  if (vpa) {
    const clash = get(`SELECT id FROM users WHERE vpa = :v`, { v: String(vpa).trim() });
    if (clash) {
      const err = new Error('That UPI ID is already registered.');
      err.code = 'VPA_TAKEN';
      throw err;
    }
  }
  const r = run(
    `INSERT INTO users (name, email, password_hash, vpa, plan, plan_status, is_demo)
     VALUES (:n, :e, :p, :v, :plan, :ps, :demo)`,
    {
      n: String(name).trim(),
      e: normalized,
      p: hashPassword(password),
      v: vpa ? String(vpa).trim() : null,
      plan,
      ps: plan === 'free' ? 'inactive' : 'active',
      demo: isDemo ? 1 : 0,
    },
  );
  const id = Number(r.lastInsertRowid);
  // Every account gets one default bank account so imports and expenses have
  // somewhere to land without extra setup.
  run(`INSERT INTO accounts (user_id, name, type, vpa, opening_balance) VALUES (:u, 'Primary', 'bank', :v, 0)`,
    { u: id, v: vpa ? String(vpa).trim() : null });
  return get(`SELECT * FROM users WHERE id = :id`, { id });
}

export function setPassword(userId, password) {
  run(`UPDATE users SET password_hash = :p WHERE id = :u`, { u: userId, p: hashPassword(password) });
}

export function usersWithEmails() {
  return all(`SELECT id, name, email FROM users WHERE email IS NOT NULL`);
}
