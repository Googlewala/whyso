import express from 'express';
import { all, get, initSchema, run, tx } from '../db.js';
import {
  buildUpiUri, isValidVpa, makeTxnRef, parseQrText, parseAmount, vpaPsp,
  parseBankCsv, parseBankSms, splitSmsBlob,
} from '../upi.js';
import { computeShares, groupLedger, groupBalances, simplifyDebts } from '../split.js';
import { inferCategory, seedIfEmpty } from '../seed.js';
import { analyse, payeeDirectory, recommendBudgets } from '../analytics.js';
import { buildStatement } from '../statement.js';

export const router = express.Router();

const round2 = (n) => Math.round(n * 100) / 100;
const DEFAULT_USER = 1;

function userId(req) {
  const u = Number(req.query.user_id || req.body?.user_id || DEFAULT_USER);
  return Number.isFinite(u) && u > 0 ? u : DEFAULT_USER;
}

function bad(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

const ok = (res, data, status = 200) => res.status(status).json(data);

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */

router.get('/bootstrap', (req, res) => {
  const uid = userId(req);
  const users = all(`SELECT id, name, vpa FROM users ORDER BY id`);
  const categories = all(`SELECT * FROM categories ORDER BY name`);
  const user = users.find((u) => u.id === uid) || users[0];
  ok(res, {
    user,
    users,
    categories,
    accounts: all(`SELECT * FROM accounts WHERE user_id = :u`, { u: uid }),
    groups: all(
      `SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count
         FROM groups g WHERE g.archived = 0 ORDER BY g.created_at DESC`,
    ),
    occasions: all(`SELECT * FROM occasions WHERE user_id = :u ORDER BY date`, { u: uid }),
    counts: {
      expenses: get(`SELECT COUNT(*) c FROM expenses WHERE user_id = :u`, { u: uid }).c,
      scans: get(`SELECT COUNT(*) c FROM scans`).c,
    },
  });
});

router.post('/seed', (req, res) => {
  ok(res, seedIfEmpty());
});

/* ------------------------------------------------------------------ *
 * UPI — scan / parse / generate
 * ------------------------------------------------------------------ */

router.post('/upi/parse', (req, res) => {
  const { text } = req.body || {};
  if (!text) return bad(res, 'Provide "text" with the QR contents.');
  const parsed = parseQrText(text);
  const category = parsed.kind === 'upi' ? inferCategory(`${parsed.name || ''} ${parsed.note || ''}`, parsed.mcc) : null;
  const saved = run(
    `INSERT INTO scans (user_id, raw, kind, parsed) VALUES (:u, :raw, :kind, :parsed)`,
    { u: userId(req), raw: String(text), kind: parsed.kind, parsed: JSON.stringify(parsed) },
  );
  ok(res, { scan_id: Number(saved.lastInsertRowid), parsed, suggested_category: category });
});

router.get('/upi/history', (req, res) => {
  ok(res, all(`SELECT id, raw, kind, parsed, created_at FROM scans ORDER BY id DESC LIMIT 30`)
    .map((s) => ({ ...s, parsed: JSON.parse(s.parsed) })));
});

router.post('/upi/link', (req, res) => {
  const { vpa, name, amount, note, ref, mcc, mode } = req.body || {};
  if (!isValidVpa(vpa)) return bad(res, 'A valid payee VPA (like name@bank) is required.');
  try {
    const uri = buildUpiUri({ vpa, name, amount, note, ref: ref || makeTxnRef(), mcc, mode });
    ok(res, { uri, vpa: vpa.trim(), psp: vpaPsp(vpa) });
  } catch (err) {
    bad(res, err.message);
  }
});

router.get('/upi/payees', (req, res) => ok(res, payeeDirectory(userId(req))));

router.post('/upi/scan-image', express.json({ limit: '12mb' }), (req, res) => {
  ok(res, { message: 'Image decoding happens in the browser; POST the decoded string to /api/upi/parse.' });
});

/* ------------------------------------------------------------------ *
 * Expenses
 * ------------------------------------------------------------------ */

function expenseRow(id) {
  return get(
    `SELECT e.*, c.name AS category, c.icon AS category_icon, c.color AS category_color,
            g.name AS group_name, g.emoji AS group_emoji, o.title AS occasion_title, u.name AS user_name
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN groups g ON g.id = e.group_id
       LEFT JOIN occasions o ON o.id = e.occasion_id
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.id = :id`,
    { id },
  );
}

router.get('/expenses', (req, res) => {
  const uid = userId(req);
  const { q, category_id, group_id, occasion_id, method, from, to, direction, limit = 200, offset = 0 } = req.query;
  const where = [`e.user_id = :u`];
  const params = { u: uid, limit: Math.min(Number(limit) || 200, 1000), offset: Number(offset) || 0 };
  if (q) { where.push(`(e.merchant LIKE :q OR e.note LIKE :q OR e.vpa LIKE :q)`); params.q = `%${q}%`; }
  if (category_id) { where.push(`e.category_id = :c`); params.c = Number(category_id); }
  if (group_id) { where.push(`e.group_id = :g`); params.g = Number(group_id); }
  if (occasion_id) { where.push(`e.occasion_id = :o`); params.o = Number(occasion_id); }
  if (method) { where.push(`e.method = :m`); params.m = method; }
  if (direction) { where.push(`e.direction = :d`); params.d = direction; }
  if (from) { where.push(`date(e.occurred_at) >= date(:from)`); params.from = from; }
  if (to) { where.push(`date(e.occurred_at) <= date(:to)`); params.to = to; }

  const rows = all(
    `SELECT e.id, e.amount, e.direction, e.merchant, e.vpa, e.note, e.method, e.occurred_at, e.txn_ref,
            e.group_id, e.occasion_id, e.source,
            c.name AS category, c.icon AS category_icon, c.color AS category_color,
            g.name AS group_name, g.emoji AS group_emoji, o.title AS occasion_title
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN groups g ON g.id = e.group_id
       LEFT JOIN occasions o ON o.id = e.occasion_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT :limit OFFSET :offset`,
    params,
  );
  const total = get(
    `SELECT COUNT(*) c FROM expenses e WHERE ${where.join(' AND ')}`,
    Object.fromEntries(Object.entries(params).filter(([k]) => !['limit', 'offset'].includes(k))),
  ).c;
  const sumRow = get(
    `SELECT COALESCE(SUM(CASE WHEN e.direction='debit' THEN e.amount ELSE 0 END),0) AS spend,
            COALESCE(SUM(CASE WHEN e.direction='credit' THEN e.amount ELSE 0 END),0) AS income
       FROM expenses e WHERE ${where.join(' AND ')}`,
    Object.fromEntries(Object.entries(params).filter(([k]) => !['limit', 'offset'].includes(k))),
  );
  ok(res, { rows, total, spend: round2(sumRow.spend), income: round2(sumRow.income) });
});

router.get('/expenses/:id', (req, res) => {
  const row = expenseRow(Number(req.params.id));
  if (!row) return bad(res, 'Expense not found', 404);
  row.shares = all(
    `SELECT s.user_id, s.share, s.weight, u.name FROM group_expense_shares s JOIN users u ON u.id = s.user_id
      WHERE s.expense_id = :e`,
    { e: row.id },
  );
  ok(res, row);
});

router.post('/expenses', (req, res) => {
  const uid = userId(req);
  const b = req.body || {};
  const amount = parseAmount(b.amount);
  if (amount === null || amount <= 0) return bad(res, 'A positive amount is required.');

  const direction = b.direction === 'credit' ? 'credit' : 'debit';
  const category = b.category_id
    ? get(`SELECT * FROM categories WHERE id = :id`, { id: Number(b.category_id) })
    : inferCategory(`${b.merchant || ''} ${b.note || ''}`, b.mcc);
  if (!category) return bad(res, 'Could not resolve a category.');

  const occurredAt = b.occurred_at ? String(b.occurred_at).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');
  const groupId = b.group_id ? Number(b.group_id) : null;
  let participants = Array.isArray(b.participants) && b.participants.length ? b.participants : null;
  const splitMode = b.split_mode || (b.split?.mode) || 'equal';
  if (!participants && b.split?.participants?.length) participants = b.split.participants;

  if (groupId && !participants) {
    // Default to an equal split across every group member.
    const members = all(`SELECT user_id FROM group_members WHERE group_id = :g`, { g: groupId });
    if (!members.length) return bad(res, 'This group has no members to split with.');
    participants = members.map((m) => ({ user_id: m.user_id }));
  }

  try {
    const created = tx(() => {
      const r = run(
        `INSERT INTO expenses (user_id, account_id, group_id, occasion_id, amount, currency, direction, merchant, vpa,
                               category_id, note, txn_ref, method, status, occurred_at, source, raw)
         VALUES (:u, :a, :g, :o, :amount, :cur, :direction, :merchant, :vpa, :cat, :note, :ref, :method, :status, :when, :source, :raw)`,
        {
          u: uid,
          a: b.account_id ? Number(b.account_id) : get(`SELECT id FROM accounts WHERE user_id = :u LIMIT 1`, { u: uid })?.id ?? null,
          g: groupId,
          o: b.occasion_id ? Number(b.occasion_id) : null,
          amount,
          cur: b.currency || 'INR',
          direction,
          merchant: b.merchant || 'Unknown',
          vpa: b.vpa || null,
          cat: category.id,
          note: b.note || null,
          ref: b.txn_ref || makeTxnRef('WYS'),
          method: b.method || (b.vpa ? 'upi' : 'manual'),
          status: b.status || 'success',
          when: occurredAt,
          source: b.source || 'manual',
          raw: b.raw ? String(b.raw) : null,
        },
      );
      const id = Number(r.lastInsertRowid);
      if (groupId && participants) {
        const shares = computeShares(amount, participants.map((p) => ({ user_id: Number(p.user_id), value: p.value })), splitMode);
        for (const s of shares) {
          run(`INSERT INTO group_expense_shares (expense_id, user_id, share, weight) VALUES (:e, :u, :s, :w)`,
            { e: id, u: s.user_id, s: s.share, w: s.weight });
        }
      }
      return id;
    });
    ok(res, { expense: expenseRow(created) }, 201);
  } catch (err) {
    bad(res, err.message);
  }
});

router.put('/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = get(`SELECT * FROM expenses WHERE id = :id`, { id });
  if (!existing) return bad(res, 'Expense not found', 404);
  const b = req.body || {};
  const amount = b.amount !== undefined ? parseAmount(b.amount) : existing.amount;
  if (amount === null || amount <= 0) return bad(res, 'A positive amount is required.');
  const category = b.category_id ? get(`SELECT * FROM categories WHERE id = :id`, { id: Number(b.category_id) })
    : b.merchant ? inferCategory(`${b.merchant} ${b.note || ''}`, b.mcc) : { id: existing.category_id };

  run(
    `UPDATE expenses SET amount=:amount, merchant=:merchant, vpa=:vpa, note=:note, category_id=:cat,
            group_id=:g, occasion_id=:o, direction=:direction, method=:method, occurred_at=:when
      WHERE id=:id`,
    {
      id,
      amount,
      merchant: b.merchant ?? existing.merchant,
      vpa: b.vpa ?? existing.vpa,
      note: b.note ?? existing.note,
      cat: category.id,
      g: b.group_id !== undefined ? (b.group_id ? Number(b.group_id) : null) : existing.group_id,
      o: b.occasion_id !== undefined ? (b.occasion_id ? Number(b.occasion_id) : null) : existing.occasion_id,
      direction: b.direction || existing.direction,
      method: b.method || existing.method,
      when: b.occurred_at ? String(b.occurred_at).replace('T', ' ') : existing.occurred_at,
    },
  );
  ok(res, { expense: expenseRow(id) });
});

