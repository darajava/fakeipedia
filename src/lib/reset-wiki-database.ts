import type { PoolClient } from "pg";

export async function resetWikiDatabase(client: Pick<PoolClient, "query">, all: boolean) {
  await client.query("BEGIN");
  try {
    // Block checkout creation, fulfillment and worker claims during the reset.
    await client.query("LOCK TABLE generation_intents, generation_jobs, purchase_orders IN EXCLUSIVE MODE");
    const active = await client.query("SELECT 1 FROM generation_jobs WHERE status IN ('queued', 'running') OR (status='succeeded' AND progress->>'phase' <> 'done' AND progress_updated_at > now()-interval '2 minutes') UNION ALL SELECT 1 FROM purchase_orders WHERE status IN ('pending', 'refund_pending') LIMIT 1");
    if (active.rowCount) throw new Error("Finish or cancel pending payments and generation before resetting content.");
    if (all) {
      // Explicit list, without CASCADE: never erase unrelated tables or migrations.
      await client.query("TRUNCATE TABLE credit_transactions, credit_accounts, generation_jobs, purchase_orders, generation_intents, lore_contributions, article_revisions, articles, users RESTART IDENTITY");
    } else {
      await client.query("DELETE FROM lore_contributions");
      await client.query("DELETE FROM articles");
      await client.query("UPDATE generation_jobs SET progress=NULL, progress_updated_at=NULL");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
