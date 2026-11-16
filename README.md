# Production setup (Cloudflare Pages + Functions + D1, free plan)

Deploy from GitHub, not drag-and-drop (drag-and-drop ignores the `functions` folder). Keep the repo PRIVATE.

## 1. Deploy
1. Push every file to a private GitHub repository. In Cloudflare: Workers & Pages > Create > Pages > Connect to Git. Build command empty, output directory `/`.
2. Storage & databases > D1 > create `paydesk`, open Console, run `schema.sql`.
3. Pages project > Settings > Bindings > D1 database, variable name `DB`.
4. Custom domain: add your subdomain (CNAME).

## 2. Google sign-in
Google Cloud Console > Credentials > OAuth client (Web). Authorized JavaScript origins: your live URL. Publish the consent screen. Put the Client ID in `app.js` (`GOOGLE_CLIENT_ID`).

## 3. Settings (Pages > Settings > Variables and secrets, mark as Secret)
`GOOGLE_CLIENT_ID`, `SESSION_SECRET` (random 40+ chars), `RZP_KEY_ID`, `RZP_KEY_SECRET`, `RZP_WEBHOOK_SECRET`, `PLAN_PRICE_RUPEES` (20), `YEAR_PRICE_RUPEES` (199).

## 4. Razorpay
Webhook URL `https://YOUR-SITE/api/rzp-webhook`, events `payment.captured`, `subscription.charged`, `subscription.activated`, same secret. Payments unlock the plan for the user whose Google email matches the payment email; otherwise the user pastes the payment ID in the app (verified with Razorpay, one use per payment). Test with test keys, then make one live Rs 20 payment and refund it.

## 5. Safety nets
- Tests: `npm test` (also runs on every push via GitHub Actions).
- Backups: add repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; `backup.yml` exports D1 daily (30 days kept). Restore: `wrangler d1 execute paydesk --remote --file=backup.sql`.
- Uptime: monitor `https://YOUR-SITE/api/health` with a free uptime service.
- Rate limiting: Cloudflare dashboard > Security > WAF > Rate limiting rules on `/api/*`.
- Fill the [brackets] in privacy, terms, refund and contact pages, and have a lawyer review them.

## Go-live checklist
Real name and trademark check; legal pages reviewed; Razorpay live and webhook verified; backup restored once in a test; sign-in and sync tested on two phones; scan tested with real shop QRs on Android and iPhone; limits tested by a free user.

## Limits to know
- The free-plan limit is enforced on synced data and in the app; local-only use on a phone can't be forced.
- Free Cloudflare limits: 100,000 function requests a day, 10 ms CPU per request. Workers Paid ($5/month) is the first upgrade if you hit them.
- Not included yet: health-style home redesign, income and recurring entries, savings goals, Hindi UI, push reminders, bank statement import, Play Store wrapper.
