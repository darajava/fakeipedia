import "dotenv/config";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { articles } from "../db/schema";
import { readWikiArticles } from "../lib/wiki-files";
import { articlePath } from "../lib/wiki";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing from .env");
}

const wikiDirectory = path.join(process.cwd(), "wiki-files");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

async function main() {
  const importedArticles = await readWikiArticles(wikiDirectory);
  if (importedArticles.length === 0) {
    throw new Error(`No Markdown files found in ${wikiDirectory}`);
  }

  await db.transaction(async (tx) => {
    for (const article of importedArticles) {
      await tx.insert(articles).values(article).onConflictDoUpdate({
        target: [articles.wiki, articles.slug],
        set: {
          title: article.title,
          content: article.content,
          updatedAt: new Date(),
        },
      });
    }
  });

  for (const article of importedArticles) {
    console.log(`Imported ${articlePath(article.wiki, article.slug)}`);
  }
  console.log(`Finished importing ${importedArticles.length} article(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
