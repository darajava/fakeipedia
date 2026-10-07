import "dotenv/config";
import path from "node:path";
import { readWikiArticles } from "../lib/wiki-files";
import { articlePath } from "../lib/wiki";
import { generateStubPages, planStubGeneration } from "../lib/generate-stubs";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) {
    throw new Error("Usage: npm run generate:stubs [-- --dry-run]");
  }
  const localArticles = await readWikiArticles(path.join(process.cwd(), "wiki-files"));
  const plan = planStubGeneration(localArticles);
  if (!plan.length) throw new Error("No stubs found in wiki-files.");
  if (args.includes("--dry-run")) {
    for (const { stub, slug, title } of plan) {
      console.log(`${stub.wiki}/${stub.slug} → ${articlePath(stub.wiki, slug)} (${title})`);
    }
    console.log(`${plan.length} stub(s). Existing pages will be skipped. No database or generation calls made.`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env");
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing from .env");

  const { db } = await import("../db");
  const { articles } = await import("../db/schema");
  const { articleLockPool } = await import("../lib/article-lock");
  try {
    // Refresh briefs from disk and restore any existing target files before generating.
    await db.transaction(async (tx) => {
      for (const { stub, slug } of plan) {
        await tx.insert(articles).values(stub).onConflictDoUpdate({
          target: [articles.wiki, articles.slug],
          set: { title: stub.title, content: stub.content, updatedAt: new Date() },
        });
        const saved = localArticles.find((article) => article.wiki === stub.wiki && article.slug === slug);
        if (saved) await tx.insert(articles).values(saved).onConflictDoNothing();
      }
    });
    // This is an operator-only CLI. Public generation remains payment-gated.
    const { generateArticleRequest } = await import("../lib/article-generation");
    const result = await generateStubPages(plan, generateArticleRequest);
    console.log(`Finished: ${result.generated} generated, ${result.skipped} skipped, ${result.failed} failed.`);
    if (result.failed) process.exitCode = 1;
  } finally {
    await articleLockPool.end();
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
