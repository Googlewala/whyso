/**
 * UPI parsing and generation.
 *
 * Reference formats implemented here:
 *  - NPCI UPI deep link / QR payload:  upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>&tr=<ref>&mc=<mcc>&mode=<01|02>
 *  - EMVCo / Bharat QR TLV:  tag 26-51 holds merchant account info; the UPI GUIDs are
 *    "in.gov.upi" / "com.upi" with nested sub-tags 00=VPA, 01=merchant name, 02=MCC, 03=currency.
 *  - UPI VPA shape: <handle>@<psp> where handle is alphanumeric with . - _
 */

const PSP_HANDLES = [
  'okhdfcbank', 'okicici', 'oksbi', 'okaxis', 'ybl', 'ibl', 'axl', 'paytm',
  'apl', 'upi', 'sbi', 'hdfcbank', 'icici', 'axisbank', 'kotak', 'pnb',
  'barodampay', 'idfcbank', 'indus', 'federal', 'rbl', 'yesbank', 'airtel',
  'jio', 'freecharge', 'slice', 'naviaxis', 'timecosmos', 'waaxis', 'wahdfcbank',
];

const VPA_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{1,60})@[a-zA-Z][a-zA-Z0-9]{1,30}$/;

export function isValidVpa(vpa) {
  return typeof vpa === 'string' && VPA_RE.test(vpa.trim());
}

export function vpaPsp(vpa) {
  if (!isValidVpa(vpa)) return null;
  const handle = vpa.trim().split('@')[1].toLowerCase();
  const known = PSP_HANDLES.find((h) => handle.startsWith(h) || h.startsWith(handle));
  return known || handle;
}

/** Normalise an amount that may arrive as "1200", "1,200.50", "₹1,200.5", "INR 1200". */
export function parseAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const cleaned = String(value)
    .replace(/[₹$€£]/g, '')
    .replace(/\b(inr|rs|rupees?)\b\.?/gi, '')
    .replace(/,/g, '')
    .replace(/[^\d.\-]/g, '')
    .trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Bank narrations shout in caps; "AMAZON" should read as "Amazon". */
