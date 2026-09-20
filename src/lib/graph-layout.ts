import type { GraphRow } from "./wiki-graph";
import { articlePath, titleFromSlug } from "./wiki";

export type GraphData = {
  nodes: [slug: string, title: string][];
  edges: Uint32Array;
  missing: Uint32Array;
  blue: Uint32Array;
  sources: Int32Array;
  savedCount: number;
  positions: Float32Array;
  degree: Uint32Array;
};

// Saved articles come first; each unwritten target gets one shared red node.
export function buildGraph(rows: GraphRow[]): GraphData {
  rows = rows.filter(([slug]) => !slug.startsWith("stub-"));
  const indices = new Map(rows.map((row, index) => [row[0], index]));
  const nodes: GraphData["nodes"] = rows.map(([slug, title]) => [slug, title]);
  let edgeCount = 0;
  for (const [, , targets] of rows) for (const target of targets) {
    if (target.startsWith("stub-")) continue;
    if (!indices.has(target)) {
      indices.set(target, nodes.length);
      nodes.push([target, titleFromSlug(target)]);
    }
    edgeCount++;
  }
  const savedCount = rows.length;
  const degree = new Uint32Array(nodes.length);
  const missing = new Uint32Array(nodes.length);
  const blue = new Uint32Array(nodes.length);
  const sources = new Int32Array(nodes.length).fill(-1);
  const edges = new Uint32Array(edgeCount * 2);
  let cursor = 0;
  for (let source = 0; source < rows.length; source++) {
    for (const slug of rows[source][2]) {
      const target = indices.get(slug);
      if (target === undefined) continue;
      if (target >= savedCount) {
        missing[source]++;
        if (sources[target] === -1) sources[target] = source;
      } else blue[source]++;
      edges[cursor++] = source;
      edges[cursor++] = target;
      degree[source]++;
      degree[target]++;
    }
  }
  const positions = initialPositions(nodes.length, edges, degree);
  return { nodes, edges, missing, blue, sources, savedCount, positions, degree };
}

export function graphNodePath(wiki: string, nodes: GraphData["nodes"], index: number, savedCount: number, sources: Int32Array) {
  const [slug, title] = nodes[index];
  const path = articlePath(wiki, slug);
  return index < savedCount ? path
    : `${path}/generate?title=${encodeURIComponent(title)}&source=${encodeURIComponent(nodes[sources[index]][0])}`;
}

// CSR adjacency and component packing use O(N + E) storage. No all-pairs forces.
function initialPositions(count: number, edges: Uint32Array, degree: Uint32Array) {
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + degree[i];
  const adjacent = new Uint32Array(edges.length);
  const cursors = offsets.slice();
  for (let i = 0; i < edges.length; i += 2) {
    adjacent[cursors[edges[i]]++] = edges[i + 1];
    adjacent[cursors[edges[i + 1]]++] = edges[i];
  }
  const seen = new Uint8Array(count);
  const queue = new Uint32Array(count);
  const components: Uint32Array[] = [];
  for (let root = 0; root < count; root++) {
    if (seen[root]) continue;
    let end = 1;
    queue[0] = root;
    seen[root] = 1;
    for (let head = 0; head < end; head++) {
      const node = queue[head];
      for (let j = offsets[node]; j < offsets[node + 1]; j++) {
        const target = adjacent[j];
        if (!seen[target]) { seen[target] = 1; queue[end++] = target; }
      }
    }
    components.push(queue.slice(0, end));
  }
  components.sort((a, b) => b.length - a.length);
  const positions = new Float32Array(count * 2);
  const width = Math.max(240, Math.sqrt(count) * 65);
  let x = 0, y = 0, rowHeight = 0;
  for (const component of components) {
    const side = 2 ** Math.ceil(Math.log2(Math.sqrt(component.length)));
    const radius = Math.max(28, side * 17);
    const size = radius * 2 + 60;
    if (x + size > width && x > 0) { x = 0; y += rowHeight; rowHeight = 0; }
    for (let i = 0; i < component.length; i++) {
      if (component.length < 1000) {
        const angle = i * 2.399963229728653;
        const distance = Math.sqrt(i) * 23;
        positions[component[i] * 2] = x + radius + Math.cos(angle) * distance;
        positions[component[i] * 2 + 1] = y + radius + Math.sin(angle) * distance;
      } else {
        // A Hilbert curve keeps successive BFS neighbours close at large scale,
        // avoiding a giant ball of crossing edges before the forces settle.
        let hx = 0, hy = 0, rank = i;
        for (let scale = 1; scale < side; scale *= 2) {
          const rx = 1 & (rank >> 1), ry = 1 & (rank ^ rx);
          if (!ry) {
            if (rx) { hx = scale - 1 - hx; hy = scale - 1 - hy; }
            [hx, hy] = [hy, hx];
          }
          hx += scale * rx; hy += scale * ry; rank >>= 2;
        }
        positions[component[i] * 2] = x + 28 + hx * 34;
        positions[component[i] * 2 + 1] = y + 28 + hy * 34;
      }
    }
    x += size;
    rowHeight = Math.max(rowHeight, size);
  }
  return positions;
}

