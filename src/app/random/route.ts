import { and, eq, notLike, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { articlePath, validWikiSlug } from "@/lib/wiki";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wiki = new URL(request.url).searchParams.get("wiki");
  const headers = { "Cache-Control": "no-store" };
  if (!wiki) return new Response(null, { status: 307, headers: { ...headers, Location: "/" } });
  if (!validWikiSlug(wiki)) {
    return new Response("Invalid wiki.", { status: 400, headers });
  }

  const [article] = await db.select({ slug: articles.slug }).from(articles)
    .where(and(eq(articles.wiki, wiki), notLike(articles.slug, "stub-%")))
    .orderBy(sql`random()`)
    .limit(1);

  if (!article) return new Response("This wiki has no articles yet.", { status: 404, headers });
  return new Response(null, {
    status: 307,
    headers: { ...headers, Location: articlePath(wiki, article.slug) },
  });
}
