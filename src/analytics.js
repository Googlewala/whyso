import { all, get } from './db.js';

const round2 = (n) => Math.round(n * 100) / 100;

function monthKey(d) {
  return String(d).slice(0, 7);
}

function addMonths(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Aggregate every dimension the dashboard and PDF need in one pass. */
export function analyse({ userId, from, to, groupId = null } = {}) {
  const where = [`e.user_id = :u`, `e.status != 'failed'`];
  const params = { u: userId };
  if (from) { where.push(`date(e.occurred_at) >= date(:from)`); params.from = from; }
  if (to) { where.push(`date(e.occurred_at) <= date(:to)`); params.to = to; }
  if (groupId) { where.push(`e.group_id = :g`); params.g = groupId; }
  const clause = where.join(' AND ');

  const rows = all(
    `SELECT e.id, e.amount, e.direction, e.merchant, e.vpa, e.method, e.occurred_at, e.note,
            e.group_id, e.occasion_id, e.source,
            c.name AS category, c.icon AS icon, c.color AS color,
            g.name AS group_name, g.emoji AS group_emoji,
            o.title AS occasion_title
       FROM expenses e
       LEFT JOIN categories c ON c.id = e.category_id
       LEFT JOIN groups g ON g.id = e.group_id
       LEFT JOIN occasions o ON o.id = e.occasion_id
      WHERE ${clause}
      ORDER BY e.occurred_at DESC`,
    params,
  );

  const spendRows = rows.filter((r) => r.direction === 'debit');
  const incomeRows = rows.filter((r) => r.direction === 'credit');
  const sum = (arr) => round2(arr.reduce((s, r) => s + r.amount, 0));

  const totalSpend = sum(spendRows);
  const totalIncome = sum(incomeRows);

  const byCategory = groupBy(spendRows, (r) => r.category || 'Uncategorised', (r) => ({
    name: r.category || 'Uncategorised', icon: r.icon || '💸', color: r.color || '#64748b', total: 0, count: 0,
  }), (a, r) => { a.total = round2(a.total + r.amount); a.count += 1; })
    .map((c) => ({ ...c, pct: totalSpend ? round2((c.total / totalSpend) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);

  const byMonth = groupBy(spendRows, (r) => monthKey(r.occurred_at), (r) => ({ month: monthKey(r.occurred_at), total: 0, count: 0, income: 0 }),
    (a, r) => { a.total = round2(a.total + r.amount); a.count += 1; }).sort((a, b) => a.month.localeCompare(b.month));
  for (const m of byMonth) {
    m.income = sum(incomeRows.filter((r) => monthKey(r.occurred_at) === m.month));
    m.net = round2(m.income - m.total);
  }

  const byMerchant = groupBy(spendRows, (r) => r.merchant, (r) => ({ merchant: r.merchant, total: 0, count: 0, vpa: r.vpa }),
    (a, r) => { a.total = round2(a.total + r.amount); a.count += 1; }).sort((a, b) => b.total - a.total);

  const byMethod = groupBy(spendRows, (r) => r.method, (r) => ({ method: r.method, total: 0, count: 0 }),
    (a, r) => { a.total = round2(a.total + r.amount); a.count += 1; }).sort((a, b) => b.total - a.total);

  const byPsp = groupBy(
    spendRows.filter((r) => r.vpa),
    (r) => (r.vpa || '').split('@')[1] || 'other',
    (r) => ({ psp: (r.vpa || '').split('@')[1] || 'other', total: 0, count: 0 }),
    (a, r) => { a.total = round2(a.total + r.amount); a.count += 1; },
  ).sort((a, b) => b.total - a.total);

  const byDayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => ({ day: d, total: 0, count: 0 }));
  for (const r of spendRows) {
    const idx = new Date(`${r.occurred_at.replace(' ', 'T')}Z`).getUTCDay();
    byDayOfWeek[idx].total = round2(byDayOfWeek[idx].total + r.amount);
    byDayOfWeek[idx].count += 1;
  }

  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, count: 0 }));
  for (const r of spendRows) {
    const h = Number(String(r.occurred_at).slice(11, 13));
    if (Number.isFinite(h)) { byHour[h].total = round2(byHour[h].total + r.amount); byHour[h].count += 1; }
  }

  const byOccasion = groupBy(spendRows.filter((r) => r.occasion_id), (r) => r.occasion_title,
    (r) => ({ title: r.occasion_title, total: 0, count: 0 }),
    (a, r) => { a.total = round2(a.total + r.amount); a.count += 1; }).sort((a, b) => b.total - a.total);

  const budgets = all(
    `SELECT b.id, b.amount, b.period, c.id AS category_id, c.name AS category, c.icon, c.color
       FROM budgets b JOIN categories c ON c.id = b.category_id WHERE b.user_id = :u`,
    { u: userId },
  );
  const currentMonth = monthKey(new Date().toISOString());
  const monthSpendByCat = new Map();
  for (const r of spendRows.filter((x) => monthKey(x.occurred_at) === currentMonth)) {
    monthSpendByCat.set(r.category, round2((monthSpendByCat.get(r.category) || 0) + r.amount));
  }
  const budgetStatus = budgets.map((b) => {
    const spent = monthSpendByCat.get(b.category) || 0;
    return { ...b, spent, remaining: round2(b.amount - spent), pct: b.amount ? round2((spent / b.amount) * 100) : 0 };
  }).sort((a, b) => b.pct - a.pct);

  const recurring = all(
    `SELECT r.*, c.name AS category, c.icon FROM recurring r LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.user_id = :u AND r.active = 1 ORDER BY r.next_due`,
    { u: userId },
  );

  const trend = byMonth.slice(-6);
  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];
  const momChange = last && prev && prev.total ? round2(((last.total - prev.total) / prev.total) * 100) : null;

  const thisMonth = byMonth.find((m) => m.month === currentMonth)?.total || 0;
  const lastMonth = byMonth.find((m) => m.month === addMonths(currentMonth, -1))?.total || 0;

  const anomalies = detectAnomalies(spendRows, byCategory);
  const forecast = forecastMonth(byMonth, currentMonth, spendRows);
  const insights = buildInsights({ totalSpend, byCategory, byMonth, byMerchant, anomalies, budgetStatus, momChange, thisMonth, lastMonth, currentMonth, recurring, byMethod, byDayOfWeek, forecast });

  return {
    range: { from: from || null, to: to || null, groupId },
    totals: { spend: totalSpend, income: totalIncome, net: round2(totalIncome - totalSpend), count: rows.length, avgTicket: spendRows.length ? round2(totalSpend / spendRows.length) : 0, thisMonth, lastMonth, momChange },
    byCategory, byMonth, byMerchant: byMerchant.slice(0, 15), byMethod, byPsp, byDayOfWeek, byHour, byOccasion,
    budgets: budgetStatus, recurring, anomalies, forecast, insights,
    topExpenses: spendRows.slice(0, 10),
  };
}

