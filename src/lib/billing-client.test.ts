import assert from "node:assert/strict";
import test from "node:test";
import { BillingRequestError, creditCheckoutRequest, creditCheckoutStorageKey, startCreditGeneration, type AccountData } from "../components/billing-client";

function retryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
function accountFor(userId: number, orders: NonNullable<AccountData["orders"]> = []): AccountData {
  return { signedIn: true, userId, authAvailable: true, prices: null, orders };
}
function creditOrder(requestId: string, status = "pending"): NonNullable<AccountData["orders"]>[number] {
  return { id: "order", intentId: null, requestId, kind: "credits", status, credits: 10, amount: 900, currency: "eur", createdAt: "2026-09-23", refundNeedsAttention: false };
}

test("switching accounts never reuses a shared or another account's checkout request", () => {
  const storage = retryStorage();
  storage.setItem("credit-checkout-request", "old-shared-request");
  const first = creditCheckoutRequest(accountFor(1), undefined, storage);
  const second = creditCheckoutRequest(accountFor(2), first, storage);
  assert.notEqual(first.requestId, "old-shared-request");
  assert.notEqual(second.requestId, first.requestId);
  assert.equal(storage.getItem("credit-checkout-request"), null);
  assert.deepEqual(creditCheckoutRequest(accountFor(1), second, storage), first);
  assert.equal(storage.getItem(creditCheckoutStorageKey(2)), second.requestId);
});

test("reloads and uncertain failures reuse the current account's checkout request", () => {
  const storage = retryStorage();
  const first = creditCheckoutRequest(accountFor(1), undefined, storage);
  assert.deepEqual(creditCheckoutRequest(accountFor(1), undefined, storage), first);
  const unavailable = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  assert.deepEqual(creditCheckoutRequest(accountFor(1), first, unavailable), first);
});

test("only an owned pending credit pack recovers a legacy checkout", () => {
  const storage = retryStorage();
  storage.setItem("credit-checkout-request", "legacy-request");
  const recovered = creditCheckoutRequest(accountFor(1, [creditOrder("legacy-request")]), undefined, storage);
  assert.equal(recovered.requestId, "legacy-request");
  const articlePack = { ...creditOrder("article-request"), intentId: "article" };
  assert.notEqual(creditCheckoutRequest(accountFor(2, [articlePack]), undefined, storage).requestId, "article-request");
});

test("completed or cancelled purchases get a new request and signed-out accounts cannot buy", () => {
  for (const status of ["paid", "cancelled", "refunded"]) {
    const previous = { userId: 1, requestId: "processed" };
    assert.notEqual(creditCheckoutRequest(accountFor(1, [creditOrder("processed", status)]), previous).requestId, previous.requestId);
  }
  assert.throws(() => creditCheckoutRequest({ signedIn: false, authAvailable: true, prices: null }), /Sign in/);
});

test("a saved draft starts credit generation without a checkout request", async (t) => {
  const calls: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(options.body)) });
    return Response.json({ jobId: "same-job", status: "queued" }, { status: 202 });
  });
  assert.deepEqual(await startCreditGeneration("saved-intent", "private-token"), { jobId: "same-job", status: "queued" });
  assert.deepEqual(calls, [{ url: "/api/articles/generate", body: { intentId: "saved-intent", token: "private-token", funding: "credit" } }]);
});

test("missing credits or an existing checkout falls back to the payment step", async (t) => {
  for (const status of [402, 409]) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Payment step required" }, { status }));
    assert.equal(await startCreditGeneration("saved-intent", "private-token"), null);
    mock.mock.restore();
  }
});

test("uncertain failures retain the saved intent for retry instead of opening checkout", async (t) => {
  let attempt = 0;
  const bodies: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    bodies.push(JSON.parse(String(options.body)));
    if (attempt++ === 0) return Response.json({ error: "Temporary failure" }, { status: 500 });
    return Response.json({ jobId: "original-job", status: "running" });
  });
  await assert.rejects(startCreditGeneration("saved-intent", "private-token"), (error) => error instanceof BillingRequestError && error.status === 500);
  assert.equal((await startCreditGeneration("saved-intent", "private-token"))?.jobId, "original-job");
  assert.deepEqual(bodies[0], bodies[1]);
});

test("authorization errors cannot silently fall back to checkout", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Not your draft" }, { status: 403 }));
  await assert.rejects(startCreditGeneration("saved-intent", "wrong-token"), (error) => error instanceof BillingRequestError && error.status === 403);
});
