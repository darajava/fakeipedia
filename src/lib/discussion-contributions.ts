import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { loreContributions } from "../db/schema";

export async function discussionContributions(articleId: number) {
  return db.select({
    id: loreContributions.id,
    answer: loreContributions.answer,
    createdAt: loreContributions.createdAt,
    sourceArticleId: loreContributions.sourceArticleId,
    sourceSlug: loreContributions.sourceSlug,
    sourceTitle: loreContributions.sourceTitle,
  }).from(loreContributions)
    .where(and(eq(loreContributions.articleId, articleId), eq(loreContributions.status, "succeeded")))
    .orderBy(asc(loreContributions.createdAt));
}