router.delete('/expenses/:id', (req, res) => {
  const id = Number(req.params.id);
  const r = run(`DELETE FROM expenses WHERE id = :id`, { id });
  if (!r.changes) return bad(res, 'Expense not found', 404);
  ok(res, { deleted: id });
});

/* ------------------------------------------------------------------ *
 * Import — SMS / CSV
 * ------------------------------------------------------------------ */

router.post('/import/sms', (req, res) => {
  const uid = userId(req);
  const { messages, commit = false, drafts: incoming } = req.body || {};
  // The preview screen sends back the exact rows the user ticked, so trust those verbatim.
  const drafts = Array.isArray(incoming) && incoming.length
    ? incoming
    : (Array.isArray(messages) ? messages : splitSmsBlob(messages)).map((m) => parseBankSms(m));
  if (!drafts.length) return bad(res, 'Provide "messages" as text or an array of strings.');
  if (!commit) return ok(res, { drafts, committed: 0 });
  ok(res, { drafts, committed: commitDrafts(uid, drafts, 'sms') });
});

router.post('/import/csv', (req, res) => {
  const uid = userId(req);
  const { csv, commit = false, drafts: incoming } = req.body || {};
  if (Array.isArray(incoming) && incoming.length) {
    if (!commit) return ok(res, { drafts: incoming, warnings: [], committed: 0 });
    return ok(res, { drafts: incoming, warnings: [], committed: commitDrafts(uid, incoming, 'csv') });
  }
  if (!csv) return bad(res, 'Provide "csv" with the statement contents.');
  const { rows, warnings } = parseBankCsv(csv);
  if (!commit) return ok(res, { drafts: rows, warnings, committed: 0 });
  ok(res, { drafts: rows, warnings, committed: commitDrafts(uid, rows, 'csv') });
});

