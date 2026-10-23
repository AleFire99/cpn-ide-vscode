import { describe, expect, it } from 'vitest';
import type { PTNet } from '../../src/analysis/ptnet';
import type { StateSpaceResult } from '../../src/runtime/explore-core';
import { analyseStructure, onlyPlainTokens, runAnalyse, reportText, rowsToText, stateSpaceRows, strengthLabel, structuralRows } from '../../src/views/analysis-core';

const mk = (places: string[], trans: [string, Record<string, number>, Record<string, number>][], m0: Record<string, number>, exact = true): PTNet => {
  const row = (m: Record<string, number>) => places.map((p) => m[p] ?? 0);
  return {
    places: places.map((p) => ({ id: p, label: p })),
    transitions: trans.map(([id]) => ({ id, label: id })),
    pre: trans.map((t) => row(t[1])),
    post: trans.map((t) => row(t[2])),
    m0: row(m0),
    exact,
    approximations: exact ? [] : [{ element: 'Page/arc', reason: 'variable arc' }],
  };
};

// a -> b -> stop: dead once the token is in c.
const chain = mk(['a', 'b'], [['t', { a: 1 }, { b: 1 }]], { a: 1 });
const cycle = mk(['a', 'b'], [['t', { a: 1 }, { b: 1 }], ['u', { b: 1 }, { a: 1 }]], { a: 1 });

const ss = (o: Partial<StateSpaceResult> = {}): StateSpaceResult => ({
  complete: true,
  nodes: 2,
  arcs: 1,
  elapsedMs: 5,
  deadMarkings: [],
  bounds: { a: { min: 0, max: 1 }, b: { min: 0, max: 1 } },
  deadTransitions: [],
  ...o,
});

const find = (rows: ReturnType<typeof structuralRows>, section: string, label: RegExp) =>
  rows.find((r) => r.label === section)?.children?.find((c) => label.test(c.label));

describe('strengthLabel', () => {
  it('names each strength', () => {
    expect(strengthLabel({ kind: 'proved' })).toBe('proved');
    expect(strengthLabel({ kind: 'upTo', n: 4, unit: 'tokens' })).toBe('up to 4 tokens');
    expect(strengthLabel({ kind: 'candidate' })).toBe('candidate');
    expect(strengthLabel({ kind: 'inconclusive' })).toBe('inconclusive');
  });
});

