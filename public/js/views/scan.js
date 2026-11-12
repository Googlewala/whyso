import { api, qrUrl } from '../api.js';
import {
  $, h, frag, toast, field, inr, fdate, table, emptyState, modal, confirmDialog,
} from '../ui.js';
import { app, navigate } from '../app.js';
import { openExpenseForm } from './expenses.js';

/** Fetch scan history through the shared api wrapper (kept here so the view stays self-contained). */
async function scanHistory() {
  const res = await fetch(`/api/upi/history?user_id=${app.data.user.id}`);
  return res.ok ? res.json() : [];
}

export function scanView({ actions }) {
  const wrap = h('div');
  const stage = h('div', { class: 'scan-stage' });
  const status = h('div', { class: 'tiny muted', style: 'margin-top:8px;text-align:center' });
  let stream = null;
  let rafId = null;
  let canvas = null;
  let ctx = null;

  actions.append(
    h('button', { class: 'btn', onclick: () => startCamera(), text: '🎥 Start camera' }),
    h('button', { class: 'btn', onclick: () => pickImage(), text: '🖼 Upload image' }),
  );

  /* ---------------- camera scanning ---------------- */
  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'This browser has no camera API — use “Upload image” or paste the QR text below.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } });
    } catch (e) {
      status.textContent = `Camera unavailable (${e.name}). Upload an image or paste the QR text instead.`;
      return;
    }
    const video = h('video', { playsinline: true, autoplay: true, muted: true });
    stage.replaceChildren(video, h('div', { class: 'scan-frame' }), h('div', { class: 'scan-laser' }));
    video.srcObject = stream;
    await video.play().catch(() => {});
    status.textContent = 'Point the camera at a UPI QR code…';

    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (!stream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = 480;
        const scale = w / video.videoWidth;
        canvas.width = w;
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = window.jsQR ? window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }) : null;
        if (found?.data) {
          stopCamera();
          handleScan(found.data, 'camera');
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopCamera() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  /* ---------------- image upload ---------------- */
  function pickImage() {
    const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      status.textContent = `Reading ${file.name}…`;
      const img = await loadImage(file);
      const c = document.createElement('canvas');
      const maxW = 1000;
      const scale = Math.min(1, maxW / img.width);
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const cctx = c.getContext('2d', { willReadFrequently: true });
      cctx.drawImage(img, 0, 0, c.width, c.height);

      let found = decode(c, cctx);
      if (!found) {
        // Retry with a higher-contrast, larger render — screenshots and photos often need this.
        const c2 = document.createElement('canvas');
        c2.width = img.width; c2.height = img.height;
        const x2 = c2.getContext('2d', { willReadFrequently: true });
        x2.drawImage(img, 0, 0);
        found = decode(c2, x2, true);
      }
      stage.replaceChildren(h('canvas', { class: 'preview', id: 'scan-preview' }));
      const preview = $('#scan-preview', stage);
      preview.width = c.width; preview.height = c.height;
      preview.getContext('2d').drawImage(img, 0, 0, c.width, c.height);

      if (found) { handleScan(found, 'image'); }
      else {
        status.textContent = 'No QR code found in that image. Try a sharper crop, or paste the text below.';
        toast('Could not read a QR code from that image', 'err');
      }
    });
    input.click();
  }

  function decode(canvasEl, context, boost = false) {
    if (!window.jsQR) return null;
    const { width, height } = canvasEl;
    const img = context.getImageData(0, 0, width, height);
    if (boost) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = lum > 128 ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    const r = window.jsQR(img.data, width, height, { inversionAttempts: 'attemptBoth' });
    return r?.data || null;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  /* ---------------- shared handling ---------------- */
  async function handleScan(text, source) {
    status.textContent = `Decoded from ${source}. Analysing…`;
    try {
      const res = await api.parseQr(text);
      showResult(res, text, source);
    } catch (e) {
      status.textContent = '';
      toast(e.message, 'err');
    }
  }

  const paste = h('textarea', { placeholder: 'Or paste the raw QR contents / UPI link here, e.g.\nupi://pay?pa=blinkit@ybl&pn=Blinkit&am=1450&cu=INR&tn=Groceries&mc=5411' });
  const pasteBtn = h('button', {
    class: 'btn', text: 'Analyse text',
    onclick: () => { if (paste.value.trim()) handleScan(paste.value.trim(), 'paste'); },
  });

  const genBox = h('div');
  renderGenerator(genBox);

  wrap.append(
    h('div', { class: 'grid g-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', {}, h('div', { class: 'card-title', text: 'Scan a UPI QR code' }), h('div', { class: 'card-sub', text: 'Merchant, personal or Bharat QR (EMVCo)' })),
          h('button', { class: 'btn btn-sm', text: '⏹ Stop', onclick: () => { stopCamera(); status.textContent = 'Camera stopped.'; } }),
        ),
        stage,
        status,
        h('div', { class: 'row', style: 'margin-top:12px' },
          h('button', { class: 'btn btn-primary', onclick: () => startCamera(), text: '🎥 Start camera' }),
          h('button', { class: 'btn', onclick: () => pickImage(), text: '🖼 Upload image' }),
        ),
        h('div', { style: 'margin-top:14px' }, h('label', { class: 'tiny muted', style: 'font-weight:600' }, 'Manual / pasted payload'), paste, h('div', { style: 'margin-top:8px' }, pasteBtn)),
      ),
      h('div', {},
        h('div', { class: 'card', id: 'scan-result' }, emptyState('📷', 'Nothing scanned yet', 'Scan a QR or paste a UPI link to see the parsed payee, amount and suggested category')),
        h('div', { style: 'margin-top:14px' }, genBox),
      ),
    ),
    h('div', { class: 'card', style: 'margin-top:14px', id: 'scan-history' },
      h('div', { class: 'card-title', text: 'Recent scans' }),
      h('div', { class: 'card-sub', text: 'Every QR you analyse is kept for reference' }),
      h('div', { class: 'skeleton', style: 'height:80px' }),
    ),
  );

  loadHistory();

  async function loadHistory() {
    try {
      const hist = await scanHistory();
      const card = $('#scan-history', wrap);
      if (!card) return;
      card.replaceChildren(
        h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-title', text: 'Recent scans' }), h('div', { class: 'card-sub', text: 'Every QR you analyse is kept for reference' }))),
        table(
          ['When', 'Type', 'Payee', 'Amount', ''],
          hist.slice(0, 8).map((s) => h('tr', {},
            h('td', { class: 'tiny muted', text: fdate(s.created_at) }),
            h('td', {}, h('span', { class: 'pill grey', text: s.kind })),
            h('td', { class: 'tiny mono', text: s.parsed.vpa || s.parsed.name || '—' }),
            h('td', { class: 'num', text: s.parsed.amount ? inr(s.parsed.amount) : '—' }),
            h('td', {}, h('button', { class: 'btn btn-sm', text: 'Reuse', onclick: () => showResult({ parsed: s.parsed, suggested_category: null }, s.raw, 'history') })),
          )),
          { aligns: [null, null, null, 'right', null], empty: 'No scans yet' },
        ),
      );
    } catch { /* history is best-effort */ }
  }

  function showResult(res, raw, source) {
    const p = res.parsed;
    const card = $('#scan-result', wrap);
    if (!card) return;
    if (p.kind !== 'upi') {
      card.replaceChildren(
        h('div', { class: 'card-title', text: 'Not a UPI payment code' }),
        h('div', { class: 'card-sub', text: `Decoded as ${p.kind}` }),
        p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener', text: p.url, style: 'word-break:break-all' }) : h('div', { class: 'mono tiny', style: 'word-break:break-all;background:#f8fafc;padding:10px;border-radius:8px', text: raw.slice(0, 400) }),
        p.warnings?.length ? frag(p.warnings.map((w) => h('div', { class: 'insight warn' }, h('div', { class: 'ib' }), h('div', { class: 'ib2', text: w })))) : null,
      );
      return;
    }

    const cat = res.suggested_category;
    const rows = [
      ['Payee VPA', p.vpa || '—'],
      ['Payee name', p.name || '—'],
      ['Amount', p.amount ? inr(p.amount) : 'Not set in the QR (static code)'],
      ['Currency', p.currency || 'INR'],
      ['Merchant category code', p.mcc || '—'],
      ['UPI reference', p.ref || '—'],
      ['QR type', p.mode ? `${p.mode} code` : '—'],
      ['PSP handle', p.psp || '—'],
    ];

    const payLink = p.vpa ? buildLink(p) : null;

    card.replaceChildren(
      h('div', { class: 'card-head' },
        h('div', {}, h('div', { class: 'card-title', text: '✅ UPI payment code decoded' }), h('div', { class: 'card-sub', text: `Source: ${source}` })),
        cat ? h('span', { class: 'pill', text: `${cat.icon} ${cat.name}` }) : null,
      ),
      h('div', { class: 'grid g-2', style: 'align-items:start' },
        h('div', {}, frag(rows.map(([k, v]) => h('div', { class: 'kv' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', style: 'word-break:break-all', text: v }))))),
        h('div', { style: 'text-align:center' },
          p.vpa ? h('img', { src: qrUrl({ vpa: p.vpa, name: p.name || '', amount: p.amount || '', note: p.note || '' }), alt: 'UPI QR', style: 'width:150px;height:150px;border:1px solid #e5e9f0;border-radius:12px' }) : null,
          h('div', { class: 'tiny muted', style: 'margin-top:6px', text: 'Re-generated QR' }),
        ),
      ),
      p.warnings?.length ? h('div', { style: 'margin-top:10px' }, ...p.warnings.map((w) => h('div', { class: 'insight warn' }, h('div', { class: 'ib' }), h('div', { class: 'ib2', text: w })))) : null,
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'btn btn-primary', text: '＋ Record as expense', onclick: () => openExpenseForm(null, () => { toast('Saved from scan', 'ok'); loadHistory(); }, { merchant: p.name || p.vpa?.split('@')[0], vpa: p.vpa, amount: p.amount, note: p.note, method: 'upi' }) }),
        payLink ? h('a', { class: 'btn', href: payLink, text: '↗ Open in UPI app' }) : null,
        p.vpa ? h('button', { class: 'btn', text: '🔗 Copy pay link', onclick: () => copy(payLink, 'Pay link copied') }) : null,
        h('button', { class: 'btn', text: '⬇ Download QR', onclick: () => downloadQr(p) }),
      ),
      h('details', { style: 'margin-top:12px' },
        h('summary', { class: 'tiny muted', style: 'cursor:pointer' }, 'Raw QR payload'),
        h('div', { class: 'mono tiny', style: 'word-break:break-all;background:#f8fafc;padding:10px;border-radius:8px;margin-top:6px', text: raw }),
      ),
    );
  }

  return wrap;
}

function buildLink(p) {
  const q = new URLSearchParams();
  q.set('pa', p.vpa);
  if (p.name) q.set('pn', p.name);
  if (p.amount) q.set('am', Number(p.amount).toFixed(2));
  q.set('cu', p.currency || 'INR');
  if (p.note) q.set('tn', p.note);
  if (p.ref) q.set('tr', p.ref);
  if (p.mcc) q.set('mc', p.mcc);
  q.set('mode', p.amount ? '02' : '01');
  return `upi://pay?${q.toString()}`;
}

function downloadQr(p) {
  const a = h('a', { href: qrUrl({ vpa: p.vpa, name: p.name || '', amount: p.amount || '', note: p.note || '' }), download: `whyso-qr-${p.vpa}.png` });
  document.body.append(a); a.click(); a.remove();
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); }
  catch { toast('Copy failed — select and copy manually', 'err'); }
}

