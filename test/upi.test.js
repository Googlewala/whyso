import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidVpa, vpaPsp, parseAmount, parseQrText, buildUpiUri, makeTxnRef,
  parseBankSms, splitSmsBlob, parseBankCsv, categoryFromMcc, merchantFromNarration, parseTlv,
} from '../src/upi.js';

/* ---------------- VPA validation ---------------- */

test('isValidVpa accepts well-formed handles and rejects junk', () => {
  assert.equal(isValidVpa('aarav.mehta@okhdfcbank'), true);
  assert.equal(isValidVpa('blinkit@ybl'), true);
  assert.equal(isValidVpa('user-name_1@paytm'), true);
  assert.equal(isValidVpa('no-at-sign'), false);
  assert.equal(isValidVpa('@ybl'), false);
  assert.equal(isValidVpa('name@'), false);
  assert.equal(isValidVpa('name@1bad'), false);
  assert.equal(isValidVpa(''), false);
  assert.equal(isValidVpa(null), false);
});

test('vpaPsp resolves the PSP handle', () => {
  assert.equal(vpaPsp('someone@okhdfcbank'), 'okhdfcbank');
  assert.equal(vpaPsp('someone@ybl'), 'ybl');
  assert.equal(vpaPsp('nonsense'), null);
});

/* ---------------- amount parsing ---------------- */

test('parseAmount normalises the shapes banks actually emit', () => {
  assert.equal(parseAmount('1200'), 1200);
  assert.equal(parseAmount('1,200.50'), 1200.5);
  assert.equal(parseAmount('₹1,200.5'), 1200.5);
  assert.equal(parseAmount('INR 1200'), 1200);
  assert.equal(parseAmount('Rs. 499.00'), 499);
  assert.equal(parseAmount('  0.99  '), 0.99);
  assert.equal(parseAmount(1200.456), 1200.46);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount(null), null);
});

/* ---------------- UPI deep links ---------------- */

test('parseQrText decodes a upi://pay deep link', () => {
  const r = parseQrText('upi://pay?pa=blinkit@ybl&pn=Blinkit&am=1450&cu=INR&tn=Groceries&mc=5411&mode=02');
  assert.equal(r.kind, 'upi');
  assert.equal(r.vpa, 'blinkit@ybl');
  assert.equal(r.name, 'Blinkit');
  assert.equal(r.amount, 1450);
  assert.equal(r.currency, 'INR');
  assert.equal(r.note, 'Groceries');
  assert.equal(r.mcc, '5411');
  assert.equal(r.psp, 'ybl');
});

test('parseQrText is case-insensitive about parameter names', () => {
  const r = parseQrText('upi://pay?PA=someone@okaxis&PN=Someone&AM=99.5');
  assert.equal(r.vpa, 'someone@okaxis');
  assert.equal(r.amount, 99.5);
});

test('parseQrText handles a static QR with no amount', () => {
  const r = parseQrText('upi://pay?pa=shop@paytm&pn=Corner%20Shop');
  assert.equal(r.kind, 'upi');
  assert.equal(r.amount, null);
  assert.ok(r.warnings.some((w) => /no amount|static/i.test(w)));
});

test('parseQrText flags an unknown UPI intent but still parses', () => {
  const r = parseQrText('upi://collect?pa=someone@ybl');
  assert.equal(r.vpa, 'someone@ybl');
  assert.ok(r.warnings.some((w) => /unrecognised/i.test(w)));
});

test('parseQrText extracts UPI details hidden in an https link', () => {
  const r = parseQrText('https://example.com/pay?pa=someone@ybl&am=10');
  assert.equal(r.vpa, 'someone@ybl');
  assert.ok(r.warnings.some((w) => /https link/i.test(w)));
});

test('parseQrText classifies a plain URL and a bare VPA', () => {
  assert.equal(parseQrText('https://example.com').kind, 'url');
  const vpa = parseQrText('someone@okicici');
  assert.equal(vpa.kind, 'upi');
  assert.equal(vpa.vpa, 'someone@okicici');
});

test('parseQrText reports an empty payload', () => {
  assert.equal(parseQrText('').kind, 'empty');
  assert.equal(parseQrText('   ').kind, 'empty');
});

/* ---------------- EMVCo / Bharat QR TLV ---------------- */

test('parseTlv walks nested tag-length-value structures', () => {
  // 26 -> nested: 00 = "com.upi", 01 = vpa, 02 = name
  const inner = '0007com.upi' + '0105a@ybl' + '0208Cafe Co ';
  const tlv = `26${String(inner.length).padStart(2, '0')}${inner}`;
  const out = parseTlv(tlv);
  assert.equal(out['26']['00'], 'com.upi');
  assert.equal(out['26']['01'], 'a@ybl');
  assert.equal(out['26']['02'], 'Cafe Co ');
});

test('isValidVpa requires a handle of at least two characters', () => {
  assert.equal(isValidVpa('a@ybl'), false);
  assert.equal(isValidVpa('aa@ybl'), true);
});

test('parseQrText decodes an EMVCo/Bharat QR merchant payload', () => {
  const acct = '00' + '07' + 'com.upi' + '01' + '10' + 'cafe@ybl  ' + '02' + '09' + 'Cafe Co  ';
  const tag26 = '26' + String(acct.length).padStart(2, '0') + acct;
  const tag53 = '5303' + '356';
  const payload = tag26 + tag53;
  const r = parseQrText(payload);
  assert.equal(r.kind, 'upi');
  assert.equal(r.vpa, 'cafe@ybl');
  assert.equal(r.currency, 'INR');
  assert.ok(r.warnings.some((w) => /EMVCo|Bharat/i.test(w)));
});

