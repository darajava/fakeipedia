import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import Stripe from "stripe";
import { creditCheckoutRequest } from "../components/billing-client";

test("payments and durable generation against PostgreSQL", { skip: !process.env.BILLING_TEST_DATABASE_URL }, async (t) => {
  const root = process.cwd();
  const schema = `billing_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: process.env.BILLING_TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  const directory = await mkdtemp(path.join(tmpdir(), "fakeipedia-payments-"));
  const oldEnv = { ...process.env };
  let cleanDb: () => Promise<void> = async () => {};
  t.after(async () => {
    process.chdir(root);
    await cleanDb?.();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  });
  for (const file of (await readdir(path.join(root, "drizzle"))).filter((file) => file.endsWith(".sql")).sort()) {
    await admin.query((await readFile(path.join(root, "drizzle", file), "utf8")).replaceAll('"public".', `"${schema}".`));
  }
  const databaseUrl = new URL(process.env.BILLING_TEST_DATABASE_URL!);
  databaseUrl.searchParams.set("options", `-csearch_path=${schema}`);
  Object.assign(process.env, { DATABASE_URL: databaseUrl.toString(), GEMINI_API_KEY: "test", OPENAI_API_KEY: "test", BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_ARTICLE_PRICE_ID: "price_article", STRIPE_CREDIT_PACK_PRICE_ID: "price_pack", CREDIT_PACK_QUANTITY: "5", APP_URL: "http://localhost:3000" });
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  process.chdir(directory);
  const { db } = await import("../db");
  const { articleLockPool, acquireArticleLock } = await import("./article-lock");
  const { generationStreamPool, notifyGeneration } = await import("./billing/generation-stream");
  cleanDb = async () => { await generationStreamPool.end(); await db.$client.end(); await articleLockPool.end(); };
  const { saveIntent, readIntent, authorizeIntent } = await import("./billing/intents");
  const { createCheckout, fulfillCheckout, cancelCheckout, processRefunds, reconcilePayments, refreshPendingPayments } = await import("./billing/payments");
  const { reserveCredit, creditBalance, completeJob } = await import("./billing/credits");
  const { claimJob, runJob, recoverExhaustedJobs, publishGenerationProgress } = await import("./billing/worker");
  const { emptyGenerationProgress } = await import("./generation-progress");
  const { POST: publicGenerate } = await import("../app/api/articles/generate/route");
  const { POST: webhook } = await import("../app/api/billing/webhook/route");
  const { POST: checkoutEndpoint } = await import("../app/api/billing/checkout/route");
  const { POST: statusEndpoint } = await import("../app/api/billing/status/route");
  const { POST: progressEndpoint } = await import("../app/api/articles/progress/route");
  const { GET: imageStatusEndpoint } = await import("../app/api/articles/images/status/route");
  const { GET: balanceEndpoint } = await import("../app/api/billing/balance/route");
  const { savePublicHandle } = await import("./account-profile");
  const { discussionContributions } = await import("./discussion-contributions");
  const { POST: profileEndpoint } = await import("../app/api/account/profile/route");
  const sessions = new Map<string, Record<string, unknown>>();
  const sessionKeys = new Map<string, string>();
  const refunds = new Map<string, Record<string, unknown>>();
  let modelCalls = 0;
  let refundCalls = 0;
  let rejectCheckout = false;
  let sessionReads = 0;
  let failSessionRead = false;
  let failModel = false;
  let failRefund = false;
  let pendingRefund = false;
  let beforeModel: (prompt: string) => Promise<void> = async () => {};
  let beforeImage: () => Promise<void> = async () => {};
  let successfulImage = false;
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.stripe.com") {
      const headers = new Headers(init?.headers);
      const key = headers.get("idempotency-key") ?? "";
      const pathname = url.pathname;
      if (pathname.startsWith("/v1/prices/")) {
        const id = pathname.split("/").at(-1)!;
        return Response.json({ id, object: "price", active: true, type: "one_time", billing_scheme: "per_unit", unit_amount: id === "price_article" ? 150 : 500, currency: "eur" });
      }
      if (pathname === "/v1/checkout/sessions" && init?.method === "POST") {
        const fields = new URLSearchParams(String(init.body));
        // Simulate an account with Managed Payments enabled by default.
        if (fields.get("managed_payments[enabled]") !== "false") return Response.json({ error: { type: "invalid_request_error", message: "Unsupported parameter: payment_method_types with Managed Payments" } }, { status: 400 });
        if (rejectCheckout) return Response.json({ error: { type: "invalid_request_error", message: "Checkout configuration rejected" } }, { status: 400 });
        if (sessionKeys.has(key)) return Response.json(sessions.get(sessionKeys.get(key)!)!);
        const id = `cs_test_${sessions.size + 1}`;
        const price = fields.get("line_items[0][price]");
        const orderId = fields.get("client_reference_id");
        const session = { id, object: "checkout.session", url: `https://checkout.stripe.com/${id}`, status: "open", payment_status: "unpaid", mode: "payment", client_reference_id: orderId, metadata: { orderId }, currency: "eur", amount_total: price === "price_article" ? 150 : 500, payment_intent: `pi_${id}`, line_items: { data: [{ quantity: 1, price: { id: price } }], has_more: false } };
        sessions.set(id, session); sessionKeys.set(key, id);
        return Response.json(session);
      }
      if (pathname.startsWith("/v1/checkout/sessions/")) {
        sessionReads++;
        if (failSessionRead) return Response.json({ error: { type: "invalid_request_error", message: "Temporary session lookup failure" } }, { status: 400 });
        const id = pathname.split("/")[4];
        const session = sessions.get(id)!;
        assert.ok(session, pathname);
        if (pathname.endsWith("/expire")) session.status = "expired";
        return Response.json(session);
      }
      if (pathname === "/v1/refunds" && init?.method !== "POST") return Response.json({ object: "list", data: [...refunds.values()].filter(entry => entry.payment_intent === url.searchParams.get("payment_intent")), has_more: false });
      if (pathname === "/v1/refunds") {
        if (failRefund) return Response.json({ error: { type: "invalid_request_error", message: "Temporarily cannot refund" } }, { status: 400 });
        if (!refunds.has(key)) { refundCalls++; const fields = new URLSearchParams(String(init?.body)); refunds.set(key, { id: `re_${refundCalls}`, payment_intent: fields.get("payment_intent"), metadata: { orderId: fields.get("metadata[orderId]") }, status: pendingRefund ? "pending" : "succeeded" }); }
        return Response.json(refunds.get(key));
      }
      if (pathname.startsWith("/v1/refunds/")) return Response.json([...refunds.values()].find((entry) => entry.id === pathname.split("/").at(-1)));
      throw new Error(`Unexpected Stripe request: ${pathname}`);
    }
    const request = JSON.parse(String(init?.body));
    if (url.hostname === "generativelanguage.googleapis.com") {
      assert.equal(request.stream, true, "Only article generation should call the text model");
      modelCalls++;
      const prompt = request.messages[0].content as string;
      await beforeModel(prompt);
      const slug = prompt.match(/Article URL slug: ([^\n]+)/)![1];
      const title = prompt.match(/Begin with exactly:\n\n# ([^\n]+)/)![1];
      const markdown = `# ${title}\n\n![View](./images/${slug}_view.png "The subject")\n\nThe river runs backwards. [[Next Chapter]]`;
      return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: markdown }, finish_reason: failModel ? "length" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
    assert.equal(url.hostname, "api.openai.com");
    await beforeImage();
    if (successfulImage) return Response.json({ data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=" }] });
    return Response.json({ error: { message: "Optional image failure", type: "invalid_request_error" } }, { status: 400 });
  });
  const request = (body: object) => new Request("http://localhost:3000/api", { method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify(body) });
  let sequence = 0;
  const draft = async (answer = "", target?: string) => {
    const slug = target ?? `target-${++sequence}`;
    const sourceSlug = `source-${++sequence}`;
    await admin.query("INSERT INTO articles(wiki,slug,title,content) VALUES('world',$1,$2,$3) RETURNING *", [sourceSlug, "Source", `See [[${slug}]].`]);
    const body = { wiki: "world", slug, title: slug, sourceSlug, answer, requestId: crypto.randomUUID(), token: randomBytes(32).toString("hex") };
    return { intent: await saveIntent(body), body };
  };
  const user = async (balance = 0) => {
    const id = (await admin.query("INSERT INTO users(email) VALUES($1) RETURNING id", [`reader-${crypto.randomUUID()}@example.test`])).rows[0].id as number;
    await admin.query("INSERT INTO credit_accounts(user_id,balance) VALUES($1,$2)", [id, balance]);
    return id;
  };
  const markPaid = async (intentId?: string) => {
    const order = (await admin.query("SELECT * FROM purchase_orders WHERE ($1::uuid IS NULL OR intent_id=$1) ORDER BY created_at DESC LIMIT 1", [intentId ?? null])).rows[0];
    const session = sessions.get(order.stripe_session_id)!;
    session.payment_status = "paid"; session.status = "complete";
    return { order, session };
  };
  const signedEvent = (session: Record<string, unknown>) => {
    const body = JSON.stringify({ id: `evt_${session.id}`, object: "event", type: "checkout.session.completed", data: { object: session } });
    const signature = new Stripe("sk_test_fixture").webhooks.generateTestHeaderString({ payload: body, secret: "whsec_fixture" });
    return new Request("http://localhost:3000/api/billing/webhook", { method: "POST", headers: { "stripe-signature": signature }, body });
  };

  await t.test("unpaid requests, forged webhooks and another guest's token cannot start generation", async () => {
    const signedOutBalance = await balanceEndpoint(new Request("http://localhost:3000/api/billing/balance"));
    assert.deepEqual(await signedOutBalance.json(), { signedIn: false });
    assert.equal((await publicGenerate(request({ wiki: "world", slug: "target" }))).status, 402);
    const d = await draft("Preserved answer");
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: d.body.token }))).status, 402);
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: randomBytes(32).toString("hex"), funding: "credit" }))).status, 404);
    assert.equal((await webhook(request({ id: "fake" }))).status, 400);
    assert.equal((await checkoutEndpoint(request({ kind: "credits", intentId: d.intent.id, token: d.body.token, requestId: crypto.randomUUID(), price: "free", quantity: 999 }))).status, 401);
    assert.equal(modelCalls, 0);
    await assert.rejects(saveIntent({ ...d.body, answer: "Changed" }), /different details/);
    await assert.rejects(readIntent(d.intent.id, randomBytes(32).toString("hex")), /not found/);
  });
  await t.test("guest checkout ignores client prices, preserves the answer on cancellation and retries safely", async () => {
    const d = await draft("A precise answer with <script>text</script>.");
    const response = await checkoutEndpoint(request({ kind: "article", intentId: d.intent.id, token: d.body.token, requestId: crypto.randomUUID(), priceId: "price_free", amount: 1, quantity: 999 }));
    assert.equal(response.status, 200);
    const [order] = (await admin.query("SELECT * FROM purchase_orders WHERE intent_id=$1", [d.intent.id])).rows;
    assert.equal(order.price_id, "price_article"); assert.equal(order.amount, 150); assert.equal(order.user_id, null);
    const count = sessions.size;
    await createCheckout("article", d.intent, null, crypto.randomUUID());
    assert.equal(sessions.size, count);
    await cancelCheckout(d.intent.id, null);
    assert.equal((await readIntent(d.intent.id, d.body.token)).answer, d.body.answer);
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "cancelled");
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: d.body.token }))).status, 402);
  });
  await t.test("a rejected checkout can be retried without losing the saved answer", async () => {
    const d = await draft("Keep this after a checkout error.");
    rejectCheckout = true;
    await assert.rejects(createCheckout("article", d.intent, null, crypto.randomUUID()), /configuration rejected/);
    rejectCheckout = false;
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE intent_id=$1", [d.intent.id])).rows[0].status, "cancelled");
    assert.equal((await readIntent(d.intent.id, d.body.token)).answer, d.body.answer);
    const checkout = await createCheckout("article", d.intent, null, crypto.randomUUID());
    assert.ok(checkout.url);
    await cancelCheckout(d.intent.id, null);
  });
  await t.test("duplicate signed webhooks fund one job; worker saves text and contribution despite optional failures", async () => {
    const d = await draft("  The ferrymen elect their king.  ");
    await createCheckout("article", d.intent, null, crypto.randomUUID());
    const { session, order } = await markPaid(d.intent.id);
    const responses = await Promise.all([webhook(signedEvent(session)), webhook(signedEvent(session))]);
    assert.deepEqual(responses.map((r) => r.status), [200, 200]);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM generation_jobs WHERE intent_id=$1", [d.intent.id])).rows[0].n, 1);
    beforeModel = async (prompt) => {
      assert.ok(prompt.includes("The ferrymen elect their king."));
      assert.ok(prompt.includes(JSON.stringify({ answer: d.body.answer })));
      assert.equal((await admin.query("SELECT answer FROM lore_contributions WHERE id=$1", [d.intent.contributionId])).rows[0].answer, d.body.answer);
      assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "paid");
    };
    const job = await claimJob(); assert.ok(job);
    // No browser stream exists: the worker alone owns execution.
    await runJob(job);
    beforeModel = async () => {};
    const [saved] = (await admin.query("SELECT * FROM generation_jobs WHERE id=$1", [job.id])).rows;
    assert.equal(saved.status, "succeeded");
    assert.equal((await admin.query("SELECT status FROM lore_contributions WHERE id=$1", [d.intent.contributionId])).rows[0].status, "succeeded");
    assert.match(await readFile(path.join(directory, "wiki-files", "world", `${d.intent.slug}.md`), "utf8"), /river runs backwards/);
    await fulfillCheckout(String(session.id));
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: d.body.token }))).status, 200);
    assert.equal(await claimJob(), null);
  });
  await t.test("optional public handles follow authenticated funding and edits update Discussion", async () => {
    const owner = await user(1);
    const other = await user();
    await admin.query("UPDATE users SET name='Private billing name' WHERE id=$1", [owner]);
    assert.equal((await profileEndpoint(request({ handle: "Forged", userId: owner }))).status, 401);
    assert.equal((await profileEndpoint(new Request("http://localhost:3000/api/account/profile", { method: "POST", headers: { origin: "https://elsewhere.example" }, body: JSON.stringify({ handle: "Forged" }) }))).status, 403);
    await savePublicHandle(other, "Another reader");
    const d = await draft("The public library moves each winter.");
    await db.transaction(tx => reserveCredit(tx, d.intent, owner));
    const job = await claimJob(); assert.ok(job);
    await runJob(job);
    const article = (await admin.query("SELECT id FROM articles WHERE wiki='world' AND slug=$1", [d.intent.slug])).rows[0];
    let rows = await discussionContributions(article.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].handle, null);
    assert.ok(!JSON.stringify(rows).includes("Private billing name"));
    await savePublicHandle(owner, "  River reader  ");
    rows = await discussionContributions(article.id);
    assert.equal(rows[0].handle, "River reader");
    await savePublicHandle(owner, "New name");
    assert.equal((await discussionContributions(article.id))[0].handle, "New name");
    await assert.rejects(savePublicHandle(owner, "x".repeat(51)));
    assert.equal((await discussionContributions(article.id))[0].handle, "New name");
    await savePublicHandle(owner, "");
    assert.equal((await discussionContributions(article.id))[0].handle, null);
    assert.equal((await admin.query("SELECT handle FROM users WHERE id=$1", [other])).rows[0].handle, "Another reader");
  });
  await t.test("account switching starts a separate credit checkout and retries reuse one order", async () => {
    const firstUser = await user(); const secondUser = await user();
    const first = creditCheckoutRequest({ signedIn: true, userId: firstUser, authAvailable: true, prices: null });
    await createCheckout("credits", null, firstUser, first.requestId);
    await assert.rejects(createCheckout("credits", null, secondUser, first.requestId), /belongs to another purchase/);
    const second = creditCheckoutRequest({ signedIn: true, userId: secondUser, authAvailable: true, prices: null }, first);
    const checkout = await createCheckout("credits", null, secondUser, second.requestId);
    assert.ok(checkout.url);
    assert.deepEqual(await createCheckout("credits", null, secondUser, second.requestId), checkout);
    const orders = (await admin.query("SELECT id,user_id FROM purchase_orders WHERE request_id IN ($1,$2)", [first.requestId, second.requestId])).rows;
    assert.equal(orders.length, 2);
    assert.deepEqual(new Set(orders.map(order => order.user_id)), new Set([firstUser, secondUser]));
    for (const order of orders) await cancelCheckout(null, order.user_id, order.id);
  });
  await t.test("credit pack grants once and cannot be spent by another account", async () => {
    const owner = await user(); const other = await user();
    const d = await draft();
    await createCheckout("credits", d.intent, owner, crypto.randomUUID());
    const { session } = await markPaid(d.intent.id);
    await Promise.all([fulfillCheckout(String(session.id)), fulfillCheckout(String(session.id))]);
    assert.deepEqual(await creditBalance(owner), { balance: 5, reserved: 1, available: 4 });
    assert.equal((await readIntent(d.intent.id, undefined, owner)).id, d.intent.id);
    await assert.rejects(readIntent(d.intent.id, undefined, other), /private purchase link/);
    await assert.rejects(authorizeIntent(d.intent, other), /account that funded/);
    assert.equal((await statusEndpoint(request({ intentId: d.intent.id, token: d.body.token }))).status, 403);
    await assert.rejects(db.transaction(tx => reserveCredit(tx, d.intent, other)), /already been funded/);
    const job = await claimJob(); assert.ok(job); await runJob(job);
    assert.deepEqual(await creditBalance(owner), { balance: 4, reserved: 0, available: 4 });
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM lore_contributions WHERE request_id=$1", [d.intent.id])).rows[0].n, 0);
    await assert.rejects(db.transaction(tx => completeJob(tx, job, 1)), /lease was lost/);
    assert.deepEqual(await creditBalance(owner), { balance: 4, reserved: 0, available: 4 });
  });
  await t.test("simultaneous credit spending cannot overdraw the last credit", async () => {
    const owner = await user(1);
    const [a, b] = await Promise.all([draft(), draft()]);
    const results = await Promise.allSettled([db.transaction(tx => reserveCredit(tx, a.intent, owner)), db.transaction(tx => reserveCredit(tx, b.intent, owner))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected").length, 1);
    assert.deepEqual(await creditBalance(owner), { balance: 1, reserved: 1, available: 0 });
    const job = await claimJob(); assert.ok(job); await runJob(job);
    assert.deepEqual(await creditBalance(owner), { balance: 0, reserved: 0, available: 0 });
  });
  await t.test("lease expiry retries interrupted work and fences a stale worker", async () => {
    const owner = await user(1); const d = await draft("Remember the lighthouse.");
    await db.transaction(tx => reserveCredit(tx, d.intent, owner));
    const first = await claimJob(); assert.ok(first);
    await admin.query("UPDATE generation_jobs SET leased_until=now()-interval '1 minute' WHERE id=$1", [first.id]);
    const retry = await claimJob(); assert.ok(retry);
    assert.equal(retry.id, first.id); assert.equal(retry.attempts, 2); assert.notEqual(retry.leaseToken, first.leaseToken);
    await assert.rejects(db.transaction(tx => completeJob(tx, first, 1)), /lease was lost/);
    await runJob(retry);
    assert.deepEqual(await creditBalance(owner), { balance: 0, reserved: 0, available: 0 });
  });
  await t.test("article-save rollback leaves the reserved credit intact until a successful retry", async () => {
    const owner = await user(1); const d = await draft("Keep the original custom.");
    await db.transaction(tx => reserveCredit(tx, d.intent, owner));
    await admin.query("CREATE FUNCTION reject_debit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.balance < OLD.balance THEN RAISE EXCEPTION 'Simulated storage failure'; END IF; RETURN NEW; END $$");
    await admin.query("CREATE TRIGGER reject_debit BEFORE UPDATE ON credit_accounts FOR EACH ROW EXECUTE FUNCTION reject_debit()");
    const job = await claimJob(); assert.ok(job); await runJob(job);
    assert.deepEqual(await creditBalance(owner), { balance: 1, reserved: 1, available: 0 });
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM articles WHERE wiki='world' AND slug=$1", [d.intent.slug])).rows[0].n, 0);
    await assert.rejects(readFile(path.join(directory, "wiki-files", "world", `${d.intent.slug}.md`)), { code: "ENOENT" });
    await admin.query("DROP TRIGGER reject_debit ON credit_accounts");
    await admin.query("DROP FUNCTION reject_debit()");
    await admin.query("UPDATE generation_jobs SET available_at=now() WHERE id=$1", [job.id]);
    const retry = await claimJob(); assert.ok(retry); await runJob(retry);
    assert.deepEqual(await creditBalance(owner), { balance: 0, reserved: 0, available: 0 });
  });
  await t.test("terminal guest failure refunds once even when recording the refund first fails", async () => {
    const d = await draft(); await createCheckout("article", d.intent, null, crypto.randomUUID());
    const { session, order } = await markPaid(d.intent.id); await fulfillCheckout(String(session.id));
    failModel = true;
    for (let i = 0; i < 3; i++) {
      const job = await claimJob(); assert.ok(job); await runJob(job);
      await admin.query("UPDATE generation_jobs SET available_at=now() WHERE id=$1", [job.id]);
    }
    failModel = false;
    await admin.query("CREATE FUNCTION reject_refund_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'refunded' THEN RAISE EXCEPTION 'Simulated storage failure'; END IF; RETURN NEW; END $$");
    await admin.query("CREATE TRIGGER reject_refund_record BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION reject_refund_record()");
    const before = refundCalls;
    await processRefunds();
    await admin.query("DROP TRIGGER reject_refund_record ON purchase_orders");
    await admin.query("DROP FUNCTION reject_refund_record()");
    await processRefunds(); await processRefunds();
    assert.equal(refundCalls, before + 1);
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "refunded");
  });
  await t.test("three failed attempts restore one credit, retain the answer, and cannot consume again", async () => {
    const owner = await user(1); const d = await draft("Keep this for retry.");
    await db.transaction(tx => reserveCredit(tx, d.intent, owner));
    failModel = true;
    for (let i = 1; i <= 3; i++) {
      const job = await claimJob(); assert.ok(job); assert.equal(job.attempts, i); await runJob(job);
      await admin.query("UPDATE generation_jobs SET available_at=now() WHERE id=$1", [job.id]);
    }
    failModel = false;
    assert.deepEqual(await creditBalance(owner), { balance: 1, reserved: 0, available: 1 });
    assert.equal((await readIntent(d.intent.id, d.body.token)).answer, d.body.answer);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM credit_transactions WHERE user_id=$1 AND reserved_delta=-1", [owner])).rows[0].n, 1);
    assert.equal(await claimJob(), null);
  });
  await t.test("stale red links refund the single purchase, including retries and pending refunds", async () => {
    const d = await draft(); await createCheckout("article", d.intent, null, crypto.randomUUID());
    const { session, order } = await markPaid(d.intent.id); await fulfillCheckout(String(session.id));
    await admin.query("INSERT INTO articles(wiki,slug,title,content) VALUES('world',$1,$1,'Already written')", [d.intent.slug]);
    const job = await claimJob(); assert.ok(job); await runJob(job);
    assert.equal((await admin.query("SELECT status FROM generation_jobs WHERE id=$1", [job.id])).rows[0].status, "superseded");
    failRefund = true; await processRefunds(); failRefund = false;
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "refund_pending");
    const before = refundCalls;
    pendingRefund = true; await processRefunds(); pendingRefund = false;
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "refund_pending");
    for (const entry of refunds.values()) entry.status = "succeeded";
    await processRefunds(); await processRefunds();
    assert.equal(refundCalls, before + 1);
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "refunded");
  });
  await t.test("third interrupted attempt returns funds and concurrent target locks do not waste attempts", async () => {
    const owner = await user(1); const d = await draft(); await db.transaction(tx => reserveCredit(tx, d.intent, owner));
    const job = await claimJob(); assert.ok(job);
    const release = await acquireArticleLock(`generation:world:${d.intent.slug}`);
    await runJob(job); await release();
    assert.equal((await admin.query("SELECT attempts FROM generation_jobs WHERE id=$1", [job.id])).rows[0].attempts, 0);
    await admin.query("UPDATE generation_jobs SET status='running',attempts=3,lease_token=$2,leased_until=now()-interval '1 minute' WHERE id=$1", [job.id, crypto.randomUUID()]);
    await recoverExhaustedJobs(); await recoverExhaustedJobs();
    assert.deepEqual(await creditBalance(owner), { balance: 1, reserved: 0, available: 1 });
  });
  await t.test("reconciliation recovers missed delivery and rejects altered paid sessions", async () => {
    const d = await draft(); await createCheckout("article", d.intent, null, crypto.randomUUID());
    const { session } = await markPaid(d.intent.id);
    session.amount_total = 1;
    await assert.rejects(fulfillCheckout(String(session.id)), /does not match/);
    assert.equal(await claimJob(), null);
    session.amount_total = 150;
    await reconcilePayments();
    const job = await claimJob(); assert.ok(job); await runJob(job);
  });
  const allowPaymentRefresh = async (orderId: string) => {
    await admin.query("UPDATE purchase_orders SET checked_at=now()-interval '1 minute' WHERE id=$1", [orderId]);
  };
  await t.test("account polling confirms paid credits without a webhook or resume and scopes access", async () => {
    const owner = await user(); const other = await user();
    await createCheckout("credits", null, owner, crypto.randomUUID());
    const { order, session } = await markPaid();
    await allowPaymentRefresh(order.id);
    const reads = sessionReads;
    await refreshPendingPayments({ userId: null });
    await refreshPendingPayments({ userId: other });
    assert.equal(sessionReads, reads);
    await Promise.all([refreshPendingPayments({ userId: owner }), refreshPendingPayments({ userId: owner })]);
    assert.equal(sessionReads, reads + 2);
    assert.deepEqual(await creditBalance(owner), { balance: 5, reserved: 0, available: 5 });
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "paid");
    await refreshPendingPayments({ userId: owner });
    await fulfillCheckout(String(session.id));
    assert.deepEqual(await creditBalance(owner), { balance: 5, reserved: 0, available: 5 });
  });
  await t.test("repeated generation submissions reserve one credit for the saved contribution", async () => {
    const owner = await user(2);
    const d = await draft("Preserve this answer before starting");
    assert.ok(d.intent.contributionId);
    const [first, second] = await Promise.all([
      db.transaction(tx => reserveCredit(tx, d.intent, owner)),
      db.transaction(tx => reserveCredit(tx, d.intent, owner)),
    ]);
    assert.equal(first.id, second.id);
    assert.deepEqual(await creditBalance(owner), { balance: 2, reserved: 1, available: 1 });
    const job = await claimJob(); assert.ok(job); await runJob(job);
    const retry = await db.transaction(tx => reserveCredit(tx, d.intent, owner));
    assert.equal(retry.id, first.id);
    assert.deepEqual(await creditBalance(owner), { balance: 1, reserved: 0, available: 1 });
    assert.equal((await readIntent(d.intent.id, d.body.token, owner)).answer, "Preserve this answer before starting");
  });
  await t.test("intent polling confirms a credit pack and reserves its article without exposing another account", async () => {
    const owner = await user(); const d = await draft("Keep this contribution");
    await createCheckout("credits", d.intent, owner, crypto.randomUUID());
    const { order } = await markPaid(d.intent.id);
    await allowPaymentRefresh(order.id);
    await refreshPendingPayments({ intentId: d.intent.id, userId: null });
    await refreshPendingPayments({ intentId: d.intent.id, userId: await user() });
    assert.deepEqual(await creditBalance(owner), { balance: 0, reserved: 0, available: 0 });
    await refreshPendingPayments({ intentId: d.intent.id, userId: owner });
    assert.deepEqual(await creditBalance(owner), { balance: 5, reserved: 1, available: 4 });
    const job = await claimJob(); assert.ok(job); await runJob(job);
    assert.equal((await readIntent(d.intent.id, undefined, owner)).answer, "Keep this contribution");
  });
  await t.test("payment status verifies guest checkout and returns the new job in the same response", async () => {
    const d = await draft(); await createCheckout("article", d.intent, null, crypto.randomUUID());
    const { order } = await markPaid(d.intent.id);
    await allowPaymentRefresh(order.id);
    const reads = sessionReads;
    assert.equal((await statusEndpoint(request({ intentId: d.intent.id, token: randomBytes(32).toString("hex") }))).status, 404);
    assert.equal(sessionReads, reads);
    const response = await statusEndpoint(request({ intentId: d.intent.id, token: d.body.token }));
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.orders[0].status, "paid"); assert.equal(status.job.status, "queued");
    const job = await claimJob(); assert.ok(job); await runJob(job);
  });
  await t.test("polling throttles unpaid checks and retries provider failures without trusting return flags", async () => {
    const owner = await user();
    await createCheckout("credits", null, owner, crypto.randomUUID());
    const { order, session } = await markPaid();
    session.payment_status = "unpaid"; session.status = "open";
    await allowPaymentRefresh(order.id);
    await refreshPendingPayments({ userId: owner });
    const reads = sessionReads;
    await refreshPendingPayments({ userId: owner });
    assert.equal(sessionReads, reads);
    assert.equal((await creditBalance(owner)).balance, 0);
    session.payment_status = "paid"; session.status = "complete";
    await allowPaymentRefresh(order.id);
    failSessionRead = true;
    await refreshPendingPayments({ userId: owner });
    failSessionRead = false;
    assert.equal((await creditBalance(owner)).balance, 0);
    session.amount_total = 1;
    await allowPaymentRefresh(order.id);
    await refreshPendingPayments({ userId: owner });
    assert.equal((await creditBalance(owner)).balance, 0);
    session.amount_total = 500;
    await allowPaymentRefresh(order.id);
    await refreshPendingPayments({ userId: owner });
    assert.equal((await creditBalance(owner)).balance, 5);
  });
  await t.test("live preview retains committed text while images run and replays completed images", async () => {
    const d = await draft(); await createCheckout("article", d.intent, null, crypto.randomUUID());
    const { session } = await markPaid(d.intent.id); await fulfillCheckout(String(session.id));
    const job = await claimJob(); assert.ok(job);
    let releaseImage!: () => void;
    let imageStarted!: () => void;
    const imageGate = new Promise<void>(resolve => { releaseImage = resolve; });
    const started = new Promise<void>(resolve => { imageStarted = resolve; });
    beforeImage = async () => { imageStarted(); await imageGate; };
    successfulImage = true;
    const running = runJob(job);
    try {
      await started;
      // Image execution and stream consumption run independently in the worker.
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = (await admin.query("SELECT progress FROM generation_jobs WHERE id=$1", [job.id])).rows;
        if (row.progress?.phase === "images") break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const body = { intentId: d.intent.id, token: d.body.token, includeProgress: true };
      const preview = await (await statusEndpoint(request(body))).json();
      assert.equal(preview.job.status, "succeeded", "Text and payment have committed");
      assert.equal(preview.job.previewComplete, false, "Do not redirect before images finish");
      assert.equal(preview.progress.phase, "images");
      assert.match(preview.progress.markdown, /river runs backwards/);
      assert.deepEqual(preview.progress.readyImages, {});
      const publicImageStatus = () => imageStatusEndpoint(new Request(`http://localhost:3000/api/articles/images/status?wiki=world&slug=${d.intent.slug}`));
      const pendingImage = await publicImageStatus();
      assert.equal(pendingImage.headers.get("cache-control"), "no-store");
      const publicState = await pendingImage.json();
      assert.deepEqual(Object.keys(publicState), ["images"], "Public image status exposes no private contribution or payment data");
      assert.equal(publicState.images[`${d.intent.slug}_view.png`].state, "pending");
      await admin.query("UPDATE generation_jobs SET progress_updated_at=now()-interval '3 minutes' WHERE id=$1", [job.id]);
      assert.equal((await (await publicImageStatus()).json()).images[`${d.intent.slug}_view.png`].state, "missing", "A stopped worker must not leave an endless spinner");
      await publishGenerationProgress(job, { ...preview.progress, failedImages: { [`${d.intent.slug}_view.png`]: true } });
      assert.equal((await (await publicImageStatus()).json()).images[`${d.intent.slug}_view.png`].state, "missing", "Failed images offer retry instead of spinning");
      await publishGenerationProgress(job, preview.progress);
      const reconnect = await (await statusEndpoint(request(body))).json();
      assert.deepEqual(reconnect.progress, preview.progress);
      assert.equal((await statusEndpoint(request({ ...body, token: randomBytes(32).toString("hex") }))).status, 404);
      await publishGenerationProgress({ ...job, leaseToken: crypto.randomUUID() }, emptyGenerationProgress());
      const fenced = await (await statusEndpoint(request(body))).json();
      assert.deepEqual(fenced.progress, preview.progress, "A stale worker cannot overwrite the preview");
    } finally { releaseImage(); await running; beforeImage = async () => {}; successfulImage = false; }
    const finished = await (await statusEndpoint(request({ intentId: d.intent.id, token: d.body.token, includeProgress: true }))).json();
    assert.equal(finished.job.previewComplete, true);
    assert.equal(finished.progress.phase, "done");
    assert.equal(Object.keys(finished.progress.readyImages).length, 1);
    assert.equal(Object.keys(finished.progress.failedImages).length, 0);
    const ready = await imageStatusEndpoint(new Request(`http://localhost:3000/api/articles/images/status?wiki=world&slug=${d.intent.slug}`));
    assert.equal((await ready.json()).images[`${d.intent.slug}_view.png`].state, "ready");
    assert.equal((await imageStatusEndpoint(new Request("http://localhost/api/articles/images/status?wiki=../world&slug=target"))).status, 400);
    const lightweight = await (await statusEndpoint(request({ intentId: d.intent.id, token: d.body.token }))).json();
    assert.equal(lightweight.progress, undefined);
  });
  await t.test("authorized live readers receive individual deltas before checkpoint writes and can reconnect", async () => {
    const d = await draft(); await createCheckout("article", d.intent, null, crypto.randomUUID());
    const { session } = await markPaid(d.intent.id); await fulfillCheckout(String(session.id));
    const job = await claimJob(); assert.ok(job);
    assert.equal((await progressEndpoint(request({ intentId: d.intent.id, token: randomBytes(32).toString("hex") }))).status, 404);
    const subscribe = () => progressEndpoint(request({ intentId: d.intent.id, token: d.body.token }));
    const response = await subscribe();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), "identity");
    const reader = response.body!.getReader();
    const read = async (streamReader = reader) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const chunk = await Promise.race([streamReader.read(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Live stream update timed out")), 1500); })]);
        assert.equal(chunk.done, false);
        return JSON.parse(new TextDecoder().decode(chunk.value));
      } finally { clearTimeout(timeout); }
    };
    try {
      assert.equal((await read()).type, "snapshot");
      await notifyGeneration(job, { offset: 0, text: "First" });
      assert.equal((await read()).delta, "First");
      await notifyGeneration(job, { offset: 0, text: "First second" });
      assert.equal((await read()).delta, "First second");
      assert.equal((await admin.query("SELECT progress FROM generation_jobs WHERE id=$1", [job.id])).rows[0].progress.markdown, "", "Live delivery must not wait for the checkpoint");
      await publishGenerationProgress(job, { ...emptyGenerationProgress(), markdown: "First second" });
      const reconnected = (await subscribe()).body!.getReader();
      try {
        assert.equal((await read(reconnected)).progress.markdown, "First second");
        await notifyGeneration({ ...job, leaseToken: crypto.randomUUID() }, { offset: 12, text: "STALE" });
        await notifyGeneration(job, { offset: 12, text: " third" });
        assert.equal((await read()).delta, " third", "Stale workers must never publish");
        assert.equal((await read(reconnected)).delta, " third");
      } finally { await reconnected.cancel(); }
    } finally { await reader.cancel(); }
    await runJob(job); // Closing the browser stream must not cancel the paid job.
    assert.equal((await admin.query("SELECT status FROM generation_jobs WHERE id=$1", [job.id])).rows[0].status, "succeeded");
    const other = await draft();
    assert.equal((await progressEndpoint(request({ intentId: other.intent.id, token: other.body.token }))).status, 409);
  });
});
