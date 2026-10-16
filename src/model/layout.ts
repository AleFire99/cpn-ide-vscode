// Positions for nodes the text model leaves unplaced: a layered layout (longest path from the
// sources, back edges ignored, one barycenter pass). Nodes that already have a position keep it;
// new ones go in a band next to them (in y) so nothing overlaps.
import type { Pos } from './types';

export const LAYER_GAP = 220;
export const ROW_GAP = 120;

export interface LayoutNode {
  key: string;
  pos?: Pos;
}

/** Returns a position for every node key. Deterministic for a given input order. */
export function layoutPage(nodes: LayoutNode[], edges: [string, string][]): Map<string, Pos> {
  const out = new Map<string, Pos>();
  for (const n of nodes) if (n.pos) out.set(n.key, n.pos);
  const free = nodes.filter((n) => !n.pos).map((n) => n.key);
  if (!free.length) return out;

  const succ = new Map<string, string[]>(nodes.map((n) => [n.key, []]));
  for (const [a, b] of edges) if (a !== b && succ.has(a) && succ.has(b)) succ.get(a)!.push(b);

  // Drop back edges (DFS in input order) so the rest is a DAG.
  const state = new Map<string, 1 | 2>();
  const dag = new Map<string, string[]>(nodes.map((n) => [n.key, []]));
  const visit = (k: string) => {
    state.set(k, 1);
    for (const s of succ.get(k)!) {
      if (state.get(s) === 1) continue; // back edge
      dag.get(k)!.push(s);
      if (!state.has(s)) visit(s);
    }
    state.set(k, 2);
  };
  for (const n of nodes) if (!state.has(n.key)) visit(n.key);

  // Longest-path layering over the DAG.
  const indeg = new Map<string, number>(nodes.map((n) => [n.key, 0]));
  for (const ss of dag.values()) for (const s of ss) indeg.set(s, indeg.get(s)! + 1);
  const layer = new Map<string, number>();
  const queue = nodes.map((n) => n.key).filter((k) => indeg.get(k) === 0);
  for (const k of queue) layer.set(k, 0);
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    for (const s of dag.get(k)!) {
      layer.set(s, Math.max(layer.get(s) ?? 0, layer.get(k)! + 1));
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }

  // Only unplaced nodes are laid out; compact their layers.
  const freeSet = new Set(free);
  const used = [...new Set(free.map((k) => layer.get(k) ?? 0))].sort((a, b) => a - b);
  const layers: string[][] = used.map(() => []);
  for (const k of free) layers[used.indexOf(layer.get(k) ?? 0)].push(k);

  // One barycenter pass: order each layer by the mean row of its predecessors in the previous layer.
  const row = new Map<string, number>();
  layers[0].forEach((k, i) => row.set(k, i));
  const preds = new Map<string, string[]>();
  for (const [a, ss] of dag) for (const s of ss) if (freeSet.has(a)) (preds.get(s) ?? preds.set(s, []).get(s)!).push(a);
  for (let l = 1; l < layers.length; l++) {
    const bary = (k: string) => {
      const ps = (preds.get(k) ?? []).filter((p) => row.has(p));
      return ps.length ? ps.reduce((sum, p) => sum + row.get(p)!, 0) / ps.length : Infinity;
    };
    const idx = new Map(layers[l].map((k, i) => [k, i]));
    layers[l].sort((a, b) => bary(a) - bary(b) || idx.get(a)! - idx.get(b)!);
    layers[l].forEach((k, i) => row.set(k, i));
  }

  // In a band past the placed nodes, if any.
  const placed = [...out.values()];
  const tallest = Math.max(...layers.map((l) => l.length));
  const top = placed.length ? Math.max(...placed.map((p) => p[1])) + ROW_GAP + ((tallest - 1) * ROW_GAP) / 2 : 0;
  const left = placed.length ? Math.min(...placed.map((p) => p[0])) : -((layers.length - 1) * LAYER_GAP) / 2;
  layers.forEach((ks, l) => {
    ks.forEach((k, i) => out.set(k, [left + l * LAYER_GAP, top + ((ks.length - 1) / 2 - i) * ROW_GAP]));
  });
  return out;
}
