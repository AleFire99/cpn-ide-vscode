// vscode-free logic of the "Analysis" sidebar view: findings -> tree rows.

import type { Finding } from '../model/diagnostics';
import type { SourceRef, PetriSpec } from '../model/types';
import { toPTNet } from '../analysis/abstract';
import { invariantBounds, isConservative, pInvariants, tInvariants, uncoveredTransitions, type InvariantResult } from '../analysis/invariants';
import type { PTNet } from '../analysis/ptnet';
import { commoner, type CommonerResult } from '../analysis/siphons';
import { deadlockCandidate, lpBounds, structuralBoundedness, type Boundedness, type DeadlockResult } from '../analysis/stateEquation';
import { formatStateSpace, type StateSpaceResult } from '../runtime/explore-core';

export interface AnalysisRow {
  kind: 'summary' | 'finding' | 'section' | 'result';
  label: string;
  /** Codicon id. */
  icon: string;
  /** Where the finding is, e.g. "line 12" or "/pages/0/places/1"; absent for the summary. */
  description?: string;
  source?: SourceRef;
  /** Child rows (sections only). */
  children?: AnalysisRow[];
  /** Command id run on click (rows of the structural / state space results). */
  command?: string;
}

/** Short text for a source reference. */
export function locationLabel(source: SourceRef | undefined): string | undefined {
  if (!source) return undefined;
  return source.file === 'sml' ? (source.line >= 1 ? `line ${source.line}` : undefined) : source.path || undefined;
}

export function summaryText(findings: Finding[]): string {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  if (findings.length === 0) return 'No errors';
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return warnings ? `${plural(errors, 'error')}, ${plural(warnings, 'warning')}` : plural(errors, 'error');
}

/** The summary row, then one row per finding. */
export function findingsToRows(findings: Finding[]): AnalysisRow[] {
  const clean = findings.length === 0;
  const rows: AnalysisRow[] = [
    { kind: 'summary', label: summaryText(findings), icon: clean ? 'pass' : findings.some((f) => f.severity === 'error') ? 'error' : 'warning' },
  ];
  for (const f of findings) {
    rows.push({
      kind: 'finding',
      label: f.message,
      icon: f.severity === 'error' ? 'error' : 'warning',
      description: locationLabel(f.source),
      source: f.source,
    });
  }
  return rows;
}

// ---- Structural and state space results (#107) ---------------------------------------------------------------

/** How far a result can be trusted. */
export type Strength =
  | { kind: 'proved' }
  | { kind: 'upTo'; n: number; unit: string }
  | { kind: 'candidate' }
  | { kind: 'inconclusive' };

export interface StructuralResults {
  net: PTNet;
  pInv: InvariantResult;
  tInv: InvariantResult;
  /** Place bound from P-invariants (undefined: not covered). */
  invBounds: (number | undefined)[];
  /** Place bound from the LP (Infinity: unbounded or timeout). */
  lp: number[];
  bounded: Boundedness;
  deadlock: DeadlockResult;
  commoner: CommonerResult;
}

/** Run every structural analysis on the net. Needs no backend. */
export function analyseStructure(net: PTNet): StructuralResults {
  const pInv = pInvariants(net);
  const tInv = tInvariants(net);
  return {
    net,
    pInv,
    tInv,
    invBounds: invariantBounds(net, pInv.truncated ? [] : pInv.vectors),
    lp: lpBounds(net),
    bounded: structuralBoundedness(net),
    deadlock: deadlockCandidate(net),
    commoner: commoner(net),
  };
}

/** Structural results straight from a text model. */
export const analyseSpec = (spec: PetriSpec, sml: string): StructuralResults => analyseStructure(toPTNet(spec, sml));

/** The badge text for a strength. */
export function strengthLabel(s: Strength): string {
  switch (s.kind) {
    case 'proved':
      return 'proved';
    case 'upTo':
      return `up to ${s.n} ${s.unit}`;
    case 'candidate':
      return 'candidate';
    case 'inconclusive':
      return 'inconclusive';
  }
}

const STRENGTH_ICON: Record<Strength['kind'], string> = { proved: 'pass', upTo: 'pass', candidate: 'question', inconclusive: 'circle-slash' };

function result(label: string, strength: Strength, approximate: boolean, detail?: string, command?: string): AnalysisRow {
  const badge = approximate ? `${strengthLabel(strength)}, approximate` : strengthLabel(strength);
  return {
    kind: 'result',
    label,
    icon: approximate ? 'warning' : STRENGTH_ICON[strength.kind],
    description: detail ? `${badge} · ${detail}` : badge,
    command,
  };
}

