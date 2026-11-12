import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test file gets its own throwaway database, seeded with the demo dataset.
process.env.WHYSO_DB = join(mkdtempSync(join(tmpdir(), 'whyso-test-')), 'test.db');

const { computeShares, groupBalances, simplifyDebts, groupLedger } = await import('../src/split.js');
const { run, get, all } = await import('../src/db.js');
const { seedIfEmpty } = await import('../src/seed.js');

seedIfEmpty();

const round2 = (n) => Math.round(n * 100) / 100;

/* ---------------- computeShares ---------------- */

test('equal split divides the amount and preserves the total', () => {
  const shares = computeShares(1000, [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }], 'equal');
  assert.equal(shares.length, 3);
  assert.equal(round2(shares.reduce((s, x) => s + x.share, 0)), 1000);
  assert.equal(shares[0].share, 333.33);
  assert.equal(shares[2].share, 333.34, 'rounding remainder lands on the last participant');
});

test('equal split of an indivisible amount still sums exactly', () => {
  const shares = computeShares(100, [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }], 'equal');
  assert.equal(round2(shares.reduce((s, x) => s + x.share, 0)), 100);
});

test('shares mode splits proportionally to weights', () => {
  const shares = computeShares(900, [
    { user_id: 1, value: 2 },
    { user_id: 2, value: 1 },
  ], 'shares');
  assert.equal(shares[0].share, 600);
  assert.equal(shares[1].share, 300);
});

test('percent mode splits by percentage', () => {
  const shares = computeShares(500, [
    { user_id: 1, value: 70 },
    { user_id: 2, value: 30 },
  ], 'percent');
  assert.equal(shares[0].share, 350);
  assert.equal(shares[1].share, 150);
});

test('exact mode accepts a balanced split and rejects an unbalanced one', () => {
  const ok = computeShares(4000, [
    { user_id: 1, value: 1000 },
    { user_id: 2, value: 1000 },
    { user_id: 3, value: 2000 },
  ], 'exact');
  assert.deepEqual(ok.map((s) => s.share), [1000, 1000, 2000]);

  assert.throws(
    () => computeShares(4000, [{ user_id: 1, value: 1000 }, { user_id: 2, value: 1000 }], 'exact'),
    /must add up to/,
  );
});

test('computeShares rejects empty participants and zero weights', () => {
  assert.throws(() => computeShares(100, [], 'equal'), /At least one participant/);
  assert.throws(() => computeShares(100, [{ user_id: 1, value: 0 }], 'shares'), /more than zero/);
});

/* ---------------- balances ---------------- */

test('group balances net to zero and settlements are honoured', () => {
  const gid = get(`SELECT id FROM groups WHERE name = 'Goa Trip 2026'`).id;
  const before = groupBalances(gid);
  assert.equal(round2(before.reduce((s, b) => s + b.net, 0)), 0);

  // A settlement between two members must not change the group total.
  const from = before.find((b) => b.net < -0.01);
  const to = before.find((b) => b.net > 0.01);
  run(
    `INSERT INTO settlements (group_id, from_user, to_user, amount, note) VALUES (:g, :f, :t, :a, :n)`,
    { g: gid, f: from.user_id, t: to.user_id, a: 100, n: 'test transfer' },
  );
  const after = groupBalances(gid);
  assert.equal(round2(after.reduce((s, b) => s + b.net, 0)), 0);
  const moved = after.find((b) => b.user_id === from.user_id);
  assert.equal(round2(moved.settled), round2(from.settled - 100));
});

/* ---------------- simplifyDebts ---------------- */

test('simplifyDebts clears every balance and uses at most n-1 transfers', () => {
  const gid = get(`SELECT id FROM groups WHERE name = 'Flat 402 — Rent & Bills'`).id;
  const balances = groupBalances(gid);
  const transfers = simplifyDebts(balances);

  assert.ok(transfers.length <= balances.length - 1, 'never needs more than n-1 transfers');

  // Applying the transfers must zero out every balance.
  const net = new Map(balances.map((b) => [b.user_id, b.net]));
  for (const t of transfers) {
    net.set(t.from.user_id, round2(net.get(t.from.user_id) + t.amount));
    net.set(t.to.user_id, round2(net.get(t.to.user_id) - t.amount));
  }
  for (const [, v] of net) assert.ok(Math.abs(v) < 0.01, `balance ${v} should be ~0`);
});

test('simplifyDebts returns nothing when everyone is settled', () => {
  assert.deepEqual(simplifyDebts([{ user_id: 1, net: 0 }, { user_id: 2, net: 0 }]), []);
});

/* ---------------- ledger ---------------- */

test('groupLedger exposes the group, members and transfers with a balanced total', () => {
  const gid = get(`SELECT id FROM groups WHERE name = 'Goa Trip 2026'`).id;
  const ledger = groupLedger(gid);
  assert.ok(ledger);
  assert.equal(ledger.group.id, gid);
  assert.equal(ledger.members.length, 4);
  assert.equal(round2(ledger.balances.reduce((s, b) => s + b.net, 0)), 0);
  assert.ok(Array.isArray(ledger.transfers));
  assert.ok(ledger.total_spend > 0);
});

test('group expense shares always reconcile to the expense amount', () => {
  const gid = get(`SELECT id FROM groups WHERE name = 'Goa Trip 2026'`).id;
  const expenses = all(`SELECT id, amount FROM expenses WHERE group_id = :g`, { g: gid });
  assert.ok(expenses.length > 0);
  for (const e of expenses) {
    const shares = all(`SELECT user_id, share FROM group_expense_shares WHERE expense_id = :e`, { e: e.id });
    assert.ok(shares.length > 0, `expense ${e.id} has shares`);
    assert.equal(round2(shares.reduce((s, x) => s + x.share, 0)), round2(e.amount));
  }
});

test('groupLedger returns null for a missing group', () => {
  assert.equal(groupLedger(999999), null);
});

/* ---------------- schema sanity ---------------- */

test('the seed produces the expected shape of data', () => {
  assert.equal(all(`SELECT id FROM users`).length, 5);
  assert.ok(all(`SELECT id FROM expenses`).length >= 40);
  assert.ok(all(`SELECT id FROM group_expense_shares`).length > 0);
  assert.ok(all(`SELECT id FROM budgets`).length > 0);
  assert.ok(all(`SELECT id FROM occasions`).length > 0);
});
