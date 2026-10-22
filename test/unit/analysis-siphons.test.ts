import { describe, expect, it } from 'vitest';
import type { PTNet } from '../../src/analysis/ptnet';
import { commoner, isFreeChoice, maximalTrap, minimalSiphons } from '../../src/analysis/siphons';

const mk = (places: string[], trans: [string, Record<string, number>, Record<string, number>][], m0: Record<string, number>): PTNet => {
  const row = (m: Record<string, number>) => places.map(p => m[p] ?? 0);
  return {
    places: places.map(p => ({ id: p, label: p })),
    transitions: trans.map(([id]) => ({ id, label: id })),
    pre: trans.map(t => row(t[1])),
    post: trans.map(t => row(t[2])),
    m0: row(m0),
    exact: true,
    approximations: [],
  };
};

const mutex = mk(['i1', 'i2', 'c1', 'c2', 'm'], [
  ['e1', { i1: 1, m: 1 }, { c1: 1 }], ['l1', { c1: 1 }, { i1: 1, m: 1 }],
  ['e2', { i2: 1, m: 1 }, { c2: 1 }], ['l2', { c2: 1 }, { i2: 1, m: 1 }],
], { i1: 1, i2: 1, m: 1 });

const philosophers = mk(['t1', 't2', 'h1', 'h2', 'e1', 'e2', 'f1', 'f2'], [
  ['a1', { t1: 1, f1: 1 }, { h1: 1 }], ['b1', { h1: 1, f2: 1 }, { e1: 1 }], ['c1', { e1: 1 }, { t1: 1, f1: 1, f2: 1 }],
  ['a2', { t2: 1, f2: 1 }, { h2: 1 }], ['b2', { h2: 1, f1: 1 }, { e2: 1 }], ['c2', { e2: 1 }, { t2: 1, f1: 1, f2: 1 }],
], { t1: 1, t2: 1, f1: 1, f2: 1 });

const workflow = mk(['i', 'a', 'b', 'o'], [
  ['t1', { i: 1 }, { a: 1 }], ['t2', { i: 1 }, { b: 1 }],
  ['t3', { a: 1 }, { o: 1 }], ['t4', { b: 1 }, { o: 1 }], ['t5', { o: 1 }, { i: 1 }],
], { i: 1 });

describe('siphons and traps', () => {
  it('mutex: every siphon has a marked trap, so deadlock-free', () => {
    const r = commoner(mutex);
    expect(r.badSiphons).toEqual([]);
    expect(r.verdict).toBe('deadlock-free');
    expect(isFreeChoice(mutex)).toBe(false);
  });

  it('dining philosophers: reports the fork/eating siphon', () => {
    const r = commoner(philosophers);
    expect(r.verdict).toBe('possible-deadlock');
    expect(r.badSiphons).toContainEqual([4, 5, 6, 7]);
  });

  it('free-choice workflow net is live', () => {
    expect(isFreeChoice(workflow)).toBe(true);
    expect(commoner(workflow).verdict).toBe('live');
  });

  it('maximalTrap shrinks to a trap', () => {
    expect(maximalTrap(philosophers, [4, 5, 6, 7])).toEqual([]);
    expect(maximalTrap(mutex, [4, 2, 3])).toEqual([4, 2, 3]);
  });

  it('reports truncation when the cap is hit', () => {
    const r = minimalSiphons(philosophers, 1);
    expect(r.truncated).toBe(true);
    expect(commoner(philosophers, 1).verdict).toBe('possible-deadlock');
  });
  it('weighted net: a marked trap proves nothing, so inconclusive', () => {
    // t needs 2 tokens from p, which holds 1: dead at once although {p} is a marked trap.
    const net: PTNet = { places: [{ id: 'p', label: 'p' }], transitions: [{ id: 't', label: 't' }], pre: [[2]], post: [[2]], m0: [1], exact: true, approximations: [] };
    expect(commoner(net).verdict).toBe('inconclusive');
  });
});
