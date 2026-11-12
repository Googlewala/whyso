/** Small DOM + formatting helpers shared by every view. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// The native replaceChildren() stringifies null/undefined into visible "null" text,
// which is easy to hit with conditional children. Filter them out once, here.
const nativeReplaceChildren = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function patched(...nodes) {
  return nativeReplaceChildren.apply(this, nodes.flat(9).filter((n) => n !== null && n !== undefined && n !== false));
};

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  for (const c of children.flat(3)) if (c !== null && c !== undefined && c !== false) f.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return f;
};

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- formatting ---------------- */

export const inr = (n, { paise = true } = {}) =>
  `₹${Number(n || 0).toLocaleString('en-IN', paise
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 })}`;

export const inrShort = (n) => {
  const v = Number(n || 0);
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  return `₹${v.toFixed(0)}`;
};

export const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

export function fdate(s, opts = {}) {
  if (!s) return '—';
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', ...opts });
}

export function fdatetime(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function monthLabel(key) {
  const [y, m] = String(key).split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

export const initials = (name) =>
  String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function firstOfMonth(offset = 0) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 10);
}

export function lastOfMonth(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset + 1, 0);
  return d.toISOString().slice(0, 10);
}

export const relDays = (n) => {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${Math.abs(n)} days ago`;
};

export function barColor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${hash} 62% 52%)`;
}

/* ---------------- feedback ---------------- */

export function toast(message, kind = '') {
  const wrap = $('#toasts');
  if (!wrap) return;
  const el = h('div', { class: `toast ${kind}`, text: message });
  wrap.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; el.style.transition = 'all .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

export function modal({ title, body, footer, onClose, width }) {
  const root = $('#modal-root');
  const close = () => { clear(root); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal', style: width ? `width:min(${width},100%)` : null },
    h('div', { class: 'modal-head' },
      h('h3', { text: title }),
      h('button', { class: 'x-btn', text: '✕', onclick: close, 'aria-label': 'Close' })),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null,
  );
  clear(root).append(h('div', { class: 'modal-back', onclick: (e) => { if (e.target.classList.contains('modal-back')) close(); } }, box));
  document.addEventListener('keydown', onKey);
  return { close, box };
}

export function confirmDialog(message, { title = 'Please confirm', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const okBtn = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: okLabel, onclick: () => { m.close(); resolve(true); } });
    const m = modal({
      title,
      body: h('p', { text: message, style: 'margin:0;color:#334155' }),
      footer: [h('button', { class: 'btn', text: 'Cancel', onclick: () => { m.close(); resolve(false); } }), okBtn],
      onClose: () => resolve(false),
    });
    okBtn.focus();
  });
}

/** Field builder: field('Amount', input, 'hint text') */
export function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', { text: label }), input, hint ? h('div', { class: 'tiny muted', text: hint }) : null);
}

export function statCard({ label, value, sub, spark, grad }) {
  return h('div', { class: `card stat ${grad ? 'grad' : ''}` },
    h('div', { class: 'lbl', text: label }),
    h('div', { class: 'val', text: value }),
    sub ? h('div', { class: 'sub', text: sub }) : null,
    spark ? h('div', { class: 'spark', text: spark }) : null,
  );
}

export function emptyState(emoji, title, sub) {
  return h('div', { class: 'empty' }, h('div', { class: 'em', text: emoji }), h('div', { style: 'font-weight:650', text: title }), sub ? h('div', { class: 'tiny', text: sub }) : null);
}

export function hbar(rows, { max, color = '#4f46e5', valueFmt = inr, labelKey = 'name' } = {}) {
  const top = max || Math.max(...rows.map((r) => Number(r.total || 0)), 1);
  return frag(rows.map((r) => h('div', { class: 'bar-row' },
    h('div', { class: 'nm', title: r[labelKey] }, r.icon ? `${r.icon} ` : '', r[labelKey]),
    h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.max(2, (r.total / top) * 100)}%;background:${r.color || color}` })),
    h('div', { class: 'amt', text: valueFmt(r.total) }),
  )));
}

export function monthChart(months) {
  const max = Math.max(...months.map((m) => Math.max(m.total, m.income || 0)), 1);
  const cols = months.map((m) => h('div', { class: 'month-col' },
    h('div', { class: 'month-val', text: inrShort(m.total) }),
    h('div', { class: 'month-bars' },
      h('div', { class: 'month-bar spend', style: `height:${(m.total / max) * 100}%`, title: `Spend ${inr(m.total)}` }),
      h('div', { class: 'month-bar income', style: `height:${((m.income || 0) / max) * 100}%`, title: `Income ${inr(m.income || 0)}` }),
    ),
    h('div', { class: 'month-lbl', text: monthLabel(m.month) }),
  ));
  return frag(
    h('div', { class: 'month-chart' }, cols),
    h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:#4f46e5' }), 'Spend'), h('span', {}, h('i', { style: 'background:#16a34a' }), 'Income')),
  );
}

export function donut(items, { size = 150 } = {}) {
  const total = items.reduce((s, i) => s + i.total, 0) || 1;
  const R = size / 2;
  const r = R * 0.62;
  let angle = -Math.PI / 2;
  const paths = items.slice(0, 9).map((it) => {
    const frac = it.total / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = R + r * Math.cos(angle); const y1 = R + r * Math.sin(angle);
    const x2 = R + r * Math.cos(a2); const y2 = R + r * Math.sin(a2);
    const x3 = R + R * Math.cos(a2); const y3 = R + R * Math.sin(a2);
    const x4 = R + R * Math.cos(angle); const y4 = R + R * Math.sin(angle);
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${R} ${R} 0 ${large} 0 ${x4} ${y4} Z`;
    angle = a2;
    return h('path', { d, fill: it.color || barColor(it.name), stroke: '#fff', 'stroke-width': '1.5' });
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'donut');
  paths.forEach((p) => svg.append(p));
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', R); text.setAttribute('y', R + 2);
  text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '13');
  text.setAttribute('font-weight', '700'); text.setAttribute('fill', '#0f172a');
  text.textContent = inrShort(total);
  svg.append(text);

  const legend = h('div', { class: 'donut-legend' }, items.slice(0, 9).map((it) => h('div', { class: 'li' },
    h('span', { class: 'dot', style: `background:${it.color || barColor(it.name)}` }),
    h('span', { class: 'nm' }, it.icon ? `${it.icon} ` : '', it.name),
    h('span', { class: 'vl', text: inrShort(it.total) }),
  )));
  return h('div', { class: 'donut-wrap' }, svg, legend);
}

export function table(headers, rows, opts = {}) {
  const { aligns = [], empty = 'Nothing here yet' } = opts;
  if (!rows.length) return emptyState('🗒️', empty);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' },
    h('thead', {}, h('tr', {}, headers.map((th, i) => h('th', { class: aligns[i] === 'right' ? 'num' : null, text: th })))),
    h('tbody', {}, rows),
  ));
}

export function pctPill(value) {
  const kind = value > 100 ? 'red' : value >= 85 ? 'amber' : 'green';
  return h('span', { class: `pill ${kind}`, text: pct(value) });
}

export function progress(value, color = '#4f46e5') {
  return h('div', { class: 'progress' }, h('span', { style: `width:${Math.min(100, value)}%;background:${value > 100 ? '#dc2626' : color}` }));
}

export const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadText(filename, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
