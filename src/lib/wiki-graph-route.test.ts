import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { GET } from "../app/api/wikis/[wiki]/graph/route";

test("graph snapshots batch article data, reuse unchanged revisions, and reflect deletions", async (t) => {
  let source = [
    { slug: "a", title: "A", revision: "1", content: "[[B]] [[Missing]] [[Stub-world]]" },
    { slug: "b", title: "B", revision: "1", content: "`[[Not a link]]`" },
    { slug: "stub-world", title: "World brief", revision: "1", content: "[[A]]" },
  ];
  let connections = 0, releases = 0, page = 0;
  const bodyReads: string[][] = [];
  const statements: string[] = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      statements.push(sql);
      if (sql.startsWith("DECLARE")) {
        assert.deepEqual(params, ["graph-route-test"]);
        assert.ok(sql.includes("slug NOT LIKE 'stub-%'"));
        page = 0;
      }
      if (sql.startsWith("FETCH")) return { rows: page++ ? [] : source.filter((row) => !row.slug.startsWith("stub-"))
        .map(({ slug, title, revision }) => ({ slug, title, revision })) };
      if (sql.startsWith("SELECT slug, content")) {
        const slugs = params![1] as string[];
        bodyReads.push(slugs);
        return { rows: source.filter((row) => slugs.includes(row.slug)) };
      }
      return { rows: [] };
    },
    release() { releases++; },
  };
  t.mock.method(Pool.prototype, "connect", async () => { connections++; return client; });
  const request = () => GET(new Request("http://localhost/api/wikis/graph-route-test/graph"), { params: Promise.resolve({ wiki: "graph-route-test" }) });
  const first = await (await request()).text();
  assert.deepEqual(first.trim().split("\n").map((line) => JSON.parse(line)), [
    ["a", "A", ["b", "missing"]], ["b", "B", []], { complete: true, count: 2 },
  ]);
  assert.equal(await (await request()).text(), first);
  assert.equal(connections, 1);
  assert.equal(releases, 1);
  assert.ok(statements.includes("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"));
  assert.ok(statements.includes("ROLLBACK"));

  const later = Date.now() + 61_000;
  t.mock.method(Date, "now", () => later);
  source = [{ slug: "a", title: "A", revision: "1", content: "[[B]] [[Missing]]" }, { slug: "c", title: "C", revision: "2", content: "[[A]]" }];
  const refreshed = await (await request()).text();
  assert.deepEqual(bodyReads, [["a", "b"], ["c"]]);
  assert.deepEqual(refreshed.trim().split("\n").map((line) => JSON.parse(line)), [
    ["a", "A", ["b", "missing"]], ["c", "C", ["a"]], { complete: true, count: 2 },
  ]);
  assert.equal(releases, 2);
});

test("cancelling a graph stream closes its read-only database transaction", async (t) => {
  let releases = 0;
  const statements: string[] = [];
  t.mock.method(Pool.prototype, "connect", async () => ({
    async query(sql: string) {
      statements.push(sql);
      if (sql.startsWith("FETCH")) return { rows: [{ slug: "a", title: "A", revision: "1" }] };
      if (sql.startsWith("SELECT slug, content")) return { rows: [{ slug: "a", content: "[[Missing]]" }] };
      return { rows: [] };
    },
    release() { releases++; },
  }));
  const response = await GET(new Request("http://localhost/api/wikis/cancel-test/graph"), { params: Promise.resolve({ wiki: "cancel-test" }) });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(releases, 1);
  assert.ok(statements.includes("ROLLBACK"));
});

test("invalid wiki names never open a database connection", async (t) => {
  t.mock.method(Pool.prototype, "connect", () => { throw new Error("Should not connect"); });
  const response = await GET(new Request("http://localhost/api/wikis/invalid/graph"), { params: Promise.resolve({ wiki: "../bad" }) });
  assert.equal(response.status, 400);
});
