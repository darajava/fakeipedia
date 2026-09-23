import assert from "node:assert/strict";
import test from "node:test";
import { billingConfig, requireUuid, stripeClient } from "./billing/config";
import { billingBody, billingEndpoint } from "./billing/http";
import { money } from "../components/billing-client";

test("payment launch settings fail closed until explicitly configured", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { BILLING_ENABLED: "true", APP_URL: "http://localhost:3000", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_ARTICLE_PRICE_ID: "price_article", STRIPE_CREDIT_PACK_PRICE_ID: "price_pack", CREDIT_PACK_QUANTITY: "5", STRIPE_ALLOW_LIVE: "false" });
    assert.equal(billingConfig().packQuantity, 5);
    process.env.BILLING_ENABLED = "false";
    assert.throws(billingConfig, /not available/);
    assert.ok(stripeClient(), "Existing payments and refunds can still be reconciled while new checkout is disabled");
    process.env.BILLING_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_live_fixture";
    assert.throws(billingConfig, /Live payments/);
    process.env.STRIPE_ALLOW_LIVE = "true";
    assert.equal(billingConfig().secret, "sk_live_fixture");
    process.env.CREDIT_PACK_QUANTITY = "-1";
    assert.throws(billingConfig, /not available/);
    process.env.CREDIT_PACK_QUANTITY = "1.5";
    assert.throws(billingConfig, /not available/);
    process.env.CREDIT_PACK_QUANTITY = "5";
    process.env.APP_URL = "http://public.example";
    assert.throws(billingConfig, /configuration/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("billing request validation rejects malformed and oversized payloads", async () => {
  for (const body of ["null", "[]", "invalid"]) {
    await assert.rejects(billingBody(new Request("http://localhost/api", { method: "POST", body })), /valid/);
  }
  await assert.rejects(billingBody(new Request("http://localhost/api", { method: "POST", body: "a".repeat(16001) })), /too large/);
  const id = crypto.randomUUID();
  assert.equal(requireUuid(id), id);
  assert.throws(() => requireUuid("an-order"), /identifier/);
});

test("cross-site browser requests cannot spend account credits", async () => {
  let called = false;
  const response = await billingEndpoint(new Request("http://localhost:3000/api", { method: "POST", headers: { origin: "https://other.example" } }), async () => {
    called = true; return Response.json({ ok: true });
  });
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("Stripe prices display their correct currency units", () => {
  assert.match(money({ amount: 150, currency: "eur" }), /1[.,]50/);
  assert.match(money({ amount: 500, currency: "jpy" }), /500/);
  assert.match(money({ amount: 500, currency: "isk" }), /5/);
  assert.doesNotMatch(money({ amount: 500, currency: "isk" }), /500/);
});