function commitDrafts(uid, drafts, source) {
  let committed = 0;
  tx(() => {
    for (const d of drafts) {
      if (!d.amount || d.amount <= 0) continue;
      if (d.ref && get(`SELECT id FROM expenses WHERE txn_ref = :r`, { r: d.ref })) continue;
      const cat = inferCategory(`${d.merchant || ''} ${d.description || ''}`, d.mcc);
      const account = get(`SELECT id FROM accounts WHERE user_id = :u LIMIT 1`, { u: uid });
      run(
        `INSERT INTO expenses (user_id, account_id, amount, direction, merchant, vpa, category_id, note, txn_ref,
                               method, occurred_at, source, raw)
         VALUES (:u, :a, :amount, :direction, :merchant, :vpa, :cat, :note, :ref, :method, :when, :source, :raw)`,
        {
          u: uid,
          a: account?.id ?? null,
          amount: d.amount,
          direction: d.direction,
          merchant: d.merchant || 'Unknown',
          vpa: d.vpa || null,
          cat: cat?.id ?? null,
          note: d.description || d.raw?.slice(0, 120) || null,
          ref: d.ref || makeTxnRef('IMP'),
          method: d.method || 'bank',
          when: d.occurredAt || new Date().toISOString().slice(0, 19).replace('T', ' '),
          source,
          raw: d.raw || null,
        },
      );
      committed++;
    }
  });
  return committed;
}

