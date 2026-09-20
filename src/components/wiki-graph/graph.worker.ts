/// <reference lib="webworker" />
import { buildGraph, graphBounds, relaxGraphSteps, SpatialGrid, type GraphData } from "@/lib/graph-layout";
import type { GraphRow } from "@/lib/wiki-graph";

const worker = self as unknown as DedicatedWorkerGlobalScope;
let graph: GraphData | undefined;
let grid: SpatialGrid | undefined;
let searchTitles: string[] = [];
let iteration = 0;
let paused = false;
let reducedMotion = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastUpdate = 0;
let version = 0;
const snapshots = new Map<number, Float32Array>();
const renderStarts = new Map<number, Float32Array>();
let layoutSteps: ReturnType<typeof relaxGraphSteps> | undefined;
const pinned = new Set<number>();

function tick() {
  timer = undefined;
  if (!graph || !grid || paused || iteration >= (graph.nodes.length > 20_000 ? 60 : 100)) return;
  layoutSteps ??= relaxGraphSteps(graph, grid, iteration, pinned);
  const started = performance.now();
  let step = layoutSteps.next();
  while (!step.done && performance.now() - started < 8) step = layoutSteps.next();
  if (!step.done) { timer = setTimeout(tick, 0); return; }
  layoutSteps = undefined;
  iteration++;
  const now = performance.now();
  const done = iteration >= (graph.nodes.length > 20_000 ? 60 : 100);
  if ((!reducedMotion && now - lastUpdate > 120) || done) {
    snapshots.set(++version, graph.positions.slice());
    if (snapshots.size > 4) snapshots.delete(version - 4);
    const positions = graph.positions.slice();
    worker.postMessage({ type: "positions", positions, version, duration: Math.max(120, now - lastUpdate), bounds: graphBounds(positions), done }, [positions.buffer]);
    lastUpdate = now;
  }
  if (!done) timer = setTimeout(tick, 0);
}

async function load(wiki: string) {
  try {
    const response = await fetch(`/api/wikis/${encodeURIComponent(wiki)}/graph`);
    if (!response.ok || !response.body) throw new Error("Could not load this wiki’s graph.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const rows: GraphRow[] = [];
    let pending = "", completed = false, progressAt = 0;
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let start = 0, end = pending.indexOf("\n");
      while (end >= 0) {
        const line = JSON.parse(pending.slice(start, end));
        if (Array.isArray(line)) rows.push(line as GraphRow);
        else if (line.complete && line.count === rows.length) completed = true;
        start = end + 1;
        end = pending.indexOf("\n", start);
      }
      pending = pending.slice(start);
      if (performance.now() - progressAt > 150) {
        worker.postMessage({ type: "progress", count: rows.length });
        progressAt = performance.now();
      }
      if (done) break;
    }
    if (!completed || pending.trim()) throw new Error("Loading was interrupted. Please try again.");
    graph = buildGraph(rows);
    rows.length = 0;
    searchTitles = graph.nodes.map(([slug, title]) => `${title.toLowerCase()} ${slug}`);
    grid = new SpatialGrid(graph.positions);
    const positions = graph.positions.slice(), edges = graph.edges.slice();
    const missingCount = graph.missing.reduce((sum, count) => sum + count, 0);
    const loops: number[] = [];
    for (let i = 0; i < edges.length; i += 2) if (edges[i] === edges[i + 1]) loops.push(edges[i]);
    const loopNodes = new Uint32Array(loops);
    snapshots.set(0, graph.positions.slice());
    worker.postMessage({ type: "ready", nodes: graph.nodes, positions, edges, savedCount: graph.savedCount,
      sources: graph.sources, selfLinks: loopNodes, missingCount, bounds: graphBounds(positions) }, [positions.buffer, edges.buffer, loopNodes.buffer]);
    if (!graph.nodes.length) return;
    lastUpdate = performance.now();
    tick();
  } catch (error) {
    worker.postMessage({ type: "error", message: error instanceof Error ? error.message : "Could not load the graph." });
  }
}

worker.onmessage = ({ data }) => {
  if (data.type === "motion" && graph) {
    // A small local spring system is rendered at display refresh rate; keep the
    // background layout and picking snapshots aligned without full transfers.
    for (const { index, x, y } of data.points) {
      if (!Number.isInteger(index) || index < 0 || index >= graph.nodes.length || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      pinned.add(index);
      for (const positions of [graph.positions, ...snapshots.values(), ...renderStarts.values()]) {
        positions[index * 2] = x;
        positions[index * 2 + 1] = y;
      }
    }
  }
  if (data.type === "drag-end" && graph) worker.postMessage({ type: "bounds", bounds: graphBounds(graph.positions) });
  if (data.type === "rendered") {
    renderStarts.set(data.version, data.previous);
    if (renderStarts.size > 4) renderStarts.delete(data.version - 4);
  }
  if (data.type === "load") { reducedMotion = data.reducedMotion; void load(data.wiki); }
  if (data.type === "pause") {
    paused = data.paused;
    if (!paused && !timer) tick();
  }
  if (data.type === "pick" && graph && grid) {
    const next = snapshots.get(data.version);
    const previous = renderStarts.get(data.version) ?? next;
    let index = -1, distance = data.radius * data.radius, nodeX = 0, nodeY = 0;
    // Infrequent pointer queries run on the worker, against the exact GPU
    // interpolation, so a moving node cannot open its neighbour by mistake.
    if (next && previous) for (let i = 0; i < graph.nodes.length; i++) {
      const x = previous[i * 2] + (next[i * 2] - previous[i * 2]) * data.mix;
      const y = previous[i * 2 + 1] + (next[i * 2 + 1] - previous[i * 2 + 1]) * data.mix;
      const d = (data.x - x) ** 2 + (data.y - y) ** 2;
      if (d <= distance) { index = i; distance = d; nodeX = x; nodeY = y; }
    }
    const neighbours = new Set<number>();
    if (data.press && index >= 0) {
      for (let i = 0; i < graph.edges.length && neighbours.size < 48; i += 2) {
        const a = graph.edges[i], b = graph.edges[i + 1];
        if (a === index && b !== index) neighbours.add(b);
        if (b === index && a !== index) neighbours.add(a);
      }
    }
    worker.postMessage({ type: "picked", index, blue: graph.blue[index] ?? 0, red: graph.missing[index] ?? 0,
      references: graph.degree[index] ?? 0, request: data.request, press: data.press, neighbours: [...neighbours], nodeX, nodeY, x: data.screenX, y: data.screenY });
  }
  if (data.type === "search" && graph) {
    const query = String(data.query).trim().toLowerCase();
    const matches: number[] = query ? [] : graph.nodes.slice(0, 6).map((_, index) => index);
    if (query) for (let i = 0; i < searchTitles.length && matches.length < 12; i++) if (searchTitles[i].includes(query)) matches.push(i);
    worker.postMessage({ type: "matches", query: data.query, matches });
  }
};
