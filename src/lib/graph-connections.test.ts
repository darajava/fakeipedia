import assert from "node:assert/strict";
import test from "node:test";
import { graphConnections } from "./graph-connections";

test("highlights both link directions and self-links but not neighbours' other edges", () => {
  const edges = new Uint32Array([0, 1, 2, 0, 0, 0, 1, 3, 2, 1]);
  const result = graphConnections(edges, 5, 0);
  assert.deepEqual([...result.nodes], [1, 1, 1, 0, 0]);
  assert.deepEqual([...result.edges], [0, 1, 2]);
});

test("red nodes highlight every referring article, without the drag-neighbour limit", () => {
  const edges = new Uint32Array(Array.from({ length: 120 }, (_, i) => [i, 120]).flat());
  const result = graphConnections(edges, 121, 120);
  assert.equal(result.nodes.reduce((sum, value) => sum + value, 0), 121);
  assert.equal(result.edges.length, 120);
});

test("clearing hover removes highlights and an isolated node still highlights itself", () => {
  const edges = new Uint32Array([0, 1]);
  assert.deepEqual([...graphConnections(edges, 3, -1).nodes], [0, 0, 0]);
  assert.deepEqual([...graphConnections(edges, 3, -1).edges], []);
  assert.deepEqual([...graphConnections(edges, 3, 2).nodes], [0, 0, 1]);
  assert.deepEqual([...graphConnections(edges, 3, 2).edges], []);
});