test('categoryFromMcc maps common merchant category codes', () => {
  assert.equal(categoryFromMcc('5814'), 'Dining');
  assert.equal(categoryFromMcc('5411'), 'Groceries');
  assert.equal(categoryFromMcc('4111'), 'Transport');
  assert.equal(categoryFromMcc('9999'), null);
});

/* ---------------- URI generation ---------------- */

test('buildUpiUri round-trips through parseQrText', () => {
  const uri = buildUpiUri({ vpa: 'someone@okaxis', name: 'Some One', amount: 249.5, note: 'Lunch', ref: 'WYS123', mcc: '5814' });
  const r = parseQrText(uri);
  assert.equal(r.vpa, 'someone@okaxis');
  assert.equal(r.amount, 249.5);
  assert.equal(r.note, 'Lunch');
  assert.equal(r.ref, 'WYS123');
  assert.equal(r.mode, 'dynamic');
});

test('buildUpiUri rejects an invalid VPA and a non-positive amount', () => {
  assert.throws(() => buildUpiUri({ vpa: 'not-a-vpa', amount: 10 }), /Invalid VPA/);
  assert.throws(() => buildUpiUri({ vpa: 'shop@ybl', amount: 0 }), /greater than zero/);
  assert.throws(() => buildUpiUri({ vpa: 'shop@ybl', amount: -5 }), /greater than zero/);
});

test('buildUpiUri marks a static code as mode 01 when no amount is given', () => {
  const uri = buildUpiUri({ vpa: 'shop@ybl' });
  assert.ok(uri.includes('mode=01'));
  assert.ok(!uri.includes('am='));
});

test('makeTxnRef produces a bounded, unique-ish reference', () => {
  const a = makeTxnRef('STL');
  const b = makeTxnRef('STL');
  assert.ok(a.startsWith('STL'));
  assert.ok(a.length <= 20);
  assert.notEqual(a, b);
});

/* ---------------- bank SMS ---------------- */

test('parseBankSms reads a UPI debit alert', () => {
  const d = parseBankSms('Rs.1450.00 debited from A/c XX1234 to VPA blinkit@ybl (Blinkit) on 10-11-26. UPI Ref 416782345612.');
  assert.equal(d.direction, 'debit');
  assert.equal(d.amount, 1450);
  assert.equal(d.vpa, 'blinkit@ybl');
  assert.equal(d.merchant, 'Blinkit');
  assert.equal(d.ref, '416782345612');
  assert.equal(d.occurredAt.slice(0, 10), '2026-11-10');
});

test('parseBankSms reads a card spend alert with no VPA', () => {
  const d = parseBankSms('INR 3,299.00 spent on your ICICI Bank Card ending 4321 at AMAZON on 07-Nov-2026. Ref 998877665544.');
  assert.equal(d.direction, 'debit');
  assert.equal(d.amount, 3299);
  assert.equal(d.vpa, null);
  assert.equal(d.merchant, 'Amazon');
});

test('parseBankSms reads a credit alert', () => {
  const d = parseBankSms('Rs 25,000.00 has been credited to A/c XX1234 from VPA employer.payroll@hdfcbank on 01-11-2026.');
  assert.equal(d.direction, 'credit');
  assert.equal(d.amount, 25000);
  assert.equal(d.vpa, 'employer.payroll@hdfcbank');
});

test('parseBankSms does not invent an amount for unrelated text', () => {
  const d = parseBankSms('Your OTP is 123456. Do not share it with anyone.');
  assert.equal(d.amount, null);
  assert.ok(d.warnings.length > 0);
});

test('splitSmsBlob separates concatenated messages', () => {
  const blob = 'Rs 10 debited to a@ybl.\nRs 20 debited to b@ybl.\n\nRs 30 debited to c@ybl.';
  const parts = splitSmsBlob(blob);
  assert.equal(parts.length, 3);
});

/* ---------------- CSV ---------------- */

test('parseBankCsv auto-detects columns and both directions', () => {
  const csv = [
    'Date,Narration,Debit,Credit,Balance',
    '01/11/2026,UPI/DR/416782345612/blinkit@ybl/Blinkit,1450.00,,48250.00',
    '05/11/2026,SALARY CREDIT EMPLOYER,,25000.00,70910.00',
  ].join('\n');
  const { rows, warnings } = parseBankCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(warnings.length, 0);
  assert.equal(rows[0].direction, 'debit');
  assert.equal(rows[0].amount, 1450);
  assert.equal(rows[0].vpa, 'blinkit@ybl');
  assert.equal(rows[1].direction, 'credit');
  assert.equal(rows[1].amount, 25000);
});

test('parseBankCsv tolerates quoted fields containing commas', () => {
  const csv = [
    'Date,Description,Amount',
    '2026-11-02,"Swiggy, order 123",640.00',
  ].join('\n');
  const { rows } = parseBankCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 640);
  assert.match(rows[0].merchant, /Swiggy/);
});

test('parseBankCsv warns when it cannot find an amount column', () => {
  const { warnings } = parseBankCsv('Foo,Bar\n1,2');
  assert.ok(warnings.length > 0);
});

/* ---------------- merchant extraction ---------------- */

test('merchantFromNarration strips transaction codes and noise', () => {
  assert.equal(merchantFromNarration('UPI/DR/416782345612/blinkit@ybl/Blinkit', 'blinkit@ybl'), 'Blinkit');
  assert.match(merchantFromNarration('POS 123456 TATA POWER DELHI'), /Tata Power/);
});

test('merchantFromNarration falls back to the VPA handle', () => {
  const m = merchantFromNarration('UPI/DR/416782345612', 'chai.theory@okaxis');
  assert.match(m, /Chai Theory/i);
});
