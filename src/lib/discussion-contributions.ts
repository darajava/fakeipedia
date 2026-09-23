import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { generationIntents, generationJobs, loreContributions, users } from "../db/schema";

export async function discussionContributions(articleId: number) {
  // Only an authenticated account that funded the completed request supplies
  // attribution. Guest checkout details and private identity names stay private.
  return db.select({
    id: loreContributions.id,
    answer: loreContributions.answer,
    createdAt: loreContributions.createdAt,
    sourceArticleId: loreContributions.sourceArticleId,
    sourceSlug: loreContributions.sourceSlug,
    sourceTitle: loreContributions.sourceTitle,
    handle: users.handle,
  }).from(loreContributions)
    .leftJoin(generationIntents, eq(generationIntents.contributionId, loreContributions.id))
    .leftJoin(generationJobs, and(eq(generationJobs.intentId, generationIntents.id), eq(generationJobs.articleId, articleId), eq(generationJobs.status, "succeeded")))
    .leftJoin(users, eq(users.id, generationJobs.userId))
    .where(and(eq(loreContributions.articleId, articleId), eq(loreContributions.status, "succeeded")))
    .orderBy(asc(loreContributions.createdAt));
}
