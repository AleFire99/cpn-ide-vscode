import { describe, expect, it } from 'vitest';
import { LAYER_GAP, ROW_GAP, layoutPage, type LayoutNode } from '../../src/model/layout';
import type { Pos } from '../../src/model/types';

const nodes = (...keys: string[]): LayoutNode[] => keys.map((key) => ({ key }));

function expectSeparated(pos: Map<string, Pos>) {
  const ps = [...pos.values()];
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const dx = Math.abs(ps[i][0] - ps[j][0]);
      const dy = Math.abs(ps[i][1] - ps[j][1]);
      expect(dx >= LAYER_GAP || dy >= ROW_GAP, `${ps[i]} vs ${ps[j]}`).toBe(true);
    }
  }
}

describe('layoutPage', () => {
  it('is deterministic', () => {
    const ns = nodes('a', 'b', 'c', 'd', 'e');
    const edges: [string, string][] = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'e']];
    expect([...layoutPage(ns, edges)]).toEqual([...layoutPage(ns, edges)]);
  });

  it('places a chain left to right, one layer apart', () => {
    const pos = layoutPage(nodes('a', 'b', 'c'), [['a', 'b'], ['b', 'c']]);
    expect(pos.get('b')![0] - pos.get('a')![0]).toBe(LAYER_GAP);
    expect(pos.get('c')![0] - pos.get('b')![0]).toBe(LAYER_GAP);
    expect(new Set([...pos.values()].map((p) => p[1])).size).toBe(1);
  });

  it('keeps nodes apart by at least the gaps', () => {
    const ks = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const edges: [string, string][] = ks.slice(1).map((k, i) => [ks[Math.floor(i / 3)], k]);
    const pos = layoutPage(nodes(...ks), edges);
    expect(pos.size).toBe(12);
    expectSeparated(pos);
  });

  it('lays out isolated nodes without overlap', () => {
    expectSeparated(layoutPage(nodes('a', 'b', 'c', 'd'), []));
  });

  it('handles cycles, self loops and edges to unknown nodes', () => {
    const pos = layoutPage(nodes('a', 'b', 'c'), [['a', 'b'], ['b', 'c'], ['c', 'a'], ['b', 'b'], ['a', 'zzz']]);
    expect(pos.size).toBe(3);
    expectSeparated(pos);
    for (const p of pos.values()) expect(p.every(Number.isFinite)).toBe(true);
  });

  it('keeps given positions and does not overlap them with new nodes', () => {
    const ns: LayoutNode[] = [{ key: 'a', pos: [10, 20] }, { key: 'b', pos: [300, -40] }, ...nodes('c', 'd', 'e')];
    const pos = layoutPage(ns, [['a', 'c'], ['c', 'b'], ['b', 'd'], ['d', 'e']]);
    expect(pos.get('a')).toEqual([10, 20]);
    expect(pos.get('b')).toEqual([300, -40]);
    expectSeparated(new Map([...pos].filter(([k]) => 'cde'.includes(k))));
    for (const k of 'cde') {
      for (const f of 'ab') {
        const [x, y] = pos.get(k)!;
        const [fx, fy] = pos.get(f)!;
        expect(Math.abs(x - fx) >= LAYER_GAP || Math.abs(y - fy) >= ROW_GAP, `${k} vs ${f}`).toBe(true);
      }
    }
  });

  it('returns the given positions unchanged when everything is placed', () => {
    const pos = layoutPage([{ key: 'a', pos: [1, 2] }, { key: 'b', pos: [3, 4] }], [['a', 'b']]);
    expect([...pos]).toEqual([['a', [1, 2]], ['b', [3, 4]]]);
  });

  it('handles no nodes', () => {
    expect(layoutPage([], []).size).toBe(0);
  });
});