export function titleCaseMerchant(name) {
  const s = String(name || '').trim();
  if (!s || s !== s.toUpperCase() || !/[A-Z]{3}/.test(s)) return s;
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function normaliseParams(query) {
  const out = {};
  for (const [k, v] of query.entries()) out[k.toLowerCase()] = v;
  return out;
}

function applyUpiParams(input, warnings) {
  const params = input instanceof Map || typeof input?.entries === 'function'
    ? normaliseParams(input)
    : Object.fromEntries(Object.entries(input || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const vpa = String(params.pa || params.payeevpa || '').trim();
  const name = (params.pn || params.payeename || '').trim();
  const amount = parseAmount(params.am ?? params.amount);
  const currency = (params.cu || 'INR').toUpperCase();
  const note = (params.tn || params.note || '').trim();

  if (!vpa) warnings.push('No payee VPA (pa) present in payload.');
  else if (!isValidVpa(vpa)) warnings.push(`Payee VPA "${vpa}" does not match the <handle>@<psp> shape.`);
  if (amount !== null && amount <= 0) warnings.push('Amount must be greater than zero.');
  if (amount === null && vpa) warnings.push('No amount in this QR — it is a static payee code, so the payer enters the amount.');

  return {
    kind: 'upi',
    vpa: vpa || null,
    name: name || (vpa ? vpa.split('@')[0] : null),
    amount,
    currency,
    note: note || null,
    ref: (params.tr || '').trim() || null,
    mcc: (params.mc || '').trim() || null,
    mode: params.mode === '01' ? 'static' : params.mode === '02' ? 'dynamic' : null,
    org: (params.org || '').trim() || null,
    sign: (params.sign || '').trim() || null,
    url: (params.url || '').trim() || null,
    psp: vpaPsp(vpa),
    warnings,
  };
}

/**
 * Parse an EMVCo TLV string. Returns a map of tag -> value (nested maps for
 * constructed template tags 26-51 which carry merchant account information).
 */
export function parseTlv(payload) {
  const out = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const lenStr = payload.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) break;
    const len = Number.parseInt(lenStr, 10);
    const start = i + 4;
    const value = payload.slice(start, start + len);
    if (value.length < len) break;
    if (Number.parseInt(tag, 10) >= 26 && Number.parseInt(tag, 10) <= 51) {
      out[tag] = parseTlv(value);
    } else {
      out[tag] = value;
    }
    i = start + len;
  }
  return out;
}

function fromEmv(payload) {
  const tlv = parseTlv(payload);
  const warnings = [];
  for (const [tag, value] of Object.entries(tlv)) {
    const n = Number.parseInt(tag, 10);
    if (n < 26 || n > 51 || typeof value !== 'object') continue;
    const subs = Object.entries(value).filter(([, v]) => typeof v === 'string');
    const guid = (value['00'] || '').toLowerCase();
    if (!guid.includes('upi')) continue;

    // Sub-tags differ between issuers; pick the value that actually looks like a VPA
    // rather than trusting a fixed sub-tag number.
    const vpaEntry = subs.find(([k, v]) => k !== '00' && isValidVpa(v)) || subs.find(([, v]) => isValidVpa(v));
    const mccEntry = subs.find(([k, v]) => k !== '00' && v !== vpaEntry?.[1] && /^\d{4}$/.test(v));
    const nameEntry = subs.find(([k, v]) => !['00'].includes(k) && v !== vpaEntry?.[1] && v !== mccEntry?.[1] && /[A-Za-z]{3,}/.test(v));

    return applyUpiParams({
      pa: vpaEntry?.[1] || '',
      pn: nameEntry?.[1] || '',
      cu: 'INR',
      mc: mccEntry?.[1] || '',
    }, warnings);
  }
  return null;
}

/** Detect and parse whatever text came out of a QR scan. */
export function parseQrText(raw) {
  const text = String(raw || '').trim();
  if (!text) return { kind: 'empty', raw: text, warnings: ['Empty QR payload.'] };

  const lower = text.toLowerCase();
  if (lower.startsWith('upi://')) {
    const [base, query = ''] = text.split('?');
    const warnings = [];
    if (!/^upi:\/\/(pay|p2p|p2m)/i.test(base)) {
      warnings.push(`Unrecognised UPI intent "${base}".`);
    }
    const parsed = applyUpiParams(new URLSearchParams(query), warnings);
    return { ...parsed, raw: text, warnings };
  }

  if (/^(https?:\/\/)/i.test(text)) {
    try {
      const url = new URL(text);
      const q = normaliseParams(url.searchParams);
      if (q.pa || q.payeevpa) {
        const warnings = ['UPI details were found inside a https link rather than a upi:// intent.'];
        return { ...applyUpiParams(url.searchParams, warnings), raw: text, warnings };
      }
    } catch {
      /* fall through */
    }
    return { kind: 'url', raw: text, url: text, warnings: ['Plain web URL — not a UPI payment code.'] };
  }

  const emv = fromEmv(text);
  if (emv) return { ...emv, raw: text, warnings: [...emv.warnings, 'Decoded from an EMVCo/Bharat QR TLV payload.'] };

  if (/^[A-Za-z0-9._-]+@[A-Za-z][A-Za-z0-9]{1,30}$/.test(text)) {
    const warnings = ['Bare VPA with no amount — treat as a static payee.'];
    return { kind: 'upi', raw: text, vpa: text, name: text.split('@')[0], amount: null, currency: 'INR', psp: vpaPsp(text), warnings };
  }

  return { kind: 'text', raw: text, text, warnings: ['QR did not contain UPI payment details.'] };
}

/** Build a UPI deep link (used to hand off payment to a real UPI app, or render a QR). */
export function buildUpiUri({ vpa, name, amount, note, ref, mcc, mode = null, currency = 'INR' }) {
  if (!isValidVpa(vpa)) throw new Error(`Invalid VPA: ${vpa}`);
  const q = new URLSearchParams();
  q.set('pa', vpa.trim());
  if (name) q.set('pn', name);
  let amt = null;
  if (amount !== undefined && amount !== null && amount !== '') {
    amt = parseAmount(amount);
    if (amt === null || amt <= 0) throw new Error('Amount must be greater than zero.');
    q.set('am', amt.toFixed(2));
  }
  q.set('cu', currency);
  if (note) q.set('tn', String(note).slice(0, 50));
  if (ref) q.set('tr', String(ref).slice(0, 35));
  if (mcc) q.set('mc', String(mcc));
  // A code carrying an amount is dynamic (02); a bare payee code is static (01).
  const resolvedMode = mode || (amt ? '02' : '01');
  if (resolvedMode !== '01' && resolvedMode !== '02') throw new Error(`Invalid UPI mode: ${resolvedMode} (expected 01 or 02).`);
  q.set('mode', resolvedMode);
  return `upi://pay?${q.toString()}`;
}

export function makeTxnRef(prefix = 'WYS') {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}${t}${r}`.slice(0, 20);
}

/* ------------------------------------------------------------------ *
 * Bank SMS / statement import
 * ------------------------------------------------------------------ */

const SMS_TEMPLATES = [
  { id: 'debited', re: /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)\s+(?:has been\s+)?debited/i, direction: 'debit' },
  { id: 'credited', re: /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)\s+(?:has been\s+)?credited/i, direction: 'credit' },
  { id: 'spent', re: /spent\s+(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i, direction: 'debit' },
  { id: 'paid', re: /paid\s+(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i, direction: 'debit' },
  { id: 'sent', re: /sent\s+(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i, direction: 'debit' },
  { id: 'received', re: /received\s+(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i, direction: 'credit' },
  { id: 'txn-generic', re: /(?:txn|transaction)\s+of\s+(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i, direction: 'debit' },
];

const VPA_IN_TEXT_RE = /([a-zA-Z0-9._-]{2,60}@[a-zA-Z][a-zA-Z0-9]{1,30})/;
const REF_RE = /(?:ref(?:erence)?\s*(?:no\.?|id|#)?\s*[:#]?\s*)([A-Za-z0-9]{6,30})/i;
const UPI_REF_RE = /\b(\d{12})\b/;
const A_C_RE = /a\/c\s*(?:no\.?|xx+)?\s*([xX*\d]{3,})/i;
const DATE_RE = /(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/;

/** Extract the date inside an SMS when present. Returns YYYY-MM-DD or null. */
export function parseDateish(s) {
  if (!s) return null;
  const iso = String(s).match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const dmy = String(s).match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const dMon = String(s).match(/\b(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})\b/);
  if (dMon) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mi = months.indexOf(dMon[2].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const year = dMon[3].length === 2 ? `20${dMon[3]}` : dMon[3];
      return `${year}-${String(mi + 1).padStart(2, '0')}-${String(dMon[1]).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Parse one bank/UPI SMS alert into a candidate expense row. */
export function parseBankSms(text) {
  const raw = String(text || '').trim();
  const warnings = [];
  let amount = null;
  let direction = 'debit';

  for (const t of SMS_TEMPLATES) {
    const m = raw.match(t.re);
    if (m) {
      amount = parseAmount(m[1]);
      direction = t.direction;
      break;
    }
  }
  if (amount === null) {
    const generic = raw.match(/(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (generic) {
      amount = parseAmount(generic[1]);
      warnings.push('Amount found but the debit/credit wording was unclear — assumed debit.');
    }
  }
  if (amount === null) warnings.push('No amount could be parsed from this message.');

  const vpaMatch = raw.match(VPA_IN_TEXT_RE);
  const vpa = vpaMatch ? vpaMatch[1] : null;
  const refMatch = raw.match(REF_RE);
  const upiRef = raw.match(UPI_REF_RE);
  const acct = raw.match(A_C_RE);

  let merchant = null;
  const parenMatch = raw.match(/\(([A-Za-z0-9 ._&'-]{2,40})\)/);
  const toMatch = raw.match(/\bto\s+(?:vpa\s+)?([A-Za-z0-9 ._&'-]{2,40}?)(?:\s+on|\s+ref|\s+upi|\s+from|[,.]|$)/i);
  const atMatch = raw.match(/\bat\s+([A-Za-z0-9 ._&'-]{2,40}?)(?:\s+on|\s+ref|[,.]|$)/i);
  const fromMatch = raw.match(/\bfrom\s+(?:vpa\s+)?([A-Za-z0-9 ._&'-]{2,40}?)(?:\s+on|\s+ref|[,.]|$)/i);
  if (parenMatch) merchant = parenMatch[1];
  else if (direction === 'debit') merchant = toMatch?.[1] || atMatch?.[1] || null;
  else merchant = fromMatch?.[1] || atMatch?.[1] || null;
  if (merchant) merchant = merchant.replace(/\bvpa\b/gi, '').trim().replace(/\s+/g, ' ');
  if (!merchant && vpa) merchant = vpa.split('@')[0];
  // If the merchant is just the VPA handle, prefer a friendlier title-cased form.
  if (merchant && vpa && merchant.toLowerCase() === vpa.split('@')[0].toLowerCase()) {
    merchant = merchant.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const date = parseDateish(raw);

  return {
    kind: 'sms',
    amount,
    direction,
    vpa,
    merchant: titleCaseMerchant(merchant) || 'Unknown',
    ref: refMatch?.[1] || upiRef?.[1] || null,
    accountHint: acct?.[1] ? acct[1].replace(/x/gi, 'x') : null,
    occurredAt: date ? `${date} 12:00:00` : null,
    method: vpa ? 'upi' : 'bank',
    raw,
    warnings,
  };
}

/** Split a pasted blob into individual SMS candidates. */
const looksLikeAlert = (line) =>
  /(?:rs\.?|inr|₹)\s*[\d,]/i.test(line) &&
  /(debited|credited|debit|credit|spent|withdraw|deposit|paid|received|sent)/i.test(line);

export function splitSmsBlob(blob) {
  const text = String(blob || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  // Group on blank lines first, so a single multi-line alert stays intact.
  const groups = text.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);

  const out = [];
  for (const group of groups) {
    const lines = group.split('\n').map((s) => s.trim()).filter(Boolean);
    let buffer = [];
    const flush = () => { if (buffer.length) { out.push(buffer.join(' ')); buffer = []; } };
    for (const line of lines) {
      // Start a fresh message whenever the current buffer already holds a complete alert.
      if (buffer.length && looksLikeAlert(buffer.join(' ')) && looksLikeAlert(line)) flush();
      buffer.push(line);
    }
    flush();
  }

  // A single long line can still hold several alerts glued together with no newline.
  return out.flatMap((chunk) => (
    chunk.length > 320 && (chunk.match(/(?:rs\.?|inr|₹)/gi) || []).length > 2
      ? chunk.split(/(?=(?:Rs\.?|INR|₹)\s*[\d,])/i).map((s) => s.trim()).filter(Boolean)
      : [chunk]
  ));
}

const NOISE_TOKENS = new Set([
  'upi', 'dr', 'cr', 'neft', 'imps', 'rtgs', 'pos', 'atm', 'ach', 'nach', 'p2a', 'p2m',
  'debit', 'credit', 'txn', 'ref', 'no', 'payment', 'transfer', 'sent', 'received',
  'card', 'bank', 'acct', 'account', 'from', 'to', 'by', 'via', 'the',
]);

/**
 * Pull a readable payee name out of a bank narration such as
 * "UPI/DR/416782345612/blinkit@ybl/Blinkit" -> "Blinkit".
 */
export function merchantFromNarration(desc, vpa = null) {
  const raw = String(desc || '');
  const segments = raw
    .split(/[/|\\]+|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const scored = segments.map((seg) => {
    const lower = seg.toLowerCase();
    const isRef = /^[A-Za-z0-9]{10,}$/.test(seg) && /\d/.test(seg);
    const isNumeric = /^[\d.,\s]+$/.test(seg);
    const isVpa = vpa && seg.toLowerCase() === vpa.toLowerCase();
    const words = seg.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w) && !NOISE_TOKENS.has(w.toLowerCase()));
    const letters = (seg.match(/[A-Za-z]/g) || []).length;
    const useful = !isRef && !isNumeric && !isVpa && words.length > 0;
    return { seg, useful, letters };
  });

  const useful = scored.filter((s) => s.useful);
  let best = null;
  if (useful.length) {
    // Prefer the longest alphabetic segment, but break ties by taking the later one
    // (merchant names usually trail the transaction codes in Indian narrations).
    best = useful.reduce((a, b) => (b.letters >= a.letters ? b : a)).seg;
  } else {
    best = raw;
  }

  best = best
    .replace(/[A-Za-z0-9._-]+@[A-Za-z][A-Za-z0-9]{1,30}/g, ' ')
    .replace(/\b(upi|neft|imps|rtgs|ach|nach|pos|atm|dr|cr|txn|ref|no|p2a|p2m)\b/gi, ' ')
    .replace(/[^A-Za-z0-9 .&'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!best) best = vpa ? vpa.split('@')[0] : 'Unknown';
  // A narration of only reference codes leaves nothing readable; fall back to the VPA handle.
  if (!/[A-Za-z]{2}/.test(best) && vpa) best = vpa.split('@')[0];
  if (best.toLowerCase() === (vpa || '').split('@')[0].toLowerCase()) {
    best = best.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // Bank narrations shout in caps; title-case all-caps names so "AMAZON" reads like "Amazon".
  best = titleCaseMerchant(best);
  return best.split(' ').slice(0, 5).join(' ') || 'Unknown';
}

/* ------------------------------------------------------------------ *
 * CSV statement import
 * ------------------------------------------------------------------ */

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const COLUMN_ALIASES = {
  date: ['date', 'txn date', 'transaction date', 'value date', 'posting date', 'time'],
  description: ['description', 'narration', 'particulars', 'details', 'remarks', 'transaction details', 'transaction remarks'],
  debit: ['debit', 'withdrawal', 'withdrawal amt', 'withdrawal amount', 'debit amount', 'dr'],
  credit: ['credit', 'deposit', 'deposit amt', 'deposit amount', 'credit amount', 'cr'],
  amount: ['amount', 'transaction amount', 'txn amount'],
  balance: ['balance', 'closing balance', 'available balance'],
  type: ['type', 'txn type', 'dr/cr', 'cr/dr'],
  ref: ['ref no', 'reference', 'chq/ref no', 'ref no./cheque no.', 'cheque no', 'utr'],
};

function mapHeaders(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const key = h.toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map[field] === undefined && aliases.includes(key)) map[field] = idx;
    }
  });
  return map;
}

/** Parse a CSV bank statement into candidate expense rows. */
export function parseBankCsv(csv) {
  const lines = String(csv || '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return { rows: [], warnings: ['CSV file was empty.'] };

  const warnings = [];
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const cells = splitCsvLine(lines[i]).map((c) => c.toLowerCase());
    if (cells.some((c) => COLUMN_ALIASES.date.includes(c.replace(/[._]/g, ' ').trim()))) { headerIdx = i; break; }
  }

  const headers = splitCsvLine(lines[headerIdx]);
  const col = mapHeaders(headers);
  if (col.date === undefined && col.description === undefined) {
    return { rows: [], warnings: ['Could not find a date or description column in the CSV header.'] };
  }
  if (col.debit === undefined && col.credit === undefined && col.amount === undefined) {
    warnings.push('No debit/credit/amount column detected; rows will be imported as zero-value drafts.');
  }

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (!cells.some((c) => c !== '')) continue;
    const get = (idx) => (idx === undefined ? '' : (cells[idx] ?? ''));
    const dateRaw = get(col.date);
    const desc = get(col.description);
    let amount = parseAmount(get(col.debit));
    let direction = 'debit';
    if (amount === null || amount === 0) {
      amount = parseAmount(get(col.amount));
      const t = get(col.type).toLowerCase();
      direction = t.includes('cr') || t.includes('credit') ? 'credit' : 'debit';
    }
    if (amount === null) {
      const credit = parseAmount(get(col.credit));
      if (credit !== null && credit !== 0) { amount = credit; direction = 'credit'; }
    }
    if (amount === null) continue;

    const vpaMatch = desc.match(VPA_IN_TEXT_RE);
    const date = parseDateish(dateRaw);
    let merchant = merchantFromNarration(desc, vpaMatch?.[1]);

    rows.push({
      kind: 'csv',
      amount,
      direction,
      vpa: vpaMatch?.[1] || null,
      merchant,
      description: desc,
      ref: get(col.ref) || null,
      occurredAt: date ? `${date} 12:00:00` : null,
      method: /upi/i.test(desc) ? 'upi' : 'bank',
      balance: parseAmount(get(col.balance)),
      raw: lines[i],
      warnings: [],
    });
  }
  if (!rows.length) warnings.push('No transaction rows were parsed from the CSV.');
  return { rows, warnings, header: headers, columns: col };
}

/* ------------------------------------------------------------------ *
 * Category inference
 * ------------------------------------------------------------------ */

const MCC_MAP = {
  5411: 'Groceries', 5422: 'Groceries', 5451: 'Groceries', 5462: 'Groceries',
  5812: 'Dining', 5814: 'Dining', 5813: 'Dining',
  4111: 'Transport', 4121: 'Transport', 4131: 'Transport', 4784: 'Transport',
  5541: 'Fuel', 5542: 'Fuel', 5983: 'Fuel',
  5912: 'Health', 8011: 'Health', 8062: 'Health', 8021: 'Health',
  5651: 'Shopping', 5691: 'Shopping', 5310: 'Shopping', 5399: 'Shopping',
  4899: 'Bills', 4900: 'Bills', 4814: 'Bills', 4812: 'Bills',
  7995: 'Entertainment', 7832: 'Entertainment', 7841: 'Entertainment', 7922: 'Entertainment',
  8211: 'Education', 8220: 'Education', 8299: 'Education',
  7011: 'Travel', 4511: 'Travel', 4722: 'Travel', 3501: 'Travel',
  6011: 'Cash', 6010: 'Cash',
  7372: 'Software', 5734: 'Software', 4816: 'Software',
};

export function categoryFromMcc(mcc) {
  const n = Number.parseInt(String(mcc || '').replace(/^0+/, ''), 10);
  return MCC_MAP[n] || null;
}
