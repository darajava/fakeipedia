// Legacy credit settlement is retained only for jobs funded before account retirement.
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { creditAccounts, creditTransactions, generationJobs, purchaseOrders } from "../../db/schema";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Job = typeof generationJobs.$inferSelect;

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
  } else if (job.funding === "article") {
    await tx.update(purchaseOrders).set({ status: "refund_pending" }).where(and(eq(purchaseOrders.id, job.orderId!), eq(purchaseOrders.status, "paid")));
  }
}
