import type { ArticleCurrency } from "./article-pricing";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "superseded";
export type OrderStatus = "pending" | "paid" | "cancelled" | "refund_pending" | "refunded";
export type PaymentAction = "article" | "cancel";

export type PaymentStatus = {
  currency: ArticleCurrency;
  amount: number;
  intent: {
    id: string;
    wiki: string;
    slug: string;
    title: string;
    sourceSlug: string;
    answer: string;
  };
  job: {
    id: string;
    orderId: string | null;
    status: JobStatus;
    attempts: number;
    funding: "article" | "credit";
    previewComplete: boolean;
  } | null;
  orders: { id: string; kind: string; status: OrderStatus; refundNeedsAttention: boolean }[];
  exists: boolean;
};
