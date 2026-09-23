import assert from "node:assert/strict";
import test from "node:test";
import { BillingRequestError, startCreditGeneration } from "../components/billing-client";

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
