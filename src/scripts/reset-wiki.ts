import "dotenv/config";
import path from "node:path";
import { Pool } from "pg";
import { planWikiReset, resetWiki } from "../lib/reset-wiki";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) {
    throw new Error("Usage: npm run reset:wiki [-- --dry-run]");
  }

  const directory = path.join(process.cwd(), "wiki-files");
  if (args.includes("--dry-run")) {
    const plan = await planWikiReset(directory);
    console.log("Would empty articles, article_revisions, article_question_sets, lore_contributions and users, and reset their IDs.");
    console.log("Database schema and migration history would remain intact.");
    for (const file of plan.files) console.log(`Would delete ${path.relative(process.cwd(), file)}`);
    console.log(`Would delete ${plan.files.length} file(s) and preserve ${plan.stubs.length} stub(s).`);
    console.log("Dry run only: no database connection or file changes.");
    return;
  }

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });

  try {
    // Check connectivity before moving any files.
    const client = await pool.connect();
    try {
      const result = await resetWiki(directory, async () => {
        await client.query("TRUNCATE TABLE lore_contributions, article_question_sets, article_revisions, articles, users RESTART IDENTITY");
      });
      console.log("Emptied articles, article_revisions, article_question_sets, lore_contributions and users; reset their IDs.");
      console.log(`Deleted ${result.files.length} file(s) and preserved ${result.stubs.length} stub(s).`);
      console.log("Run npm run import:wiki to load the preserved stubs into the empty database.");
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
