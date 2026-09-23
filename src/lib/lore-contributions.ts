import { eq } from "drizzle-orm";
import { db } from "../db";
import { articles, loreContributions } from "../db/schema";
import { LoreInputError, readLoreInput } from "./lore-input";

type Source = Pick<typeof articles.$inferSelect, "id" | "slug" | "title">;

export async function saveLoreContribution(wiki: string, targetSlug: string, source: Source, input: ReturnType<typeof readLoreInput>) {
  if (!input) return undefined;
  // Persist the reader's exact input before generation, including across retries.
  await db.insert(loreContributions).values({
    requestId: input.requestId, wiki, targetSlug, sourceArticleId: source.id,
    sourceSlug: source.slug, sourceTitle: source.title,
    answer: input.answer, status: "generating",
  }).onConflictDoNothing({ target: loreContributions.requestId });
  const [saved] = await db.select().from(loreContributions).where(eq(loreContributions.requestId, input.requestId)).limit(1);
  if (!saved || saved.wiki !== wiki || saved.targetSlug !== targetSlug || saved.sourceArticleId !== source.id || saved.answer !== input.answer) {
    throw new LoreInputError("This request identifier was already used for a different contribution.");
  }
  if (saved.status === "succeeded") throw new LoreInputError("This contribution has already generated an article.");
  await db.update(loreContributions).set({ status: "generating" }).where(eq(loreContributions.id, saved.id));
  return saved;
}
