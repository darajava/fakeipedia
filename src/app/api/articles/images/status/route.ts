import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articleImageStates } from "@/lib/article-image-status";
import { validSlug, validWikiSlug } from "@/lib/wiki";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const wiki = query.get("wiki") ?? "";
  const slug = query.get("slug") ?? "";
  if (!validWikiSlug(wiki) || !validSlug(slug)) return Response.json({ error: "Invalid article." }, { status: 400 });
  const [article] = await db.select({ slug: articles.slug, content: articles.content }).from(articles)
    .where(and(eq(articles.wiki, wiki), eq(articles.slug, slug))).limit(1);
  if (!article) return Response.json({ error: "Article not found." }, { status: 404 });
  return Response.json({ images: await articleImageStates(wiki, article) }, { headers: { "Cache-Control": "no-store" } });
}
