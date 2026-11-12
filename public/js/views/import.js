import { api } from '../api.js';
import { h, frag, table, inr, fdate, toast, emptyState, field, statCard } from '../ui.js';
import { navigate } from '../app.js';

let mode = 'sms';

export function importView({ actions }) {
  const wrap = h('div');
  const body = h('div', { id: 'import-body' });

  const tabs = h('div', { class: 'tabs' },
    h('button', { class: `tab ${mode === 'sms' ? 'active' : ''}`, dataset: { m: 'sms' }, text: '📩 Bank SMS', onclick: () => switchMode('sms') }),
    h('button', { class: `tab ${mode === 'csv' ? 'active' : ''}`, dataset: { m: 'csv' }, text: '📄 CSV statement', onclick: () => switchMode('csv') }),
    h('button', { class: `tab ${mode === 'paste' ? 'active' : ''}`, dataset: { m: 'paste' }, text: '🧪 Sample data', onclick: () => switchMode('paste') }),
  );

  function switchMode(m) {
    mode = m;
    [...tabs.children].forEach((t) => t.classList.toggle('active', t.dataset.m === m));
    render();
  }

  function render() {
    body.replaceChildren(mode === 'sms' ? smsPanel() : mode === 'csv' ? csvPanel() : samplePanel());
  }

  wrap.append(
    h('div', { class: 'insight info' },
      h('div', { class: 'ib' }),
      h('div', {}, h('div', { class: 'it', text: 'Import is preview-first' }),
        h('div', { class: 'ib2', text: 'Whyso parses everything into draft rows you can review. Nothing is saved until you press “Import selected”. Duplicate UPI reference numbers are skipped automatically.' })),
    ),
    tabs,
    body,
  );

  render();
  return wrap;
}

/* ------------------------------------------------------------------ *
 * SMS
 * ------------------------------------------------------------------ */

const SMS_SAMPLE = `Rs.1450.00 debited from A/c XX1234 to VPA blinkit@ybl (Blinkit) on 10-11-26. UPI Ref 416782345612.
INR 3,299.00 spent on your ICICI Bank Card ending 4321 at AMAZON on 07-Nov-2026. Ref 998877665544.
Rs 640.00 debited from A/c XX1234 to VPA swiggy@ybl (Swiggy) on 08-11-2026. UPI Ref 416782345690.
Rs 25,000.00 has been credited to A/c XX1234 from VPA employer.payroll@hdfcbank on 01-11-2026.
Rs.2,340.00 debited from A/c XX1234 to VPA tatapower@icici (Tata Power) on 05-11-2026. UPI Ref 416782345701.`;

function smsPanel() {
  const ta = h('textarea', { style: 'min-height:150px', placeholder: 'Paste one or more bank/UPI SMS alerts — one per line, or separated by blank lines.\n\nExample:\nRs.1450.00 debited from A/c XX1234 to VPA blinkit@ybl (Blinkit) on 10-11-26. UPI Ref 416782345612.' });
  const out = h('div', { id: 'sms-out', style: 'margin-top:14px' });

  const preview = h('button', {
    class: 'btn btn-primary', text: '🔍 Parse messages',
    onclick: async () => {
      if (!ta.value.trim()) { toast('Paste some SMS text first', 'err'); return; }
      out.replaceChildren(h('div', { class: 'skeleton', style: 'height:80px' }));
      try {
        const res = await api.importSms({ messages: ta.value });
        renderDrafts(out, res.drafts, 'sms');
      } catch (e) { out.replaceChildren(); toast(e.message, 'err'); }
    },
  });

  return h('div', { class: 'grid g-2', style: 'align-items:start' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {}, h('div', { class: 'card-title', text: 'Paste bank SMS alerts' }), h('div', { class: 'card-sub', text: 'Whyso reads the amount, direction, VPA, merchant and date' })),
        h('button', { class: 'btn btn-sm', text: 'Load sample', onclick: () => { ta.value = SMS_SAMPLE; } }),
      ),
      ta,
      h('div', { class: 'row', style: 'margin-top:12px' }, preview),
      h('div', { class: 'tiny muted', style: 'margin-top:10px' },
        'Handles the common formats from HDFC, ICICI, SBI, Axis, Kotak, Paytm and more: “Rs X debited…”, “INR X spent…”, “X credited…”, with VPA, card and reference numbers.'),
    ),
    out,
  );
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

