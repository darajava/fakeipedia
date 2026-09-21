import { and, asc, count, ilike, notLike, or, sql } from "drizzle-orm";
import { db } from "../db";
import { articles } from "../db/schema";

const pageSize = 20;

export async function searchArticles(query: string, requestedPage = "1") {
  const q = query.trim().slice(0, 200);
  if (!q) return { q, total: 0, page: 1, pages: 0, results: [] };

  // Treat user-entered SQL pattern characters as literal search text.
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const titleMatch = ilike(articles.title, pattern);
  const filter = and(
    notLike(articles.slug, "stub-%"),
    or(titleMatch, ilike(articles.content, pattern)),
  );
  const [{ total }] = await db.select({ total: count() }).from(articles).where(filter);
  const pages = Math.ceil(total / pageSize);
  const numericPage = Number(requestedPage);
  const page = Math.min(Math.max(1, pages), Number.isFinite(numericPage) ? Math.max(1, Math.floor(numericPage)) : 1);
  const results = total ? await db.select({ wiki: articles.wiki, slug: articles.slug, title: articles.title })
    .from(articles)
    .where(filter)
    .orderBy(
      sql`case when lower(${articles.title}) = lower(${q}) then 0 when ${titleMatch} then 1 else 2 end`,
      asc(articles.title), asc(articles.wiki), asc(articles.slug),
    )
    .limit(pageSize).offset((page - 1) * pageSize) : [];

  return { q, total, page, pages, results };
}
