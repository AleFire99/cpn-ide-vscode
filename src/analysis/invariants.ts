// P/T-invariants via Farkas' algorithm, and place bounds derived from P-invariants. vscode-free.
import { incidence, type PTNet } from './ptnet';

export type InvariantResult = { truncated: true } | { truncated: false; vectors: number[][] };

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

const normalise = (v: number[]): number[] => {
  const g = v.reduce(gcd, 0);
  return g > 1 ? v.map((x) => x / g) : v;
};

const support = (v: number[]): number[] => v.flatMap((x, i) => (x !== 0 ? [i] : []));
const subset = (a: number[], b: number[]): boolean => a.every((i) => b.includes(i));

/** Drop rows whose support strictly contains, or duplicates, an earlier-or-smaller row's support. */
const minimalSupport = (rows: number[][]): number[][] => {
  const sups = rows.map(support);
  return rows.filter((_, i) =>
    sups.every((s, j) => j === i || !subset(s, sups[i]) || (subset(sups[i], s) && j > i)),
  );
};

/** Minimal-support semi-positive vectors y >= 0, y != 0, with y^T A = 0 (A: rows x cols). */
function farkas(a: number[][], cap: number): InvariantResult {
  const n = a.length;
  const cols = n ? a[0].length : 0;
  // Row = [A row | identity row]; eliminate the A part column by column.
  let rows = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, k) => (k === i ? 1 : 0))]);
  for (let c = 0; c < cols; c++) {
    const next = rows.filter((r) => r[c] === 0);
    const pos = rows.filter((r) => r[c] > 0);
    const neg = rows.filter((r) => r[c] < 0);
    for (const p of pos) {
      for (const q of neg) {
        const fp = -q[c];
        const fq = p[c];
        const g = gcd(fp, fq);
        next.push(normalise(p.map((x, k) => (x * fp + q[k] * fq) / g)));
        if (next.length > cap) return { truncated: true };
      }
    }
    rows = minimalSupport(next);
  }
  const seen = new Set<string>();
  const vectors = rows
    .map((r) => normalise(r.slice(cols)))
    .filter((v) => {
      const k = v.join(',');
      return !seen.has(k) && seen.add(k);
    });
  return { truncated: false, vectors };
}

/** P-invariants: y >= 0 with y^T C = 0, indexed by place. */
export const pInvariants = (net: PTNet, cap = 10000): InvariantResult => farkas(incidence(net), cap);

/** T-invariants: x >= 0 with C x = 0, indexed by transition. */
export function tInvariants(net: PTNet, cap = 10000): InvariantResult {
  const c = incidence(net);
  const ct = net.transitions.map((_, t) => c.map((row) => row[t]));
  return farkas(ct, cap);
}

/** Best bound per place from P-invariants: min over y of floor(y.M0 / y_p); undefined if uncovered. */
export function invariantBounds(net: PTNet, inv: number[][]): (number | undefined)[] {
  return net.places.map((_, p) => {
    let best: number | undefined;
    for (const y of inv) {
      if (y[p] <= 0) continue;
      const b = Math.floor(y.reduce((s, w, i) => s + w * net.m0[i], 0) / y[p]);
      if (best === undefined || b < best) best = b;
    }
    return best;
  });
}

/** Every place lies in the support of some P-invariant. */
export const isConservative = (net: PTNet, inv: number[][]): boolean =>
  net.places.every((_, p) => inv.some((y) => y[p] > 0));

/** Indices of transitions in the support of no T-invariant. */
export const uncoveredTransitions = (net: PTNet, inv: number[][]): number[] =>
  net.transitions.flatMap((_, t) => (inv.some((x) => x[t] > 0) ? [] : [t]));
