import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WHYSO_DB = join(mkdtempSync(join(tmpdir(), 'whyso-analytics-')), 'test.db');

const { analyse, recommendBudgets, payeeDirectory, summaryForPeriod } = await import('../src/analytics.js');
const { get, all } = await import('../src/db.js');
const { seedIfEmpty } = await import('../src/seed.js');

seedIfEmpty();

const userId = get(`SELECT id FROM users WHERE name = 'Aarav Mehta'`).id;
const round2 = (n) => Math.round(n * 100) / 100;

/* ---------------- totals ---------------- */

test('analyse reports totals that match the raw ledger', () => {
  const a = analyse({ userId });
  const raw = get(
    `SELECT
       COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END),0) AS spend,
       COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END),0) AS income
     FROM expenses WHERE user_id = :u AND status != 'failed'`,
    { u: userId },
  );
  assert.equal(a.totals.spend, round2(raw.spend));
  assert.equal(a.totals.income, round2(raw.income));
  assert.equal(a.totals.net, round2(raw.income - raw.spend));
  const rowCount = get(`SELECT COUNT(*) c FROM expenses WHERE user_id = :u AND status != 'failed'`, { u: userId }).c;
  assert.equal(a.totals.count, rowCount);
});

test('analyse average ticket equals spend divided by debit count', () => {
  const a = analyse({ userId });
  const debitCount = get(
    `SELECT COUNT(*) c FROM expenses WHERE user_id = :u AND direction='debit' AND status != 'failed'`,
    { u: userId },
  ).c;
  assert.equal(a.totals.avgTicket, round2(a.totals.spend / debitCount));
});

test('category percentages sum to roughly 100', () => {
  const a = analyse({ userId });
  const total = a.byCategory.reduce((s, c) => s + c.pct, 0);
  assert.ok(Math.abs(total - 100) < 1, `category pct summed to ${total}`);
});

test('byMonth is chronological and each month nets income against spend', () => {
  const a = analyse({ userId });
  for (let i = 1; i < a.byMonth.length; i++) {
    assert.ok(a.byMonth[i - 1].month < a.byMonth[i].month, 'months ascend');
  }
  for (const m of a.byMonth) assert.equal(m.net, round2(m.income - m.total));
});

test('a date range narrows the result', () => {
  const all0 = analyse({ userId });
  const narrowed = analyse({ userId, from: '2026-11-01', to: '2026-11-30' });
  assert.ok(narrowed.totals.spend <= all0.totals.spend);
  assert.ok(narrowed.byMonth.every((m) => m.month === '2026-11'));
});

test('group filtering returns only that group\'s expenses', () => {
  const gid = get(`SELECT id FROM groups WHERE name = 'Goa Trip 2026'`).id;
  const a = analyse({ userId, groupId: gid });
  assert.equal(a.range.groupId, gid);
  assert.ok(a.totals.spend > 0);
  assert.ok(a.totals.spend <= analyse({ userId }).totals.spend);
});

/* ---------------- insights ---------------- */

test('insights are well-formed and never contradict themselves', () => {
  const a = analyse({ userId });
  assert.ok(a.insights.length > 0);
  for (const i of a.insights) {
    assert.ok(['info', 'warn', 'danger'].includes(i.type), `bad type ${i.type}`);
    assert.ok(typeof i.title === 'string' && i.title.length > 0);
    assert.ok(typeof i.body === 'string' && i.body.length > 0);
  }
});

test('the weekend insight compares per-day averages, not raw totals', () => {
  const a = analyse({ userId });
  const weekend = a.insights.find((i) => /weekend/i.test(i.title));
  if (!weekend) return;
  const nums = [...weekend.body.matchAll(/₹([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  assert.equal(nums.length, 2, 'body quotes two figures');
  assert.ok(nums[0] > nums[1], 'a "weekends are expensive" claim must show a higher weekend figure');
});

/* ---------------- budgets ---------------- */

test('recommendBudgets derives a suggestion from recent complete months', () => {
  const recs = recommendBudgets(userId);
  assert.ok(Array.isArray(recs));
  for (const r of recs) {
    assert.ok(r.category);
    assert.ok(r.avgMonthly > 0);
    assert.ok(r.suggested >= r.avgMonthly, 'suggestion adds headroom over the average');
    assert.equal(r.suggested % 100, 0, 'suggestion is rounded to a clean hundred');
  }
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].avgMonthly >= recs[i].avgMonthly);
});

test('budget status flags the categories over their limit', () => {
  const a = analyse({ userId });
  const over = a.budgets.filter((b) => b.pct > 100);
  assert.ok(over.length > 0, 'the demo data has at least one blown budget');
  for (const b of over) assert.ok(b.spent > b.amount);
});

/* ---------------- forecast + anomalies ---------------- */

test('forecast projects the running month forward', () => {
  const a = analyse({ userId });
  if (!a.forecast) return;
  assert.ok(a.forecast.projected >= a.forecast.spent, 'projection is at least what has been spent');
  assert.equal(a.forecast.month, new Date().toISOString().slice(0, 7));
  assert.equal(a.forecast.remainingDays, a.forecast.daysInMonth - a.forecast.day);
});

test('every anomaly is genuinely large for its category', () => {
  const a = analyse({ userId });
  for (const x of a.anomalies) {
    assert.ok(x.amount > x.median * 2, `${x.merchant} should exceed twice the median`);
    assert.match(x.message, /× your usual/);
  }
});

/* ---------------- payees + summary ---------------- */

test('payeeDirectory ranks payees by frequency and keeps UPI handles', () => {
  const payees = payeeDirectory(userId);
  assert.ok(payees.length > 0);
  for (let i = 1; i < payees.length; i++) assert.ok(payees[i - 1].times >= payees[i].times, 'descending by frequency');
  assert.ok(payees.every((p) => p.vpa), 'every grouped payee carries a VPA');
});

test('summaryForPeriod agrees with analyse for the same window', () => {
  const from = '2026-09-01';
  const to = '2026-11-30';
  const s = summaryForPeriod(userId, from, to);
  const a = analyse({ userId, from, to });
  assert.equal(s.spend, a.totals.spend);
  assert.equal(s.income, a.totals.income);
});
