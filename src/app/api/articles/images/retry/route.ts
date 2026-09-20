import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { extractArticleImages } from "@/lib/article-draft";
import { generateArticleImages } from "@/lib/article-images";
import { validSlug } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (
    !body || typeof body.wiki !== "string" || !validSlug(body.wiki) ||
    typeof body.slug !== "string" || !validSlug(body.slug) ||
    typeof body.filename !== "string"
  ) {
    return Response.json({ error: "A valid wiki, article and image are required." }, { status: 400 });
  }

  try {
    const [article] = await db.select().from(articles)
      .where(and(eq(articles.wiki, body.wiki), eq(articles.slug, body.slug))).limit(1);
    if (!article) {
      return Response.json({ error: "Article not found." }, { status: 404 });
    }

    // Only regenerate an image declared by the saved article, using its original description.
    if (!extractArticleImages(article.content, article.slug).some((image) => image.filename === body.filename)) {
      return Response.json({ error: "This image cannot be regenerated." }, { status: 400 });
    }

    let url: string | undefined;
    await generateArticleImages({
      wiki: body.wiki, slug: article.slug, title: article.title, markdown: article.content,
    }, (message) => {
      if (message.type === "image-done") url = message.url;
    }, { filename: body.filename });

    if (!url) {
      return Response.json({ error: "Could not generate this image. Please try again." }, { status: 502 });
    }

    return Response.json({ url: `${url}?v=${crypto.randomUUID()}` });
  } catch (error) {
    console.error("Image retry failed:", error);
    return Response.json({ error: "Could not generate this image. Please try again." }, { status: 500 });
  }
}
