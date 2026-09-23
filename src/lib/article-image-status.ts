import path from "node:path";
import { lstat } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { articles, generationJobs } from "../db/schema";
import { extractArticleImages } from "./article-draft";
import { generationPreviewComplete } from "./generation-progress";

export type ArticleImageState = { state: "pending" | "ready" | "missing"; url: string };

export async function articleImageStates(wiki: string, article: { slug: string; content: string }): Promise<Record<string, ArticleImageState>> {
  const images = extractArticleImages(article.content, article.slug);
  if (!images.length) return {};
  const [job] = await db.select({ status: generationJobs.status, progress: generationJobs.progress, progressUpdatedAt: generationJobs.progressUpdatedAt })
    .from(generationJobs).innerJoin(articles, eq(generationJobs.articleId, articles.id))
    .where(and(eq(articles.wiki, wiki), eq(articles.slug, article.slug))).limit(1);
  const active = job?.status === "succeeded" && !generationPreviewComplete(job);
  const entries = await Promise.all(images.map(async ({ filename }) => {
    let exists = false;
    try { exists = (await lstat(path.join(process.cwd(), "wiki-files", wiki, "images", filename))).isFile(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const state: ArticleImageState = {
      state: exists ? "ready" : active && !job.progress?.failedImages[filename] ? "pending" : "missing",
      url: `/wiki-images/${encodeURIComponent(wiki)}/${encodeURIComponent(filename)}`,
    };
    return [filename, state] as const;
  }));
  return Object.fromEntries(entries);
}
