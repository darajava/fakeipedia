import assert from "node:assert/strict";
import test from "node:test";
import { graphArticleLinks, type GraphRow } from "./wiki-graph";
import { buildGraph, graphBounds, graphNodePath, relaxGraph, relaxGraphSteps, SpatialGrid } from "./graph-layout";

test("graph links follow rendered Markdown, reference links and HTML within this wiki", () => {
  const markdown = `[[City|the city]] [same city](/world/city#history)
[Archive][ref] <a href='/wiki/harbor?title=Harbor'>port</a>
<a href="/world/market">market</a>
[other world](/other/city) [external](https://example.com/world/sea)
[edit](/world/city/edit)

[ref]: /world/archive
`;
  assert.deepEqual(graphArticleLinks(markdown, "world"), ["city", "archive", "harbor", "market"]);
});

test("preformatted links are graph edges while inline code, raw code HTML and image sources stay literal", () => {
  const markdown = `\`[[Inline code]]\`
\`[example](/wiki/code-link)\`
\`\`\`md
[[Fenced code]] <a href="/wiki/code-html">test</a>
\`\`\`
![Picture](/world/picture)
<!-- <a href="/wiki/comment">comment</a> -->
[unused]: /world/unused

[[Real article]]
`;
  assert.deepEqual(graphArticleLinks(markdown, "world"), ["fenced-code", "real-article"]);
});

test("unwritten articles become shared red nodes, with accurate outgoing link counts", () => {
  const rows: GraphRow[] = [
    ["a", "Article A", ["b", "missing", "a"]],
    ["b", "Article B", ["a", "missing"]],
    ["isolated", "Isolated", []],
  ];
  const graph = buildGraph(rows);
  assert.deepEqual(graph.nodes, [["a", "Article A"], ["b", "Article B"], ["isolated", "Isolated"], ["missing", "Missing"]]);
  assert.equal(graph.savedCount, 3);
  assert.deepEqual([...graph.edges], [0, 1, 0, 3, 0, 0, 1, 0, 1, 3]);
  assert.deepEqual([...graph.missing], [1, 1, 0, 0]);
  assert.deepEqual([...graph.blue], [2, 1, 0, 0]);
  assert.deepEqual([...graph.sources], [-1, -1, -1, 0]);
  assert.equal(graph.degree[3], 2);
  assert.equal(graphNodePath("world", graph.nodes, 0, graph.savedCount, graph.sources), "/world/a");
  assert.equal(graphNodePath("world", graph.nodes, 3, graph.savedCount, graph.sources), "/world/missing/generate?title=Missing&source=a");
  const grid = new SpatialGrid(graph.positions);
  for (let i = 0; i < 10; i++) relaxGraph(graph, grid, i);
  assert.ok(graph.positions.every(Number.isFinite));
  for (let i = 0; i < graph.nodes.length; i++) assert.equal(grid.pick(graph.positions[i * 2], graph.positions[i * 2 + 1], 1), i);
});

test("stub articles and links never become blue or red graph nodes", () => {
  const graph = buildGraph([["a", "A", ["stub-world", "missing"]], ["stub-world", "Brief", ["a", "other"]]]);
  assert.deepEqual(graph.nodes, [["a", "A"], ["missing", "Missing"]]);
  assert.deepEqual([...graph.edges], [0, 1]);
  assert.deepEqual([...graph.blue], [0, 0]);
  assert.deepEqual([...graph.missing], [1, 0]);
});

test("a newly saved article replaces its red node and updates link counts", () => {
  const graph = buildGraph([["a", "A", ["b"]], ["b", "Exact B title", ["a"]]]);
  assert.equal(graph.savedCount, 2);
  assert.deepEqual(graph.nodes, [["a", "A"], ["b", "Exact B title"]]);
  assert.deepEqual([...graph.blue], [1, 1]);
  assert.deepEqual([...graph.missing], [0, 0]);
});

test("100,000 saved articles and one million actual links stay in linear typed storage", () => {
  const count = 100_000;
  const rows: GraphRow[] = Array.from({ length: count }, (_, i) => [
    `article-${i}`, `Article ${i}`, Array.from({ length: 10 }, (_, j) => `article-${(i + j + 1) % count}`),
  ]);
  const start = performance.now();
  const graph = buildGraph(rows);
  assert.equal(graph.nodes.length, count);
  assert.equal(graph.edges.length, count * 20);
  assert.equal(graph.positions.byteLength, count * 8);
  assert.equal(graph.edges.byteLength, count * 80);
  assert.equal(graph.missing.reduce((sum, n) => sum + n, 0), 0);
  assert.ok(graph.positions.every(Number.isFinite));
  const bounds = graphBounds(graph.positions);
  assert.ok(bounds.every(Number.isFinite));
  const built = performance.now();
  const grid = new SpatialGrid(graph.positions);
  relaxGraph(graph, grid, 0);
  assert.ok(graph.positions.every(Number.isFinite));
  console.log(`100k articles / 1m links: build ${(built - start).toFixed(0)}ms; layout step ${(performance.now() - built).toFixed(0)}ms (worker work).`);
});

test("empty graphs and a single article have finite bounds", () => {
  for (const rows of [[], [["only", "Only article", ["missing"]]] as GraphRow[]]) {
    const graph = buildGraph(rows);
    assert.ok(graphBounds(graph.positions).every(Number.isFinite));
  }
});

test("locally controlled nodes are not overwritten by a yielded background layout step", () => {
  const graph = buildGraph([["a", "A", ["b"]], ["b", "B", ["a"]]]);
  const grid = new SpatialGrid(graph.positions);
  const pinned = new Set<number>();
  const step = relaxGraphSteps(graph, grid, 0, pinned);
  step.next();
  pinned.add(0);
  graph.positions[0] = 800;
  graph.positions[1] = -400;
  for (const chunk of step) void chunk;
  assert.equal(graph.positions[0], 800);
  assert.equal(graph.positions[1], -400);
  assert.equal(grid.pick(800, -400, 1), 0);
  const neighbourX = graph.positions[2];
  for (const chunk of relaxGraphSteps(graph, grid, 1, pinned)) void chunk;
  assert.equal(graph.positions[0], 800);
  assert.equal(graph.positions[1], -400);
  assert.notEqual(graph.positions[2], neighbourX);
});