export class SpatialGrid {
  private cells = new Map<string, number[]>();
  constructor(readonly positions: Float32Array, readonly cellSize = 80) { this.rebuild(); }
  rebuild() {
    this.cells.clear();
    for (let i = 0; i < this.positions.length; i += 2) {
      const key = `${Math.floor(this.positions[i] / this.cellSize)},${Math.floor(this.positions[i + 1] / this.cellSize)}`;
      const cell = this.cells.get(key);
      if (cell) cell.push(i / 2); else this.cells.set(key, [i / 2]);
    }
  }
  nearby(x: number, y: number, visit: (index: number) => void) {
    const cx = Math.floor(x / this.cellSize), cy = Math.floor(y / this.cellSize);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const cell = this.cells.get(`${cx + dx},${cy + dy}`);
      if (!cell) continue;
      // Bounded work even for a pathological high-density cluster.
      const stride = Math.max(1, Math.ceil(cell.length / 24));
      for (let k = 0; k < cell.length; k += stride) visit(cell[k]);
    }
  }
  pick(x: number, y: number, radius: number) {
    let best = -1, distance = radius * radius;
    const minX = Math.floor((x - radius) / this.cellSize), maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize), maxY = Math.floor((y + radius) / this.cellSize);
    // At overview zoom, scanning 100k points once on the worker is cheaper than
    // walking an enormous mostly-empty grid. Picking never blocks the UI.
    const check = (i: number) => {
      const d = (this.positions[i * 2] - x) ** 2 + (this.positions[i * 2 + 1] - y) ** 2;
      if (d <= distance) { best = i; distance = d; }
    };
    if ((maxX - minX + 1) * (maxY - minY + 1) > 400) {
      for (let i = 0; i < this.positions.length / 2; i++) check(i);
    } else {
      for (let cx = minX; cx <= maxX; cx++) for (let cy = minY; cy <= maxY; cy++) {
        for (const i of this.cells.get(`${cx},${cy}`) ?? []) check(i);
      }
    }
    return best;
  }
}

export function* relaxGraphSteps(graph: GraphData, grid: SpatialGrid, iteration: number, pinned: ReadonlySet<number> = new Set()) {
  const { positions: p, edges, degree } = graph;
  const forces = new Float32Array(p.length);
  for (let i = 0; i < edges.length; i += 2) {
    if (i % 32768 === 0) yield;
    const a = edges[i], b = edges[i + 1];
    if (a === b) continue;
    const dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1];
    const distance = Math.max(1, Math.hypot(dx, dy));
    const force = (distance - 65) * 0.035 / Math.sqrt(Math.max(degree[a], degree[b], 1));
    const fx = dx / distance * force, fy = dy / distance * force;
    forces[a * 2] += fx; forces[a * 2 + 1] += fy;
    forces[b * 2] -= fx; forces[b * 2 + 1] -= fy;
  }
  for (let a = 0; a < degree.length; a++) {
    if (a % 1024 === 0) yield;
    grid.nearby(p[a * 2], p[a * 2 + 1], (b) => {
      if (a === b) return;
      const dx = p[a * 2] - p[b * 2], dy = p[a * 2 + 1] - p[b * 2 + 1];
      const d2 = Math.max(4, dx * dx + dy * dy);
      if (d2 > 10000) return;
      const strength = 90 / d2;
      forces[a * 2] += (dx || (a < b ? -0.1 : 0.1)) * strength;
      forces[a * 2 + 1] += dy * strength;
    });
  }
  const cooling = Math.max(0.1, 1 - iteration / 100);
  for (let i = 0; i < p.length; i += 2) {
    if (pinned.has(i / 2)) continue;
    p[i] += Math.max(-8, Math.min(8, forces[i])) * cooling;
    p[i + 1] += Math.max(-8, Math.min(8, forces[i + 1])) * cooling;
  }
  grid.rebuild();
}

export function relaxGraph(graph: GraphData, grid: SpatialGrid, iteration: number) {
  for (const step of relaxGraphSteps(graph, grid, iteration)) void step;
}

export function graphBounds(positions: Float32Array) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 2) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
  }
  return positions.length ? [minX - 40, minY - 40, maxX + 40, maxY + 40] : [-100, -100, 100, 100];
}
