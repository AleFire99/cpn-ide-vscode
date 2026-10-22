/**
 * State space exploration through the simulator (#106, spike #104). No `vscode` import so it is unit-testable with a fake fetch.
 *
 * The bundled backend has no classic state space tool, but `sim/script` can run SML on top of the ASAP interface
 * (`CPNToolsModel`). We instantiate it, run a sliced breadth-first search and read the report back from the html file
 * the backend returns in `extraInfo`. Untimed nets only; monitors are not evaluated.
 */
import type { FetchLike } from './headless-sim';
import { ASAP_SETUP, SS_EXPLORER_SML, SS_NAMES_SML } from './explore-sml';

export interface DeadMarking {
  /** 1-based node number in the search order. */
  node: number;
  /** Transition names (`Page/Transition`) from the initial state to this marking. */
  trace: string[];
  /** Marking text per place name. */
  marking: Record<string, string>;
}

export interface PlaceBound {
  min: number;
  max: number;
}

export interface StateSpaceResult {
  /** False when the search stopped at a cap or was aborted: the numbers are then a lower bound. */
  complete: boolean;
  nodes: number;
  arcs: number;
  elapsedMs: number;
  deadMarkings: DeadMarking[];
  /** Token count range per place name. */
  bounds: Record<string, PlaceBound>;
  deadTransitions: string[];
}

export type ExploreOutcome = { ok: false; issues: Record<string, unknown> } | { ok: true; result: StateSpaceResult };

export interface ExploreOptions {
  fetch: FetchLike;
  baseUrl: string;
  xml: string;
  sessionId: string;
  /** The backend's `-Duser.home`: the report file is written to `<userHome>/CPN_IDE/model_out/<sessionId>/`. */
  userHome: string;
  /** Simulator id -> readable name (see nodeNames); unknown ids are reported as they are. */
  names?: ReadonlyMap<string, string>;
  /** State cap, default 100000. */
  maxNodes?: number;
  /** Time cap in ms, default 30000. */
  maxMs?: number;
  /** Length of one exploration slice in ms (the backend cannot cancel a running script), default 500. */
  sliceMs?: number;
  signal?: AbortSignal;
  onProgress?: (nodes: number) => void;
  now?: () => number;
}

export const DEFAULT_MAX_NODES = 100000;
export const DEFAULT_MAX_MS = 30000;
const REPORT = 'ss.html';

