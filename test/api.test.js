import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WHYSO_DB = join(mkdtempSync(join(tmpdir(), 'whyso-api-')), 'test.db');

const { default: app } = await import('../src/server.js');

let base;
let server;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const get = async (path) => {
  const r = await fetch(base + path);
  return { status: r.status, body: await r.json() };
};
const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const round2 = (n) => Math.round(n * 100) / 100;

/* ---------------- read endpoints ---------------- */

test('GET /health is alive', async () => {
  const { status, body } = await get('/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, 'whyso');
});

test('GET /api/bootstrap returns the app shell data', async () => {
  const { status, body } = await get('/api/bootstrap');
  assert.equal(status, 200);
  assert.ok(body.user && body.user.id);
  assert.equal(body.users.length, 5);
  assert.ok(body.categories.length >= 10);
  assert.ok(Array.isArray(body.groups));
  assert.ok(Array.isArray(body.occasions));
});

test('GET /api/expenses lists expenses with joins resolved', async () => {
  const { status, body } = await get('/api/expenses?limit=5');
  assert.equal(status, 200);
  assert.ok(body.rows.length > 0);
  assert.ok(body.rows.length <= 5);
  const e = body.rows[0];
  assert.ok(e.amount > 0);
  assert.ok(typeof e.merchant === 'string');
  assert.ok(body.total >= body.rows.length);
});

test('GET /api/expenses filters by direction', async () => {
  const { body } = await get('/api/expenses?direction=credit');
  assert.ok(body.rows.length > 0);
  assert.ok(body.rows.every((e) => e.direction === 'credit'));
});

test('GET /api/analytics/summary returns totals and insights', async () => {
  const { status, body } = await get('/api/analytics/summary');
  assert.equal(status, 200);
  assert.ok(body.totals.spend > 0);
  assert.ok(body.insights.length > 0);
  assert.ok(Array.isArray(body.byCategory));
});

test('unknown API routes 404 as JSON', async () => {
  const { status, body } = await get('/api/does-not-exist');
  assert.equal(status, 404);
  assert.ok(body.error);
});

/* ---------------- QR endpoints ---------------- */

test('GET /qr.png renders a real PNG for a payee', async () => {
  const r = await fetch(`${base}/qr.png?vpa=chai.point@ybl&name=Chai%20Point&amount=120`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG');
  assert.ok(buf.length > 200);
});

test('GET /qr.png rejects an invalid VPA with 400', async () => {
  const r = await fetch(`${base}/qr.png?vpa=not-a-vpa`);
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /Invalid VPA/);
});

test('POST /api/upi/parse decodes a UPI deep link and records a scan', async () => {
  const { status, body } = await post('/api/upi/parse', { text: 'upi://pay?pa=cafe@ybl&pn=Cafe&am=250&cu=INR' });
  assert.equal(status, 200);
  assert.ok(body.scan_id);
  assert.equal(body.parsed.vpa, 'cafe@ybl');
  assert.equal(body.parsed.amount, 250);
});

test('POST /api/upi/link builds a deep link and reports the PSP', async () => {
  const { status, body } = await post('/api/upi/link', { vpa: 'someone@okhdfcbank', name: 'Someone', amount: 99 });
  assert.equal(status, 200);
  assert.ok(body.uri.startsWith('upi://pay?'));
  assert.equal(body.psp, 'okhdfcbank');
});

test('POST /api/upi/link rejects a bad VPA', async () => {
  const { status, body } = await post('/api/upi/link', { vpa: 'nope' });
  assert.equal(status, 400);
  assert.ok(body.error);
});

/* ---------------- write endpoints ---------------- */

test('POST /api/expenses creates an expense with an auto category', async () => {
  const { status, body } = await post('/api/expenses', {
    amount: 1299.5, merchant: 'BigBasket', vpa: 'bigbasket@ybl', direction: 'debit', method: 'upi',
  });
  assert.equal(status, 201);
  assert.ok(body.expense.id);
  assert.equal(body.expense.category, 'Groceries', 'merchant keyword drives the category');
  const { body: list } = await get('/api/expenses?q=BigBasket');
  assert.ok(list.rows.some((e) => e.id === body.expense.id));
});

test('POST /api/expenses rejects a missing amount', async () => {
  const { status, body } = await post('/api/expenses', { merchant: 'NoAmount' });
  assert.equal(status, 400);
  assert.ok(body.error);
});

test('POST /api/expenses splits into a group and reconciles shares', async () => {
  const { body: boot } = await get('/api/bootstrap');
  const gid = boot.groups[0].id;
  const { status, body } = await post('/api/expenses', {
    amount: 4000, merchant: 'Beach Shack', direction: 'debit', group_id: gid,
  });
  assert.equal(status, 201);
  const { body: group } = await get(`/api/groups/${gid}`);
  const created = group.expenses.find((e) => e.id === body.expense.id);
  assert.ok(created, 'the expense appears in the group ledger');
  assert.equal(round2(created.shares.reduce((s, x) => s + x.share, 0)), 4000);
});

test('POST /api/expenses rejects an unbalanced exact split', async () => {
  const { body: boot } = await get('/api/bootstrap');
  const gid = boot.groups[0].id;
  const { body: group } = await get(`/api/groups/${gid}`);
  const [m1, m2] = group.members;
  const { status, body } = await post('/api/expenses', {
    amount: 4000, merchant: 'Unbalanced', direction: 'debit', group_id: gid,
    split_mode: 'exact',
    participants: [{ user_id: m1.id, value: 1000 }, { user_id: m2.id, value: 1000 }],
  });
  assert.equal(status, 400);
  assert.match(body.error, /add up to/i);
});

test('POST /api/groups creates a group with members', async () => {
  const { body: boot } = await get('/api/bootstrap');
  const { status, body } = await post('/api/groups', {
    name: 'Test Crew', emoji: '🧪', member_ids: boot.users.slice(0, 3).map((u) => u.id),
  });
  assert.equal(status, 201);
  const gid = body.group.id;
  const { body: group } = await get(`/api/groups/${gid}`);
  assert.equal(group.group.name, 'Test Crew');
  assert.equal(group.members.length, 3);
});

test('POST /api/groups/:id/settle records a payment and emits a UPI pay link', async () => {
  const { body: boot } = await get('/api/bootstrap');
  // Find a group that actually has an outstanding debtor and creditor.
  let gid = null;
  let group = null;
  for (const g of boot.groups) {
    const { body: detail } = await get(`/api/groups/${g.id}`);
    if (detail.balances.some((b) => b.net < -0.01) && detail.balances.some((b) => b.net > 0.01)) {
      gid = g.id;
      group = detail;
      break;
    }
  }
  assert.ok(gid, 'the demo data has at least one unsettled group');
  const from = group.balances.find((b) => b.net < 0);
  const to = group.balances.find((b) => b.net > 0);
  const { status, body } = await post(`/api/groups/${gid}/settle`, {
    from_user: from.user_id, to_user: to.user_id, amount: 500,
  });
  assert.equal(status, 201);
  assert.ok(body.pay_link.startsWith('upi://pay?'));
  assert.ok(body.pay_link.includes('am=500.00'));
  assert.equal(round2(body.ledger.balances.reduce((s, b) => s + b.net, 0)), 0, 'the ledger still nets to zero');
});

/* ---------------- import ---------------- */

test('POST /api/import/sms previews drafts without committing', async () => {
  const { status, body } = await post('/api/import/sms', {
    messages: 'Rs.899.00 debited from A/c XX1234 to VPA spotify@axisbank (Spotify) on 10-11-26. UPI Ref 123456789012.',
  });
  assert.equal(status, 200);
  assert.equal(body.drafts.length, 1);
  assert.equal(body.committed, 0);
  assert.equal(body.drafts[0].amount, 899);
});

test('POST /api/import/csv previews drafts from a statement', async () => {
  const csv = 'Date,Narration,Debit,Credit,Balance\n01/11/2026,UPI/DR/111/blinkit@ybl/Blinkit,1450.00,,48250.00';
  const { status, body } = await post('/api/import/csv', { csv });
  assert.equal(status, 200);
  assert.equal(body.drafts.length, 1);
  assert.equal(body.drafts[0].amount, 1450);
});

test('POST /api/import/sms with commit persists the drafts', async () => {
  const preview = await post('/api/import/sms', {
    messages: 'Rs.555.00 debited from A/c XX1234 to VPA uniquetest@ybl (Unique Test Merchant) on 09-11-26.',
  });
  const drafts = preview.body.drafts.map((d) => ({ ...d, include: true }));
  const { status, body } = await post('/api/import/sms', { drafts, commit: true });
  assert.equal(status, 200);
  assert.ok(body.committed >= 1);
  const { body: list } = await get('/api/expenses?q=Unique%20Test');
  assert.ok(list.rows.length >= 1);
});

test('a duplicate UPI reference is skipped on re-import', async () => {
  const message = 'Rs.777.00 debited from A/c XX1234 to VPA dupref@ybl (Dup Ref) on 08-11-26. UPI Ref 999888777666.';
  const first = await post('/api/import/sms', { messages: message, commit: true });
  assert.equal(first.body.committed, 1);
  const second = await post('/api/import/sms', { messages: message, commit: true });
  assert.equal(second.body.committed, 0, 'the same UPI ref must not be imported twice');
});

/* ---------------- statement ---------------- */

test('GET /api/statement.pdf streams a PDF', async () => {
  const r = await fetch(`${base}/api/statement.pdf?from=2026-09-01&to=2026-11-30`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/pdf/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

/* ---------------- static assets ---------------- */

test('the SPA shell is served at the root', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Whyso/);
});
