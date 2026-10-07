import type { PaymentStatus } from "./billing-types";
import { articlePath } from "./wiki";

export function generationPath(intent: PaymentStatus["intent"], token: string) {
  const query = new URLSearchParams({ title: intent.title, source: intent.sourceSlug, intent: intent.id });
  return `${articlePath(intent.wiki, intent.slug)}/generate?${query}${token ? `#token=${token}` : ""}`;
}

export type PaymentStage = "opening" | "confirming" | "terminal" | "available" | "options";

export function paymentView(status: PaymentStatus, checkout: string | null) {
  const { job, orders, intent } = status;
  const pending = orders.some((order) => order.status === "pending");
  const terminal = job?.status === "failed" || job?.status === "superseded";
  let stage: PaymentStage;
  if (job && !terminal) stage = "opening";
  else if (terminal) stage = "terminal";
  else if (checkout === "success" && pending) stage = "confirming";
  else if (status.exists) stage = "available";
  else stage = "options";

  const target = articlePath(intent.wiki, intent.slug);
  const retryQuery = new URLSearchParams({ title: intent.title, source: intent.sourceSlug, newRequest: "1" });
  return {
    stage,
    target,
    retryPath: `${target}/generate?${retryQuery}`,
    pending,
    cancelled: checkout === "cancelled" && !terminal && stage !== "opening",
    refunded: orders.some((order) => order.id === job?.orderId && order.status === "refunded"),
    refundPending: orders.some((order) => order.status === "refund_pending"),
    refundNeedsAttention: orders.some((order) => order.refundNeedsAttention),
    canCancel: pending && !job && stage !== "confirming",
    canRead: status.exists && stage !== "opening",
  };
}

export type PaymentView = ReturnType<typeof paymentView>;
