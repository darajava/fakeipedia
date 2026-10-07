import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { articles, generationIntents, generationJobs, purchaseOrders } from "../../db/schema";
import { validSlug, validWikiSlug } from "../wiki";
import { generationTargets } from "../article-targets";
import { saveLoreContribution } from "../lore-contributions";
import { readLoreInput } from "../lore-input";
import { BillingError, requireUuid } from "./config";
import type { GenerateRequest } from "../article-generation";

export type Intent = typeof generationIntents.$inferSelect;
export function hashToken(token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new BillingError("Your private purchase link is missing. Return to the article preparation page.", 403);
  return createHash("sha256").update(token).digest("hex");
}
export function verifyToken(hash: string, token: unknown) {
  if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(hashToken(token), "hex"))) throw new BillingError("Purchase not found.", 404);
}
export async function readIntent(id: unknown, token: unknown) {
  const [intent] = await db.select().from(generationIntents).where(eq(generationIntents.id, requireUuid(id))).limit(1);
  if (!intent) throw new BillingError("Purchase not found.", 404);
  verifyToken(intent.tokenHash, token);
  return intent;
}
export async function authorizeIntent(intent: Intent) {
  const [job] = await db.select().from(generationJobs).where(eq(generationJobs.intentId, intent.id)).limit(1);
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
      if (existing.wiki !== wiki || existing.slug !== slug || existing.title !== title || existing.sourceSlug !== sourceSlug || existing.answer !== (lore?.answer ?? "")) throw new BillingError("This saved request has different details. Return to the article preparation page.", 409);
      return existing;
    }
    const [source] = await tx.select().from(articles).where(and(eq(articles.wiki, wiki), eq(articles.slug, sourceSlug))).limit(1);
    if (!source || !generationTargets(source, wiki).some((entry) => entry.slug === slug)) throw new BillingError("The source article no longer links to this page.");
    const contribution = await saveLoreContribution(wiki, slug, source, lore);
    const [saved] = await tx.insert(generationIntents).values({ id, tokenHash, wiki, slug, sourceSlug, title, answer: lore?.answer ?? "", contributionId: contribution?.id }).returning();
    return saved;
  });
}

export async function latestOrders(intentId: string) {
  const rows = await db.select().from(purchaseOrders).where(eq(purchaseOrders.intentId, intentId));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
