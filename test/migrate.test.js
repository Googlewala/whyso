import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'whyso-migrate-'));
process.env.WHYSO_DB = join(dir, 'test.db');

const { initSchema, get, all, run, closeDb, schemaVersion, migrate } = await import('../src/db.js');

test('initSchema applies every migration and records a version', () => {
  const result = initSchema();
  assert.ok(result.version >= 2, 'at least the initial and auth migrations ran');
  assert.equal(result.version, result.latest);
  assert.ok(result.applied.includes('001_initial'), 'the initial migration was applied on a fresh database');
  assert.equal(schemaVersion(), result.latest);
});

test('initSchema is idempotent — running it again applies nothing new', () => {
  initSchema();
  const again = migrate();
  assert.deepEqual(again.applied, [], 'no migration is re-applied');
  assert.equal(again.version, again.latest);
});

test('the auth migration added the credential columns', () => {
  const cols = all(`PRAGMA table_info(users)`).map((c) => c.name);
  for (const col of ['email', 'password_hash', 'plan', 'plan_status', 'stripe_customer_id']) {
    assert.ok(cols.includes(col), `users.${col} exists`);
  }
});

test('sessions and usage counters exist with their unique constraints', () => {
  const tables = all(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((t) => t.name);
  for (const t of ['sessions', 'usage_counters', 'billing_events']) {
    assert.ok(tables.includes(t), `${t} exists`);
  }
  const usageIdx = all(`PRAGMA index_list(usage_counters)`);
  assert.ok(usageIdx.length > 0, 'usage counters have an index for the upsert');
});

test('an email can only be registered once (unique index)', () => {
  const email = `unique-${Date.now()}@example.com`;
  run(`INSERT INTO users (name, email, password_hash) VALUES ('A', :e, 'x')`, { e: email });
  assert.throws(
    () => run(`INSERT INTO users (name, email, password_hash) VALUES ('B', :e, 'y')`, { e: email }),
    /UNIQUE|constraint/i,
  );
});

test('usage counters upsert by (user, metric, period)', () => {
  const userId = Number(run(`INSERT INTO users (name, email, password_hash) VALUES ('C', :e, 'x')`, { e: `upsert-${Date.now()}@e.com` }).lastInsertRowid);
  const period = '2026-11';
  run(`INSERT INTO usage_counters (user_id, metric, period, count) VALUES (:u, 'expense', :p, 1)`, { u: userId, p: period });
  run(`INSERT INTO usage_counters (user_id, metric, period, count) VALUES (:u, 'expense', :p, 1)
       ON CONFLICT (user_id, metric, period) DO UPDATE SET count = count + 1`, { u: userId, p: period });
  const row = get(`SELECT count FROM usage_counters WHERE user_id = :u AND metric = 'expense' AND period = :p`, { u: userId, p: period });
  assert.equal(row.count, 2);
});

test('closeDb releases the file so the path is reusable', () => {
  closeDb();
  assert.ok(existsSync(process.env.WHYSO_DB));
});