/* ------------------------------------------------------------------ *
 * Groups, splits and settlements
 * ------------------------------------------------------------------ */

router.get('/groups', (req, res) => {
  const groups = all(
    `SELECT g.*, u.name AS owner_name,
            (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS member_count,
            COALESCE((SELECT SUM(CASE WHEN e.direction='credit' THEN -e.amount ELSE e.amount END)
                        FROM expenses e WHERE e.group_id = g.id AND e.status != 'failed'), 0) AS total_spend
       FROM groups g JOIN users u ON u.id = g.owner_id
      WHERE g.archived = 0 ORDER BY g.created_at DESC`,
  );
  ok(res, groups);
});

router.post('/groups', (req, res) => {
  const uid = userId(req);
  const { name, emoji = '👥', kind = 'trip', member_ids = [], currency = 'INR' } = req.body || {};
  if (!name) return bad(res, 'Group name is required.');
  const members = [...new Set([uid, ...member_ids.map(Number)])].filter((x) => Number.isFinite(x));
  const id = tx(() => {
    const r = run(`INSERT INTO groups (name, emoji, kind, owner_id, currency) VALUES (:n, :e, :k, :o, :c)`,
      { n: name, e: emoji, k: kind, o: uid, c: currency });
    const gid = Number(r.lastInsertRowid);
    for (const m of members) {
      run(`INSERT INTO group_members (group_id, user_id, role) VALUES (:g, :u, :r)`,
        { g: gid, u: m, r: m === uid ? 'owner' : 'member' });
    }
    return gid;
  });
  ok(res, { group: get(`SELECT * FROM groups WHERE id = :id`, { id }) }, 201);
});

