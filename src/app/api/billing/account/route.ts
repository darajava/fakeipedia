import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { generationIntents, generationJobs, purchaseOrders } from "@/db/schema";
import { billingUser } from "@/lib/billing/auth";
import { creditBalance } from "@/lib/billing/credits";
import { prices, refreshPendingPayments } from "@/lib/billing/payments";
import { billingEndpoint, privateJson } from "@/lib/billing/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return billingEndpoint(request, async () => {
    const user = await billingUser();
    let catalog;
    try { catalog = await prices(); } catch { /* A readable account does not require Stripe availability. */ }
    if (!user) return privateJson({ signedIn: false, authAvailable: Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY), prices: catalog ?? null });
    await refreshPendingPayments({ userId: user.id });
    const [orders, jobs] = await Promise.all([
      db.select().from(purchaseOrders).where(eq(purchaseOrders.userId, user.id)).orderBy(desc(purchaseOrders.createdAt)).limit(100),
      db.select({ id: generationJobs.id, intentId: generationJobs.intentId, status: generationJobs.status, createdAt: generationJobs.createdAt, wiki: generationIntents.wiki, slug: generationIntents.slug, title: generationIntents.title }).from(generationJobs).innerJoin(generationIntents, eq(generationIntents.id, generationJobs.intentId)).where(eq(generationJobs.userId, user.id)).orderBy(desc(generationJobs.createdAt)).limit(100),
    ]);
    return privateJson({ signedIn: true, userId: user.id, authAvailable: true, credits: await creditBalance(user.id), prices: catalog ?? null,
      orders: orders.map((order) => ({ id: order.id, intentId: order.intentId, requestId: order.requestId, kind: order.kind, status: order.status, credits: order.creditQuantity, amount: order.amount, currency: order.currency, createdAt: order.createdAt, refundNeedsAttention: Boolean(order.refundError) })), jobs });
  });
}