/* ------------------------------------------------------------------ *
 * "Request money" generator — build a UPI QR for any amount
 * ------------------------------------------------------------------ */

function renderGenerator(box) {
  const vpa = h('input', { type: 'text', placeholder: 'someone@bank' });
  const name = h('input', { type: 'text', placeholder: 'Payee name' });
  const amount = h('input', { type: 'number', step: '0.01', placeholder: '0.00' });
  const note = h('input', { type: 'text', placeholder: 'Note (max 50 chars)' });
  const out = h('div', { style: 'margin-top:12px' });

  const gen = h('button', {
    class: 'btn btn-primary', text: 'Generate UPI QR',
    onclick: async () => {
      if (!vpa.value.trim()) { toast('Enter a UPI ID first', 'err'); return; }
      try {
        const res = await api.payLink({ vpa: vpa.value.trim(), name: name.value.trim(), amount: amount.value, note: note.value.trim() });
        out.replaceChildren(
          h('div', { style: 'text-align:center;margin-top:10px' },
            h('img', { src: qrUrl({ uri: res.uri }), alt: 'UPI QR', style: 'width:180px;height:180px;border:1px solid #e5e9f0;border-radius:12px' }),
            h('div', { class: 'tiny muted', style: 'margin-top:6px;word-break:break-all', text: res.uri }),
            h('div', { class: 'row-tight', style: 'justify-content:center;margin-top:10px' },
              h('a', { class: 'btn btn-sm', href: res.uri, text: '↗ Open in UPI app' }),
              h('button', { class: 'btn btn-sm', text: '🔗 Copy link', onclick: () => copy(res.uri, 'Link copied') }),
              h('a', { class: 'btn btn-sm', href: qrUrl({ uri: res.uri }), download: 'whyso-request-qr.png', text: '⬇ QR' }),
            ),
          ),
        );
      } catch (e) { toast(e.message, 'err'); }
    },
  });

  box.replaceChildren(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {}, h('div', { class: 'card-title', text: 'Request money — build a UPI QR' }), h('div', { class: 'card-sub', text: 'Anyone can scan this to pay you the exact amount' })),
      ),
      h('div', { class: 'grid g-2' }, field('Payee UPI ID', vpa), field('Payee name', name)),
      h('div', { class: 'grid g-2', style: 'margin-top:12px' }, field('Amount (₹)', amount), field('Note', note)),
      h('div', { style: 'margin-top:12px' }, gen),
      out,
    ),
  );
}