router.post('/groups/:id/members', (req, res) => {
  const gid = Number(req.params.id);
  const { user_id, name, vpa } = req.body || {};
  let uid = user_id ? Number(user_id) : null;
  if (!uid) {
    if (!name) return bad(res, 'Provide user_id or a name for a new member.');
    if (vpa && get(`SELECT id FROM users WHERE vpa = :v`, { v: vpa })) return bad(res, 'That UPI ID already exists.');
    uid = Number(run(`INSERT INTO users (name, vpa) VALUES (:n, :v)`, { n: name, v: vpa || null }).lastInsertRowid);
  }
  run(`INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (:g, :u, 'member')`, { g: gid, u: uid });
  ok(res, { members: all(`SELECT u.id, u.name, u.vpa FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = :g`, { g: gid }) });
});

router.delete('/groups/:id/members/:userId', (req, res) => {
  run(`DELETE FROM group_members WHERE group_id = :g AND user_id = :u`,
    { g: Number(req.params.id), u: Number(req.params.userId) });
  ok(res, { removed: Number(req.params.userId) });
});

router.get('/groups/:id', (req, res) => {
  const ledger = groupLedger(Number(req.params.id));
  if (!ledger) return bad(res, 'Group not found', 404);
  const expenses = all(
    `SELECT e.id, e.amount, e.merchant, e.note, e.occurred_at, e.direction, e.user_id, u.name AS paid_by,
            c.name AS category, c.icon AS category_icon
       FROM expenses e JOIN users u ON u.id = e.user_id
       LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.group_id = :g ORDER BY e.occurred_at DESC`,
    { g: ledger.group.id },
  );
  for (const e of expenses) {
    e.shares = all(`SELECT s.user_id, s.share, u.name FROM group_expense_shares s JOIN users u ON u.id = s.user_id WHERE s.expense_id = :e`, { e: e.id });
  }
  ok(res, { ...ledger, expenses, settlements: all(
    `SELECT s.*, f.name AS from_name, t.name AS to_name FROM settlements s
       JOIN users f ON f.id = s.from_user JOIN users t ON t.id = s.to_user
      WHERE s.group_id = :g ORDER BY s.settled_at DESC`, { g: ledger.group.id }) });
});

router.post('/groups/:id/settle', (req, res) => {
  const gid = Number(req.params.id);
  const { from_user, to_user, amount, note } = req.body || {};
  const amt = parseAmount(amount);
  if (!from_user || !to_user) return bad(res, 'from_user and to_user are required.');
  if (amt === null || amt <= 0) return bad(res, 'A positive amount is required.');
  const ref = makeTxnRef('STL');
  const r = run(
    `INSERT INTO settlements (group_id, from_user, to_user, amount, method, txn_ref, note)
     VALUES (:g, :f, :t, :a, 'upi', :ref, :n)`,
    { g: gid, f: Number(from_user), t: Number(to_user), a: amt, ref, n: note || null },
  );
  const to = get(`SELECT * FROM users WHERE id = :id`, { id: Number(to_user) });
  let pay_link = null;
  if (to?.vpa && isValidVpa(to.vpa)) {
    try {
      pay_link = buildUpiUri({ vpa: to.vpa, name: to.name, amount: amt, note: note || 'Whyso settlement', ref });
    } catch { pay_link = null; }
  }
  ok(res, { settlement: get(`SELECT * FROM settlements WHERE id = :id`, { id: Number(r.lastInsertRowid) }), pay_link, ledger: groupLedger(gid) }, 201);
});

/* ------------------------------------------------------------------ *
 * Occasions (planning)
 * ------------------------------------------------------------------ */

