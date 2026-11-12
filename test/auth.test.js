import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WHYSO_DB = join(mkdtempSync(join(tmpdir(), 'whyso-auth-')), 'test.db');
process.env.WHYSO_DEMO = '1';

const auth = await import('../src/auth.js');
const { initSchema } = await import('../src/db.js');
const { seedIfEmpty } = await import('../src/seed.js');

before(() => {
  initSchema();
  seedIfEmpty();
});

/* ---------------- password hashing ---------------- */

test('hashPassword produces a salted scrypt hash that verifies', () => {
  const hash = auth.hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$/);
  assert.equal(auth.verifyPassword('correct horse battery', hash), true);
  assert.equal(auth.verifyPassword('wrong password', hash), false);
});

test('two hashes of the same password differ (unique salt)', () => {
  const a = auth.hashPassword('same-password');
  const b = auth.hashPassword('same-password');
  assert.notEqual(a, b);
  assert.equal(auth.verifyPassword('same-password', a), true);
  assert.equal(auth.verifyPassword('same-password', b), true);
});

test('verifyPassword rejects malformed stored hashes instead of throwing', () => {
  assert.equal(auth.verifyPassword('x', 'not-a-hash'), false);
  assert.equal(auth.verifyPassword('x', ''), false);
});

/* ---------------- validation ---------------- */

test('validateSignup flags a missing name, bad email and short password', () => {
  const { errors } = auth.validateSignup({ name: '', email: 'nope', password: '123' });
  assert.ok(errors.name);
  assert.ok(errors.email);
  assert.ok(errors.password);
});

test('validateSignup accepts a valid payload', () => {
  const { ok, errors } = auth.validateSignup({ name: 'Asha Rao', email: '  Asha@Example.COM ', password: 'longenough1' });
  assert.equal(ok, true);
  assert.deepEqual(errors, {});
});

test('validateSignup rejects a malformed UPI ID', () => {
  const { errors } = auth.validateSignup({ name: 'Asha', email: 'a@b.com', password: 'longenough', vpa: 'not-a-vpa' });
  assert.ok(errors.vpa);
});

/* ---------------- user creation ---------------- */

test('createUser stores a hashed password and a default bank account', () => {
  const email = `u-${Date.now()}@example.com`;
  const user = auth.createUser({ name: 'Test Person', email, password: 'passw0rd1', vpa: `tp${Date.now()}@ybl` });
  assert.ok(user.id);
  assert.equal(user.email, email);
  assert.ok(user.password_hash, 'the row stores a hash');
  assert.notEqual(user.password_hash, 'passw0rd1', 'the raw password is never stored');
  assert.equal(auth.verifyPassword('passw0rd1', user.password_hash), true);

  const publicShape = auth.publicUser(user);
  assert.equal(publicShape.password_hash, undefined, 'the public shape never leaks the hash');
  assert.equal(publicShape.email, email);
});

test('createUser rejects a duplicate email', () => {
  const email = `dup-${Date.now()}@example.com`;
  auth.createUser({ name: 'First', email, password: 'passw0rd1' });
  assert.throws(() => auth.createUser({ name: 'Second', email, password: 'passw0rd1' }), /already/i);
});

/* ---------------- sessions ---------------- */

test('a session token resolves back to its user and revokes cleanly', () => {
  const email = `sess-${Date.now()}@example.com`;
  const user = auth.createUser({ name: 'Session User', email, password: 'passw0rd1' });
  const { token } = auth.createSession(user.id, { userAgent: 'test', ip: '127.0.0.1' });

  const resolved = auth.sessionFromToken(token);
  assert.ok(resolved, 'the token resolves');
  assert.equal(resolved.id, user.id);

  assert.equal(auth.sessionFromToken('not-a-real-token'), null);

  auth.revokeSession(token);
  assert.equal(auth.sessionFromToken(token), null, 'the token is dead after revoke');
});

test('revokeAllSessions signs every device out', () => {
  const email = `multi-${Date.now()}@example.com`;
  const user = auth.createUser({ name: 'Multi Device', email, password: 'passw0rd1' });
  const a = auth.createSession(user.id);
  const b = auth.createSession(user.id);
  assert.ok(auth.sessionFromToken(a.token));
  assert.ok(auth.sessionFromToken(b.token));
  auth.revokeAllSessions(user.id);
  assert.equal(auth.sessionFromToken(a.token), null);
  assert.equal(auth.sessionFromToken(b.token), null);
});

test('purgeExpiredSessions leaves live sessions alone', () => {
  const email = `purge-${Date.now()}@example.com`;
  const user = auth.createUser({ name: 'Purge User', email, password: 'passw0rd1' });
  const { token } = auth.createSession(user.id);
  auth.purgeExpiredSessions();
  assert.ok(auth.sessionFromToken(token), 'a fresh session survives the purge');
});

/* ---------------- demo backfill ---------------- */

test('the demo accounts can sign in with their seeded credentials', () => {
  const found = auth.findUserByEmail('aarav@whyso.dev');
  assert.ok(found, 'the primary demo user exists');
  assert.equal(auth.verifyPassword('demo1234', found.password_hash), true);
});
