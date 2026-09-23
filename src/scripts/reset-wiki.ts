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
    console.log("Would delete article content, revisions, question sets and contributions. Accounts, purchases, credit history and generation records remain intact.");
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
        await client.query("BEGIN");
        try {
          // Exclude new funding/claims until the content reset commits.
          await client.query("LOCK TABLE generation_intents, generation_jobs, purchase_orders IN EXCLUSIVE MODE");
          const active = await client.query("SELECT 1 FROM generation_jobs WHERE status IN ('queued', 'running') OR (status='succeeded' AND progress->>'phase' <> 'done' AND progress_updated_at > now()-interval '2 minutes') UNION ALL SELECT 1 FROM purchase_orders WHERE status IN ('pending', 'refund_pending') LIMIT 1");
          if (active.rowCount) throw new Error("Finish or cancel pending payments and generation before resetting content.");
          await client.query("DELETE FROM lore_contributions");
          await client.query("DELETE FROM articles");
          await client.query("UPDATE generation_jobs SET progress=NULL, progress_updated_at=NULL");
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
      });
      console.log("Deleted articles, revisions, question sets and contributions. Preserved accounts and financial records.");
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