function occasionDetail(id) {
  const o = get(`SELECT * FROM occasions WHERE id = :id`, { id });
  if (!o) return null;
  const spent = get(
    `SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END), 0) s, COUNT(*) c
       FROM expenses WHERE occasion_id = :id`, { id },
  );
  const items = all(
    `SELECT e.id, e.amount, e.direction, e.merchant, e.note, e.occurred_at, c.name AS category, c.icon
       FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.occasion_id = :id ORDER BY e.occurred_at DESC`, { id },
  );
  const byCategory = all(
    `SELECT c.name, c.icon, c.color, ROUND(SUM(e.amount),2) AS total
       FROM expenses e JOIN categories c ON c.id = e.category_id
      WHERE e.occasion_id = :id AND e.direction='debit' GROUP BY c.id ORDER BY total DESC`, { id },
  );
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = Math.ceil((new Date(`${o.date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  const spentTotal = round2(spent.s);
  return {
    ...o,
    spent: spentTotal,
    txn_count: spent.c,
    remaining: round2(o.budget - spentTotal),
    pct: o.budget ? round2((spentTotal / o.budget) * 100) : 0,
    days_left: daysLeft,
    per_day_allowance: daysLeft > 0 ? round2((o.budget - spentTotal) / daysLeft) : 0,
    items, byCategory,
  };
}

router.get('/occasions', (req, res) => {
  const uid = userId(req);
  ok(res, all(`SELECT id FROM occasions WHERE user_id = :u ORDER BY date`, { u: uid }).map((o) => occasionDetail(o.id)));
});

router.get('/occasions/:id', (req, res) => {
  const o = occasionDetail(Number(req.params.id));
  if (!o) return bad(res, 'Occasion not found', 404);
  ok(res, o);
});

router.post('/occasions', (req, res) => {
  const uid = userId(req);
  const { title, type = 'festival', date, budget = 0, color = '#f59e0b', notes = null, status = 'planning' } = req.body || {};
  if (!title) return bad(res, 'Title is required.');
  if (!date) return bad(res, 'Date is required.');
  const r = run(
    `INSERT INTO occasions (user_id, title, type, date, budget, color, notes, status)
     VALUES (:u, :t, :ty, :d, :b, :c, :n, :s)`,
    { u: uid, t: title, ty: type, d: date, b: parseAmount(budget) || 0, c: color, n: notes, s: status },
  );
  ok(res, { occasion: occasionDetail(Number(r.lastInsertRowid)) }, 201);
});

router.put('/occasions/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = get(`SELECT * FROM occasions WHERE id = :id`, { id });
  if (!existing) return bad(res, 'Occasion not found', 404);
  const b = req.body || {};
  run(
    `UPDATE occasions SET title=:t, type=:ty, date=:d, budget=:b, color=:c, notes=:n, status=:s WHERE id=:id`,
    {
      id,
      t: b.title ?? existing.title, ty: b.type ?? existing.type, d: b.date ?? existing.date,
      b: b.budget !== undefined ? parseAmount(b.budget) || 0 : existing.budget,
      c: b.color ?? existing.color, n: b.notes ?? existing.notes, s: b.status ?? existing.status,
    },
  );
  ok(res, { occasion: occasionDetail(id) });
});

router.delete('/occasions/:id', (req, res) => {
  run(`DELETE FROM occasions WHERE id = :id`, { id: Number(req.params.id) });
  ok(res, { deleted: Number(req.params.id) });
});

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

router.get('/analytics/summary', (req, res) => {
  const uid = userId(req);
  ok(res, analyse({
    userId: uid,
    from: req.query.from,
    to: req.query.to,
    groupId: req.query.group_id ? Number(req.query.group_id) : null,
  }));
});

router.get('/analytics/budget-recommendations', (req, res) => ok(res, recommendBudgets(userId(req))));

router.get('/budgets', (req, res) => {
  ok(res, all(
    `SELECT b.*, c.name AS category, c.icon, c.color FROM budgets b JOIN categories c ON c.id = b.category_id
      WHERE b.user_id = :u ORDER BY c.name`, { u: userId(req) },
  ));
});

router.put('/budgets', (req, res) => {
  const uid = userId(req);
  const { items = [] } = req.body || {};
  tx(() => {
    for (const it of items) {
      const amt = parseAmount(it.amount);
      if (!it.category_id || amt === null) continue;
      run(
        `INSERT INTO budgets (user_id, category_id, period, amount) VALUES (:u, :c, :p, :a)
         ON CONFLICT(user_id, category_id, period) DO UPDATE SET amount = :a`,
        { u: uid, c: Number(it.category_id), p: it.period || 'monthly', a: amt },
      );
    }
  });
  ok(res, all(`SELECT b.*, c.name AS category, c.icon FROM budgets b JOIN categories c ON c.id = b.category_id WHERE b.user_id = :u`, { u: uid }));
});

/* ------------------------------------------------------------------ *
 * Recurring
 * ------------------------------------------------------------------ */

router.get('/recurring', (req, res) => {
  ok(res, all(
    `SELECT r.*, c.name AS category, c.icon FROM recurring r LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.user_id = :u ORDER BY r.next_due`, { u: userId(req) },
  ));
});

router.post('/recurring', (req, res) => {
  const uid = userId(req);
  const { merchant, vpa, amount, category_id, frequency = 'monthly', next_due } = req.body || {};
  const amt = parseAmount(amount);
  if (!merchant || amt === null) return bad(res, 'merchant and a numeric amount are required.');
  const cat = category_id ? Number(category_id) : inferCategory(merchant, null)?.id ?? null;
  const r = run(
    `INSERT INTO recurring (user_id, merchant, vpa, amount, category_id, frequency, next_due)
     VALUES (:u, :m, :v, :a, :c, :f, :n)`,
    { u: uid, m: merchant, v: vpa || null, a: amt, c: cat, f: frequency, n: next_due || null },
  );
  ok(res, { recurring: get(`SELECT * FROM recurring WHERE id = :id`, { id: Number(r.lastInsertRowid) }) }, 201);
});

router.delete('/recurring/:id', (req, res) => {
  run(`DELETE FROM recurring WHERE id = :id`, { id: Number(req.params.id) });
  ok(res, { deleted: Number(req.params.id) });
});

/* ------------------------------------------------------------------ *
 * Categories
 * ------------------------------------------------------------------ */

router.get('/categories', (req, res) => ok(res, all(`SELECT * FROM categories ORDER BY name`)));

router.post('/categories', (req, res) => {
  const { name, icon = '🏷️', color = '#6366f1', keywords = '' } = req.body || {};
  if (!name) return bad(res, 'Category name is required.');
  const r = run(`INSERT INTO categories (name, icon, color, keywords) VALUES (:n, :i, :c, :k)`,
    { n: name, i: icon, c: color, k: keywords });
  ok(res, { category: get(`SELECT * FROM categories WHERE id = :id`, { id: Number(r.lastInsertRowid) }) }, 201);
});

/* ------------------------------------------------------------------ *
 * Insights + statements
 * ------------------------------------------------------------------ */

router.get('/insights', (req, res) => {
  const s = analyse({ userId: userId(req), from: req.query.from, to: req.query.to });
  ok(res, { insights: s.insights, anomalies: s.anomalies, forecast: s.forecast, budgets: s.budgets, recurring: s.recurring });
});

router.get('/statement.pdf', (req, res) => {
  const uid = userId(req);
  const include = {
    categories: req.query.categories !== '0',
    trend: req.query.trend !== '0',
    insights: req.query.insights !== '0',
    anomalies: req.query.anomalies !== '0',
    budgets: req.query.budgets !== '0',
    merchants: req.query.merchants !== '0',
    occasions: req.query.occasions !== '0',
    transactions: req.query.transactions !== '0',
  };
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="whyso-statement-${uid}-${Date.now()}.pdf"`);
  // pdfkit streams into the response; a late error must not take the process down.
  res.on('error', () => {});
  try {
    buildStatement({
      userId: uid,
      from: req.query.from || null,
      to: req.query.to || null,
      groupId: req.query.group_id ? Number(req.query.group_id) : null,
      include,
    }, res);
  } catch (err) {
    if (!res.headersSent) {
      res.removeHeader('Content-Disposition');
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

void initSchema;
