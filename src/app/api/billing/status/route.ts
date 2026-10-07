import { authorizeIntent, latestOrders, readIntent } from "@/lib/billing/intents";
import { billingBody, billingEndpoint, privateJson } from "@/lib/billing/http";
import { existingArticle } from "@/lib/billing/worker";
import { refreshPendingPayments } from "@/lib/billing/payments";
import { generationPreviewComplete } from "@/lib/generation-progress";
import { ARTICLE_PRICE_AMOUNT, isArticleCurrency } from "@/lib/article-pricing";
import { requestCurrency } from "@/lib/request-currency";
import type { PaymentStatus } from "@/lib/billing-types";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const body = await billingBody(request);
    const intent = await readIntent(body.intentId, body.token);
    await authorizeIntent(intent);
    await refreshPendingPayments({ intentId: intent.id });
    const job = await authorizeIntent(intent);
    const orders = await latestOrders(intent.id);
    const savedOrder = orders.find((order) => order.status === "pending") ?? orders.find((order) => order.id === job?.orderId);
    const currency = savedOrder && isArticleCurrency(savedOrder.currency) ? savedOrder.currency : requestCurrency(request.headers);
    return privateJson({
      currency,
      amount: savedOrder?.amount ?? ARTICLE_PRICE_AMOUNT,
      intent: { id: intent.id, wiki: intent.wiki, slug: intent.slug, title: intent.title, sourceSlug: intent.sourceSlug, answer: intent.answer },
      job: job ? { id: job.id, orderId: job.orderId, status: job.status, attempts: job.attempts, funding: job.funding, previewComplete: generationPreviewComplete(job) } : null,
      ...(body.includeProgress === true ? { progress: job?.progress ?? null } : {}),
      orders: orders.map((order) => ({ id: order.id, kind: order.kind, status: order.status, amount: order.amount, currency: order.currency, refundNeedsAttention: Boolean(order.refundError) })),
      exists: Boolean(await existingArticle(intent)),
    } satisfies PaymentStatus);
  });
}
