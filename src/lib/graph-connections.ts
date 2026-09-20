/** Direct connections in either direction, including every edge to a red node. */
export function graphConnections(edges: Uint32Array, nodeCount: number, selected: number) {
  const nodes = new Uint8Array(nodeCount);
  const connectedEdges: number[] = [];
  if (selected >= 0 && selected < nodeCount) {
    nodes[selected] = 1;
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i], b = edges[i + 1];
      if (a !== selected && b !== selected) continue;
      nodes[a] = nodes[b] = 1;
      connectedEdges.push(i / 2);
    }
  }
  return { nodes, edges: new Uint32Array(connectedEdges) };
}