const section = (label: string, icon: string, children: AnalysisRow[]): AnalysisRow => ({ kind: 'section', label, icon, children });

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Weighted sum text for a P-invariant, e.g. `A + 2*B = 3`. */
function invariantLabel(net: PTNet, y: number[]): string {
  const terms = y.flatMap((w, p) => (w > 0 ? [w === 1 ? net.places[p].label : `${w}*${net.places[p].label}`] : []));
  return `${terms.join(' + ')} = ${y.reduce((a, w, p) => a + w * net.m0[p], 0)}`;
}

/** One section per structural topic; `ss` (if present) confirms or refutes the deadlock candidate and adds reached bounds. */
export function structuralRows(r: StructuralResults, ss?: StateSpaceResult): AnalysisRow[] {
  const { net } = r;
  const approx = !net.exact;
  const sections: AnalysisRow[] = [];

  // Boundedness
  const bound: AnalysisRow[] = [];
  const b = r.bounded;
  bound.push(
    b.bounded === true
      ? result('Structurally bounded', { kind: 'proved' }, approx)
      : b.bounded === false
        ? result('Not structurally bounded', { kind: 'proved' }, approx, 'unbounded for some initial marking; this one may still be bounded')
        : result('Structural boundedness', { kind: 'inconclusive' }, approx),
  );
  net.places.forEach((pl, p) => {
    const cands = [r.invBounds[p], r.lp[p]].filter((x): x is number => x !== undefined && Number.isFinite(x));
    const ub = cands.length ? Math.min(...cands) : undefined;
    const seen = ss?.bounds[pl.label];
    const reached = seen ? `reached ${seen.min}..${seen.max}${ss && !ss.complete ? ' (lower bound)' : ''}` : undefined;
    const detail = [ub === undefined ? 'no bound' : `at most ${ub}`, reached].filter(Boolean).join(' · ');
    bound.push(result(pl.label, ub === undefined ? { kind: 'inconclusive' } : { kind: 'proved' }, approx, detail));
  });
  sections.push(section('Boundedness', 'graph', bound));

  // Deadlocks / liveness
  const dead: AnalysisRow[] = [];
  const c = r.commoner;
  const commonerText = { live: 'Live (Commoner)', 'deadlock-free': 'Deadlock-free (Commoner)', 'possible-deadlock': 'Commoner: possible deadlock', inconclusive: 'Commoner' }[c.verdict];
  dead.push(
    c.verdict === 'live' || c.verdict === 'deadlock-free'
      ? result(commonerText, { kind: 'proved' }, approx)
      : result(
          commonerText,
          { kind: 'inconclusive' },
          approx,
          c.truncated ? 'siphon search hit its cap' : c.verdict === 'inconclusive' ? 'arc weights above 1' : `${plural(c.badSiphons.length, 'siphon')} without a marked trap`,
        ),
  );
  const d = r.deadlock;
  if ('deadlockFree' in d) {
    dead.push(result('Deadlock-free (state equation)', d.assumedMax === undefined ? { kind: 'proved' } : { kind: 'upTo', n: d.assumedMax, unit: 'tokens' }, approx));
  } else if ('candidate' in d) {
    const marking =
      d.candidate
        .map((n, p) => (n > 0 ? `${net.places[p].label}: ${n}` : ''))
        .filter(Boolean)
        .join(', ') || 'empty marking';
    if (ss && ss.complete && ss.deadMarkings.length === 0) {
      dead.push(result('Deadlock candidate refuted by the state space', { kind: 'proved' }, approx, marking));
    } else if (ss && ss.deadMarkings.length > 0) {
      dead.push(result('Deadlock confirmed by the state space', { kind: 'proved' }, approx, plural(ss.deadMarkings.length, 'dead marking')));
    } else {
      dead.push(result('Deadlock candidate (state equation)', { kind: 'candidate' }, approx, `${marking} · click to confirm with Analyse State Space`, 'cpnIde.analyseStateSpace'));
    }
  } else {
    dead.push(result('Deadlock check (state equation)', { kind: 'inconclusive' }, approx, 'solver timeout'));
  }
  sections.push(section('Deadlocks / Liveness', 'debug-pause', dead));

  // Invariants
  const inv: AnalysisRow[] = [];
  if (r.pInv.truncated) inv.push(result('P-invariants', { kind: 'inconclusive' }, approx, 'enumeration hit its cap'));
  else {
    const conservative = isConservative(net, r.pInv.vectors) ? 'conservative' : 'not every place is covered';
    inv.push(result(plural(r.pInv.vectors.length, 'P-invariant'), { kind: 'proved' }, approx, conservative));
    for (const y of r.pInv.vectors) inv.push(result(invariantLabel(net, y), { kind: 'proved' }, approx));
  }
  if (r.tInv.truncated) inv.push(result('T-invariants', { kind: 'inconclusive' }, approx, 'enumeration hit its cap'));
  else {
    const unc = uncoveredTransitions(net, r.tInv.vectors);
    const cover = unc.length ? `not covered: ${unc.map((t) => net.transitions[t].label).join(', ')}` : 'every transition is covered';
    inv.push(result(plural(r.tInv.vectors.length, 'T-invariant'), { kind: 'proved' }, approx, cover));
  }
  sections.push(section('Invariants', 'symbol-numeric', inv));

  if (approx) {
    const rows = net.approximations.map<AnalysisRow>((a) => ({ kind: 'result', label: a.element, icon: 'warning', description: `approximate · ${a.reason}` }));
    sections.push(section('Approximations', 'warning', rows));
  }
  return sections;
}