describe('structuralRows', () => {
  it('has the three sections, with proved bounds and invariants for a cycle', () => {
    const rows = structuralRows(analyseStructure(cycle));
    expect(rows.map((r) => r.label)).toEqual(['Boundedness', 'Deadlocks / Liveness', 'Invariants']);
    expect(find(rows, 'Boundedness', /^Structurally bounded/)?.description).toBe('proved');
    expect(find(rows, 'Boundedness', /^a$/)?.description).toBe('proved · at most 1');
    expect(find(rows, 'Invariants', /^a \+ b = 1/)?.description).toBe('proved');
    expect(find(rows, 'Deadlocks / Liveness', /Deadlock-free \(state equation\)/)?.description).toBe('proved');
  });

  it('offers a deadlock candidate with the confirm action, and the state space settles it', () => {
    const r = analyseStructure(chain);
    const cand = find(structuralRows(r), 'Deadlocks / Liveness', /candidate/);
    expect(cand?.description).toMatch(/^candidate/);
    expect(cand?.command).toBe('cpnIde.analyseStateSpace');
    const confirmed = find(structuralRows(r, ss({ deadMarkings: [{ node: 2, trace: ['t'], marking: {} }] })), 'Deadlocks / Liveness', /confirmed/);
    expect(confirmed?.description).toMatch(/^proved/);
    expect(find(structuralRows(r, ss()), 'Deadlocks / Liveness', /refuted/)).toBeDefined();
    // An incomplete search with no dead marking settles nothing.
    expect(find(structuralRows(r, ss({ complete: false })), 'Deadlocks / Liveness', /^Deadlock candidate \(/)?.command).toBe('cpnIde.analyseStateSpace');
  });

  it('flags every result as approximate and lists the approximations when the net is not exact', () => {
    const rows = structuralRows(analyseStructure({ ...cycle, exact: false, approximations: [{ element: 'Page/arc', reason: 'variable arc' }] }));
    for (const s of rows.filter((r) => r.label !== 'Approximations')) {
      for (const c of s.children ?? []) expect(c.description).toContain('approximate');
    }
    const a = rows.find((r) => r.label === 'Approximations');
    expect(a?.children?.[0]).toMatchObject({ label: 'Page/arc', description: 'approximate · variable arc' });
  });

  it('shows the state space bounds next to the structural ones only when the search completed', () => {
    const net = analyseStructure(cycle);
    expect(find(structuralRows(net, ss({ complete: true })), 'Boundedness', /^a$/)?.description).toBe('proved · at most 1 · reached 0..1');
    expect(find(structuralRows(net, ss({ complete: false })), 'Boundedness', /^a$/)?.description).toBe('proved · at most 1');
  });

  it('marks the place of an unbounded witness', () => {
    const rows = structuralRows(analyseStructure(cycle), ss({ complete: false, unbounded: { place: 'a', trace: ['t'] } }));
    expect(find(rows, 'Boundedness', /^a$/)?.description).toBe('proved · at most 1 · grows without bound in the state space');
  });
});

describe('stateSpaceRows', () => {
  it('labels a complete result as proved', () => {
    const rows = stateSpaceRows(ss({ deadTransitions: ['P/t'] }));
    const text = rowsToText(rows).join('\n');
    expect(text).toContain('2 states, 1 arc');
    expect(text).toContain('Dead transitions: proved · P/t');
    expect(text).toContain('a: proved · 0..1');
  });

  it('labels an incomplete result as up to N states, with lower bounds and "not fired within"', () => {
    const text = rowsToText(stateSpaceRows(ss({ complete: false, nodes: 500, deadTransitions: ['P/t'] }))).join('\n');
    expect(text).toContain('Inconclusive: stopped at the state cap or timeout');
    expect(text).not.toMatch(/dead marking|Dead transitions|Not fired|lower bound|0\.\.1/);
    expect(stateSpaceRows(ss({ complete: false })).map((r) => r.label)).toEqual(['State space']);
  });

  it('puts an unbounded finding first: proved when exact, approximate otherwise', () => {
    const u = ss({ complete: false, unbounded: { place: 'a', trace: ['t', 'u'] } });
    const exact = rowsToText(stateSpaceRows(u, true, true)).join('\n');
    expect(exact).toContain('Unbounded: place a: proved · reached by t > u');
    expect(exact).not.toContain('Inconclusive');
    expect(exact).not.toContain('dead marking');
    const approx = rowsToText(stateSpaceRows(u, false)).join('\n');
    expect(approx).toContain('Likely unbounded: place a');
    expect(approx).toContain('approximate');
  });

  it('does not prove unboundedness when tokens are coloured, even on an exact net', () => {
    const u = ss({ complete: false, unbounded: { place: 'a', trace: ['t'] } });
    const text = rowsToText(stateSpaceRows(u, true, false)).join('\n');
    expect(text).toContain('Likely unbounded: place a');
    expect(text).not.toContain('Unbounded: place a: proved');
    expect(reportText('m', undefined, u, false)).toContain('Likely unbounded');
    expect(reportText('m', undefined, u, true)).toContain('Unbounded: place a: proved');
  });

  it('reports the same in the saved text', () => {
    expect(reportText('m', undefined, ss({ complete: false }))).toContain('Inconclusive');
    expect(reportText('m', undefined, ss({ complete: false, unbounded: { place: 'a', trace: ['t'] } }), true)).toContain('Unbounded: place a');
  });
});

describe('reportText', () => {
  it('holds the structural summary and the state space text', () => {
    const t = reportText('m.petri.json', analyseStructure(cycle), ss());
    expect(t).toContain('CPN IDE analysis report: m.petri.json');
    expect(t).toContain('Structural analysis');
    expect(t).toContain('State space: 2 nodes, 1 arcs');
    expect(reportText('x')).toContain('No results yet.');
  });
});

describe('onlyPlainTokens', () => {
  const spec = (...types: string[]) => ({ version: 1 as const, pages: [{ name: 'P', places: types.map((type, i) => ({ name: `p${i}`, type })) }] });
  it('is true when every place is UNIT or a unit alias', () => {
    expect(onlyPlainTokens(spec('UNIT', 'UNIT'), '')).toBe(true);
    expect(onlyPlainTokens(spec('U', 'UNIT'), 'colset U = unit;')).toBe(true);
  });
  it('is false for any other colour set', () => {
    expect(onlyPlainTokens(spec('UNIT', 'INT'), '')).toBe(false);
    expect(onlyPlainTokens(spec('U'), 'colset U = int;')).toBe(false);
  });
});

describe('runAnalyse', () => {
  const steps = (check: boolean | undefined) => {
    const calls: string[] = [];
    return {
      calls,
      s: {
        check: async () => (calls.push('check'), check),
        structural: async () => void calls.push('structural'),
        stateSpace: async () => (calls.push('stateSpace'), ['done']),
      },
    };
  };
  it('runs check, structural, then state space', async () => {
    const t = steps(true);
    expect(await runAnalyse(t.s)).toEqual(['done']);
    expect(t.calls).toEqual(['check', 'structural', 'stateSpace']);
  });
  it('stops after the check when it finds errors or does not complete', async () => {
    for (const c of [false, undefined]) {
      const t = steps(c);
      expect(await runAnalyse(t.s)).toBeUndefined();
      expect(t.calls).toEqual(['check']);
    }
  });
});
