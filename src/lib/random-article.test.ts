import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

test("random article stays in the requested wiki, excludes stubs and selects afresh", async (t) => {
  const oldDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:1/test";
  t.after(() => {
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldDatabaseUrl;
  });
  const { db } = await import("../db");
  const { GET } = await import("../app/random/route");
  const dialect = new PgDialect();
  const selections = [[{ slug: "history" }], [{ slug: "harbor" }], []];
  let reads = 0;
  t.mock.method(db, "select", () => ({
    from: () => ({
      where: (filter: SQL) => {
        const query = dialect.sqlToQuery(filter);
        assert.match(query.sql, /"articles"\."wiki" = \$1/);
        assert.match(query.sql, /"articles"\."slug" not like \$2/);
        assert.deepEqual(query.params, ["hellas", "stub-%"]);
        return {
          orderBy: (order: SQL) => {
            assert.equal(dialect.sqlToQuery(order).sql, "random()");
            return {
              limit: async (limit: number) => {
                assert.equal(limit, 1);
                return selections[reads++];
              },
            };
          },
        };
      },
    }),
  }));
  const request = (query: string) => GET(new Request(`http://localhost/random${query}`));

  const unscoped = await request("");
  assert.equal(unscoped.status, 307);
  assert.equal(unscoped.headers.get("Location"), "/");
  for (const wiki of ["../escape", "api", "//other.example"]) {
    assert.equal((await request(`?wiki=${encodeURIComponent(wiki)}`)).status, 400);
  }
  assert.equal(reads, 0);

  for (const slug of ["history", "harbor"]) {
    const response = await request("?wiki=hellas");
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("Location"), `/hellas/${slug}`);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  const empty = await request("?wiki=hellas");
  assert.equal(empty.status, 404);
  assert.equal(empty.headers.get("Location"), null);
  assert.equal(empty.headers.get("Cache-Control"), "no-store");
  assert.equal(reads, 3);
});
