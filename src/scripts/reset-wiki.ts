import "dotenv/config";
import path from "node:path";
import { Pool } from "pg";
import { planWikiReset, resetWiki } from "../lib/reset-wiki";
import { readWikiArticles } from "../lib/wiki-files";
import { planStubGeneration } from "../lib/generate-stubs";
import { resetWikiDatabase } from "../lib/reset-wiki-database";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--dry-run", "--all"].includes(arg))) {
    throw new Error("Usage: npm run reset:wiki [-- --all] [--dry-run]");
  }

  const directory = path.join(process.cwd(), "wiki-files");
  const all = args.includes("--all");
  if (all) {
    const seeds = planStubGeneration(await readWikiArticles(directory));
    if (!seeds.length) throw new Error("No valid stubs found. Restore the seed files before resetting.");
    console.log(`Validated ${seeds.length} opening-article seed(s).`);
  }
  if (args.includes("--dry-run")) {
    const plan = await planWikiReset(directory);
    console.log(all
      ? "Would erase ALL app data: articles, revisions, contributions, users, purchases, credit history, saved requests and generation jobs."
      : "Would delete articles, revisions and contributions. Accounts, purchases, credit history and generation records remain intact.");
    console.log("Database schema and migration history would remain intact.");
    for (const file of plan.files) console.log(`Would delete ${path.relative(process.cwd(), file)}`);
    console.log(`Would delete ${plan.files.length} file(s) and preserve ${plan.stubs.length} stub(s).`);
    console.log("Dry run only: no database connection or file changes.");
    return;
  }

  if (all && process.env.BILLING_ENABLED === "true") {
    throw new Error("Disable BILLING_ENABLED on the deployed service before a full reset.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });

  try {
    // Check connectivity before moving any files.
    const client = await pool.connect();
    try {
      const result = await resetWiki(directory, () => resetWikiDatabase(client, all));
      console.log(all
        ? "Erased all app data, including users, purchases, saved requests and generation jobs. Schema and migration history remain intact."
        : "Deleted articles, revisions and contributions. Preserved accounts and financial records.");
      console.log(`Deleted ${result.files.length} file(s) and preserved ${result.stubs.length} stub(s).`);
      console.log("Run npm run generate:stubs to load the preserved stubs and generate each wiki’s opening article.");
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
