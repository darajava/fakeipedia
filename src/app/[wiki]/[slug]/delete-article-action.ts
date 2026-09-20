"use server";

import path from "node:path";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { articles } from "@/db/schema";
import { deleteWikiArticle } from "@/lib/delete-article";
import { wikiPath } from "@/lib/wiki";

export async function deleteArticle(wiki: string, slug: string) {
  try {
    await deleteWikiArticle(path.join(process.cwd(), "wiki-files"), wiki, slug, async () => {
      const { db } = await import("@/db");
      await db.delete(articles).where(and(eq(articles.wiki, wiki), eq(articles.slug, slug)));
    });
  } catch (error) {
    console.error("Article deletion failed:", error);
    return { error: "Could not delete the article. Please try again." };
  }

  revalidatePath("/");
  revalidatePath(wikiPath(wiki));
  revalidatePath("/[wiki]/[slug]", "page");
  return { success: true };
}
