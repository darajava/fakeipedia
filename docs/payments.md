# Article purchases and credits

Reading and question preparation remain public. The generation endpoint only queues a paid article request or atomically reserves an account credit. The model is called by the database worker, never by a browser request.

On the question page, **Generate article** saves the contribution and tries to use one account credit. Readers with an available credit immediately enter the live article preview, where text and images appear as they are generated. Paid checkout also returns to this preview. Guests, readers without credits, and drafts with a pending checkout continue to the payment step. Refreshing the generation view resumes from its persisted preview without spending another credit.

Migration `0005` adds a generation preview snapshot to jobs. The worker pushes each model chunk through PostgreSQL LISTEN/NOTIFY to an authorized streaming response, with proxy buffering and compression disabled. Checkpoints are still saved about every 400ms for recovery; they no longer control the visible update rate. New connections subscribe before reading their checkpoint, and offset-based updates prevent duplicate or regressing text. Image completion is pushed immediately. No extra service or migration is needed for live streaming. Text still commits and consumes the credit before optional images finish, while the live preview stays open until the image pass completes. A stopped worker cannot strand an already-saved article: an inactive preview falls back to the article after two minutes. Restart the worker after deploying this change.

## Local setup and Stripe test mode

1. Copy the payment settings from `.env.example` into your local environment. Keep existing database and model keys. Set `APP_URL=http://localhost:3000`.
2. Create a Clerk application. In its authentication settings, enable email verification **links** for sign-in and sign-up (and disable unwanted password/social strategies). Account forms are embedded on this site at `/auth/sign-up` and `/auth/sign-in`; `/auth` defaults to account creation. The provider and middleware configure these local paths in code. Switching forms preserves the validated payment/account return destination. Add your local and production return URLs in Clerk. Configure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. The publishable key must be present during the Next.js build as well as at runtime. Only a verified primary email can link a Clerk identity to a local user; billing names/emails are never used as public attribution.
3. In Stripe **test mode**, create two one-time, fixed, positive-price products: one article and one credit pack. Set their Price IDs, your test secret key, and `CREDIT_PACK_QUANTITY`. Pack quantity is server-side; each Checkout line item has quantity 1. Prices and currency come from Stripe, not from the browser. Do not attach adjustable quantities or discounts. Amounts are a launch decision.
4. Run `npm run db:migrate`, then `npm run dev` and `npm run worker` in separate terminals. Production `npm start` supervises both processes together.
5. Forward Stripe events to `http://localhost:3000/api/billing/webhook` using `stripe listen --forward-to localhost:3000/api/billing/webhook`. Set its displayed signing secret as `STRIPE_WEBHOOK_SECRET` and restart the web server. Subscribe to `checkout.session.completed` and `checkout.session.async_payment_succeeded` in the deployed webhook endpoint.
6. Set `BILLING_ENABLED=true`. Keep `STRIPE_ALLOW_LIVE=false`. Visit a red link, save an optional answer, and complete Stripe test Checkout. The test card `4242 4242 4242 4242` with a future expiry can be used in test mode. Confirm the article, Discussion contribution, order, job, and credit ledger before launch. Test a declined card and cancel checkout too.

