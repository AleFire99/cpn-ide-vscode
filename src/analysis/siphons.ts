// Siphons, traps and Commoner's deadlock check on the place/transition view. vscode-free.
import type { PTNet } from './ptnet';

export interface CommonerResult {
  verdict: 'deadlock-free' | 'live' | 'possible-deadlock' | 'inconclusive';
  /** Minimal siphons (place indices) with no initially marked trap. */
  badSiphons: number[][];
  /** The siphon enumeration hit its cap, so the verdict is not conclusive. */
  truncated: boolean;
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Minimal siphons (as sorted place indices). Branch and bound; `truncated` when `cap` search nodes are spent. */
export const minimalSiphons = (net: PTNet, cap = 5000): { siphons: number[][]; truncated: boolean } => {
  const nP = net.places.length;
  const found: number[][] = [];
  let nodes = 0;
  let truncated = false;
  // Input places of each transition, and producers of each place (support only).
  const preOf = net.pre.map(row => range(nP).filter(p => row[p] > 0));
  const producers = range(nP).map(p => range(net.transitions.length).filter(t => net.post[t][p] > 0));

  const search = (inS: boolean[], excluded: boolean[]): void => {
    if (truncated) return;
    if (++nodes > cap) { truncated = true; return; }
    // A place in S with a producer that takes nothing from S breaks the siphon condition.
    for (let p = 0; p < nP; p++) {
      if (!inS[p]) continue;
      for (const t of producers[p]) {
        if (preOf[t].some(q => inS[q])) continue;
        const options = preOf[t].filter(q => !excluded[q]);
        const ex = excluded.slice();
        for (const q of options) {
          const next = inS.slice();
          next[q] = true;
          search(next, ex.slice());
          ex[q] = true; // later branches omit q; any minimal siphon holding q is found above
        }
        return;
      }
    }
    found.push(range(nP).filter(p => inS[p]));
  };

  for (let seed = 0; seed < nP && !truncated; seed++) {
    const inS = new Array<boolean>(nP).fill(false);
    inS[seed] = true;
    search(inS, range(nP).map(p => p < seed));
  }
  const sub = (a: number[], b: number[]) => a.every(x => b.includes(x));
  const siphons = found
    .filter((s, i) => !found.some((o, j) => j !== i && sub(o, s) && (o.length < s.length || j < i)));
  return { siphons, truncated };
};

/** Largest trap contained in `places` (possibly empty). */
export const maximalTrap = (net: PTNet, places: number[]): number[] => {
  let q = places.slice();
  for (let changed = true; changed;) {
    changed = false;
    const keep = q.filter(p => net.pre.every((row, t) => row[p] === 0 || q.some(r => net.post[t][r] > 0)));
    if (keep.length !== q.length) { q = keep; changed = true; }
  }
  return q;
};

/** Free-choice: transitions sharing an input place have the same input places. */
export const isFreeChoice = (net: PTNet): boolean => {
  const nP = net.places.length;
  const sup = net.pre.map(row => range(nP).filter(p => row[p] > 0));
  for (let a = 0; a < sup.length; a++)
    for (let b = a + 1; b < sup.length; b++)
      if (sup[a].some(p => sup[b].includes(p)) && (sup[a].length !== sup[b].length || sup[a].some((p, i) => p !== sup[b][i])))
        return false;
  return true;
};

/**
 * Commoner: in an ordinary net, every siphon holding an initially marked trap => deadlock-free (and live if also
 * free-choice). With arc weights > 1 a marked trap may hold too few tokens, so the property proves nothing.
 */
export const commoner = (net: PTNet, cap?: number): CommonerResult => {
  const { siphons, truncated } = minimalSiphons(net, cap);
  const badSiphons = siphons.filter(s => !maximalTrap(net, s).some(p => net.m0[p] > 0));
  const ordinary = net.pre.every(r => r.every(w => w <= 1)) && net.post.every(r => r.every(w => w <= 1));
  const ok = badSiphons.length === 0 && !truncated;
  const verdict = !ok ? 'possible-deadlock' : !ordinary ? 'inconclusive' : isFreeChoice(net) ? 'live' : 'deadlock-free';
  return { verdict, badSiphons, truncated };
};
