import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { all, get } from './db.js';
import { analyse, summaryForPeriod, payeeDirectory } from './analytics.js';
import { groupLedger } from './split.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DejaVu carries the ₹ glyph that the built-in Helvetica font lacks.
const FONT_DIRS = [
  join(__dirname, '..', 'assets', 'fonts'),
  '/usr/share/fonts/truetype/dejavu',
];
const FONT_REGULAR = ['DejaVuSans.ttf', 'NotoSans-Regular.ttf']
  .map((f) => FONT_DIRS.map((d) => join(d, f))).flat().find((p) => existsSync(p));
const FONT_BOLD = ['DejaVuSans-Bold.ttf', 'NotoSans-Bold.ttf']
  .map((f) => FONT_DIRS.map((d) => join(d, f))).flat().find((p) => existsSync(p));

const BODY = FONT_REGULAR ? 'Body' : BODY;
const BODY_BOLD = FONT_BOLD ? 'Body-Bold' : BODY_BOLD;

const M = 42; // page margin
const BRAND = '#4f46e5';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const money = (n, cur = '₹') =>
  `${cur}${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * DejaVu has no colour-emoji glyphs, so emoji would render as empty boxes.
 * Drop pictographs but keep the rupee sign and ordinary punctuation.
 */
export function cleanPdfText(value) {
  return String(value ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function humanRange(from, to) {
  if (!from && !to) return 'All time';
  return `${from ? fmtDate(from) : 'Start'} — ${to ? fmtDate(to) : 'Today'}`;
}

class Report {
  constructor(doc) {
    this.doc = doc;
    this.pageWidth = doc.page.width;
    this.contentWidth = this.pageWidth - M * 2;
  }

  get y() { return this.doc.y; }
  set y(v) { this.doc.y = v; }

  space(h) {
    if (this.doc.y + h > this.doc.page.height - 60) {
      this.doc.addPage();
      return true;
    }
    return false;
  }

  sectionTitle(text, sub) {
    this.space(56);
    const d = this.doc;
    d.moveDown(0.6);
    d.fillColor(BRAND).font(BODY_BOLD).fontSize(13).text(cleanPdfText(text), M, d.y);
    if (sub) {
      d.fillColor(MUTED).font(BODY).fontSize(8.5).text(cleanPdfText(sub), M, d.y + 1);
    }
    d.moveDown(0.35);
    const y = d.y + 2;
    d.moveTo(M, y).lineTo(M + this.contentWidth, y).strokeColor(LINE).lineWidth(1).stroke();
    d.moveDown(0.7);
    d.y = y + 10;
  }

  summaryCards(cards) {
    const d = this.doc;
    this.space(70);
    const gap = 10;
    const w = (this.contentWidth - gap * (cards.length - 1)) / cards.length;
    const h = 56;
    const top = d.y;
    cards.forEach((c, i) => {
      const x = M + i * (w + gap);
      d.roundedRect(x, top, w, h, 8).fillColor(c.bg || '#f8fafc').fill();
      d.roundedRect(x, top, w, h, 8).strokeColor(LINE).lineWidth(0.8).stroke();
      d.fillColor(MUTED).font(BODY).fontSize(8).text(cleanPdfText(c.label).toUpperCase(), x + 10, top + 10, { width: w - 20, lineBreak: false });
      d.fillColor(c.color || INK).font(BODY_BOLD).fontSize(13).text(cleanPdfText(c.value), x + 10, top + 23, { width: w - 20, lineBreak: false, ellipsis: true });
      if (c.sub) d.fillColor(MUTED).font(BODY).fontSize(7.5).text(cleanPdfText(c.sub), x + 10, top + 42, { width: w - 20, lineBreak: false, ellipsis: true });
    });
    d.y = top + h + 6;
  }

  hbar(rows, { valueKey = 'total', labelKey = 'name', color = BRAND, max = null, cur = '₹' } = {}) {
    const d = this.doc;
    const top = Math.max(...rows.map((r) => r[valueKey]), 1);
    const scaleMax = max || top;
    for (const r of rows) {
      this.space(24);
      const y = d.y;
      const labelW = 150;
      const barW = this.contentWidth - labelW - 110;
      d.fillColor(INK).font(BODY).fontSize(9).text(cleanPdfText(`${r.icon ? `${r.icon} ` : ''}${r[labelKey]}`), M, y, { width: labelW - 6, ellipsis: true });
      d.roundedRect(M + labelW, y + 2, barW, 9, 4.5).fillColor('#eef2f7').fill();
      const w = Math.max(2, (r[valueKey] / scaleMax) * barW);
      d.roundedRect(M + labelW, y + 2, w, 9, 4.5).fillColor(r.color || color).fill();
      d.fillColor(INK).font(BODY_BOLD).fontSize(8.5).text(money(r[valueKey], cur), M + labelW + barW + 8, y + 1, { width: 100, align: 'right' });
      d.y = y + 18;
    }
  }

  monthBars(months, cur = '₹') {
    const d = this.doc;
    this.space(120);
    const chartH = 90;
    const top = d.y + 6;
    const w = this.contentWidth;
    const max = Math.max(...months.map((m) => Math.max(m.total, m.income || 0)), 1);
    const bw = w / months.length;
    d.moveTo(M, top + chartH).lineTo(M + w, top + chartH).strokeColor(LINE).lineWidth(1).stroke();
    months.forEach((m, i) => {
      const x = M + i * bw;
      const spendH = (m.total / max) * (chartH - 10);
      const incomeH = ((m.income || 0) / max) * (chartH - 10);
      d.rect(x + bw * 0.16, top + chartH - spendH, bw * 0.3, spendH).fillColor(BRAND).fill();
      d.rect(x + bw * 0.5, top + chartH - incomeH, bw * 0.3, incomeH).fillColor('#22c55e').fill();
      d.fillColor(MUTED).font(BODY).fontSize(7).text(m.month.slice(2), x, top + chartH + 4, { width: bw, align: 'center' });
      d.fillColor(INK).font(BODY_BOLD).fontSize(6.5).text(
        `${Math.round(m.total / 1000)}k`,
        x, top + chartH - spendH - 9, { width: bw, align: 'center' },
      );
    });
    d.y = top + chartH + 20;
    d.fillColor(BRAND).font(BODY).fontSize(7.5).text('■ Spend', M, d.y - 4);
    d.fillColor('#22c55e').text('■ Income', M + 52, d.y - 4);
    d.y += 10;
  }

  table(headers, rows, widths, { align = [], fontSize = 8, cur = '₹' } = {}) {
    const d = this.doc;
    const drawHead = () => {
      const y = d.y;
      d.rect(M, y, this.contentWidth, 16).fillColor('#f1f5f9').fill();
      let x = M;
      headers.forEach((h, i) => {
        d.fillColor(MUTED).font(BODY_BOLD).fontSize(7.5)
          .text(cleanPdfText(h).toUpperCase(), x + 4, y + 5, { width: widths[i] - 8, align: align[i] || 'left' });
        x += widths[i];
      });
      d.y = y + 18;
    };
    this.space(30);
    drawHead();
    for (const r of rows) {
      if (this.space(16)) drawHead();
      const y = d.y;
      let x = M;
      r.forEach((cell, i) => {
        d.fillColor(i === r.length - 1 && align[i] === 'right' ? INK : '#334155')
          .font(i === r.length - 1 && align[i] === 'right' ? BODY_BOLD : BODY)
          .fontSize(fontSize)
          .text(cleanPdfText(cell), x + 4, y + 2, { width: widths[i] - 8, align: align[i] || 'left', ellipsis: true });
        x += widths[i];
      });
      d.y = y + 15;
      d.moveTo(M, d.y - 2).lineTo(M + this.contentWidth, d.y - 2).strokeColor('#f1f5f9').lineWidth(0.6).stroke();
    }
    d.moveDown(0.3);
    void cur;
  }

  bullets(items) {
    const d = this.doc;
    for (const it of items) {
      this.space(30);
      const color = { danger: '#dc2626', warn: '#d97706', info: BRAND }[it.type] || BRAND;
      const y = d.y;
      d.circle(M + 4, y + 5, 3).fillColor(color).fill();
      d.fillColor(INK).font(BODY_BOLD).fontSize(9).text(cleanPdfText(it.title), M + 14, y, { width: this.contentWidth - 14 });
      if (it.body) {
        d.fillColor(MUTED).font(BODY).fontSize(8).text(cleanPdfText(it.body), M + 14, d.y, { width: this.contentWidth - 14 });
      }
      d.y += 6;
    }
  }

  callout(title, body) {
    const d = this.doc;
    this.space(60);
    const y = d.y;
    const h = 46;
    d.roundedRect(M, y, this.contentWidth, h, 8).fillColor('#eef2ff').fill();
    d.fillColor(BRAND).font(BODY_BOLD).fontSize(10).text(cleanPdfText(title), M + 12, y + 9, { width: this.contentWidth - 24 });
    d.fillColor('#3730a3').font(BODY).fontSize(8.5).text(cleanPdfText(body), M + 12, y + 24, { width: this.contentWidth - 24 });
    d.y = y + h + 8;
  }
}

export function buildStatement(opts, stream) {
  const { userId, from, to, groupId = null, include = {} } = opts;
  const user = get(`SELECT * FROM users WHERE id = :u`, { u: userId });
  if (!user) throw new Error('User not found');

  const stats = analyse({ userId, from, to, groupId });
  const summary = summaryForPeriod(userId, from || '1970-01-01', to || '2999-12-31');
  const ledger = groupId ? groupLedger(groupId) : null;

  const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, autoFirstPage: true, info: {
    Title: `Whyso expense statement — ${user.name}`,
    Author: 'Whyso',
    Subject: 'Expense statement',
  } });
  if (FONT_REGULAR) doc.registerFont('Body', FONT_REGULAR);
  if (FONT_BOLD) doc.registerFont('Body-Bold', FONT_BOLD);
  doc.font(BODY);
  doc.pipe(stream);
  const r = new Report(doc);

  /* ---------------- Header band ---------------- */
  doc.rect(0, 0, doc.page.width, 96).fillColor(BRAND).fill();
  doc.fillColor('#ffffff').font(BODY_BOLD).fontSize(22).text('Whyso', M, 26);
  doc.font(BODY).fontSize(9).fillColor('#e0e7ff')
    .text('UPI-aware expense statement', M, 54);
  doc.font(BODY_BOLD).fontSize(11).fillColor('#ffffff')
    .text(cleanPdfText(user.name), 0, 26, { align: 'right', width: doc.page.width - M });
  doc.font(BODY).fontSize(8.5).fillColor('#e0e7ff')
    .text(cleanPdfText(user.vpa || 'No UPI ID on file'), 0, 43, { align: 'right', width: doc.page.width - M });
  doc.text(humanRange(from, to), 0, 57, { align: 'right', width: doc.page.width - M });
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, 0, 70, { align: 'right', width: doc.page.width - M });
  doc.y = 116;
  doc.fillColor(INK);

  /* ---------------- Summary ---------------- */
  const nMonths = stats.byMonth.length || 1;
  r.summaryCards([
    { label: 'Total spend', value: money(summary.spend), sub: `${summary.count} transactions`, bg: '#fef2f2', color: '#b91c1c' },
    { label: 'Total income', value: money(summary.income), sub: 'Credits in period', bg: '#f0fdf4', color: '#15803d' },
    { label: 'Net', value: money(summary.income - summary.spend), sub: 'Income − spend', bg: '#eff6ff', color: '#1d4ed8' },
    { label: 'Monthly average', value: money(summary.spend / nMonths), sub: `Across ${nMonths} month(s)`, bg: '#f8fafc', color: INK },
    { label: 'Avg ticket', value: money(stats.totals.avgTicket), sub: 'Per debit txn', bg: '#f8fafc', color: INK },
  ]);

  /* ---------------- Category breakdown ---------------- */
  if (include.categories !== false && stats.byCategory.length) {
    r.sectionTitle('Where the money went', 'Debit transactions grouped by category');
    r.hbar(stats.byCategory.slice(0, 10).map((c) => ({ ...c, name: `${c.name} (${c.pct}%)` })));
  }

  /* ---------------- Monthly trend ---------------- */
  if (include.trend !== false && stats.byMonth.length > 1) {
    r.sectionTitle('Month-on-month trend', 'Indigo = spend, green = income');
    r.monthBars(stats.byMonth);
  }

  /* ---------------- Forecast + insights ---------------- */
  if (stats.forecast) {
    const f = stats.forecast;
    r.callout(
      `Projected ${f.month} spend: ${money(f.projected)}`,
      `You have spent ${money(f.spent)} in ${f.day} of ${f.daysInMonth} days. At the current pace the month closes near ${money(f.projected)} with ${f.remainingDays} day(s) left.`,
    );
  }

  if (include.insights !== false && stats.insights.length) {
    r.sectionTitle('Insights', 'Automatic observations from your transaction history');
    r.bullets(stats.insights);
  }

  /* ---------------- Anomalies ---------------- */
  if (include.anomalies !== false && stats.anomalies.length) {
    r.sectionTitle('Unusual transactions', 'Statistically larger than your normal spend for that category');
    r.table(
      ['Date', 'Merchant', 'Category', 'Amount', 'Vs. usual'],
      stats.anomalies.map((a) => [
        fmtDate(a.occurred_at), a.merchant, a.category, money(a.amount),
        `${(a.amount / (a.median || 1)).toFixed(1)}× of ${money(a.median)}`,
      ]),
      [72, 150, 90, 90, 115],
      { align: ['left', 'left', 'left', 'right', 'right'] },
    );
  }

  /* ---------------- Budgets ---------------- */
  if (include.budgets !== false && stats.budgets.length) {
    r.sectionTitle('Budgets vs actual', `Current month (${new Date().toISOString().slice(0, 7)})`);
    r.table(
      ['Category', 'Budget', 'Spent', 'Remaining', 'Used'],
      stats.budgets.map((b) => [
        `${b.icon} ${b.category}`, money(b.amount), money(b.spent), money(b.remaining), `${b.pct}%`,
      ]),
      [180, 100, 100, 100, 47],
      { align: ['left', 'right', 'right', 'right', 'right'] },
    );
  }

  /* ---------------- Top merchants ---------------- */
  if (include.merchants !== false && stats.byMerchant.length) {
    r.sectionTitle('Top payees', 'Ranked by total paid, with UPI handle');
    r.table(
      ['Payee', 'UPI handle', 'Txns', 'Total'],
      stats.byMerchant.slice(0, 12).map((m) => [
        m.merchant, m.vpa || '—', String(m.count), money(m.total),
      ]),
      [170, 190, 47, 120],
      { align: ['left', 'left', 'right', 'right'] },
    );
  }

  /* ---------------- Occasion spend ---------------- */
  if (include.occasions !== false && stats.byOccasion.length) {
    r.sectionTitle('Occasion planning', 'Spend tracked against planned occasions');
    const occasions = all(
      `SELECT o.title, o.budget, o.date, o.status,
              COALESCE((SELECT SUM(amount) FROM expenses e WHERE e.occasion_id = o.id AND e.direction='debit'), 0) AS spent
         FROM occasions o WHERE o.user_id = :u ORDER BY o.date`,
      { u: userId },
    );
    r.table(
      ['Occasion', 'Date', 'Budget', 'Spent', 'Left'],
      occasions.map((o) => [
        o.title, fmtDate(o.date), money(o.budget), money(o.spent), money(o.budget - o.spent),
      ]),
      [170, 95, 85, 90, 87],
      { align: ['left', 'left', 'right', 'right', 'right'] },
    );
  }

  /* ---------------- Group settlement ---------------- */
  if (ledger) {
    r.sectionTitle(`${ledger.group.emoji} ${ledger.group.name} — settlement`, 'Net balances and the fewest transfers that clear them');
    r.table(
      ['Member', 'Paid', 'Share', 'Settled', 'Net'],
      ledger.balances.map((b) => [b.name, money(b.paid), money(b.owed), money(b.settled), money(b.net)]),
      [160, 90, 90, 90, 87],
      { align: ['left', 'right', 'right', 'right', 'right'] },
    );
    if (ledger.transfers.length) {
      doc.moveDown(0.2);
      doc.fillColor(MUTED).font(BODY_BOLD).fontSize(8.5).text('Suggested settlements', M, doc.y);
      doc.moveDown(0.2);
      r.table(
        ['From', 'To', 'Amount'],
        ledger.transfers.map((t) => [t.from.name, t.to.name, money(t.amount)]),
        [220, 220, 87],
        { align: ['left', 'left', 'right'] },
      );
    }
  }

  /* ---------------- Full ledger ---------------- */
  if (include.transactions !== false) {
    doc.addPage();
    doc.fillColor(BRAND).font(BODY_BOLD).fontSize(14).text('Transaction ledger', M, M);
    doc.fillColor(MUTED).font(BODY).fontSize(8.5)
      .text(`${humanRange(from, to)} · ${stats.topExpenses.length ? `${summary.count} records` : '0 records'}`, M, doc.y + 2);
    doc.moveDown(1);
    const ledgerParams = { u: userId };
    const ledgerWhere = [`e.user_id = :u`, `e.status != 'failed'`];
    if (from) { ledgerWhere.push('date(e.occurred_at) >= date(:from)'); ledgerParams.from = from; }
    if (to) { ledgerWhere.push('date(e.occurred_at) <= date(:to)'); ledgerParams.to = to; }
    if (groupId) { ledgerWhere.push('e.group_id = :g'); ledgerParams.g = groupId; }
    const rows = all(
      `SELECT e.occurred_at, e.merchant, e.direction, e.amount, e.method, e.vpa, e.note,
              c.name AS category, g.name AS group_name
         FROM expenses e
         LEFT JOIN categories c ON c.id = e.category_id
         LEFT JOIN groups g ON g.id = e.group_id
        WHERE ${ledgerWhere.join(' AND ')}
        ORDER BY e.occurred_at DESC`,
      ledgerParams,
    );
    const widths = [68, 138, 92, 58, 63, 88];
    const drawHead = () => {
      const y = doc.y;
      doc.rect(M, y, r.contentWidth, 16).fillColor('#f1f5f9').fill();
      ['Date', 'Merchant', 'Category', 'Method', 'Type', 'Amount'].forEach((h, i) => {
        const x = M + widths.slice(0, i).reduce((s, w) => s + w, 0);
        doc.fillColor(MUTED).font(BODY_BOLD).fontSize(7.5)
          .text(cleanPdfText(h).toUpperCase(), x + 4, y + 5, { width: widths[i] - 8, align: i === 5 ? 'right' : 'left' });
      });
      doc.y = y + 18;
    };
    r.space(30);
    drawHead();
    for (const t of rows) {
      if (r.space(15)) drawHead();
      const y = doc.y;
      const cells = [
        fmtDate(t.occurred_at),
        t.merchant,
        t.category || '—',
        t.method.toUpperCase(),
        t.direction === 'debit' ? 'Debit' : 'Credit',
        `${t.direction === 'debit' ? '−' : '+'}${money(t.amount)}`,
      ];
      let x = M;
      cells.forEach((c, i) => {
        doc.fillColor(i === 5 ? (t.direction === 'debit' ? '#b91c1c' : '#15803d') : '#334155')
          .font(i === 5 ? BODY_BOLD : BODY).fontSize(7.8)
          .text(cleanPdfText(c), x + 4, y + 2, { width: widths[i] - 8, align: i === 5 ? 'right' : 'left', ellipsis: true });
        x += widths[i];
      });
      doc.y = y + 14;
      doc.moveTo(M, doc.y - 2).lineTo(M + r.contentWidth, doc.y - 2).strokeColor('#f1f5f9').lineWidth(0.6).stroke();
    }

    const payees = payeeDirectory(userId).slice(0, 0);
    void payees;
  }

  /* ---------------- Footers ---------------- */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Footer sits inside the bottom margin, so relax that margin or pdfkit paginates again.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc.moveTo(M, y).lineTo(doc.page.width - M, y).strokeColor(LINE).lineWidth(0.8).stroke();
    doc.fillColor(MUTED).font(BODY).fontSize(7.5)
      .text('Whyso · This statement was generated automatically from your recorded transactions.', M, y + 5, { width: r.contentWidth - 90, lineBreak: false });
    doc.fillColor(MUTED).font(BODY).fontSize(7.5)
      .text(`Page ${i - range.start + 1} of ${range.count}`, 0, y + 5, { align: 'right', width: doc.page.width - M, lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return doc;
}
