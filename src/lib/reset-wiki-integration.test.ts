import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { resetWikiDatabase } from "./reset-wiki-database";

test("full reset erases all app records, preserves migrations and refuses pending payments", { skip: !process.env.RESET_TEST_DATABASE_URL }, async (t) => {
  const client = new Client({ connectionString: process.env.RESET_TEST_DATABASE_URL });
  await client.connect();
  const schema = `reset_test_${crypto.randomUUID().replaceAll("-", "")}`;
  t.after(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  for (const file of (await readdir("drizzle")).filter(file => file.endsWith(".sql")).sort()) {
    await client.query((await readFile(path.join("drizzle", file), "utf8")).replaceAll('"public".', `"${schema}".`));
  }
  await client.query("CREATE TABLE migration_marker (version integer); INSERT INTO migration_marker VALUES (7)");
  const intent = crypto.randomUUID(), order = crypto.randomUUID(), job = crypto.randomUUID();
  await client.query("INSERT INTO users (email) VALUES ('reset@example.test')");
  await client.query("INSERT INTO articles (wiki,slug,title,content) VALUES ('world','old','Old','Old article')");
  await client.query("INSERT INTO article_revisions (article_id,editor_id,title,content) VALUES (1,1,'Old','Old revision')");
  await client.query("INSERT INTO lore_contributions (request_id,wiki,target_slug,source_slug,source_title,answer,status,article_id) VALUES ($1,'world','old','source','Source','Answer','succeeded',1)", [crypto.randomUUID()]);
  await client.query("INSERT INTO generation_intents (id,token_hash,wiki,slug,title,source_slug,answer,contribution_id) VALUES ($1,'hash','world','old','Old','source','Answer',1)", [intent]);
  await client.query("INSERT INTO purchase_orders (id,user_id,intent_id,request_id,kind,price_id,amount,currency,status) VALUES ($1,1,$2,$3,'article','price_test',100,'eur','pending')", [order,intent,crypto.randomUUID()]);
  await assert.rejects(resetWikiDatabase(client, true), /pending payments/);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM articles")).rows[0].n, 1);
  await client.query("UPDATE purchase_orders SET status='paid'");
  await client.query("INSERT INTO generation_jobs (id,intent_id,user_id,order_id,funding,status,article_id) VALUES ($1,$2,1,$3,'article','queued',1)", [job,intent,order]);
  await assert.rejects(resetWikiDatabase(client, true), /pending payments/);
  await client.query("UPDATE generation_jobs SET status='succeeded', progress='{}'");
  await client.query("INSERT INTO credit_accounts (user_id,balance) VALUES (1,5)");
  await client.query("INSERT INTO credit_transactions (user_id,order_id,job_id,key,delta,reason) VALUES (1,$1,$2,'old',5,'Historical purchase')", [order,job]);

  // The default reset must still preserve purchases and identities.
  await resetWikiDatabase(client, false);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM articles")).rows[0].n, 0);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM purchase_orders")).rows[0].n, 1);
  assert.equal((await client.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 1);
  await client.query("INSERT INTO articles (wiki,slug,title,content) VALUES ('world','old','Old','Old article')");
  await resetWikiDatabase(client, true);
  for (const table of ["articles", "article_revisions", "lore_contributions", "generation_intents", "generation_jobs", "purchase_orders", "users", "credit_accounts", "credit_transactions"]) {
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0, table);
  }
  assert.equal((await client.query("SELECT version FROM migration_marker")).rows[0].version, 7);
  const seeded = await client.query("INSERT INTO articles (wiki,slug,title,content) VALUES ('world','stub-world','World','[[World]]') RETURNING id");
  assert.equal(seeded.rows[0].id, 1);
});
