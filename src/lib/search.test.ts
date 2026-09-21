import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

test("search handles empty queries, literal special characters, ranking and bounded pages", async (t) => {
  const oldDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
  t.after(() => {
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldDatabaseUrl;
  });
  const { db } = await import("../db");
  const { searchArticles } = await import("./search");
  const dialect = new PgDialect();
  let total = 41;
  let reads = 0;
  let filterQuery: ReturnType<typeof dialect.sqlToQuery> | undefined;
  let rankQuery: ReturnType<typeof dialect.sqlToQuery> | undefined;
  let offset = -1;
  const rows = [{ wiki: "hellas", slug: "alexandria", title: "Alexandria" }];

  t.mock.method(db, "select", (fields: object) => {
    reads++;
    return { from: () => ({ where: (filter: SQL) => {
      filterQuery = dialect.sqlToQuery(filter);
      if ("total" in fields) return Promise.resolve([{ total }]);
      return { orderBy: (rank: SQL) => {
        rankQuery = dialect.sqlToQuery(rank);
        return { limit: (limit: number) => {
          assert.equal(limit, 20);
          return { offset: async (value: number) => { offset = value; return rows; } };
        } };
      } };
    } }) };
  });

  assert.deepEqual(await searchArticles("  \n "), { q: "", total: 0, page: 1, pages: 0, results: [] });
  assert.equal(reads, 0);

  const result = await searchArticles("  50%_\\'  ", "999");
  assert.equal(result.q, "50%_\\'");
  assert.equal(result.page, 3);
  assert.equal(result.pages, 3);
  assert.equal(offset, 40);
  assert.deepEqual(result.results, rows);
  assert.match(filterQuery!.sql, /"slug" not like/);
  assert.match(filterQuery!.sql, /"title" ilike .* or .*"content" ilike/);
  assert.deepEqual(filterQuery!.params, ["stub-%", "%50\\%\\_\\\\'%", "%50\\%\\_\\\\'%"]);
  assert.match(rankQuery!.sql, /case when lower\(.*"title"\) = lower\(/);
  assert.equal(rankQuery!.params[0], result.q);

  for (const page of ["-1", "NaN", "Infinity", "1.5"]) {
    assert.equal((await searchArticles("Alexandria", page)).page, 1);
    assert.equal(offset, 0);
  }
  assert.equal((await searchArticles("Alexandria", "2")).page, 2);
  assert.equal(offset, 20);
  assert.equal((await searchArticles("x".repeat(250))).q.length, 200);

  total = 0;
  const beforeEmpty = reads;
  const empty = await searchArticles("no match", "2");
  assert.equal(empty.page, 1);
  assert.deepEqual(empty.results, []);
  assert.equal(reads, beforeEmpty + 1, "No result query is needed when nothing matches");
});