function groupBy(rows, keyFn, initFn, accFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, initFn(r));
    accFn(map.get(k), r);
  }
  return [...map.values()];
}

/** Flag transactions that are unusually large for their category (median + MAD based). */
function detectAnomalies(spendRows, byCategory) {
  const byCat = new Map();
  for (const r of spendRows) {
    const k = r.category || 'Uncategorised';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(r);
  }
  const out = [];
  for (const [cat, rows] of byCat) {
    if (rows.length < 3) continue;
    const amounts = rows.map((r) => r.amount).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const deviations = amounts.map((a) => Math.abs(a - median)).sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)] || median * 0.1 || 1;
    for (const r of rows) {
      const score = (0.6745 * (r.amount - median)) / mad;
      if (score > 3.5 && r.amount > median * 2) {
        out.push({
          id: r.id, merchant: r.merchant, category: cat, amount: r.amount, median: round2(median),
          occurred_at: r.occurred_at, score: round2(score),
          message: `${r.merchant} was ${round2(r.amount / (median || 1))}× your usual ${cat} spend.`,
        });
      }
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

/** Straight-line forecast for the running month using day-of-month pacing. */
function forecastMonth(byMonth, currentMonth, spendRows) {
  const monthRows = spendRows.filter((r) => monthKey(r.occurred_at) === currentMonth);
  if (!monthRows.length) return null;
  const now = new Date();
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
  const day = now.getUTCDate();
  const spent = round2(monthRows.reduce((s, r) => s + r.amount, 0));
  const projected = day ? round2((spent / day) * daysInMonth) : spent;
  return { month: currentMonth, spent, day, daysInMonth, projected, remainingDays: daysInMonth - day };
}

function buildInsights(ctx) {
  const out = [];
  const { byCategory, anomalies, budgetStatus, momChange, byDayOfWeek, recurring, currentMonth } = ctx;

  if (byCategory.length) {
    const top = byCategory[0];
    out.push({ type: 'info', title: `Biggest category: ${top.icon} ${top.name}`, body: `${top.name} is ${top.pct}% of your spending (₹${top.total.toLocaleString('en-IN')}).` });
  }
  if (momChange !== null) {
    const dir = momChange >= 0 ? 'up' : 'down';
    out.push({ type: momChange > 15 ? 'warn' : 'info', title: `Spending ${dir} ${Math.abs(momChange)}% MoM`, body: `This month is ₹${ctx.thisMonth.toLocaleString('en-IN')} vs ₹${ctx.lastMonth.toLocaleString('en-IN')} last month.` });
  }
  for (const b of budgetStatus.filter((x) => x.pct >= 90).slice(0, 3)) {
    out.push({ type: b.pct > 100 ? 'danger' : 'warn', title: `${b.icon} ${b.category} budget ${b.pct > 100 ? 'exceeded' : 'almost used'}`, body: `₹${b.spent.toLocaleString('en-IN')} of ₹${b.amount.toLocaleString('en-IN')} used (${b.pct}%).` });
  }
  if (anomalies.length) {
    out.push({ type: 'warn', title: `${anomalies.length} unusual transaction${anomalies.length > 1 ? 's' : ''} detected`, body: anomalies[0].message });
  }
  const weekend = round2(byDayOfWeek.filter((d) => ['Sat', 'Sun'].includes(d.day)).reduce((s, d) => s + d.total, 0));
  const weekday = round2(byDayOfWeek.filter((d) => !['Sat', 'Sun'].includes(d.day)).reduce((s, d) => s + d.total, 0));
  const weekendPerDay = weekend / 2;
  const weekdayPerDay = weekday / 5;
  if (weekendPerDay > weekdayPerDay * 1.15) {
    out.push({
      type: 'info',
      title: 'Weekends are expensive',
      body: `You average ₹${Math.round(weekendPerDay).toLocaleString('en-IN')} a day at the weekend vs ₹${Math.round(weekdayPerDay).toLocaleString('en-IN')} on weekdays.`,
    });
  }
  if (recurring.length) {
    const monthly = round2(recurring.filter((r) => r.frequency === 'monthly').reduce((s, r) => s + r.amount, 0));
    out.push({ type: 'info', title: `₹${monthly.toLocaleString('en-IN')} locked in subscriptions`, body: `${recurring.length} recurring payments are active. Review them in the Recurring tab.` });
  }
  return out;
}

/** Budget recommendations from the last 3 complete months of history. */
export function recommendBudgets(userId) {
  const rows = all(
    `SELECT c.id AS category_id, c.name AS category, c.icon,
            date(e.occurred_at) AS d, e.amount
       FROM expenses e JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = :u AND e.direction = 'debit' AND e.status != 'failed'`,
    { u: userId },
  );
  const months = new Set(rows.map((r) => monthKey(r.d)));
  const recent = [...months].sort().slice(-4, -1); // last 3 complete months
  const relevant = rows.filter((r) => recent.includes(monthKey(r.d)));
  const perCat = new Map();
  for (const r of relevant) {
    if (!perCat.has(r.category)) perCat.set(r.category, { category: r.category, category_id: r.category_id, icon: r.icon, total: 0 });
    perCat.get(r.category).total = round2(perCat.get(r.category).total + r.amount);
  }
  const n = recent.length || 1;
  return [...perCat.values()]
    .map((c) => ({ ...c, avgMonthly: round2(c.total / n), suggested: round2(Math.ceil((c.total / n) * 1.1 / 100) * 100) }))
    .sort((a, b) => b.avgMonthly - a.avgMonthly);
}

/** Payee autocomplete from history, ranked by frequency then recency. */
export function payeeDirectory(userId) {
  return all(
    `SELECT merchant, vpa, COUNT(*) AS times, MAX(occurred_at) AS last_seen,
            ROUND(AVG(amount), 2) AS avg_amount, SUM(amount) AS total
       FROM expenses
      WHERE user_id = :u AND vpa IS NOT NULL AND status != 'failed'
      GROUP BY vpa ORDER BY times DESC, last_seen DESC LIMIT 100`,
    { u: userId },
  );
}

export function summaryForPeriod(userId, from, to) {
  const r = get(
    `SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END),0) AS spend,
            COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END),0) AS income,
            COUNT(*) AS count
       FROM expenses
      WHERE user_id = :u AND status != 'failed'
        AND date(occurred_at) BETWEEN date(:from) AND date(:to)`,
    { u: userId, from, to },
  );
  return { ...r, spend: round2(r.spend), income: round2(r.income) };
}
