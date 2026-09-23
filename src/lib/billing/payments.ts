import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "../../db";
import { articles, creditAccounts, creditTransactions, generationIntents, generationJobs, purchaseOrders } from "../../db/schema";
import { BillingError, billingConfig, requireUuid, stripeClient } from "./config";
import { reserveCredit } from "./credits";
import type { Intent } from "./intents";

let cachedPrices: { key: string; expiresAt: number; value: Promise<Awaited<ReturnType<typeof loadPrices>>> } | undefined;
export async function prices() {
  const config = billingConfig();
  const key = [config.secret, config.articlePrice, config.packPrice, config.packQuantity].join(":");
  if (!cachedPrices || cachedPrices.key !== key || cachedPrices.expiresAt < Date.now()) {
    const value = loadPrices();
    cachedPrices = { key, expiresAt: Date.now() + 60000, value };
    void value.catch(() => { if (cachedPrices?.value === value) cachedPrices = undefined; });
  }
  return cachedPrices.value;
}
async function loadPrices() {
  const config = billingConfig();
  const stripe = stripeClient();
  const [article, pack] = await Promise.all([stripe.prices.retrieve(config.articlePrice), stripe.prices.retrieve(config.packPrice)]);
  for (const price of [article, pack]) {
    if (!price.active || price.type !== "one_time" || !price.unit_amount || price.billing_scheme !== "per_unit") throw new BillingError("Payment prices are not configured correctly.", 503);
  }
  return { article: { id: article.id, amount: article.unit_amount!, currency: article.currency }, pack: { id: pack.id, amount: pack.unit_amount!, currency: pack.currency, credits: config.packQuantity } };
}

