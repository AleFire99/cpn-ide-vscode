import { describe, expect, it } from 'vitest';
import { formatResult, runHeadless, type FetchLike } from '../../src/runtime/headless-sim';

function fakeFetch(opts: { issues?: Record<string, unknown>; enabledSteps: number }) {
  const calls: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = [];
  let left = opts.enabledSteps;
  const state = () => ({ enableTrans: left > 0 ? ['t1'] : [], tokensAndMark: [{ id: 'p1', marking: `${left}\`()` }] });
  const f: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const json = (v: unknown) => ({ status: 200, text: async () => JSON.stringify(v) });
    if (url.endsWith('/sim/init')) return json(state());
    if (url.endsWith('/init')) return json(opts.issues ? { success: false, issues: opts.issues } : { success: true, issues: {} });
    if (url.endsWith('/sim/step/multistep')) {
      left--;
      return json(state());
    }
    return { status: 404, text: async () => 'nope' };
  };
  return { f, calls };
}

const base = { baseUrl: 'http://h:1', xml: '<x/>', sessionId: 's1' };

describe('runHeadless', () => {
  it('steps until nothing is enabled', async () => {
    const { f, calls } = fakeFetch({ enabledSteps: 3 });
    const r = await runHeadless({ ...base, fetch: f, maxSteps: 100 });
    expect(r).toMatchObject({ ok: true, steps: 3 });
    expect(calls.map((c) => c.url.replace('http://h:1/api/v2/cpn/', ''))).toEqual([
      'init',
      'sim/init',
      'sim/step/multistep',
      'sim/step/multistep',
      'sim/step/multistep',
    ]);
    expect(calls[0].headers?.['X-SessionId']).toBe('s1');
    expect(JSON.parse(calls[0].body!)).toEqual({ xml: '<x/>', complex_verify: true, need_sim_restart: true });
    expect(calls[2].method).toBe('GET');
  });

  it('stops at maxSteps', async () => {
    const { f } = fakeFetch({ enabledSteps: 50 });
    const r = await runHeadless({ ...base, fetch: f, maxSteps: 5 });
    expect(r).toMatchObject({ ok: true, steps: 5 });
  });

  it('reports validation issues and does not simulate', async () => {
    const { f, calls } = fakeFetch({ issues: { p1: ['bad'] }, enabledSteps: 3 });
    const r = await runHeadless({ ...base, fetch: f, maxSteps: 5 });
    expect(r).toEqual({ ok: false, issues: { p1: ['bad'] } });
    expect(calls).toHaveLength(1);
    expect(formatResult(r).join('\n')).toContain('p1');
  });

  it('throws on HTTP errors', async () => {
    const f: FetchLike = async () => ({ status: 500, text: async () => 'boom' });
    await expect(runHeadless({ ...base, fetch: f, maxSteps: 1 })).rejects.toThrow(/HTTP 500 boom/);
  });

  it('formats steps, time and final markings', async () => {
    const { f } = fakeFetch({ enabledSteps: 1 });
    let t = 0;
    const r = await runHeadless({ ...base, fetch: f, maxSteps: 9, now: () => (t += 7) });
    const out = formatResult(r).join('\n');
    expect(out).toContain('1 step(s) in 7 ms');
    expect(out).toContain('p1: 0`()');
  });
});
