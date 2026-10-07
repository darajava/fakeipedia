import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import Stripe from "stripe";

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
  Object.assign(process.env, { DATABASE_URL: databaseUrl.toString(), GEMINI_API_KEY: "test", OPENAI_API_KEY: "test", BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_ARTICLE_PRICE_ID: "price_article", APP_URL: "http://localhost:3000" });
  process.chdir(directory);
  const { db } = await import("../db");
  const { articleLockPool, acquireArticleLock } = await import("./article-lock");
  const { generationStreamPool, notifyGeneration } = await import("./billing/generation-stream");
  cleanDb = async () => { await generationStreamPool.end(); await db.$client.end(); await articleLockPool.end(); };
  const { saveIntent, readIntent } = await import("./billing/intents");
  const { createCheckout, fulfillCheckout, cancelCheckout, processRefunds, reconcilePayments, refreshPendingPayments } = await import("./billing/payments");
  const { completeJob } = await import("./billing/jobs");
  const { claimJob, runJob, recoverExhaustedJobs, publishGenerationProgress } = await import("./billing/worker");
  const { emptyGenerationProgress } = await import("./generation-progress");
  const { POST: publicGenerate } = await import("../app/api/articles/generate/route");
  const { POST: webhook } = await import("../app/api/billing/webhook/route");
  const { POST: checkoutEndpoint } = await import("../app/api/billing/checkout/route");
  const { POST: statusEndpoint } = await import("../app/api/billing/status/route");
  const { POST: progressEndpoint } = await import("../app/api/articles/progress/route");
  const { GET: imageStatusEndpoint } = await import("../app/api/articles/images/status/route");
  const { discussionContributions } = await import("./discussion-contributions");
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
        return Response.json({ id, object: "price", active: true, type: "one_time", billing_scheme: "per_unit", unit_amount: 150, currency: "eur", currency_options: { usd: { unit_amount: 150 }, gbp: { unit_amount: 150 } } });
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
        const session = { id, object: "checkout.session", url: `https://checkout.stripe.com/${id}`, status: "open", payment_status: "unpaid", mode: "payment", client_reference_id: orderId, metadata: { orderId }, currency: fields.get("currency"), amount_total: 150, payment_intent: `pi_${id}`, line_items: { data: [{ quantity: 1, price: { id: price } }], has_more: false } };
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
      const markdown = prompt.includes("featured overview")
        ? `# ${title}\n\n` + Array.from({ length: 4 }, (_, i) => `![District ${i}](./images/${slug}_${i}.png "District ${i}")`).join("\n\n") + "\n\n" +
          Array.from({ length: 8 }, (_, i) => `## Topic ${i}\n\n${"The river runs backwards. ".repeat(60)}`).join("\n\n")
        : `# ${title}\n\n![View](./images/${slug}_view.png "The subject")\n\nThe river runs backwards. [[Next Chapter]]`;
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
  const markPaid = async (intentId?: string) => {
    const order = (await admin.query("SELECT * FROM purchase_orders WHERE ($1::uuid IS NULL OR intent_id=$1) ORDER BY created_at DESC LIMIT 1", [intentId ?? null])).rows[0];
    const session = sessions.get(order.stripe_session_id)!;
    session.payment_status = "paid"; session.status = "complete";
    return { order, session };
  };
  const fund = async (d: Awaited<ReturnType<typeof draft>>) => {
    await createCheckout(d.intent, crypto.randomUUID());
    const { session } = await markPaid(d.intent.id);
    await fulfillCheckout(String(session.id));
  };
  const signedEvent = (session: Record<string, unknown>) => {
    const body = JSON.stringify({ id: `evt_${session.id}`, object: "event", type: "checkout.session.completed", data: { object: session } });
    const signature = new Stripe("sk_test_fixture").webhooks.generateTestHeaderString({ payload: body, secret: "whsec_fixture" });
    return new Request("http://localhost:3000/api/billing/webhook", { method: "POST", headers: { "stripe-signature": signature }, body });
  };

  await t.test("regional prices persist through checkout, status, retries and fulfillment", async () => {
    for (const [ip, currency] of [["8.8.8.8", "usd"], ["81.2.69.160", "gbp"], ["86.43.1.1", "eur"], ["2a02:8084::1", "eur"]]) {
      const d = await draft();
      const regional = request({ intentId: d.intent.id, token: d.body.token, requestId: crypto.randomUUID() });
      regional.headers.set("x-real-ip", ip);
      assert.equal((await checkoutEndpoint(regional)).status, 200);
      const order = (await admin.query("SELECT * FROM purchase_orders WHERE intent_id=$1", [d.intent.id])).rows[0];
      const session = sessions.get(order.stripe_session_id)!;
      assert.equal(order.currency, currency);
      assert.equal(order.amount, 150);
      assert.equal(session.currency, currency);
      // Another region must not change the original pending order or its display.
      const statusRequest = request({ intentId: d.intent.id, token: d.body.token });
      statusRequest.headers.set("x-real-ip", "8.8.8.8");
      const result = await (await statusEndpoint(statusRequest)).json();
      assert.equal(result.result.currency, currency);
      assert.equal(result.result.amount, 150);
      const count = sessions.size;
      await createCheckout(d.intent, crypto.randomUUID(), "usd");
      assert.equal(sessions.size, count);
      await markPaid(d.intent.id);
      await fulfillCheckout(String(session.id));
      const jobs = await admin.query("SELECT id FROM generation_jobs WHERE intent_id=$1", [d.intent.id]);
      assert.equal(jobs.rowCount, 1);
      // Keep this fixture out of later generation-worker tests.
      await admin.query("UPDATE generation_jobs SET status='succeeded' WHERE intent_id=$1", [d.intent.id]);
    }
    const d = await draft();
    const invalid = await checkoutEndpoint(request({ intentId: d.intent.id, token: d.body.token, requestId: crypto.randomUUID(), currency: "jpy" }));
    assert.equal(invalid.status, 400);
  });

  await t.test("Irish IPs show and charge euros despite British English or a client currency override", async () => {
    const d = await draft();
    const checkout = (ip: string) => {
      const req = request({ intentId: d.intent.id, token: d.body.token, requestId: crypto.randomUUID(), currency: "gbp" });
      req.headers.set("x-real-ip", ip);
      req.headers.set("accept-language", "en-GB,en;q=0.9");
      return checkoutEndpoint(req);
    };
    const preview = request({ intentId: d.intent.id, token: d.body.token });
    preview.headers.set("x-real-ip", "86.43.1.1");
    preview.headers.set("accept-language", "en-GB");
    assert.equal((await (await statusEndpoint(preview)).json()).result.currency, "eur");
    assert.equal((await checkout("86.43.1.1")).status, 200);
    const euroOrder = (await admin.query("SELECT * FROM purchase_orders WHERE intent_id=$1 AND status='pending'", [d.intent.id])).rows[0];
    assert.equal(euroOrder.currency, "eur");
    assert.equal(sessions.get(euroOrder.stripe_session_id)!.currency, "eur");
    const statusRequest = request({ intentId: d.intent.id, token: d.body.token });
    statusRequest.headers.set("accept-language", "en-GB,en;q=0.9");
    assert.equal((await (await statusEndpoint(statusRequest)).json()).result.currency, "eur");
    const count = sessions.size;
    assert.equal((await checkout("81.2.69.160")).status, 200);
    assert.equal(sessions.size, count, "An open checkout keeps its original currency");
    await cancelCheckout(d.intent.id);
    assert.equal((await checkout("81.2.69.160")).status, 200);
    const poundOrder = (await admin.query("SELECT * FROM purchase_orders WHERE intent_id=$1 AND status='pending'", [d.intent.id])).rows[0];
    assert.equal(poundOrder.currency, "gbp");
    assert.equal(sessions.get(poundOrder.stripe_session_id)!.currency, "gbp");
    await cancelCheckout(d.intent.id);
  });

  await t.test("checkouts opened at 1.00 keep their saved amount and still fund an article", async () => {
    const d = await draft();
    await createCheckout(d.intent, crypto.randomUUID(), "eur");
    const { order, session } = await markPaid(d.intent.id);
    await admin.query("UPDATE purchase_orders SET amount=100 WHERE id=$1", [order.id]);
    session.amount_total = 100;
    session.payment_status = "unpaid";
    session.status = "open";
    const status = await (await statusEndpoint(request({ intentId: d.intent.id, token: d.body.token }))).json();
    assert.equal(status.result.amount, 100);
    assert.equal(status.result.currency, "eur");
    const count = sessions.size;
    await createCheckout(d.intent, crypto.randomUUID(), "usd");
    assert.equal(sessions.size, count);
    await markPaid(d.intent.id);
    await fulfillCheckout(String(session.id));
    const jobs = await admin.query("SELECT id FROM generation_jobs WHERE intent_id=$1", [d.intent.id]);
    assert.equal(jobs.rowCount, 1);
    await admin.query("UPDATE generation_jobs SET status='succeeded' WHERE intent_id=$1", [d.intent.id]);
  });

  await t.test("unpaid requests, forged webhooks and another guest's token cannot start generation", async () => {
    assert.equal((await publicGenerate(request({ wiki: "world", slug: "target" }))).status, 402);
    const d = await draft("Preserved answer");
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: d.body.token }))).status, 402);
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: randomBytes(32).toString("hex"), funding: "credit" }))).status, 404);
    assert.equal((await webhook(request({ id: "fake" }))).status, 400);
    assert.equal((await checkoutEndpoint(request({ kind: "credits", intentId: d.intent.id, token: d.body.token, requestId: crypto.randomUUID(), price: "free", quantity: 999 }))).status, 400);
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
    await createCheckout(d.intent, crypto.randomUUID());
    assert.equal(sessions.size, count);
    await cancelCheckout(d.intent.id);
    assert.equal((await readIntent(d.intent.id, d.body.token)).answer, d.body.answer);
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "cancelled");
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: d.body.token }))).status, 402);
  });
  await t.test("a rejected checkout can be retried without losing the saved answer", async () => {
    const d = await draft("Keep this after a checkout error.");
    rejectCheckout = true;
    await assert.rejects(createCheckout(d.intent, crypto.randomUUID()), /configuration rejected/);
    rejectCheckout = false;
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE intent_id=$1", [d.intent.id])).rows[0].status, "cancelled");
    assert.equal((await readIntent(d.intent.id, d.body.token)).answer, d.body.answer);
    const checkout = await createCheckout(d.intent, crypto.randomUUID());
    assert.ok(checkout.url);
    await cancelCheckout(d.intent.id);
  });
  await t.test("duplicate signed webhooks fund one job; worker saves text and contribution despite optional failures", async () => {
    const d = await draft("  The ferrymen elect their king.  ");
    await createCheckout(d.intent, crypto.randomUUID());
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
    const contributions = await discussionContributions(saved.article_id);
    assert.equal(contributions[0].answer, d.body.answer);
    assert.equal("handle" in contributions[0], false);
    assert.equal((await admin.query("SELECT status FROM lore_contributions WHERE id=$1", [d.intent.contributionId])).rows[0].status, "succeeded");
    assert.match(await readFile(path.join(directory, "wiki-files", "world", `${d.intent.slug}.md`), "utf8"), /river runs backwards/);
    await fulfillCheckout(String(session.id));
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: d.body.token }))).status, 200);
    assert.equal(await claimJob(), null);
  });




  await t.test("lease expiry retries interrupted work and fences a stale worker", async () => {
    const d = await draft("Remember the lighthouse.");
    await fund(d);
    const first = await claimJob(); assert.ok(first);
    await admin.query("UPDATE generation_jobs SET leased_until=now()-interval '1 minute' WHERE id=$1", [first.id]);
    const retry = await claimJob(); assert.ok(retry);
    assert.equal(retry.id, first.id); assert.equal(retry.attempts, 2); assert.notEqual(retry.leaseToken, first.leaseToken);
    await assert.rejects(db.transaction(tx => completeJob(tx, first, 1)), /lease was lost/);
    await runJob(retry);
    assert.equal((await admin.query("SELECT status FROM generation_jobs WHERE id=$1", [retry.id])).rows[0].status, "succeeded");
  });

  await t.test("terminal guest failure refunds once even when recording the refund first fails", async () => {
    const d = await draft(); await createCheckout(d.intent, crypto.randomUUID());
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

  await t.test("stale red links refund the single purchase, including retries and pending refunds", async () => {
    const d = await draft(); await createCheckout(d.intent, crypto.randomUUID());
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
    const d = await draft(); await fund(d);
    const job = await claimJob(); assert.ok(job);
    const release = await acquireArticleLock(`generation:world:${d.intent.slug}`);
    await runJob(job); await release();
    assert.equal((await admin.query("SELECT attempts FROM generation_jobs WHERE id=$1", [job.id])).rows[0].attempts, 0);
    await admin.query("UPDATE generation_jobs SET status='running',attempts=3,lease_token=$2,leased_until=now()-interval '1 minute' WHERE id=$1", [job.id, crypto.randomUUID()]);
    await recoverExhaustedJobs(); await recoverExhaustedJobs();
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE intent_id=$1", [d.intent.id])).rows[0].status, "refund_pending");
    await processRefunds();
  });
  await t.test("reconciliation recovers missed delivery and rejects altered paid sessions", async () => {
    const d = await draft(); await createCheckout(d.intent, crypto.randomUUID());
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



  await t.test("payment status verifies guest checkout and returns the new job in the same response", async () => {
    const d = await draft(); await createCheckout(d.intent, crypto.randomUUID());
    const { order } = await markPaid(d.intent.id);
    await allowPaymentRefresh(order.id);
    const reads = sessionReads;
    assert.equal((await statusEndpoint(request({ intentId: d.intent.id, token: randomBytes(32).toString("hex") }))).status, 404);
    assert.equal(sessionReads, reads);
    const response = await statusEndpoint(request({ intentId: d.intent.id, token: d.body.token }));
    assert.equal(response.status, 200);
    const { result: status } = await response.json();
    assert.equal(status.orders[0].status, "paid"); assert.equal(status.job.status, "queued");
    const job = await claimJob(); assert.ok(job); await runJob(job);
  });

  await t.test("polling verifies payment, throttles requests, and recovers provider failures", async () => {
    const d = await draft(); await createCheckout(d.intent, crypto.randomUUID());
    const { order, session } = await markPaid(d.intent.id);
    session.payment_status = "unpaid"; session.status = "open";
    await allowPaymentRefresh(order.id);
    await refreshPendingPayments({ intentId: d.intent.id });
    const reads = sessionReads;
    await refreshPendingPayments({ intentId: d.intent.id });
    assert.equal(sessionReads, reads);
    assert.equal(await claimJob(), null);
    session.payment_status = "paid"; session.status = "complete";
    await allowPaymentRefresh(order.id);
    failSessionRead = true;
    await refreshPendingPayments({ intentId: d.intent.id });
    failSessionRead = false;
    assert.equal(await claimJob(), null);
    await allowPaymentRefresh(order.id);
    await Promise.all([refreshPendingPayments({ intentId: d.intent.id }), refreshPendingPayments({ intentId: d.intent.id })]);
    const job = await claimJob(); assert.ok(job); await runJob(job);
  });
  await t.test("parallel checkout retries create one order and tokens remain mandatory after payment", async () => {
    const d = await draft();
    const results = await Promise.all([createCheckout(d.intent, crypto.randomUUID()), createCheckout(d.intent, crypto.randomUUID())]);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM purchase_orders WHERE intent_id=$1", [d.intent.id])).rows[0].n, 1);
    const { session } = await markPaid(d.intent.id);
    await fulfillCheckout(String(session.id));
    await assert.rejects(readIntent(d.intent.id, undefined), /private purchase link/);
    assert.equal((await publicGenerate(request({ intentId: d.intent.id, token: d.body.token, funding: "credit" }))).status, 200);
    const job = await claimJob(); assert.ok(job); await runJob(job);
    await assert.rejects(createCheckout(d.intent, crypto.randomUUID()), /already been funded/);
  });
  await t.test("retired checkout payments are refunded without granting credits or generation", async () => {
    const d = await draft();
    await createCheckout(d.intent, crypto.randomUUID());
    const { session, order } = await markPaid(d.intent.id);
    await admin.query("UPDATE purchase_orders SET amount=200 WHERE id=$1", [order.id]);
    session.amount_total = 200;
    await fulfillCheckout(String(session.id));
    assert.equal((await admin.query("SELECT status FROM purchase_orders WHERE id=$1", [order.id])).rows[0].status, "refund_pending");
    assert.equal(await claimJob(), null);
    await processRefunds();
  });
  await t.test("live preview retains committed text while images run and replays completed images", async () => {
    const d = await draft(); await createCheckout(d.intent, crypto.randomUUID());
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
      const { result: preview } = await (await statusEndpoint(request(body))).json();
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
      const { result: reconnect } = await (await statusEndpoint(request(body))).json();
      assert.deepEqual(reconnect.progress, preview.progress);
      assert.equal((await statusEndpoint(request({ ...body, token: randomBytes(32).toString("hex") }))).status, 404);
      await publishGenerationProgress({ ...job, leaseToken: crypto.randomUUID() }, emptyGenerationProgress());
      const { result: fenced } = await (await statusEndpoint(request(body))).json();
      assert.deepEqual(fenced.progress, preview.progress, "A stale worker cannot overwrite the preview");
    } finally { releaseImage(); await running; beforeImage = async () => {}; successfulImage = false; }
    const { result: finished } = await (await statusEndpoint(request({ intentId: d.intent.id, token: d.body.token, includeProgress: true }))).json();
    assert.equal(finished.job.previewComplete, true);
    assert.equal(finished.progress.phase, "done");
    assert.equal(Object.keys(finished.progress.readyImages).length, 1);
    assert.equal(Object.keys(finished.progress.failedImages).length, 0);
    const ready = await imageStatusEndpoint(new Request(`http://localhost:3000/api/articles/images/status?wiki=world&slug=${d.intent.slug}`));
    assert.equal((await ready.json()).images[`${d.intent.slug}_view.png`].state, "ready");
    assert.equal((await imageStatusEndpoint(new Request("http://localhost/api/articles/images/status?wiki=../world&slug=target"))).status, 400);
    const { result: lightweight } = await (await statusEndpoint(request({ intentId: d.intent.id, token: d.body.token }))).json();
    assert.equal(lightweight.progress, undefined);
  });
  await t.test("authorized live readers receive individual deltas before checkpoint writes and can reconnect", async () => {
    const d = await draft(); await createCheckout(d.intent, crypto.randomUUID());
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
  await t.test("operator seed generation works without checkout while public generation stays gated", async () => {
    const { generateArticleRequest } = await import("./article-generation");
    const { generateStubPages, planStubGeneration } = await import("./generate-stubs");
    const stub = { wiki: "world", slug: "stub-seed", title: "Seed", content: "[[Opening World]]" };
    await admin.query("INSERT INTO articles (wiki,slug,title,content) VALUES ($1,$2,$3,$4)", [stub.wiki,stub.slug,stub.title,stub.content]);
    const payload = { wiki: "world", slug: "opening-world", title: "Opening World", sourceSlug: stub.slug };
    assert.equal((await publicGenerate(request(payload))).status, 402);
    const before = modelCalls;
    const plan = planStubGeneration([stub]);
    assert.deepEqual(await generateStubPages(plan, generateArticleRequest, () => {}), { generated: 1, skipped: 0, failed: 0 });
    assert.equal(modelCalls, before + 1);
    assert.deepEqual(await generateStubPages(plan, generateArticleRequest, () => {}), { generated: 0, skipped: 1, failed: 0 });
    assert.equal(modelCalls, before + 1);
    assert.match(await readFile(path.join(directory, "wiki-files/world/opening-world.md"), "utf8"), /river runs backwards/);
  });
});
