import { billingUser } from "@/lib/billing/auth";
import { authorizeIntent, latestOrders, readIntent } from "@/lib/billing/intents";
import { billingBody, billingEndpoint, privateJson } from "@/lib/billing/http";
import { creditBalance } from "@/lib/billing/credits";
import { existingArticle } from "@/lib/billing/worker";
import { refreshPendingPayments } from "@/lib/billing/payments";
import { generationPreviewComplete } from "@/lib/generation-progress";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return billingEndpoint(request, async () => {
    const body = await billingBody(request);
    const user = await billingUser();
    const intent = await readIntent(body.intentId, body.token, user?.id ?? null);
    await authorizeIntent(intent, user?.id ?? null);
    await refreshPendingPayments({ intentId: intent.id, userId: user?.id ?? null });
    const job = await authorizeIntent(intent, user?.id ?? null);
    const orders = await latestOrders(intent.id, user?.id ?? null);
    return privateJson({
      intent: { id: intent.id, wiki: intent.wiki, slug: intent.slug, title: intent.title, sourceSlug: intent.sourceSlug, question: intent.question, answer: intent.answer },
      job: job ? { id: job.id, orderId: job.orderId, status: job.status, attempts: job.attempts, funding: job.funding, previewComplete: generationPreviewComplete(job) } : null,
      ...(body.includeProgress === true ? { progress: job?.progress ?? null } : {}),
      orders: orders.map((order) => ({ id: order.id, kind: order.kind, status: order.status, amount: order.amount, currency: order.currency, refundNeedsAttention: Boolean(order.refundError) })),
      exists: Boolean(await existingArticle(intent)),
      signedIn: Boolean(user), credits: user ? await creditBalance(user.id) : null,
    });
  });
}
