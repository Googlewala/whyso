# Whyso — repository notes

UPI-aware expense manager. Express + vanilla-JS SPA + SQLite (`node:sqlite`).

## Commands

- `npm start` — run the server (port 12000, or `PORT`)
- `npm run dev` — same with `--watch`
- `npm test` — full suite (`node --test`, auto-discovers `test/`)

## Layout

- `src/upi.js` — UPI/QR parsing and building: VPA validation, PSP lookup,
  amount parsing, EMVCo/Bharat QR TLV, deep-link URIs, bank SMS/CSV parsing,
  merchant-name cleanup, MCC→category mapping.
- `src/split.js` — `computeShares` (equal/exact/percent/weights),
  `groupBalances`, `simplifyDebts` (greedy, ≤ n-1 transfers), `groupLedger`.
- `src/analytics.js` — `analyse()` returns every dashboard/PDF dimension in
  one pass; plus `recommendBudgets`, `payeeDirectory`, `summaryForPeriod`.
- `src/statement.js` — PDFKit statement builder. `cleanPdfText()` strips
  emoji because DejaVu has no colour-glyph coverage (rupee sign is kept).
- `src/routes/api.js` — all REST routes. Writes return **201**, reads 200.
- `src/server.js` — exports `app`; only binds a port when run as the entry
  point, so tests import it and listen on an ephemeral port.

## Conventions and gotchas

- ESM throughout (`"type": "module"`).
- `ok(res, data, status=200)` / `bad(res, msg, status=400)` helpers.
- Expense create response is `{ expense }`; list responses use `rows` plus
  `total`/`spend`/`income`, not `expenses`.
- `groupLedger(id)` returns `{ group, members, balances, transfers,
  total_spend }` — **no** `expenses`/`shares`. The group detail route adds
  those on top.
- Split payloads: either `split_mode` + `participants`, or
  `split: { mode, participants }`. Omitting participants splits equally
  across all group members.
- Import dedupes on UPI reference (`txn_ref`), so re-importing the same SMS
  commits 0 rows.

## Testing

Each test file sets `process.env.WHYSO_DB` to a fresh temp dir **before**
dynamic `import()` of app modules, then calls `seedIfEmpty()`. This gives
per-file DB isolation without a global teardown.
