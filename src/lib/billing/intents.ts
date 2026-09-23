import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { articles, articleQuestionSets, generationIntents, generationJobs, purchaseOrders } from "../../db/schema";
import { validSlug, validWikiSlug } from "../wiki";
import { questionTargets, fallbackQuestions } from "../article-questions";
import { saveLoreContribution } from "../lore-contributions";
import { readLoreInput } from "../lore-input";
import { BillingError, requireUuid } from "./config";
import type { GenerateRequest } from "../article-generation";

export type Intent = typeof generationIntents.$inferSelect;
export function hashToken(token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new BillingError("Your private purchase link is missing. Return to the question page.", 403);
  return createHash("sha256").update(token).digest("hex");
}
export function verifyToken(hash: string, token: unknown) {
  if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(hashToken(token), "hex"))) throw new BillingError("Purchase not found.", 404);
}
export async function readIntent(id: unknown, token: unknown, userId: number | null = null) {
  const [intent] = await db.select().from(generationIntents).where(eq(generationIntents.id, requireUuid(id))).limit(1);
  if (!intent) throw new BillingError("Purchase not found.", 404);
  if (userId) {
    const [ownedJob] = await db.select({ id: generationJobs.id }).from(generationJobs).where(and(eq(generationJobs.intentId, intent.id), eq(generationJobs.userId, userId))).limit(1);
    const [ownedOrder] = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(and(eq(purchaseOrders.intentId, intent.id), eq(purchaseOrders.userId, userId))).limit(1);
    if (ownedJob || ownedOrder) return intent;
  }
  verifyToken(intent.tokenHash, token);
  return intent;
}
export async function authorizeIntent(intent: Intent, userId: number | null) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.intentId, intent.id)).limit(1);
  if (job?.userId && job.userId !== userId) throw new BillingError("Sign in to the account that funded this article.", 403);
  return job;
}

export async function saveIntent(body: GenerateRequest & { token?: unknown }) {
  const id = requireUuid(body.requestId);
  const tokenHash = hashToken(body.token);
  const wiki = typeof body.wiki === "string" ? body.wiki.trim().toLowerCase() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const sourceSlug = typeof body.sourceSlug === "string" ? body.sourceSlug.trim().toLowerCase() : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
  const lore = readLoreInput(body);
  if (!validWikiSlug(wiki) || !validSlug(slug) || !validSlug(sourceSlug) || !title || slug.startsWith("stub-")) throw new BillingError("A valid article and source are required.");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`intent:${id}`}, 0))`);
    const [existing] = await tx.select().from(generationIntents).where(eq(generationIntents.id, id)).limit(1);
    if (existing) {
      verifyToken(existing.tokenHash, body.token);
      if (existing.wiki !== wiki || existing.slug !== slug || existing.title !== title || existing.sourceSlug !== sourceSlug || existing.answer !== (lore?.answer ?? "")) throw new BillingError("This saved request has different details. Return to the question page.", 409);
      return existing;
    }
    const [source] = await tx.select().from(articles).where(and(eq(articles.wiki, wiki), eq(articles.slug, sourceSlug))).limit(1);
    if (!source || !questionTargets(source, wiki).some((entry) => entry.slug === slug)) throw new BillingError("The source article no longer links to this page.");
    let question: string | null = null;
    if (body.questionSetId !== undefined) {
      if (!Number.isSafeInteger(body.questionSetId)) throw new BillingError("Invalid question reference.");
      const [set] = await tx.select().from(articleQuestionSets).where(and(eq(articleQuestionSets.id, Number(body.questionSetId)), eq(articleQuestionSets.sourceArticleId, source.id))).limit(1);
      question = (body.fallbackQuestion === true && set ? fallbackQuestions(set.questions) : set?.questions)?.find((entry) => entry.slug === slug)?.question ?? null;
      if (!question) throw new BillingError("Please reload the question before continuing.");
    }
    const contribution = await saveLoreContribution(wiki, slug, source, lore);
    const [saved] = await tx.insert(generationIntents).values({ id, tokenHash, wiki, slug, sourceSlug, title, question: contribution?.question ?? question, answer: lore?.answer ?? "", contributionId: contribution?.id }).returning();
    return saved;
  });
}

export async function latestOrders(intentId: string, userId: number | null) {
  const rows = await db.select().from(purchaseOrders).where(eq(purchaseOrders.intentId, intentId));
  return rows.filter((order) => !order.userId || order.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