export async function createCheckout(kind: "article" | "credits", intent: Intent | null, userId: number | null, requestId: unknown) {
  if (kind === "credits" && !userId) throw new BillingError("Sign in to buy credits.", 401);
  if (kind === "article" && !intent) throw new BillingError("Choose an article first.");
  const idempotencyId = requireUuid(requestId);
  const catalog = await prices();
  const price = kind === "article" ? catalog.article : catalog.pack;
  const stripe = stripeClient();
  const order = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`checkout-request:${idempotencyId}`}, 0))`);
    if (intent) {
      await tx.select().from(generationIntents).where(eq(generationIntents.id, intent.id)).for("update");
      const [job] = await tx.select().from(generationJobs).where(eq(generationJobs.intentId, intent.id));
      if (job) throw new BillingError("This article request has already been funded.", 409);
      const [existingArticle] = await tx.select({ id: articles.id }).from(articles).where(and(eq(articles.wiki, intent.wiki), eq(articles.slug, intent.slug))).limit(1);
      if (existingArticle && kind === "article") throw new BillingError("This article is already available. No payment is needed.", 409);
      const [pending] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.intentId, intent.id), eq(purchaseOrders.status, "pending"))).limit(1);
      if (pending) {
        if ((pending.userId !== null && pending.userId !== userId) || pending.kind !== kind) throw new BillingError("Cancel your previous checkout before choosing a different payment option.", 409);
        return pending;
      }
    }
    const [previous] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.requestId, idempotencyId));
    if (previous) {
      if (previous.userId !== userId || previous.kind !== kind || previous.intentId !== (intent?.id ?? null)) throw new BillingError("This payment request belongs to another purchase.", 409);
      if (previous.status !== "pending") throw new BillingError("This purchase has already been processed.", 409);
      return previous;
    }
    const [created] = await tx.insert(purchaseOrders).values({ id: randomUUID(), userId, intentId: intent?.id, requestId: idempotencyId, kind, priceId: price.id, amount: price.amount, currency: price.currency, creditQuantity: kind === "credits" ? catalog.pack.credits : 0 }).returning();
    return created;
  });
  // Idempotency is tied to the persisted order, not to a browser tab or redirect.
  if (order.stripeSessionId) {
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    if (session.status === "complete") {
      await fulfillCheckout(session.id);
      return { pending: true };
    }
    if (session.status === "expired") {
      throw new BillingError("This checkout expired. Cancel it here to choose a new payment option.", 409);
    }
    if (session.url) return { url: session.url };
  }
  if (Date.now() - order.createdAt.getTime() > 23 * 60 * 60 * 1000) {
    // Stripe may discard idempotency keys after 24 hours. Do not create a second
    // session for an old ambiguous request. Cancellation/reconciliation handles it.
    throw new BillingError("This checkout needs to be cancelled before starting again.", 409);
  }
  const returnPath = intent ? `/payment?intent=${intent.id}` : `/account?order=${order.id}`;
  const origin = billingConfig().origin;
  const session = await stripe.checkout.sessions.create({
    mode: "payment", payment_method_types: ["card"],
    // Keep standard Checkout even when the Stripe account defaults to Managed Payments.
    managed_payments: { enabled: false },
    currency: order.currency, adaptive_pricing: { enabled: false },
    line_items: [{ price: order.priceId, quantity: 1 }],
    client_reference_id: order.id, metadata: { orderId: order.id },
    payment_intent_data: { metadata: { orderId: order.id } },
    success_url: `${origin}${returnPath}&checkout=success`,
    cancel_url: `${origin}${returnPath}&checkout=cancelled`,
  }, { idempotencyKey: `checkout:${order.id}` }).catch(async (error: unknown) => {
    // A definite API rejection created no session. Release that pending checkout
    // so the reader can retry or choose credits. Network/5xx outcomes stay pending
    // and are recovered using the same idempotency key.
    if (error instanceof Stripe.errors.StripeInvalidRequestError || error instanceof Stripe.errors.StripeAuthenticationError || error instanceof Stripe.errors.StripePermissionError) {
      await db.update(purchaseOrders).set({ status: "cancelled" }).where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.status, "pending")));
    }
    throw error;
  });
  await db.update(purchaseOrders).set({ stripeSessionId: session.id, checkoutUrl: session.url }).where(eq(purchaseOrders.id, order.id));
  if (!session.url) throw new BillingError("Checkout is not available. Please try again.", 503);
  return { url: session.url };
}

export function verifyPaidSession(session: Stripe.Checkout.Session, order: typeof purchaseOrders.$inferSelect) {
  const items = session.line_items?.data;
  if (session.payment_status !== "paid" || session.mode !== "payment") return false;
  if (session.client_reference_id !== order.id || session.metadata?.orderId !== order.id ||
      (order.stripeSessionId && order.stripeSessionId !== session.id) ||
      session.amount_total !== order.amount || session.currency !== order.currency ||
      session.line_items?.has_more || items?.length !== 1 || items[0].quantity !== 1 || items[0].price?.id !== order.priceId ||
      !session.payment_intent) throw new Error("Paid checkout does not match its saved order.");
  return true;
}

export async function fulfillCheckout(sessionId: string) {
  const session = await stripeClient().checkout.sessions.retrieve(sessionId, { expand: ["line_items"] });
  const orderId = requireUuid(session.metadata?.orderId);
  return db.transaction(async (tx) => {
    // All funding paths lock intent before order to avoid lock-order inversions.
    const [snapshot] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
    if (!snapshot) throw new Error("Checkout has no saved order.");
    const [intent] = snapshot.intentId ? await tx.select().from(generationIntents).where(eq(generationIntents.id, snapshot.intentId)).for("update") : [];
    const [order] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for("update");
    if (!verifyPaidSession(session, order)) return;
    if (order.status !== "pending") return;
    const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent!.id;
    await tx.update(purchaseOrders).set({ status: "paid", paidAt: new Date(), stripeSessionId: session.id, stripePaymentIntentId: paymentIntentId }).where(eq(purchaseOrders.id, order.id));
    if (order.kind === "credits") {
      await tx.insert(creditAccounts).values({ userId: order.userId!, balance: order.creditQuantity }).onConflictDoUpdate({ target: creditAccounts.userId, set: { balance: sql`${creditAccounts.balance} + ${order.creditQuantity}` } });
      await tx.insert(creditTransactions).values({ userId: order.userId!, orderId: order.id, key: `purchase:${order.id}`, delta: order.creditQuantity, reason: "Credit pack purchased" });
      if (intent) {
        const [job] = await tx.select().from(generationJobs).where(eq(generationJobs.intentId, intent.id));
        const [article] = await tx.select({ id: articles.id }).from(articles).where(and(eq(articles.wiki, intent.wiki), eq(articles.slug, intent.slug))).limit(1);
        if (!job && !article) await reserveCredit(tx, intent, order.userId!);
      }
    } else {
      if (!intent) throw new Error("Article purchase has no saved draft.");
      const [job] = await tx.select().from(generationJobs).where(eq(generationJobs.intentId, intent.id));
      if (job) {
        // Another checkout or a credit funded this draft first. Never charge twice.
        await tx.update(purchaseOrders).set({ status: "refund_pending" }).where(eq(purchaseOrders.id, order.id));
      } else {
        await tx.insert(generationJobs).values({ intentId: intent.id, orderId: order.id, userId: order.userId, funding: "article" });
      }
    }
  });
}

export async function cancelCheckout(intentId: string | null, userId: number | null, orderId?: unknown) {
  const rows = await db.select().from(purchaseOrders).where(intentId ? eq(purchaseOrders.intentId, intentId) : eq(purchaseOrders.id, requireUuid(orderId)));
  for (const order of rows) {
    if ((order.userId !== userId && !(intentId && order.userId === null)) || order.status !== "pending") continue;
    if (!order.stripeSessionId) {
      // Creation may have reached Stripe before the connection failed. Repeating
      // the original operation recovers that session with the same idempotency key.
      if (Date.now() - order.createdAt.getTime() > 23 * 60 * 60 * 1000) throw new BillingError("This interrupted checkout needs support before it can be retried.", 409);
      throw new BillingError("Please reopen checkout once, then cancel it here.", 409);
    }
    let session = await stripeClient().checkout.sessions.retrieve(order.stripeSessionId);
    if (session.status === "open") {
      try { session = await stripeClient().checkout.sessions.expire(session.id); }
      catch { session = await stripeClient().checkout.sessions.retrieve(session.id); }
    }
    if (session.status === "complete") { await fulfillCheckout(session.id); continue; }
    if (session.status !== "expired") throw new BillingError("Payment is still being processed. Please wait.", 409);
    // Keep the order as evidence; its expiry is confirmed by Stripe.
    await db.update(purchaseOrders).set({ status: "cancelled" }).where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.status, "pending")));
  }
}

export async function processRefunds() {
  const orders = await db.select().from(purchaseOrders).where(eq(purchaseOrders.status, "refund_pending")).orderBy(purchaseOrders.checkedAt).limit(20);
  for (const order of orders) {
    if (!order.stripePaymentIntentId) continue;
    try {
      const stripe = stripeClient();
      // Recover a refund that Stripe accepted before our process/database failed,
      // including after Stripe's idempotency retention window has elapsed.
      const recovered = order.stripeRefundId ? undefined : (await stripe.refunds.list({ payment_intent: order.stripePaymentIntentId, limit: 100 })).data.find((refund) => refund.metadata?.orderId === order.id);
      const refund = order.stripeRefundId ? await stripe.refunds.retrieve(order.stripeRefundId) : recovered ?? await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId, metadata: { orderId: order.id } }, { idempotencyKey: `refund:${order.id}` });
      if (refund.status === "failed" || refund.status === "canceled") throw new Error(`Stripe refund ${refund.id} ${refund.status}; review in Stripe.`);
      await db.update(purchaseOrders).set({ status: refund.status === "succeeded" ? "refunded" : "refund_pending", stripeRefundId: refund.id, refundError: null }).where(eq(purchaseOrders.id, order.id));
    } catch (error) {
      await db.update(purchaseOrders).set({ refundError: error instanceof Error ? error.message : "Refund needs attention" }).where(eq(purchaseOrders.id, order.id));
      console.error("Refund needs retry:", order.id);
    } finally {
      await db.update(purchaseOrders).set({ checkedAt: new Date() }).where(eq(purchaseOrders.id, order.id));
    }
  }
}

// Webhooks are primary. Reconciliation also recovers a webhook missed during a
// deployment or a network failure between session creation and persistence.
async function reconcileOrder(order: typeof purchaseOrders.$inferSelect) {
  try {
    const session = await stripeClient().checkout.sessions.retrieve(order.stripeSessionId!);
    if (session.payment_status === "paid") await fulfillCheckout(session.id);
    else if (session.status === "expired") await db.update(purchaseOrders).set({ status: "cancelled" }).where(and(eq(purchaseOrders.id, order.id), eq(purchaseOrders.status, "pending")));
  } catch { console.error("Payment reconciliation needs retry:", order.id); }
  finally { await db.update(purchaseOrders).set({ checkedAt: new Date() }).where(eq(purchaseOrders.id, order.id)); }
}

// Called only after authenticating the account or authorizing the private intent.
// Stripe's verified session, never a browser return parameter, grants the funds.
export async function refreshPendingPayments(scope: { userId: number | null; intentId?: string }) {
  if (!scope.intentId && scope.userId === null) return;
  const owner = scope.userId === null ? isNull(purchaseOrders.userId) : eq(purchaseOrders.userId, scope.userId);
  const accessible = scope.intentId
    ? and(eq(purchaseOrders.intentId, scope.intentId), or(isNull(purchaseOrders.userId), owner))
    : owner;
  const cutoff = new Date(Date.now() - 5000);
  const eligible = and(accessible, eq(purchaseOrders.status, "pending"), sql`${purchaseOrders.stripeSessionId} IS NOT NULL`, lt(purchaseOrders.checkedAt, cutoff));
  const pending = await db.select().from(purchaseOrders).where(eligible).orderBy(purchaseOrders.checkedAt).limit(5);
  await Promise.all(pending.map(async (order) => {
    // Coordinate polling tabs through PostgreSQL and avoid repeated Stripe calls.
    const [claimed] = await db.update(purchaseOrders).set({ checkedAt: new Date() })
      .where(and(eq(purchaseOrders.id, order.id), eligible)).returning();
    if (claimed) await reconcileOrder(claimed);
  }));
}

export async function reconcilePayments() {
  const pending = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.status, "pending"), sql`${purchaseOrders.stripeSessionId} IS NOT NULL`)).orderBy(purchaseOrders.checkedAt).limit(30);
  for (const order of pending) {
    await reconcileOrder(order);
  }
  await processRefunds();
}
