import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { articles, articleQuestionSets, loreContributions } from "../db/schema";
import { fallbackQuestions } from "./article-questions";
import { LoreInputError, readLoreInput } from "./lore-input";

type Source = Pick<typeof articles.$inferSelect, "id" | "slug" | "title">;

export async function saveLoreContribution(wiki: string, targetSlug: string, source: Source, input: ReturnType<typeof readLoreInput>) {
  if (!input) return undefined;
  const [set] = await db.select().from(articleQuestionSets).where(and(eq(articleQuestionSets.id, input.questionSetId), eq(articleQuestionSets.sourceArticleId, source.id))).limit(1);
  const question = (input.fallbackQuestion && set ? fallbackQuestions(set.questions) : set?.questions)?.find((entry) => entry.slug === targetSlug);
  if (!question) throw new LoreInputError("This question does not belong to the selected article link. Please reload the question.");
  // Immutable snapshots preserve exactly what this reader saw, even if questions
  // are regenerated or the source is subsequently edited/deleted.
  await db.insert(loreContributions).values({
    requestId: input.requestId, wiki, targetSlug, sourceArticleId: source.id,
    sourceSlug: source.slug, sourceTitle: source.title, questionSetId: set.id,
    question: question.question, answer: input.answer, status: "generating",
  }).onConflictDoNothing({ target: loreContributions.requestId });
  const [saved] = await db.select().from(loreContributions).where(eq(loreContributions.requestId, input.requestId)).limit(1);
  if (!saved || saved.wiki !== wiki || saved.targetSlug !== targetSlug || saved.sourceArticleId !== source.id || saved.questionSetId !== set.id || saved.answer !== input.answer) {
    throw new LoreInputError("This request identifier was already used for a different contribution.");
  }
  if (saved.status === "succeeded") throw new LoreInputError("This contribution has already generated an article.");
  await db.update(loreContributions).set({ status: "generating" }).where(eq(loreContributions.id, saved.id));
  return saved;
}
