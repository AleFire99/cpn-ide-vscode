import { describe, expect, it } from 'vitest';
import type { PTNet } from '../../src/analysis/ptnet';
import { checkReachable, deadlockCandidate, lpBounds, structuralBoundedness } from '../../src/analysis/stateEquation';

/** Build a net from place names, initial marking and transitions as [name, pre, post] (maps place -> weight). */
function net(places: string[], m0: number[], ts: [string, Record<string, number>, Record<string, number>][]): PTNet {
  const row = (m: Record<string, number>) => places.map((p) => m[p] ?? 0);
  return {
    places: places.map((p) => ({ id: p, label: `Page/${p}` })),
    transitions: ts.map(([n]) => ({ id: n, label: `Page/${n}` })),
    pre: ts.map(([, pre]) => row(pre)),
    post: ts.map(([, , post]) => row(post)),
    m0,
    exact: true,
    approximations: [],
  };
}

const mutex = net(
  ['idle1', 'crit1', 'idle2', 'crit2', 'mutex'],
  [1, 0, 1, 0, 1],
  [
    ['enter1', { idle1: 1, mutex: 1 }, { crit1: 1 }],
    ['exit1', { crit1: 1 }, { idle1: 1, mutex: 1 }],
    ['enter2', { idle2: 1, mutex: 1 }, { crit2: 1 }],
    ['exit2', { crit2: 1 }, { idle2: 1, mutex: 1 }],
  ],
);

// Two philosophers, each takes the left fork then the right fork.
const philosophers = net(
  ['think1', 'left1', 'eat1', 'think2', 'left2', 'eat2', 'fork1', 'fork2'],
  [1, 0, 0, 1, 0, 0, 1, 1],
  [
    ['takeL1', { think1: 1, fork1: 1 }, { left1: 1 }],
    ['takeR1', { left1: 1, fork2: 1 }, { eat1: 1 }],
    ['release1', { eat1: 1 }, { think1: 1, fork1: 1, fork2: 1 }],
    ['takeL2', { think2: 1, fork2: 1 }, { left2: 1 }],
    ['takeR2', { left2: 1, fork1: 1 }, { eat2: 1 }],
    ['release2', { eat2: 1 }, { think2: 1, fork1: 1, fork2: 1 }],
  ],
);

const producer = net(['buffer'], [0], [['produce', {}, { buffer: 1 }]]);

describe('state equation analysis', () => {
  it('mutex: LP bound 1, structurally bounded, deadlock-free', () => {
    expect(lpBounds(mutex)).toEqual([1, 1, 1, 1, 1]);
    const b = structuralBoundedness(mutex);
    expect(b.bounded).toBe(true);
    expect(deadlockCandidate(mutex)).toEqual({ deadlockFree: true });
  });

  it('dining philosophers: a deadlock candidate', () => {
    const r = deadlockCandidate(philosophers);
    expect(r).toHaveProperty('candidate');
    if ('candidate' in r) {
      expect(r.candidate).toHaveLength(8);
      expect(r.candidate.every((v) => v >= 0)).toBe(true);
    }
  });

  it('unbounded producer: an unbounded witness', () => {
    expect(lpBounds(producer)).toEqual([Infinity]);
    const b = structuralBoundedness(producer);
    expect(b.bounded).toBe(false);
    if (b.bounded === false) expect(b.x[0]).toBeGreaterThan(0);
  });

  it('gives a certificate for an unreachable marking', () => {
    // Both processes in the critical section would need two mutex tokens.
    expect(checkReachable(mutex, { 1: { min: 1 }, 3: { min: 1 } })).toBe('unreachable');
    expect(checkReachable(mutex, { 1: { min: 1 } })).toBe('inconclusive');
  });
});
