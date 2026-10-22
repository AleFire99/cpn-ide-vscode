// State-equation LP/MILP analyses (M = M0 + C x, x >= 0). vscode-free.
// Results are structural: they hold for every reachable marking and need no state space.
import solver from 'javascript-lp-solver';
import type { LPModel, LPResult } from 'javascript-lp-solver';
import { incidence, type PTNet } from './ptnet';

/** Wall-clock budget per solver call (ms). */
export const SOLVER_TIMEOUT_MS = 5000;
/** Big-M used for a place the LP cannot bound. A dead marking with more tokens than this is not covered. */
const FALLBACK_BIG_M = 1e5;
const EPS = 1e-7;

type Cons = LPModel['constraints'];
type Vars = LPModel['variables'];

interface Solved {
  res: LPResult;
  /** True when the time guard fired, so an infeasible answer cannot be trusted. */
  timedOut: boolean;
}

function solve(model: LPModel): Solved {
  const start = Date.now();
  const res = solver.Solve({ ...model, timeout: SOLVER_TIMEOUT_MS });
  return { res, timedOut: Date.now() - start >= SOLVER_TIMEOUT_MS };
}

const val = (res: LPResult, name: string): number => {
  const v = res[name];
  return typeof v === 'number' ? v : 0;
};

/** One variable x_t per transition; its coefficient in constraint `p<i>` is C[i][t]. */
function flowVars(net: PTNet, c: number[][]): Vars {
  const vars: Vars = {};
  net.transitions.forEach((_, t) => {
    const col: Record<string, number> = {};
    net.places.forEach((_, p) => {
      if (c[p][t] !== 0) col[`p${p}`] = c[p][t];
    });
    vars[`x${t}`] = col;
  });
  return vars;
}

/** Marking constraints M(p) = m0 + (Cx)(p) >= 0, written as (Cx)(p) >= -m0. */
function markingCons(net: PTNet): Cons {
  const cons: Cons = {};
  net.places.forEach((_, p) => {
    cons[`p${p}`] = { min: -net.m0[p] };
  });
  return cons;
}

/** Sound upper bound per place over all reachable markings; Infinity when the LP is unbounded (or on timeout). */
export function lpBounds(net: PTNet): number[] {
  const c = incidence(net);
  return net.places.map((_, p) => {
    if (net.transitions.every((_, t) => c[p][t] <= 0)) return net.m0[p];
    const vars = flowVars(net, c);
    for (const t of net.transitions.keys()) vars[`x${t}`].obj = c[p][t];
    const { res, timedOut } = solve({ optimize: 'obj', opType: 'max', constraints: markingCons(net), variables: vars });
    if (timedOut || !res.feasible || res.bounded === false) return Infinity;
    return Math.round((net.m0[p] + res.result) * 1e6) / 1e6;
  });
}

export type Boundedness = { bounded: true; y: number[] } | { bounded: false; x: number[] } | { bounded: 'unknown' };

/** Structurally bounded iff some y > 0 has y^T C <= 0; unbounded if some x >= 0 has Cx >= 0, Cx != 0. */
export function structuralBoundedness(net: PTNet): Boundedness {
  const c = incidence(net);
  const nP = net.places.length;
  const nT = net.transitions.length;
  if (nT === 0) return { bounded: true, y: net.places.map(() => 1) };

  // Witness search: maximise sum(Cx) s.t. Cx >= 0, sum x <= 1.
  const wVars = flowVars(net, c);
  for (const t of net.transitions.keys()) {
    wVars[`x${t}`].obj = net.places.reduce((s, _, p) => s + c[p][t], 0);
    wVars[`x${t}`].norm = 1;
  }
  const wCons: Cons = { norm: { max: 1 } };
  for (let p = 0; p < nP; p++) wCons[`p${p}`] = { min: 0 };
  const w = solve({ optimize: 'obj', opType: 'max', constraints: wCons, variables: wVars });
  if (w.res.feasible && w.res.result > EPS) {
    return { bounded: false, x: net.transitions.map((_, t) => val(w.res, `x${t}`)) };
  }

  // y_p >= 1 (a scaling of y > 0) with sum_p y_p C[p][t] <= 0 for every t.
  const yCons: Cons = {};
  const yVars: Vars = {};
  for (let t = 0; t < nT; t++) yCons[`t${t}`] = { max: 0 };
  for (let p = 0; p < nP; p++) {
    yCons[`lb${p}`] = { min: 1 };
    const col: Record<string, number> = { [`lb${p}`]: 1 };
    for (let t = 0; t < nT; t++) if (c[p][t] !== 0) col[`t${t}`] = c[p][t];
    yVars[`y${p}`] = col;
  }
  const y = solve({ constraints: yCons, variables: yVars });
  if (y.res.feasible && !y.timedOut) {
    return { bounded: true, y: net.places.map((_, p) => val(y.res, `y${p}`)) };
  }
  return { bounded: 'unknown' };
}

