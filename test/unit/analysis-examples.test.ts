import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toPTNet } from '../../src/analysis/abstract';
import { commoner } from '../../src/analysis/siphons';
import { deadlockCandidate, lpBounds, structuralBoundedness } from '../../src/analysis/stateEquation';

const load = (id: string) => {
  const dir = path.resolve(__dirname, '../../examples');
  const spec = JSON.parse(fs.readFileSync(path.join(dir, `${id}.petri.json`), 'utf8'));
  return toPTNet(spec, fs.readFileSync(path.join(dir, `${id}.sml`), 'utf8'));
};

describe('analysis of the bundled examples', () => {
  it('05-dining-philosophers is exact and can deadlock', () => {
    const net = load('05-dining-philosophers');
    expect(net.exact).toBe(true);
    const dead = deadlockCandidate(net);
    const verdict = commoner(net).verdict;
    expect('candidate' in dead || verdict === 'possible-deadlock').toBe(true);
    expect(verdict).not.toBe('live');
  });

  it('06-unbounded-producer is structurally unbounded, with no finite bound on Buffer', () => {
    const net = load('06-unbounded-producer');
    expect(structuralBoundedness(net).bounded).toBe(false);
    const buffer = net.places.findIndex((p) => p.label.endsWith('Buffer'));
    expect(buffer).toBeGreaterThanOrEqual(0);
    expect(lpBounds(net)[buffer]).toBe(Infinity);
  });

  it('03-mutual-exclusion bounds the critical section by 1 and cannot deadlock', () => {
    const net = load('03-mutual-exclusion');
    const critical = net.places.findIndex((p) => p.label.endsWith('Critical'));
    expect(lpBounds(net)[critical]).toBe(1);
    expect('candidate' in deadlockCandidate(net)).toBe(false);
  });
});
