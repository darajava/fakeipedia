import assert from "node:assert/strict";
import test from "node:test";
import { billingFetch, BillingRequestError } from "../components/billing-client";
import { validateArticlePrice } from "./billing/config";
import type Stripe from "stripe";

test("billing client unwraps successful results and retains server errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ result: { id: "article" } }));
  assert.deepEqual(await billingFetch("/api/billing/intents", {}), { id: "article" });
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Payment required" }, { status: 402 }));
  await assert.rejects(billingFetch("/api/articles/generate", {}), (error) => error instanceof BillingRequestError && error.status === 402);
});

test("only fixed 1.50 prices in the selected supported currency are accepted", () => {
  const price = { active: true, type: "one_time", billing_scheme: "per_unit", unit_amount: 150, currency: "eur", transform_quantity: null,
    currency_options: { usd: { unit_amount: 150 }, gbp: { unit_amount: 150 } } } as unknown as Stripe.Price;
  for (const currency of ["usd", "gbp", "eur"] as const) {
    assert.doesNotThrow(() => validateArticlePrice(price, currency));
    for (const invalid of [{ type: "recurring" }, { active: false }, { billing_scheme: "tiered" }, { transform_quantity: { divide_by: 10, round: "up" } }]) {
      assert.throws(() => validateArticlePrice({ ...price, ...invalid } as Stripe.Price, currency), /one-time payment/);
    }
  }
  for (const unit_amount of [0, 100, 149, 151, 200, null]) {
    assert.throws(() => validateArticlePrice({ ...price, unit_amount }, "eur"), /€1\.50/);
    assert.throws(() => validateArticlePrice({ ...price, currency_options: { usd: { unit_amount, tax_behavior: "unspecified", custom_unit_amount: null, unit_amount_decimal: null } } }, "usd"), /\$1\.50/);
  }
  assert.throws(() => validateArticlePrice({ ...price, currency_options: undefined }, "gbp"), /£1\.50/);
});
