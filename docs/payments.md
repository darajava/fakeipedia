# $0.90 / £0.85 / €0.90 article purchases

Reading is free. Each red article costs a single $0.90, £0.85 or €0.90 payment to generate, including its images. There are no accounts, sign-in, credit purchases, or bundles. The finished article is public and contributions appear as “Anonymous reader”.

Currency is selected from the visitor's IP address: GBP for GB, EUR for euro users, and USD elsewhere. On Railway, use the ingress-provided `X-Real-IP`; `X-Forwarded-For`'s first address is a fallback for other proxies. The server performs IPv4/IPv6 country lookups locally with `geoip-country`, without sending visitor IPs to another service. Browser language, client currency values, and country hints do not select the currency. Missing, private, invalid or unknown IPs default to USD. The preparation page, payment status and new checkout all use the same lookup. An existing pending checkout retains its saved amount and currency even if the visitor's IP changes. These are fixed prices, not exchange-rate conversions. Previously opened 1.00 and 1.50 article checkouts are still honored; new checkouts use the prices above.

The country database ships with the pinned `geoip-country` dependency. Refresh it regularly with `npm install --save-exact geoip-country@latest`, commit the package and lockfile changes, and redeploy. Next.js keeps the package external so its database files remain available at runtime. This product includes GeoLite2 Data created by [MaxMind](https://www.maxmind.com/), distributed through [geoip-country](https://github.com/sapics/geoip-country); see the package's LICENSE and EULA.

The preparation page saves the optional answer and opens the payment page. Only verified Stripe fulfillment queues generation. Private purchase tokens authorize status, cancellation, and live previews; they are retained in browser storage and recovery URL fragments, never query parameters. Successful billing API responses use `{ result: ... }`.

## Setup

1. Apply existing migrations with `npm run db:migrate` and configure the database and generation providers in `.env.example`.
2. Create an active, one-time, per-unit Stripe Price with **USD, GBP and EUR**, priced at **90 USD/EUR minor units and 85 GBP minor units ($0.90 / £0.85 / €0.90)**, with no quantity transformation. Use Stripe’s [manual currency prices](https://docs.stripe.com/payments/checkout/localize-prices/manual-currency-prices) to add USD and GBP currency options to an existing €0.90 Price, or create a new multi-currency Price. Set `STRIPE_ARTICLE_PRICE_ID` to its ID. The server expands and validates the selected currency; missing or incorrectly priced options prevent checkout in that currency.
3. Configure `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `APP_URL`. Use Stripe test mode and `http://localhost:3000` locally. Forward `checkout.session.completed` and `checkout.session.async_payment_succeeded` to `/api/billing/webhook`.
4. Set `BILLING_ENABLED=true`, keeping `STRIPE_ALLOW_LIVE=false` during testing. Checkout fixes quantity at one, disables adaptive pricing, automatic tax additions, promotion codes, and Managed Payments, and charges exactly $0.90, £0.85 or €0.90 in the selected currency.
5. Run `npm run dev` and `npm run worker`. Production `npm start` starts both processes; Railway should run `npm run db:migrate` before deployment and retain `/app/wiki-files` on its persistent volume. Restart both processes when deploying.

For Railway, set **Start Command** to `node src/scripts/start.mjs` directly, rather than `npm start`, so the launcher handles termination without an npm wrapper. Set **Draining Seconds** to **25** (or `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=25`), allowing its 20-second child shutdown deadline to finish. The launcher logs received shutdown signals and unexpected child exits; a normal stop exits with code 0, while an unexpected child exit still fails the service. These settings must be applied in Railway; editing this document does not change the live service.

Authentication keys and credit-pack settings are no longer required. No destructive migration is needed for this change: historical account and ledger tables remain for financial records and settlement of jobs already funded before deployment. No endpoint can create users, buy credits, or reserve a new credit. Already funded legacy jobs can finish; retired pending checkouts that complete for a bundle or an old article price are refunded automatically and do not queue new generation. Historical unused balances remain recorded for operational reconciliation.

### Switching to live payments

1. Activate the Stripe account and switch the Dashboard to live mode. Test-mode products, prices and keys cannot be used for live payments.
2. In **Product catalog**, open or create the article product. Add a **one-time** price for €0.90 and add USD $0.90 and GBP £0.85 as currency options on that same Price. Copy its `price_...` ID. Create a new Price for the updated amounts; changing an existing Price's base amount through the API is not supported.
3. In **Workbench → Webhooks**, create an event destination for **Your account**, with **Snapshot** payloads and these events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Set the endpoint to `https://YOUR_DOMAIN/api/billing/webhook`. Copy this live endpoint's `whsec_...` signing secret, not a local Stripe CLI secret.
4. Set the following on the production Railway service (and on a separately deployed worker, if applicable):

   ```dotenv
   APP_URL=https://YOUR_DOMAIN
   STRIPE_SECRET_KEY=rk_live_YOUR_KEY
   STRIPE_ARTICLE_PRICE_ID=price_YOUR_LIVE_PRICE
   STRIPE_WEBHOOK_SECRET=whsec_YOUR_LIVE_ENDPOINT_SECRET
   STRIPE_ALLOW_LIVE=true
   BILLING_ENABLED=true
   ```

   `STRIPE_SECRET_KEY` also accepts an existing `sk_live_...` key. For restricted keys, use the permissions below. Keep local development on test keys.
5. Deploy the updated code and variables together. Apply database migrations and ensure the generation worker is running; `npm start` launches both the web app and worker. Verify checkout shows $0.90, £0.85 or €0.90 in the expected currency, then confirm a real purchase delivers a successful webhook and starts generation.

See Stripe's [price setup](https://docs.stripe.com/products-prices/manage-prices), [live API keys](https://docs.stripe.com/keys) and [webhook setup](https://docs.stripe.com/webhooks).

### Restricted API keys

`STRIPE_SECRET_KEY` accepts both secret (`sk_test_` / `sk_live_`) and restricted (`rk_test_` / `rk_live_`) API keys. Both live key types require `STRIPE_ALLOW_LIVE=true`.

Based on this app's API calls, configure a restricted key with Prices: Read, Checkout Sessions: Write (includes Read), and Refunds: Write (includes Read). Verify these permissions in Stripe's sandbox, including expanded checkout line items and refund recovery; Stripe errors identify any additional resource permissions required. Webhook signatures use the separate `STRIPE_WEBHOOK_SECRET` (`whsec_...`); the app does not create webhook endpoints through the API.

## Recovery

Saved intents retain the answer before checkout. Repeated checkout requests reuse the pending order and Stripe idempotency key. Visiting a success URL never authorizes generation: signed webhooks, private payment polling, and worker reconciliation all verify the Stripe session against the saved order.

The worker claims jobs with row locks and two-minute leases, renews leases every 20 seconds, and retries interrupted work up to three times. Stale workers cannot commit. Text and contribution persistence commit with job completion; images run afterward and optional image failure does not discard a completed article.

A stale red link or terminal generation failure queues a refund. Refund reconciliation uses persisted Stripe references and idempotency keys to avoid issuing duplicate refunds. A refund error remains recorded for operational attention. Keep database and article-volume backups.

For an uncertain checkout creation older than 23 hours without a stored session ID, inspect Stripe using the saved order ID before retrying. The app refuses to create another session with a potentially expired idempotency key.

## Verification

`npm test` runs the unit suite. The database integration suite creates a disposable schema and temporary article directory:

```sh
BILLING_TEST_DATABASE_URL=postgresql://... node --import tsx --test src/lib/billing-integration.test.ts
```

Stripe and generation providers are simulated in integration tests. Separately verify hosted test-mode Checkout success, cancellation, declined payment, browser closure, webhook retries, and refund recovery before enabling live payments with `STRIPE_ALLOW_LIVE=true`.