function csvPanel() {
  const out = h('div', { id: 'csv-out' });
  const status = h('div', { class: 'tiny muted', style: 'margin-top:8px' });

  async function handleText(csv, label) {
    status.textContent = `Parsing ${label}…`;
    out.replaceChildren(h('div', { class: 'skeleton', style: 'height:80px' }));
    try {
      const res = await api.importCsv({ csv });
      renderDrafts(out, res.drafts, 'csv', res.warnings);
      status.textContent = `Parsed ${res.drafts.length} row(s) from ${label}.`;
    } catch (e) { out.replaceChildren(); status.textContent = ''; toast(e.message, 'err'); }
  }

  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    handleText(await f.text(), f.name);
  });

  const drop = h('div', { class: 'drop' },
    h('div', { style: 'font-size:26px', text: '📄' }),
    h('div', { style: 'font-weight:650;margin-top:6px' }, 'Drop a CSV statement here, or click to choose'),
    h('div', { class: 'tiny', text: 'Works with HDFC, ICICI, SBI, Axis, Kotak net-banking exports' }),
  );
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer.files?.[0];
    if (f) handleText(await f.text(), f.name);
  });

  const pasteCsv = h('textarea', { style: 'min-height:110px', placeholder: 'Date,Narration,Debit,Credit,Balance\n01/11/2026,UPI/DR/416782345612/blinkit@ybl/Blinkit,1450.00,,48250.00' });

  return h('div', { class: 'grid g-2', style: 'align-items:start' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('div', { class: 'card-title', text: 'Upload a CSV statement' }), h('div', { class: 'card-sub', text: 'Columns are auto-detected by name' }))),
      drop,
      fileInput,
      status,
      h('div', { style: 'margin-top:14px' },
        h('div', { class: 'tiny muted', style: 'font-weight:600;margin-bottom:6px' }, 'OR PASTE CSV'),
        pasteCsv,
        h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn', text: 'Parse pasted CSV', onclick: () => pasteCsv.value.trim() ? handleText(pasteCsv.value, 'pasted CSV') : toast('Paste CSV first', 'err') })),
      ),
    ),
    out,
  );
}

/* ------------------------------------------------------------------ *
 * Sample / demo
 * ------------------------------------------------------------------ */

function samplePanel() {
  return h('div', { class: 'card' },
    h('div', { class: 'card-title', text: 'Try it instantly' }),
    h('div', { class: 'card-sub', text: 'Add a few realistic transactions to see every feature working' }),
    h('div', { class: 'row' },
      h('button', {
        class: 'btn btn-primary', text: '📥 Import the SMS sample',
        onclick: async () => {
          try {
            const res = await api.importSms({ messages: SMS_SAMPLE, commit: true });
            toast(`Imported ${res.committed} transactions`, 'ok');
            navigate('expenses');
          } catch (e) { toast(e.message, 'err'); }
        },
      }),
      h('button', {
        class: 'btn', text: '🧾 Generate a PDF statement',
        onclick: () => window.open('/api/statement.pdf', '_blank'),
      }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Shared draft renderer
 * ------------------------------------------------------------------ */

function renderDrafts(container, drafts, source, warnings = []) {
  if (!drafts.length) {
    container.replaceChildren(h('div', { class: 'card' }, emptyState('🤔', 'Nothing parsed', 'Check the format and try again')));
    return;
  }
  const selected = new Set(drafts.map((d, i) => (d.amount > 0 ? i : -1)).filter((i) => i >= 0));

  const rows = drafts.map((d, i) => {
    const chk = h('input', { type: 'checkbox', checked: selected.has(i), style: 'width:auto', disabled: !(d.amount > 0) });
    chk.addEventListener('change', () => { chk.checked ? selected.add(i) : selected.delete(i); updateCount(); });
    return h('tr', {},
      h('td', {}, chk),
      h('td', { class: 'tiny', text: d.occurredAt ? fdate(d.occurredAt) : 'today' }),
      h('td', {}, h('div', { style: 'font-weight:600', text: d.merchant || 'Unknown' }), d.vpa ? h('div', { class: 'tiny muted mono', text: d.vpa }) : null),
      h('td', { class: 'tiny' }, h('span', { class: `pill ${d.direction === 'debit' ? 'red' : 'green'}`, text: d.direction })),
      h('td', { class: 'tiny mono muted', text: d.ref || '—' }),
      h('td', { class: 'num', text: d.amount ? inr(d.amount) : h('span', { class: 'pill red', text: 'no amount' }) }),
    );
  });

  const countPill = h('span', { class: 'pill', text: `${selected.size} selected` });
  function updateCount() { countPill.textContent = `${selected.size} selected`; }

  const importBtn = h('button', {
    class: 'btn btn-primary', text: '⬆ Import selected',
    onclick: async () => {
      const payload = drafts.filter((_, i) => selected.has(i));
      if (!payload.length) { toast('Select at least one row', 'err'); return; }
      importBtn.disabled = true;
      try {
        const res = source === 'csv' ? await api.importCsv({ csv: null, commit: true, drafts: payload }) : await api.importSms({ messages: null, commit: true, drafts: payload });
        toast(`Imported ${res.committed ?? payload.length} transaction(s)`, 'ok');
        navigate('expenses');
      } catch (e) { toast(e.message, 'err'); }
      finally { importBtn.disabled = false; }
    },
  });

  const total = drafts.filter((_, i) => selected.has(i)).reduce((s, d) => s + (d.amount || 0), 0);

  container.replaceChildren(h('div', { class: 'card pad-0' },
    h('div', { style: 'padding:14px 16px;border-bottom:1px solid var(--line)' },
      h('div', { class: 'row-tight', style: 'justify-content:space-between' },
        h('div', {}, h('div', { class: 'card-title', text: `Preview — ${drafts.length} row(s) detected` }), h('div', { class: 'card-sub', text: `Selected total ${inr(total)}` })),
        h('div', { class: 'row-tight' }, countPill, importBtn),
      ),
      warnings.length ? frag(warnings.map((w) => h('div', { class: 'insight warn', style: 'margin-top:8px' }, h('div', { class: 'ib' }), h('div', { class: 'ib2', text: w })))) : null,
    ),
    table(['', 'Date', 'Merchant', 'Type', 'Ref', 'Amount'], rows, { aligns: [null, null, null, null, null, 'right'] }),
  ));
  updateCount();
}