const smlString = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Validate the model, then enumerate its reachable markings. The simulator is reset (`sim/init`) afterwards. */
export async function exploreStateSpace(o: ExploreOptions): Promise<ExploreOutcome> {
  const now = o.now ?? Date.now;
  const maxNodes = o.maxNodes ?? DEFAULT_MAX_NODES;
  const maxMs = o.maxMs ?? DEFAULT_MAX_MS;
  const sliceMs = o.sliceMs ?? 500;
  const names = o.names ?? new Map<string, string>();
  const name = (id: string) => names.get(id) ?? id;
  // Same locking as runHeadless: hold the init lock from init to the final sim/init so the canvas cannot restart the simulator.
  const api = async <T>(route: string, body?: unknown, lock: 'hold' | 'release' = 'hold'): Promise<T> => {
    const res = await o.fetch(`${o.baseUrl}/api/v2/cpn/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SessionId': o.sessionId, 'X-CPN-Lock': lock },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  };
  /** Runs SML and returns the concatenated report files (`extraInfo`). */
  const sml = async (code: string): Promise<string> => (await api<{ extraInfo?: string }>('sim/script', { repeat: code })).extraInfo ?? '';

  let simStarted = false;
  try {
    const check = await api<{ success: boolean; issues?: Record<string, unknown> }>('init', {
      xml: o.xml,
      complex_verify: true,
      need_sim_restart: true,
    });
    const issues = check.issues ?? {};
    if (!check.success || Object.keys(issues).length > 0) return { ok: false, issues };

    simStarted = true;
    const initial = await api<{ tokensAndMark: { id: string }[] }>('sim/init', {});
    const placeIds = initial.tokensAndMark.map((t) => t.id);

    for (const step of ASAP_SETUP) await sml(step);
    await sml(SS_NAMES_SML);
    await sml(SS_EXPLORER_SML);
    const dir = `${o.userHome.replace(/\/+$/, '')}/CPN_IDE/model_out/${o.sessionId}`;
    const file = `${dir}/${REPORT}`;
    // The directory may not exist yet; a leftover report from an earlier run must not be mistaken for ours.
    await sml(
      `val _ = (OS.FileSys.mkDir ${smlString(`${o.userHome.replace(/\/+$/, '')}/CPN_IDE`)}) handle _ => (); ` +
        `val _ = (OS.FileSys.mkDir ${smlString(`${o.userHome.replace(/\/+$/, '')}/CPN_IDE/model_out`)}) handle _ => (); ` +
        `val _ = (OS.FileSys.mkDir ${smlString(dir)}) handle _ => (); ` +
        `val _ = (OS.FileSys.remove ${smlString(file)}) handle _ => ();`,
    );
    const ids = `[${placeIds.map(smlString).join(',')}]`;
    await sml(`ssStart (${ids}, ${maxNodes}, ${smlString(file)});`);

    const start = now();
    let report = '';
    for (;;) {
      if (o.signal?.aborted || now() - start >= maxMs) {
        report = await sml('val _ = (!ssFin) ();');
        break;
      }
      report = await sml(`val _ = (!ssSlice) ${sliceMs};`);
      if (/^complete [01]$/m.test(report)) break;
      const n = /^nodes (\d+)$/m.exec(report);
      if (n) o.onProgress?.(Number(n[1]));
    }
    const result = parseReport(report, placeIds.map(name), now() - start);
    return { ok: true, result };
  } finally {
    // The search leaves the simulator in the last visited state with stale bindings; sim/init restores a clean one.
    if (simStarted) await api('sim/init', {}).catch(() => undefined);
    await api('', undefined, 'release').catch(() => undefined);
  }
}

/** Parse the report written by the SML (see SS_EXPLORER_SML). `placeNames` is in the order of the place id list. */
export function parseReport(extraInfo: string, placeNames: string[], elapsedMs: number): StateSpaceResult {
  const lines = extraInfo.split('\n');
  const field = (key: string): string | undefined => {
    const l = lines.find((x) => x.startsWith(`${key} `));
    return l?.slice(key.length + 1);
  };
  const readable = (t: string) => t.replace(/'/g, '/');
  const list = (v: string | undefined) => (v ? v.split(',').filter(Boolean).map(readable) : []);
  const fired = new Set(list(field('fired')));
  const bounds: Record<string, PlaceBound> = {};
  const deadMarkings: DeadMarking[] = [];
  const idIndex = new Map<string, number>();
  for (const l of lines) {
    const b = /^bound (\S+) (\d+) (\d+)$/.exec(l);
    if (b) {
      const i = idIndex.size;
      idIndex.set(b[1], i);
      const n = placeNames[i] ?? b[1];
      // A place that was never visited keeps its initial sentinel min; report 0.
      bounds[n] = { min: Number(b[2]) > Number(b[3]) ? 0 : Number(b[2]), max: Number(b[3]) };
      continue;
    }
    const d = /^dead (\d+) (\S*) # (.*)$/.exec(l);
    if (d) {
      const markings = d[3].split(' | ');
      const marking: Record<string, string> = {};
      placeNames.forEach((n, i) => {
        marking[n] = (markings[i] ?? '').replace(/\s+/g, ' ').trim() || 'empty';
      });
      deadMarkings.push({ node: Number(d[1]), trace: list(d[2]), marking });
    }
  }
  return {
    complete: field('complete') === '1',
    nodes: Number(field('nodes') ?? 0),
    arcs: Number(field('arcs') ?? 0),
    elapsedMs,
    deadMarkings,
    bounds,
    deadTransitions: list(field('alltrans')).filter((t) => !fired.has(t)),
  };
}

/** Summary lines for an output channel. */
export function formatStateSpace(r: StateSpaceResult): string[] {
  const lines = [`State space: ${r.nodes} nodes, ${r.arcs} arcs in ${r.elapsedMs} ms${r.complete ? '' : ' (incomplete: stopped at a cap or cancelled)'}`];
  lines.push(`Dead markings: ${r.deadMarkings.length}`);
  for (const d of r.deadMarkings) lines.push(`  node ${d.node} after ${d.trace.join(' > ') || '(initial)'}`);
  lines.push(`Dead transitions: ${r.deadTransitions.join(', ') || 'none'}`);
  lines.push('Bounds:');
  for (const [n, b] of Object.entries(r.bounds)) lines.push(`  ${n}: ${b.min}..${b.max}`);
  return lines;
}
