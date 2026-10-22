import { describe, expect, it } from 'vitest';
import {
  invariantBounds,
  isConservative,
  pInvariants,
  tInvariants,
  uncoveredTransitions,
} from '../../src/analysis/invariants';
import type { PTNet } from '../../src/analysis/ptnet';

/** Build a net from places, m0 and transitions as [pre, post] maps of place -> weight. */
const mk = (
  places: string[],
  m0: number[],
  ts: [Record<string, number>, Record<string, number>][],
): PTNet => {
  const row = (m: Record<string, number>) => places.map((p) => m[p] ?? 0);
  return {
    places: places.map((p) => ({ id: p, label: p })),
    transitions: ts.map((_, i) => ({ id: `t${i}`, label: `t${i}` })),
    pre: ts.map(([a]) => row(a)),
    post: ts.map(([, b]) => row(b)),
    m0,
    exact: true,
    approximations: [],
  };
};

const vecs = (r: ReturnType<typeof pInvariants>): number[][] => {
  if (r.truncated) throw new Error('truncated');
  return r.vectors;
};
const has = (vs: number[][], v: number[]) => vs.some((x) => x.join() === v.join());

describe('invariants', () => {
  it('mutual exclusion: mutex shares a P-invariant, bound 1', () => {
    const net = mk(['idle1', 'busy1', 'idle2', 'busy2', 'mutex'], [1, 0, 1, 0, 1], [
      [{ idle1: 1, mutex: 1 }, { busy1: 1 }],
      [{ busy1: 1 }, { idle1: 1, mutex: 1 }],
      [{ idle2: 1, mutex: 1 }, { busy2: 1 }],
      [{ busy2: 1 }, { idle2: 1, mutex: 1 }],
    ]);
    const p = vecs(pInvariants(net));
    expect(has(p, [0, 1, 0, 1, 1])).toBe(true);
    expect(has(p, [1, 1, 0, 0, 0])).toBe(true);
    expect(has(p, [0, 0, 1, 1, 0])).toBe(true);
    expect(invariantBounds(net, p)).toEqual([1, 1, 1, 1, 1]);
    expect(isConservative(net, p)).toBe(true);
  });

  it('producer/consumer with a buffer: bounded buffer', () => {
    const net = mk(['pReady', 'buf', 'free', 'cReady'], [1, 0, 3, 1], [
      [{ pReady: 1, free: 1 }, { pReady: 1, buf: 1 }],
      [{ buf: 1, cReady: 1 }, { cReady: 1, free: 1 }],
    ]);
    const p = vecs(pInvariants(net));
    expect(has(p, [0, 1, 1, 0])).toBe(true);
    const b = invariantBounds(net, p);
    expect(b[1]).toBe(3);
    expect(b[2]).toBe(3);
    const t = vecs(tInvariants(net));
    expect(has(t, [1, 1])).toBe(true);
    expect(uncoveredTransitions(net, t)).toEqual([]);
  });

  it('unbounded producer: no covering invariant', () => {
    const net = mk(['src', 'out'], [1, 0], [[{ src: 1 }, { src: 1, out: 1 }]]);
    const p = vecs(pInvariants(net));
    expect(invariantBounds(net, p)[1]).toBeUndefined();
    expect(isConservative(net, p)).toBe(false);
    expect(uncoveredTransitions(net, vecs(tInvariants(net)))).toEqual([0]);
  });

  it('dining philosophers (2): T-invariants cover all transitions', () => {
    const net = mk(['think1', 'eat1', 'think2', 'eat2', 'fork1', 'fork2'], [1, 0, 1, 0, 1, 1], [
      [{ think1: 1, fork1: 1, fork2: 1 }, { eat1: 1 }],
      [{ eat1: 1 }, { think1: 1, fork1: 1, fork2: 1 }],
      [{ think2: 1, fork1: 1, fork2: 1 }, { eat2: 1 }],
      [{ eat2: 1 }, { think2: 1, fork1: 1, fork2: 1 }],
    ]);
    const t = vecs(tInvariants(net));
    expect(has(t, [1, 1, 0, 0])).toBe(true);
    expect(has(t, [0, 0, 1, 1])).toBe(true);
    expect(uncoveredTransitions(net, t)).toEqual([]);
    expect(isConservative(net, vecs(pInvariants(net)))).toBe(true);
  });

  it('reports truncation when the row cap is hit', () => {
    const net = mk(['a', 'b', 'c', 'd'], [1, 1, 0, 0], [
      [{ a: 1 }, { c: 1 }],
      [{ b: 1 }, { c: 1 }],
      [{ c: 1 }, { d: 1 }],
      [{ c: 1 }, { a: 1 }],
    ]);
    expect(pInvariants(net, 1)).toEqual({ truncated: true });
  });
});
