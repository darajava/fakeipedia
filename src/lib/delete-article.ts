import { rename, unlink } from "node:fs/promises";
import { findWikiArticleFiles } from "./wiki-files";
import { validSlug } from "./wiki";

export async function deleteWikiArticle(
  directory: string,
  wiki: string,
  slug: string,
  deleteRecord: () => Promise<void>,
) {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Article deletion is only available in development.");
  }
  if (typeof wiki !== "string" || typeof slug !== "string" || !validSlug(wiki) || !validSlug(slug)) {
    throw new Error("Invalid wiki or article slug.");
  }

  const files = await findWikiArticleFiles(directory, wiki, slug);
  const staged: Array<{ original: string; temporary: string }> = [];

  try {
    // Keep the originals recoverable until the database deletion succeeds.
    for (const original of files) {
      const temporary = `${original}.${crypto.randomUUID()}.deleting`;
      await rename(original, temporary);
      staged.push({ original, temporary });
    }
    await deleteRecord();
  } catch (error) {
    for (const { original, temporary } of staged.reverse()) {
      await rename(temporary, original);
    }
    throw error;
  }

  await Promise.all(staged.map(({ temporary }) => unlink(temporary)));
}
