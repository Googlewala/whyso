import { all, get } from './db.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Compute each member's share of an amount.
 * mode: equal | shares | percent | exact
 * Returns [{ user_id, weight, share }] with shares summing to amount.
 */
export function computeShares(amount, participants, mode = 'equal') {
  const amt = round2(amount);
  if (!participants.length) throw new Error('At least one participant is required.');

  if (mode === 'exact') {
    const shares = participants.map((p) => ({ user_id: p.user_id, weight: 1, share: round2(p.value ?? p.share ?? 0) }));
    const sum = round2(shares.reduce((s, x) => s + x.share, 0));
    if (Math.abs(sum - amt) > 0.01) {
      throw new Error(`Exact shares must add up to ${amt.toFixed(2)} (they add up to ${sum.toFixed(2)}).`);
    }
    // Push any rounding remainder onto the last participant.
    const drift = round2(amt - sum);
    if (drift !== 0) shares[shares.length - 1].share = round2(shares[shares.length - 1].share + drift);
    return shares;
  }

  const raw = participants.map((p) => ({
    user_id: p.user_id,
    weight: mode === 'shares' ? Number(p.value ?? p.weight ?? 1) : mode === 'percent' ? Number(p.value ?? p.percent ?? 0) : 1,
  }));
  const totalWeight = raw.reduce((s, x) => s + x.weight, 0);
  if (totalWeight <= 0) throw new Error('Weights must add up to more than zero.');

  const out = raw.map((x) => ({ ...x, share: round2((amt * x.weight) / totalWeight) }));
  const sum = round2(out.reduce((s, x) => s + x.share, 0));
  out[out.length - 1].share = round2(out[out.length - 1].share + round2(amt - sum));
  return out;
}

/** Net balance per group member: positive means the group owes them money. */
export function groupBalances(groupId) {
  const members = all(
    `SELECT u.id, u.name, u.vpa, gm.role FROM group_members gm
       JOIN users u ON u.id = gm.user_id WHERE gm.group_id = :g`,
    { g: groupId },
  );
  const bal = new Map(members.map((m) => [m.id, { user_id: m.id, name: m.name, vpa: m.vpa, paid: 0, owed: 0, settled: 0, net: 0 }]));

  const touch = (id) => {
    if (!bal.has(id)) bal.set(id, { user_id: id, name: `User ${id}`, vpa: null, paid: 0, owed: 0, settled: 0, net: 0 });
    return bal.get(id);
  };

  const expenses = all(
    `SELECT id, user_id, amount, direction FROM expenses WHERE group_id = :g AND status != 'failed'`,
    { g: groupId },
  );
  for (const e of expenses) {
    const signed = e.direction === 'credit' ? -e.amount : e.amount;
    touch(e.user_id).paid += signed;
    const shares = all(`SELECT user_id, share FROM group_expense_shares WHERE expense_id = :e`, { e: e.id });
    for (const s of shares) touch(s.user_id).owed += s.share;
  }

  for (const s of all(`SELECT from_user, to_user, amount FROM settlements WHERE group_id = :g`, { g: groupId })) {
    touch(s.from_user).settled -= s.amount;
    touch(s.to_user).settled += s.amount;
  }

  const rows = [...bal.values()].map((b) => ({
    ...b,
    paid: round2(b.paid),
    owed: round2(b.owed),
    settled: round2(b.settled),
    net: round2(b.paid - b.owed - b.settled),
  }));
  const drift = round2(rows.reduce((s, r) => s + r.net, 0));
  if (drift !== 0 && rows.length) rows[0].net = round2(rows[0].net - drift);
  return rows;
}

/** Greedy min-cash-flow: settle all balances in at most n-1 transfers. */
export function simplifyDebts(balances) {
  const debtors = balances.filter((b) => b.net < -0.005).map((b) => ({ ...b, amt: -b.net })).sort((a, b) => b.amt - a.amt);
  const creditors = balances.filter((b) => b.net > 0.005).map((b) => ({ ...b, amt: b.net })).sort((a, b) => b.amt - a.amt);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = round2(Math.min(debtors[i].amt, creditors[j].amt));
    if (pay > 0.005) {
      transfers.push({
        from: { user_id: debtors[i].user_id, name: debtors[i].name, vpa: debtors[i].vpa },
        to: { user_id: creditors[j].user_id, name: creditors[j].name, vpa: creditors[j].vpa },
        amount: pay,
      });
    }
    debtors[i].amt = round2(debtors[i].amt - pay);
    creditors[j].amt = round2(creditors[j].amt - pay);
    if (debtors[i].amt <= 0.005) i++;
    if (creditors[j].amt <= 0.005) j++;
  }
  return transfers;
}

export function groupLedger(groupId) {
  const group = get(`SELECT * FROM groups WHERE id = :g`, { g: groupId });
  if (!group) return null;
  const members = all(
    `SELECT u.id, u.name, u.vpa, gm.role FROM group_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = :g ORDER BY gm.role = 'owner' DESC, u.name`,
    { g: groupId },
  );
  const balances = groupBalances(groupId);
  const transfers = simplifyDebts(balances);
  const total = round2(
    all(`SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN -amount ELSE amount END), 0) v FROM expenses WHERE group_id = :g`, { g: groupId })[0].v,
  );
  return { group, members, balances, transfers, total_spend: total };
}
