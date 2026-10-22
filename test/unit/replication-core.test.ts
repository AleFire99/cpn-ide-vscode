import { describe, expect, it } from 'vitest';
import { exportEventLog, latestReportDir, progressFraction, runReplications, type FetchLike } from '../../src/runtime/replication-core';

function fakeFetch(opts: { issues?: Record<string, unknown>; steps?: number } = {}) {
  const calls: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = [];
  let left = opts.steps ?? 2;
  const f: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const json = (v: unknown) => ({ status: 200, text: async () => JSON.stringify(v) });
    if (url.endsWith('/sim/init')) return json({ enableTrans: left > 0 ? ['t'] : [] });
    if (url.endsWith('/init')) return json(opts.issues ? { success: false, issues: opts.issues } : { success: true, issues: {} });
    if (url.endsWith('/sim/step/multistep')) return json({ enableTrans: --left > 0 ? ['t'] : [] });
    if (url.endsWith('/sim/replication_progress')) return json({ progress: '100.0' });
    if (url.endsWith('/sim/replication')) return json({ extraInfo: '', files: [] });
    if (url.endsWith('/play_out/apply')) return json({ absoluteFileName: '/m/play_out/log.xes', nofPlayOutEvents: 4, nofLogEvents: 4 });
    if (url.includes('/play_out/')) return json({});
    if (url.endsWith('/cpn/')) return json({});
    return { status: 404, text: async () => 'nope' };
  };
  return { f, calls };
}

const base = { baseUrl: 'http://h:1', xml: '<x/>', sessionId: 's1' };

describe('runReplications', () => {
  it('inits, replicates with a string repeat, polls progress and releases the lock', async () => {
    const { f, calls } = fakeFetch();
    const seen: number[] = [];
    const r = await runReplications({ ...base, fetch: f, repeat: 30, onProgress: (p) => seen.push(p), sleep: async () => undefined, pollMs: 1 });
    expect(r).toEqual({ ok: true, extraInfo: '' });
    const rep = calls.find((c) => c.url.endsWith('/sim/replication'));
    expect(JSON.parse(rep?.body ?? '')).toEqual({ repeat: '30' });
    expect(rep?.headers?.['X-SessionId']).toBe('s1');
    expect(calls.map((c) => c.url.split('/cpn/')[1]).slice(0, 3)).toEqual(['init', 'sim/init', 'sim/replication']);
    expect(calls.at(-1)?.headers?.['X-CPN-Lock']).toBe('release');
    expect(seen.at(-1)).toBe(1);
  });

  it('stops on validation issues', async () => {
    const { f, calls } = fakeFetch({ issues: { p1: ['bad'] } });
    const r = await runReplications({ ...base, fetch: f, repeat: 5 });
    expect(r).toEqual({ ok: false, issues: { p1: ['bad'] } });
    expect(calls.some((c) => c.url.endsWith('/sim/replication'))).toBe(false);
    expect(calls.at(-1)?.headers?.['X-CPN-Lock']).toBe('release');
  });
});

describe('progressFraction', () => {
  it('reads percentages and fractions', () => {
    expect(progressFraction('37.50')).toBeCloseTo(0.375);
    expect(progressFraction('0.4')).toBeCloseTo(0.4);
    expect(progressFraction('100.0')).toBe(1);
    expect(progressFraction('x')).toBe(0);
    expect(progressFraction('250')).toBe(1);
  });
});

describe('latestReportDir', () => {
  it('picks the highest reps_k numerically', () => {
    expect(latestReportDir(['reps_2', 'reps_10', 'other', 'reps_x'])).toBe('reps_10');
    expect(latestReportDir(['a'])).toBeUndefined();
  });
});

describe('exportEventLog', () => {
  const cfg = {
    ...base,
    maxSteps: 10,
    caseId: 'i',
    startDateTime: '2022-01-01T00:00',
    timeUnit: 'hours' as const,
    recordedEvents: 'start+complete' as const,
    informationLevelIsEvent: true,
    exportType: 'xes' as const,
    path: '/m/net.cpn',
    fileName: 'log',
  };
  it('records events, simulates, then applies the export', async () => {
    const { f, calls } = fakeFetch({ steps: 2 });
    const r = await exportEventLog({ ...cfg, fetch: f });
    expect(r).toEqual({ ok: true, absoluteFileName: '/m/play_out/log.xes', nofPlayOutEvents: 4, nofLogEvents: 4 });
    const routes = calls.map((c) => c.url.split('/cpn/')[1]);
    expect(routes).toEqual(['init', 'sim/init', 'play_out/clear', 'play_out/events/true', 'play_out/times/true', 'sim/init', 'sim/step/multistep', 'sim/step/multistep', 'play_out/apply', 'play_out/events/false', '']);
    expect(JSON.parse(calls.find((c) => c.url.endsWith('apply'))?.body ?? '')).toEqual({
      caseId: 'i',
      startDateTime: '2022-01-01T00:00',
      timeUnit: 'hours',
      recordedEvents: 'start+complete',
      informationLevelIsEvent: true,
      exportType: 'xes',
      path: '/m/net.cpn',
      fileName: 'log',
    });
  });
  it('reports validation issues', async () => {
    const { f } = fakeFetch({ issues: { a: 1 } });
    expect(await exportEventLog({ ...cfg, fetch: f })).toEqual({ ok: false, issues: { a: 1 } });
  });
});
