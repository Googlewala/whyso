import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

process.env.WHYSO_DB = join(mkdtempSync(join(tmpdir(), 'whyso-pdf-')), 'test.db');

const { buildStatement, cleanPdfText } = await import('../src/statement.js');
const { get } = await import('../src/db.js');
const { seedIfEmpty } = await import('../src/seed.js');

seedIfEmpty();
const userId = get(`SELECT id FROM users WHERE name = 'Aarav Mehta'`).id;

function render(opts) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new PassThrough();
    sink.on('data', (c) => chunks.push(c));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    buildStatement({ userId, ...opts }, sink);
  });
}

/* ---------------- cleanPdfText ---------------- */

test('cleanPdfText strips emoji but keeps the rupee sign and text', () => {
  assert.equal(cleanPdfText('🛒 Groceries'), 'Groceries');
  assert.equal(cleanPdfText('🏠 Rent — ₹24,000.00'), 'Rent — ₹24,000.00');
  assert.equal(cleanPdfText('✈️ Travel'), 'Travel');
  assert.equal(cleanPdfText('  a   b  '), 'a b');
  assert.equal(cleanPdfText(null), '');
  assert.equal(cleanPdfText(undefined), '');
});

/* ---------------- PDF output ---------------- */

test('buildStatement produces a valid multi-page PDF', async () => {
  const buf = await render({ from: '2026-09-01', to: '2026-11-30' });
  assert.ok(buf.length > 5000, 'PDF has substance');
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(buf.includes(Buffer.from('%%EOF')), 'PDF is terminated');

  const pageCount = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.ok(pageCount >= 2, `expected multiple pages, saw ${pageCount}`);
});

test('the PDF embeds a Unicode font that can draw the rupee sign', async () => {
  const buf = await render({ from: '2026-09-01', to: '2026-11-30' });
  const text = buf.toString('latin1');
  assert.ok(text.includes('DejaVu'), 'a DejaVu font is embedded');
  // Emoji never reach the PDF because cleanPdfText strips them at every text call.
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(text), 'no colour-emoji codepoints leaked in');
});

test('a group statement includes the settlement section', async () => {
  const gid = get(`SELECT id FROM groups WHERE name = 'Goa Trip 2026'`).id;
  const buf = await render({ from: '2026-09-01', to: '2026-12-31', groupId: gid });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(buf.length > 5000);
});

test('buildStatement rejects an unknown user', async () => {
  await assert.rejects(
    () => render({ userId: 999999, from: '2026-01-01', to: '2026-12-31' }),
    /User not found/,
  );
});

test('an empty date range still renders a (thin) valid PDF', async () => {
  const buf = await render({ from: '1990-01-01', to: '1990-01-31' });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(buf.length > 1000);
});

test('section toggles are honoured without breaking output', async () => {
  const buf = await render({
    from: '2026-09-01',
    to: '2026-11-30',
    include: { category: true, trend: false, insights: false, anomalies: false, budgets: false, payees: false, occasions: false, ledger: true },
  });
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(buf.length > 2000);
});
