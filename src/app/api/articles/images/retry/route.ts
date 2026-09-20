import { and, eq } from "drizzle-orm";
import path from "node:path";
import { lstat } from "node:fs/promises";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { extractArticleImages } from "@/lib/article-draft";
import { generateArticleImages } from "@/lib/article-images";
import { validSlug } from "@/lib/wiki";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const retriesInFlight = new Set<string>();

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (
    !body || typeof body.wiki !== "string" || !validSlug(body.wiki) ||
    typeof body.slug !== "string" || !validSlug(body.slug) ||
    typeof body.filename !== "string" ||
    (body.prompt !== undefined && (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 32_000))
  ) {
    return Response.json({ error: "A valid wiki, article and image are required." }, { status: 400 });
  }

  let retryKey: string | undefined;
  try {
    const [article] = await db.select().from(articles)
      .where(and(eq(articles.wiki, body.wiki), eq(articles.slug, body.slug))).limit(1);
    if (!article) {
      return Response.json({ error: "Article not found." }, { status: 404 });
    }

    // A retry may fill only an image slot declared by this saved article.
    if (!extractArticleImages(article.content, article.slug).some((image) => image.filename === body.filename)) {
      return Response.json({ error: "This image is not referenced by the article." }, { status: 400 });
    }

    const key = `${body.wiki}/${body.filename}`;
    if (retriesInFlight.has(key)) {
      return Response.json({ error: "This image is already being retried." }, { status: 409 });
    }
    retriesInFlight.add(key);
    retryKey = key;

    try {
      await lstat(path.join(process.cwd(), "wiki-files", body.wiki, "images", body.filename));
      return Response.json({ error: "This image already exists. Refresh the page to load it." }, { status: 409 });
    } catch (error) {
      // A load error or permission problem is not evidence of a missing image.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    let url: string | undefined;
    await generateArticleImages({
      wiki: body.wiki, slug: article.slug, title: article.title, markdown: article.content,
    }, (message) => {
      if (message.type === "image-done") url = message.url;
    }, { filename: body.filename, prompt: body.prompt?.trim(), onlyIfMissing: true });

    if (!url) {
      return Response.json({ error: "Could not generate this image. Please try again." }, { status: 502 });
    }

    return Response.json({ url: `${url}?v=${crypto.randomUUID()}` });
  } catch (error) {
    console.error("Image retry failed:", error);
    return Response.json({ error: "Could not generate this image. Please try again." }, { status: 500 });
  } finally {
    if (retryKey) retriesInFlight.delete(retryKey);
  }
}