Official references: [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe testing](https://docs.stripe.com/testing), [Clerk authentication settings](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options), [Clerk Next.js setup](https://clerk.com/docs/nextjs/getting-started/quickstart).

## Railway

Commit all migrations, including `drizzle/meta`, before deploying. In the app service's **Settings → Deploy**, set **Pre-deploy command** to `npm run db:migrate` and **Start command** to `npm start`. Drizzle and the worker's TypeScript runtime are production dependencies. Pre-deploy migrations only need `DATABASE_URL`; they do not access the persistent volume. See [Railway pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command).

Set these commands in the service settings: Railway's current documentation deprecates adding new `railway.json` / `railway.toml` configuration. This change does not replace your existing deployment or infrastructure configuration. See [Railway configuration guidance](https://docs.railway.com/config-as-code).

Use **one replica**, with a persistent volume mounted at `/app/wiki-files`. Both Next.js and the worker run in the same container and use the same files. Set the application's `DATABASE_URL` to the Railway PostgreSQL reference. Set `APP_URL` to the canonical HTTPS origin, configure Clerk's production keys/allowed URLs, and configure Stripe's webhook at `https://YOUR_HOST/api/billing/webhook`.

First deploy with test-mode Stripe prices and keys. After the end-to-end checklist passes, replace them with live-mode prices, secret key and webhook secret, set the intended pack quantity, and explicitly set `STRIPE_ALLOW_LIVE=true`. `BILLING_ENABLED=false` disables new Stripe checkout; existing credits and already queued jobs can still run. Payment verification and refunds continue while checkout is disabled, using the configured Stripe key. Do not remove that key or treat disabling checkout as a worker pause.

## Records and recovery

- `generation_intents`: immutable title, target/source, displayed question and answer. A 256-bit browser capability protects a guest draft; only its hash is stored in PostgreSQL. The private purchase link includes the capability in the URL fragment, which is not sent in HTTP requests/referrers. Guests should bookmark that link; their browser also remembers it. Do not share it.
- `purchase_orders`: server-selected price/currency/pack amount and Stripe references. Guest purchases have no required account. Account orders and jobs require their authenticated owner and can be resumed from the account page on another device. Guest purchases are not automatically transferred to accounts.
- `credit_accounts` and `credit_transactions`: balances, reservations and an append-only ledger. SQL enforces nonnegative balances. A conditional update reserves a credit; the article save transaction consumes it. Duplicate payment events cannot grant credits twice.
- `generation_jobs`: one job per saved intent. Row locks and two-minute leases provide durable claims. A heartbeat renews the lease every 20 seconds. A worker killed during generation is recovered after its lease expires. At most three generation attempts run; lock contention with another writer does not consume an attempt. Stale workers cannot commit article text after losing their lease.
- Article text, successful contribution attribution, job completion and credit consumption commit together. Images/questions run afterward. Their failures never refund or discard completed text; the existing missing-image retry remains available.
- A stale red link or a terminal failure releases a credit or records a refund request. The worker processes refunds independently every 30 seconds using a stable Stripe idempotency key. Pending refunds remain visible until Stripe confirms success. `refund_error` records failures for operational attention; investigate errors in Stripe rather than issuing an unrelated second refund.
- Signed webhooks are the primary fulfillment mechanism. The account and payment pages also check accessible pending purchases with Stripe while polling, so returning from checkout updates the balance even if webhook delivery is delayed. These checks are throttled per order. The worker reconciles pending sessions independently. Returning from checkout never grants funds without server-side Stripe verification.
- Content reset preserves accounts, purchases, ledgers, jobs and draft snapshots. It refuses to run while payments/refunds or generation are pending. Deleting an article clears its job reference without deleting financial history.

### Interrupted checkout creation

If session creation returns an uncertain response, retry the same saved purchase. Its persisted order ID is the Stripe idempotency key. For requests older than 23 hours without a stored session ID, the application refuses to create another session: inspect Stripe using the order ID (`client_reference_id` / metadata), reconcile the session ID into the order, and then fulfill or cancel it. This deliberately avoids relying on a potentially expired Stripe idempotency key.

### Operational checks

Check queued/running jobs, pending refunds and pending checkout sessions after deployment or provider outages. A refund with `refund_error` may require intervention; do not mark it refunded before verifying Stripe. Keep backups of PostgreSQL and the persistent volume. Never run the content reset while the worker is processing articles.

## Verification

`npm test` runs the normal suite. Database integration tests use a disposable PostgreSQL schema and temporary article directory, leaving normal articles and balances untouched:

```sh
BILLING_TEST_DATABASE_URL=postgresql://... node --import tsx --test src/lib/billing-integration.test.ts
LORE_TEST_DATABASE_URL=postgresql://... node --import tsx --test src/lib/lore-integration.test.ts
```

The integration suite simulates Stripe and model responses. It does not replace testing hosted Clerk login and Stripe Checkout with your real **test-mode** configuration. Before enabling live mode, verify guest success/cancellation, email-link sign-in, a credit pack, credit spending, preserved answers after authentication failure, browser closure, worker interruption, refund recovery, and Discussion attribution.
