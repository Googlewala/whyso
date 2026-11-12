# Whyso — repository notes

UPI-aware expense manager. Express + vanilla-JS SPA + SQLite (`node:sqlite`).

## Commands

- `npm start` — run the server (port 12000, or `PORT`)
- `npm run dev` — same with `--watch`
- `npm test` — full suite (`node --test`, auto-discovers `test/`)
- `npm run migrate` — apply pending migrations and exit (deploy step)
- `npm run seed` — seed reference data; add `WHYSO_DEMO=1` for the demo workspace
- `npm run healthcheck` — hit `/readyz`; used by Docker and CI
- `WHYSO_DEMO=1 npm start` — boot with the demo workspace (log in as
  `aarav@whyso.dev` / `demo1234`)

## Layout

- `src/config.js` — all environment parsing in one place, plus
  `assertConfig()` which throws on broken production config (e.g. billing
  enabled without `APP_URL`). `config.billingEnabled` gates paid plans.
- `src/logger.js` — structured JSON logging; `logger.info/error(msg, ctx)`.
- `src/db.js` — `node:sqlite` connection. Migrations are an ordered array with
  ids like `001_initial`; the applied version lives in a single-row
  `schema_version` table. `migrate()` is idempotent, `initSchema()` is the
  back-compat shim. Exports `get/all/run/tx/closeDb`.
- `src/auth.js` — scrypt password hashing (`scrypt$...` format), sessions with
  SHA-256-hashed tokens, `publicUser()` (never leaks `password_hash`),
  `createUser()` (adds a default account row), `DEMO_ACCOUNTS` backfill.
- `src/billing.js` — `PLANS` (free/pro), `planFor()` (pro requires
  `plan_status = 'active'`), quota checks, usage metering, Stripe adapter.
  **Metric→limit-key mapping matters**: usage metric `expense` maps to plan
  limit `expenses_per_month` via `limitKeyFor()`. Getting this wrong silently
  disables a quota.
- `src/middleware.js` — `requestContext`, `securityHeaders`, `rateLimit`,
  `requireSameOrigin`, `createDrain`.
- `src/upi.js` — UPI/QR parsing and building: VPA validation, PSP lookup,
  amount parsing, EMVCo/Bharat QR TLV, deep-link URIs, bank SMS/CSV parsing,
  merchant-name cleanup, MCC→category mapping.
- `src/split.js` — `computeShares` (equal/exact/percent/weights),
  `groupBalances`, `simplifyDebts` (greedy, ≤ n-1 transfers), `groupLedger`.
- `src/analytics.js` — `analyse()` returns every dashboard/PDF dimension in
  one pass; plus `recommendBudgets`, `payeeDirectory`, `summaryForPeriod`.
- `src/statement.js` — PDFKit statement builder. `cleanPdfText()` strips
  emoji because DejaVu has no colour-glyph coverage (rupee sign is kept).
- `src/routes/api.js` — all resource routes. `userId(req)` is `req.user.id`;
  every query is scoped by `user_id`. Writes return **201**, reads 200, quota
  blocks return **402** with `{ upgrade: true, quota }`.
- `src/routes/auth.js` — signup/login/logout/logout-all/me/change-password/demo.
- `src/routes/billing.js` — status/checkout/portal/webhook/dev-activate.
  `dev-activate` is non-production only.
- `src/server.js` — exports `app`; binds a port only when run as the entry
  point, so tests import it and listen on an ephemeral port. Middleware order:
  body parsers → `requireSameOrigin` → cookie parser → session resolver.

## Conventions and gotchas

- ESM throughout (`"type": "module"`). Requires Node ≥ 22.5 (`node:sqlite`).
- `ok(res, data, status=200)` / `bad(res, msg, status=400, extra)` helpers.
- Expense create response is `{ expense }`; list responses use `rows` plus
  `total`/`spend`/`income`, not `expenses`.
- `groupLedger(id)` returns `{ group, members, balances, transfers,
  total_spend }` — **no** `expenses`/`shares`. The group detail route adds
  those on top.
- Split payloads: either `split_mode` + `participants`, or
  `split: { mode, participants }`. Omitting participants splits equally
  across all group members.
- Import dedupes on `(txn_ref, user_id)`, so re-importing the same SMS
  commits 0 rows.
- Sessions are accepted three ways: `Authorization: Bearer`, the
  `whyso_session` cookie, or `?access_token=` (for PDF download links).
- Free-plan group creation returns 402 once the count hits the limit — tests
  that need a group should sign up a fresh user rather than reuse one.

## Testing

Each test file sets `process.env.WHYSO_DB` to a fresh temp dir **before**
dynamic `import()` of app modules, then calls `initSchema()` / `seedIfEmpty()`.
This gives per-file DB isolation without a global teardown. `test/api.test.js`
authenticates via signup and sends `Authorization` headers on every request.
New subsystems (auth, billing, migrations, tenant isolation) have dedicated
files: `test/auth.test.js`, `test/billing.test.js`, `test/migrate.test.js`.