export type Target = Partial<Record<number, { min?: number; max?: number }>>;

/** 'unreachable' is a proof (no integer x solves the state equation); 'inconclusive' is not. */
export function checkReachable(net: PTNet, target: Target): 'unreachable' | 'inconclusive' {
  const c = incidence(net);
  const cons = markingCons(net);
  for (const [key, range] of Object.entries(target)) {
    if (!range) continue;
    const p = Number(key);
    const entry: { min: number; max?: number } = { min: Math.max(0, range.min ?? 0) - net.m0[p] };
    if (range.max !== undefined) entry.max = range.max - net.m0[p];
    cons[`p${p}`] = entry;
  }
  const ints: Record<string, 1> = {};
  for (const t of net.transitions.keys()) ints[`x${t}`] = 1;
  const { res, timedOut } = solve({ constraints: cons, variables: flowVars(net, c), ints });
  return timedOut || res.feasible ? 'inconclusive' : 'unreachable';
}

/** `assumedMax`: the proof only covers markings where every LP-unbounded input place holds at most this many tokens. */
export type DeadlockResult = { deadlockFree: true; assumedMax?: number } | { candidate: number[] } | { unknown: true };

/**
 * MILP over the state equation looking for a marking that disables every transition.
 * Infeasible: deadlock-free, proved outright when every input place is LP-bounded, otherwise up to `assumedMax`.
 * Feasible: a candidate dead marking, to confirm with the state space. `unknown` on solver timeout.
 */
export function deadlockCandidate(net: PTNet): DeadlockResult {
  const c = incidence(net);
  const nT = net.transitions.length;
  // A transition without input places is always enabled.
  if (nT === 0 || net.pre.some((row) => row.every((w) => w <= 0))) return { deadlockFree: true };

  const bounds = lpBounds(net);
  const cons = markingCons(net);
  const vars = flowVars(net, c);
  const ints: Record<string, 1> = {};
  const binaries: Record<string, 1> = {};
  let capped = false;
  for (const t of net.transitions.keys()) ints[`x${t}`] = 1;

  net.transitions.forEach((_, t) => {
    const pick = `pick${t}`;
    cons[pick] = { min: 1 };
    net.places.forEach((_, p) => {
      const w = net.pre[t][p];
      if (w <= 0) return;
      const z = `z${t}_${p}`;
      binaries[z] = 1;
      if (!Number.isFinite(bounds[p])) capped = true;
      const big = Math.max(Number.isFinite(bounds[p]) ? bounds[p] : FALLBACK_BIG_M, w);
      // z = 1 forces M(p) <= w - 1; z = 0 relaxes it by big-M:  (Cx)(p) + big*z <= w - 1 + big - m0(p).
      const row = `dead${t}_${p}`;
      cons[row] = { max: w - 1 + big - net.m0[p] };
      vars[z] = { [pick]: 1, [row]: big };
      for (let u = 0; u < nT; u++) if (c[p][u] !== 0) vars[`x${u}`][row] = c[p][u];
    });
  });

  const { res, timedOut } = solve({ constraints: cons, variables: vars, ints, binaries });
  if (res.feasible) {
    return {
      candidate: net.places.map((_, p) =>
        Math.round(net.m0[p] + net.transitions.reduce((s, _, t) => s + c[p][t] * val(res, `x${t}`), 0)),
      ),
    };
  }
  if (timedOut) return { unknown: true };
  return capped ? { deadlockFree: true, assumedMax: FALLBACK_BIG_M } : { deadlockFree: true };
}
