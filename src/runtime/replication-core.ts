/**
 * Replications and play-out (event log export) on the backend without the UI. No `vscode` import so it is unit-testable
 * with a fake fetch. Request and response bodies were taken from the bundled UI (doReplication, gettingProgress, runPlayOut).
 */

import type { FetchLike } from './headless-sim';

export type { FetchLike };

/** The backend answers with empty `extraInfo`/`files`; the reports are text files on its disk (see latestReportDir). */
export interface ReplicationResp {
  extraInfo?: string;
}

export type ReplicationResult = { ok: false; issues: Record<string, unknown> } | { ok: true; extraInfo: string };

/** Newest `reps_<k>` folder name (highest k) among directory entries, if any. */
export function latestReportDir(entries: readonly string[]): string | undefined {
  const ks = entries.map((e) => /^reps_(\d+)$/.exec(e)).filter((m): m is RegExpExecArray => !!m);
  ks.sort((a, b) => Number(b[1]) - Number(a[1]));
  return ks[0]?.[0];
}

export interface SessionOptions {
  fetch: FetchLike;
  baseUrl: string;
  xml: string;
  sessionId: string;
}

export interface ReplicationOptions extends SessionOptions {
  repeat: number;
  /** Called with the progress as a fraction 0..1. */
  onProgress?: (fraction: number) => void;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type PlayOutExport = 'csv' | 'xes';

export interface PlayOutOptions extends SessionOptions {
  /** Steps simulated while the events are recorded. */
  maxSteps: number;
  caseId: string;
  /** ISO local date-time, e.g. `2022-01-01T00:00`. */
  startDateTime: string;
  timeUnit: 'years' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds';
  recordedEvents: 'start' | 'complete' | 'start+complete' | 'in transition name';
  informationLevelIsEvent: boolean;
  exportType: PlayOutExport;
  /** Path of the model file: the backend writes to `dirname(path)/play_out/<fileName>.<ext>`. */
  path: string;
  /** Without extension. */
  fileName: string;
}

export interface PlayOutResp {
  absoluteFileName: string;
  nofPlayOutEvents: number;
  nofLogEvents: number;
}

export type PlayOutResult = { ok: false; issues: Record<string, unknown> } | ({ ok: true } & PlayOutResp);

type Api = <T>(route: string, body?: unknown, lock?: 'hold' | 'release') => Promise<T>;

/** Same session/lock handling as runHeadless: the init lock is held until `release`. */
function makeApi(o: SessionOptions): Api {
  return async <T>(route: string, body?: unknown, lock: 'hold' | 'release' = 'hold'): Promise<T> => {
    const res = await o.fetch(`${o.baseUrl}/api/v2/cpn/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SessionId': o.sessionId, 'X-CPN-Lock': lock },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`${route}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  };
}

/** Validate and initialise; returns the issues if the model is invalid. */
async function prepare(api: Api, xml: string): Promise<Record<string, unknown> | undefined> {
  const check = await api<{ success: boolean; issues?: Record<string, unknown> }>('init', { xml, complex_verify: true, need_sim_restart: true });
  const issues = check.issues ?? {};
  if (!check.success || Object.keys(issues).length > 0) return issues;
  await api('sim/init', {});
  return undefined;
}

/** The backend reports a 0-100 percentage as text, e.g. "100.0"; values up to 1 are taken as fractions. */
export function progressFraction(progress: string | number | undefined): number {
  const n = typeof progress === 'number' ? progress : parseFloat(progress ?? '');
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? Math.min(n / 100, 1) : n;
}

export async function runReplications(o: ReplicationOptions): Promise<ReplicationResult> {
  const api = makeApi(o);
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    const issues = await prepare(api, o.xml);
    if (issues) return { ok: false, issues };
    const body = { repeat: String(o.repeat) };
    let done = false;
    // Poll like the UI does: the same body, every pollMs, while the long replication request is open.
    const poll = (async () => {
      while (!done) {
        await sleep(o.pollMs ?? 2000);
        if (done) break;
        try {
          const p = await api<{ progress?: string }>('sim/replication_progress', body);
          o.onProgress?.(progressFraction(p.progress));
        } catch {
          // progress is best effort
        }
      }
    })();
    let resp: ReplicationResp;
    try {
      resp = await api<ReplicationResp>('sim/replication', body);
    } finally {
      done = true;
      await poll;
    }
    o.onProgress?.(1);
    return { ok: true, extraInfo: resp.extraInfo ?? '' };
  } finally {
    await api('', undefined, 'release').catch(() => undefined);
  }
}

/** Record events while simulating up to `maxSteps`, then have the backend write the log (CSV or XES). */
export async function exportEventLog(o: PlayOutOptions): Promise<PlayOutResult> {
  const api = makeApi(o);
  try {
    const issues = await prepare(api, o.xml);
    if (issues) return { ok: false, issues };
    await api('play_out/clear');
    await api('play_out/events/true');
    await api('play_out/times/true');
    let state = await api<{ enableTrans: string[] }>('sim/init', {});
    for (let i = 0; i < o.maxSteps && state.enableTrans.length > 0; i++) state = await api<{ enableTrans: string[] }>('sim/step/multistep');
    const resp = await api<PlayOutResp>('play_out/apply', {
      caseId: o.caseId,
      startDateTime: o.startDateTime,
      timeUnit: o.timeUnit,
      recordedEvents: o.recordedEvents,
      informationLevelIsEvent: o.informationLevelIsEvent,
      exportType: o.exportType,
      path: o.path,
      fileName: o.fileName,
    });
    await api('play_out/events/false').catch(() => undefined);
    return { ok: true, ...resp };
  } finally {
    await api('', undefined, 'release').catch(() => undefined);
  }
}
