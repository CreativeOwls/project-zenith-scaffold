import type { FlowGraph } from "./flow-types";

const COL_WIDTH = 260;
const ROW_HEIGHT = 190;
const ORIGIN_X = 120;
const ORIGIN_Y = 100;

/**
 * Deterministic top-to-bottom layered layout so a generated flow always reads
 * as a visible chain: each node sits one row below the node that feeds it,
 * and siblings (e.g. true/false branches) spread across columns in that row.
 */
export function autoLayout(graph: FlowGraph): FlowGraph {
  const nodes = graph.nodes;
  if (nodes.length === 0) return graph;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.connections.filter((c) => byId.has(c.from) && byId.has(c.to));

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    incoming.get(edge.to)!.push(edge.from);
    outgoing.get(edge.from)!.push(edge.to);
  }

  // Longest-path depth via BFS from entry nodes, with cycle protection.
  const depth = new Map<string, number>();
  const roots = nodes.filter((n) => (incoming.get(n.id) ?? []).length === 0).map((n) => n.id);
  const queue: string[] = roots.length > 0 ? [...roots] : [nodes[0]!.id];
  for (const id of queue) depth.set(id, 0);

  let guard = 0;
  const maxSteps = nodes.length * edges.length + nodes.length + 1;
  while (queue.length > 0 && guard++ < maxSteps) {
    const id = queue.shift()!;
    const current = depth.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      const candidate = current + 1;
      if (candidate > (depth.get(next) ?? -1)) {
        depth.set(next, candidate);
        queue.push(next);
      }
    }
  }

  // Anything unreachable (orphan) goes after the deepest known layer.
  let maxDepth = 0;
  for (const value of depth.values()) maxDepth = Math.max(maxDepth, value);
  for (const node of nodes) {
    if (!depth.has(node.id)) depth.set(node.id, ++maxDepth);
  }

  const rows = new Map<number, string[]>();
  for (const node of nodes) {
    const row = depth.get(node.id) ?? 0;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)!.push(node.id);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [row, ids] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const offset = ((ids.length - 1) * COL_WIDTH) / 2;
    ids.forEach((id, index) => {
      positions.set(id, {
        x: Math.round(ORIGIN_X + index * COL_WIDTH - offset),
        y: ORIGIN_Y + row * ROW_HEIGHT,
      });
    });
  }

  // Keep everything on-canvas (centering can push the widest row negative).
  let minX = Infinity;
  for (const point of positions.values()) minX = Math.min(minX, point.x);
  const shift = Number.isFinite(minX) ? ORIGIN_X - minX : 0;

  return {
    nodes: nodes.map((node) => {
      const point = positions.get(node.id);
      return point ? { ...node, x: point.x + shift, y: point.y } : node;
    }),
    connections: edges,
  };
}
