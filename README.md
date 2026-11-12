# Whyso — UPI-aware expense manager

Whyso is a self-hosted web app for people in India who pay for everything over
UPI. It reads UPI QR codes and deep links, imports bank SMS and CSV statements,
splits bills across groups, plans occasions, and turns it all into analytics and
a downloadable PDF statement.

Everything runs in one Node process with a SQLite file. No external services are
required; billing is optional.

## Features

**Scan and pay**
- Scan a UPI QR image in the browser — decodes plain UPI deep links and
  EMVCo / Bharat QR TLV payloads, including nested merchant templates.
- Parse a pasted UPI deep-link URI (`upi://pay?...`) or a bare VPA.
- Validate VPAs, detect the PSP from the handle (`@okhdfcbank`, `@ybl`, …),
  and parse amounts written as `₹1,20,000.50`, `Rs 500`, or `1.2k`.
- Scan history, payee directory, and generated pay links.

**Import**
- Paste bank SMS alerts; the parser extracts amount, direction, UPI reference,
  VPA and merchant, then maps MCC codes to categories.
- Upload a CSV bank statement.
- Drafts are de-duplicated on UPI reference, so re-importing the same rows
  commits nothing.

**Split and settle**
- Groups with members, roles and per-group currency.
- Split modes: equal, exact amounts, percentages, or weights.
- Group ledger with balances and greedy debt simplification (at most *n − 1*
  transfers).
- Record settlements against a group.

**Occasions**
- Plan events (trips, festivals, birthdays) with a target budget, date and a
  linked group, then track spend against the plan.

**Analyse**
- Totals, month-by-month trends, category and PSP breakdowns, top merchants.
- Spend forecast, recurring-payment detection, and anomaly flags.
- Budget recommendations per category.

**Report**
- One-click PDF statement (PDFKit) covering a chosen period.

**Accounts and plans**
- Email + password accounts with scrypt hashing and server-side sessions.
- Every record is scoped to its owner; cross-tenant reads and writes are denied.
- Free and Pro plans with enforced quotas, plus an optional Stripe checkout and
  webhook.

## Quick start

```bash
npm install
WHYSO_DEMO=1 npm start        # http://localhost:12000
```

With demo mode on, the first boot seeds a workspace with sample groups and
expenses. Sign in with `aarav@whyso.dev` / `demo1234` (the other demo users use
the same password).

Development with auto-restart:

```bash
npm run dev
```

## Configuration

All configuration is environment variables. See `.env.example` for the full
list. The ones that matter most:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `12000` | HTTP port |
| `WHYSO_DB` | `data/whyso.db` | SQLite file path |
| `APP_URL` | `http://localhost:$PORT` | Public URL, used for payment redirects |
| `WHYSO_DEMO` | on when not production | Seed the demo workspace |
| `WHYSO_ALLOW_SIGNUP` | `1` | Allow public sign-ups |
| `TRUST_PROXY` | on in production | Trust `X-Forwarded-*` headers |
| `SESSION_TTL_DAYS` | `30` | Session lifetime |
| `STRIPE_SECRET_KEY` / `STRIPE_PRICE_PRO` / `STRIPE_WEBHOOK_SECRET` | empty | Enable paid plans |

The server refuses to start in production with an inconsistent config (for
example, billing enabled but no `APP_URL`).

## Plans

| | Free | Pro |
| --- | --- | --- |
| Expenses / month | 150 | Unlimited |
| Groups | 2 | Unlimited |
| Occasions | 2 | Unlimited |
| Members per group | 4 | 50 |
| PDF statements / month | 3 | Unlimited |
| CSV import rows | 200 | 5,000 |

Quotas are checked before a write. A blocked action returns **402** with an
`upgrade: true` hint that the UI turns into an upgrade prompt.

Without Stripe configured, paid plans are disabled. In non-production you can
switch a plan for testing:

```bash
curl -X POST localhost:12000/api/billing/dev-activate \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"plan":"pro"}'
```

## Docker

```bash
docker build -t whyso .
docker run -d --name whyso -p 12000:12000 \
  -e NODE_ENV=production \
  -e APP_URL=http://localhost:12000 \
  -v whyso-data:/data \
  whyso
```

Or with Compose:

```bash
docker compose up --build
```

The image runs as a non-root user, keeps the database on the `/data` volume, and
ships a healthcheck that hits `/readyz`.

## Testing

```bash
npm test
```

The suite uses the built-in `node:test` runner and covers UPI parsing, splitting,
analytics, the statement builder, the REST API, authentication, billing and
entitlements, migrations, and tenant isolation. Each test file points `WHYSO_DB`
at a fresh temporary database, so files stay isolated without teardown.

## API overview

Authentication: `POST /api/auth/signup`, `POST /api/auth/login`,
`POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`.
Send the session token as `Authorization: Bearer <token>`, a
`whyso_session` cookie, or `?access_token=` for download links.

| Area | Endpoints |
| --- | --- |
| Bootstrap | `GET /api/bootstrap` |
| UPI | `POST /api/upi/parse`, `POST /api/upi/scan-image`, `POST /api/upi/link`, `GET /api/upi/history`, `GET /api/upi/payees` |
| Expenses | `GET/POST /api/expenses`, `GET/PUT/DELETE /api/expenses/:id` |
| Import | `POST /api/import/sms`, `POST /api/import/csv` |
| Groups | `GET/POST /api/groups`, `GET /api/groups/:id`, `POST/DELETE /api/groups/:id/members[/:userId]`, `POST /api/groups/:id/settle` |
| Occasions | `GET/POST /api/occasions`, `GET/PUT/DELETE /api/occasions/:id` |
| Analytics | `GET /api/analytics/summary`, `GET /api/analytics/budget-recommendations`, `GET/PUT /api/budgets`, `GET /api/insights` |
| Recurring | `GET/POST /api/recurring`, `DELETE /api/recurring/:id` |
| Statement | `GET /api/statement.pdf` |
| Billing | `GET /api/billing/status`, `POST /api/billing/checkout`, `POST /api/billing/portal`, `POST /api/billing/webhook` |

Operational probes: `GET /healthz` (liveness) and `GET /readyz` (readiness).

## Project layout

```
src/
  config.js      environment parsing and startup validation
  logger.js      structured JSON logging
  db.js          node:sqlite connection and versioned migrations
  auth.js        password hashing, sessions, user records
  billing.js     plans, quota checks, usage metering, Stripe adapter
  middleware.js  request context, security headers, rate limits, same-origin
  upi.js         QR/deep-link/SMS/CSV parsing and VPA helpers
  split.js       share computation, balances, debt simplification
  analytics.js   aggregation for dashboards and the PDF
  statement.js   PDFKit statement builder
  seed.js        reference data and the demo workspace
  server.js      Express app and lifecycle
  routes/        api.js, auth.js, billing.js
public/          vanilla-JS single-page app
scripts/         migrate, seed, healthcheck entry points
test/            node:test suite
```

## License

ISC.