/** Rows for the state space result, with the caveats of a search that was cut short. `exact`: the PT abstraction of the net is exact. */
export function stateSpaceRows(r: StateSpaceResult, exact = true): AnalysisRow[] {
  if (r.unbounded) {
    const { place, trace } = r.unbounded;
    const path = trace.join(' > ') || '(initial)';
    const row = exact
      ? result(`Unbounded: place ${place}`, { kind: 'proved' }, false, `reached by ${path}`)
      : { ...result(`Likely unbounded: place ${place}`, { kind: 'candidate' }, true, `reached by ${path}`), icon: 'warning' };
    return [section('State space', 'type-hierarchy', [row, result(`${r.nodes} states explored before stopping`, { kind: 'upTo', n: r.nodes, unit: 'states' }, false, `${r.elapsedMs} ms`)])];
  }
  if (!r.complete) {
    const row = result('Inconclusive: stopped at the state cap or timeout', { kind: 'inconclusive' }, false, `${r.nodes} states, ${r.arcs} arcs, ${r.elapsedMs} ms; partial figures are hidden`);
    return [section('State space', 'type-hierarchy', [row])];
  }
  const strength: Strength = { kind: 'proved' };
  const overview = result(`${r.nodes} states, ${r.arcs} arcs`, strength, false, `${r.elapsedMs} ms`);
  const dead: AnalysisRow[] = [
    result(plural(r.deadMarkings.length, 'dead marking'), strength, false),
    ...r.deadMarkings.map<AnalysisRow>((m) => ({ kind: 'result', label: `node ${m.node}`, icon: 'debug-pause', description: m.trace.join(' > ') || '(initial)' })),
    result('Dead transitions', strength, false, r.deadTransitions.join(', ') || 'none'),
  ];
  const bounds = Object.entries(r.bounds).map(([n, b]) => result(n, strength, false, `${b.min}..${b.max}`));
  return [
    section('State space', 'type-hierarchy', [overview]),
    section('Boundedness (state space)', 'graph', bounds),
    section('Deadlocks / Liveness (state space)', 'debug-pause', dead),
  ];
}

/** Summary lines of the state space for the saved report; same logic as the rows. */
function stateSpaceLines(r: StateSpaceResult, exact: boolean): string[] {
  if (r.complete && !r.unbounded) return formatStateSpace(r);
  return ['State space', ...rowsToText(stateSpaceRows(r, exact)[0].children ?? [], '  ')];
}

/** Flatten rows to indented text. */
export function rowsToText(rows: AnalysisRow[], indent = ''): string[] {
  return rows.flatMap((r) => [`${indent}${r.label}${r.description ? `: ${r.description}` : ''}`, ...rowsToText(r.children ?? [], `${indent}  `)]);
}

/** The text of a saved report: the structural summary, then the state space text. */
export function reportText(name: string, structural?: StructuralResults, ss?: StateSpaceResult): string {
  const lines = [`CPN IDE analysis report: ${name}`, ''];
  if (structural) lines.push('Structural analysis', ...rowsToText(structuralRows(structural, ss), '  '), '');
  if (ss) lines.push(...stateSpaceLines(ss, structural?.net.exact ?? true), '');
  if (!structural && !ss) lines.push('No results yet.');
  return lines.join('\n');
}
