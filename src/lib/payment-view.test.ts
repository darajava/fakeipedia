import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentStatus } from "./billing-types";
import { generationPath, paymentView } from "./payment-view";

function status(overrides: Partial<PaymentStatus> = {}): PaymentStatus {
  return {
    currency: "usd",
    amount: 150,
    intent: { id: "saved-request", wiki: "asi", slug: "test-article", title: "An Article & Its World", sourceSlug: "asi", answer: "Keep the library." },
    job: null,
    orders: [],
    exists: false,
    ...overrides,
  };
}

function job(state: NonNullable<PaymentStatus["job"]>["status"], overrides: Partial<NonNullable<PaymentStatus["job"]>> = {}): NonNullable<PaymentStatus["job"]> {
  return { id: "job", orderId: "order", status: state, attempts: 1, funding: "article", previewComplete: false, ...overrides };
}

test("new drafts offer payment, regardless of whether the optional answer was skipped", () => {
  const answered = status();
  for (const draft of [answered, { ...answered, intent: { ...answered.intent, answer: "" } }]) {
    const view = paymentView(draft, null);
    assert.equal(view.stage, "options");
    assert.equal(view.canRead, false);
    assert.equal(view.canCancel, false);
  }
});

test("returning from checkout waits for verified funding, and cancellation retains recovery actions", () => {
  for (const kind of ["article", "credits"] as const) {
    const draft = status({ orders: [{ id: "order", kind, status: "pending", refundNeedsAttention: false }] });
    assert.equal(paymentView(draft, "success").stage, "confirming");
    assert.equal(paymentView(draft, "success").canCancel, false);
    const cancelled = paymentView(draft, "cancelled");
    assert.equal(cancelled.stage, "options");
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.canCancel, true);
    assert.equal(cancelled.pending, true);
  }
  assert.equal(paymentView(status(), "success").stage, "options");
});

test("funded jobs open the live preview even when article text has already been saved", () => {
  for (const state of ["queued", "running", "succeeded"] as const) {
    const view = paymentView(status({ job: job(state), exists: state === "succeeded" }), "success");
    assert.equal(view.stage, "opening");
    assert.equal(view.canRead, false);
    assert.equal(view.canCancel, false);
  }
});

test("stale red links show the existing article without offering another purchase", () => {
  const view = paymentView(status({ exists: true }), null);
  assert.equal(view.stage, "available");
  assert.equal(view.canRead, true);
  assert.equal(view.target, "/asi/test-article");
});

test("terminal jobs retain refund information and the new-request recovery link", () => {
  const view = paymentView(status({
    job: job("failed"),
    orders: [{ id: "order", kind: "article", status: "refund_pending", refundNeedsAttention: true }],
  }), "cancelled");
  assert.equal(view.stage, "terminal");
  assert.equal(view.cancelled, false);
  assert.equal(view.refundPending, true);
  assert.equal(view.refundNeedsAttention, true);
  const retry = new URL(view.retryPath, "http://localhost");
  assert.equal(retry.searchParams.get("newRequest"), "1");
  assert.equal(retry.searchParams.get("source"), "asi");
  assert.equal(retry.searchParams.get("title"), "An Article & Its World");
  const refunded = paymentView(status({
    job: job("superseded"), exists: true,
    orders: [{ id: "order", kind: "article", status: "refunded", refundNeedsAttention: false }],
  }), null);
  assert.equal(refunded.refunded, true);
  assert.equal(refunded.canRead, true);
});

test("generation navigation preserves the draft and keeps the guest token out of query parameters", () => {
  const draft = status();
  const url = new URL(generationPath(draft.intent, "private-token"), "http://localhost");
  assert.equal(url.pathname, "/asi/test-article/generate");
  assert.equal(url.searchParams.get("intent"), draft.intent.id);
  assert.equal(url.searchParams.get("title"), draft.intent.title);
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(url.hash, "#token=private-token");
  assert.equal(new URL(generationPath(draft.intent, ""), url.origin).hash, "");
});
