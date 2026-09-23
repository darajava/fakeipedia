import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { articles, creditAccounts, creditTransactions, generationIntents, generationJobs, purchaseOrders } from "../../db/schema";
import { BillingError } from "./config";
import type { Intent } from "./intents";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Job = typeof generationJobs.$inferSelect;

export async function creditBalance(userId: number) {
  const [account] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId)).limit(1);
  return { balance: account?.balance ?? 0, reserved: account?.reserved ?? 0, available: (account?.balance ?? 0) - (account?.reserved ?? 0) };
}

export async function reserveCredit(tx: Transaction, intent: Intent, userId: number) {
  // Every way of funding a given draft serializes on this row.
  await tx.select().from(generationIntents).where(eq(generationIntents.id, intent.id)).for("update");
  const [existing] = await tx.select().from(generationJobs).where(eq(generationJobs.intentId, intent.id)).limit(1);
  if (existing) {
    if (existing.userId !== userId) throw new BillingError("This request has already been funded.", 409);
    return existing;
  }
  const [pending] = await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.intentId, intent.id), eq(purchaseOrders.status, "pending"))).limit(1);
  if (pending) throw new BillingError("Cancel the pending checkout before using a credit.", 409);
  const [article] = await tx.select({ id: articles.id }).from(articles).where(and(eq(articles.wiki, intent.wiki), eq(articles.slug, intent.slug))).limit(1);
  if (article) throw new BillingError("This article is already available. No credit was used.", 409);
  const [account] = await tx.update(creditAccounts).set({ reserved: sql`${creditAccounts.reserved} + 1` })
    .where(and(eq(creditAccounts.userId, userId), sql`${creditAccounts.balance} > ${creditAccounts.reserved}`)).returning();
  if (!account) throw new BillingError("You need one available credit to generate this article.", 402);
  const [job] = await tx.insert(generationJobs).values({ intentId: intent.id, userId, funding: "credit" }).returning();
  await tx.insert(creditTransactions).values({ userId, jobId: job.id, key: `reserve:${job.id}`, delta: 0, reservedDelta: 1, reason: "Article credit reserved" });
  return job;
}

export async function completeJob(tx: Transaction, job: Job, articleId: number) {
  const [completed] = await tx.update(generationJobs).set({ status: "succeeded", articleId, completedAt: new Date(), leasedUntil: null, error: null })
    .where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, "running"), eq(generationJobs.leaseToken, job.leaseToken!))).returning();
  if (!completed) throw new Error("Generation lease was lost before saving the article.");
  if (job.funding === "credit") {
    const [account] = await tx.update(creditAccounts).set({ balance: sql`${creditAccounts.balance} - 1`, reserved: sql`${creditAccounts.reserved} - 1` })
      .where(and(eq(creditAccounts.userId, job.userId!), sql`${creditAccounts.reserved} > 0`)).returning();
    if (!account) throw new Error("The reserved credit is unavailable.");
    await tx.insert(creditTransactions).values({ userId: job.userId!, jobId: job.id, key: `consume:${job.id}`, delta: -1, reservedDelta: -1, reason: "Article generated" });
  }
}

export async function releaseFunding(tx: Transaction, job: Job) {
  if (job.funding === "credit") {
    const [entry] = await tx.insert(creditTransactions).values({ userId: job.userId!, jobId: job.id, key: `release:${job.id}`, delta: 0, reservedDelta: -1, reason: "Article credit returned" }).onConflictDoNothing().returning();
    if (entry) await tx.update(creditAccounts).set({ reserved: sql`${creditAccounts.reserved} - 1` }).where(eq(creditAccounts.userId, job.userId!));
  } else {
    await tx.update(purchaseOrders).set({ status: "refund_pending" }).where(and(eq(purchaseOrders.id, job.orderId!), eq(purchaseOrders.status, "paid")));
  }
}
