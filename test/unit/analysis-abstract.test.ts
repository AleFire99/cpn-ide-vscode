import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toPTNet } from '../../src/analysis/abstract';
import { incidence } from '../../src/analysis/ptnet';
import type { PetriSpec } from '../../src/model/types';

const load = (n: string) => {
  const dir = join(__dirname, '../../examples');
  return toPTNet(JSON.parse(readFileSync(join(dir, `${n}.petri.json`), 'utf8')), readFileSync(join(dir, `${n}.sml`), 'utf8'));
};
const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

describe('toPTNet', () => {
  it('01 simple flow', () => {
    const n = load('01-simple-flow');
    expect(labels(n.places)).toEqual(['SimpleFlow/Start', 'SimpleFlow/Done']);
    expect(n.m0).toEqual([3, 0]);
    expect(incidence(n)).toEqual([[-1], [1]]);
    expect(n.exact).toBe(true);
    expect(n.places[0].source).toEqual({ file: 'spec', path: '/pages/0/places/0' });
  });

  it('02 producer/consumer', () => {
    const n = load('02-producer-consumer');
    expect(n.m0).toEqual([1, 0, 0]);
    expect(incidence(n)).toEqual([[0, 0], [1, -1], [0, 1]]);
    expect(n.exact).toBe(true);
  });

  it('03 mutual exclusion', () => {
    const n = load('03-mutual-exclusion');
    expect(n.m0).toEqual([2, 1, 0]);
    expect(incidence(n)).toEqual([[-1, 1], [-1, 1], [1, -1]]);
  });

  it('04 hierarchy is flattened', () => {
    const n = load('04-hierarchy');
    expect(labels(n.places)).toEqual(['Top/Jobs', 'Top/Results', 'Top/Count']);
    expect(labels(n.transitions)).toEqual(['Worker/Work']);
    expect(n.m0).toEqual([3, 0, 1]);
    expect(incidence(n)).toEqual([[-1], [1], [0]]);
    expect(n.exact).toBe(true);
  });

  const one = (inscription: string, init?: string, type = 'INT'): PetriSpec => ({
    version: 1,
    pages: [{ name: 'P', places: [{ name: 'a', type, init }], transitions: [{ name: 't' }], arcs: [{ from: 'a', to: 't', inscription }] }],
  });

  it('reports a variable count as an approximation', () => {
    const n = toPTNet(one('k`x'), 'var x: INT;');
    expect(n.exact).toBe(false);
    expect(n.approximations).toHaveLength(1);
    expect(n.pre[0][0]).toBe(1);
  });

  it('counts n`e, ++, double arcs and val initial markings', () => {
    const n = toPTNet(one('2`x ++ y', 'k`1'), 'val k = 4;');
    expect(n.pre[0][0]).toBe(3);
    expect(n.m0).toEqual([4]);
    const b = one('x');
    b.pages[0].arcs![0].bidirectional = true;
    const d = toPTNet(b, '');
    expect([d.pre[0][0], d.post[0][0]]).toEqual([1, 1]);
  });

  it('approximates function calls and list places', () => {
    expect(toPTNet(one('f x'), '').exact).toBe(false);
    expect(toPTNet(one('x', undefined, 'LST'), 'colset LST = list INT;').exact).toBe(false);
  });

  it('counts the empty multiset as no tokens', () => {
    const n = toPTNet(one('x ++ empty', 'empty'), '');
    expect(n.pre[0][0]).toBe(1);
    expect(n.m0).toEqual([0]);
    expect(n.exact).toBe(true);
  });
});
