import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { nodeNames } from '../../src/model/decompile';
import { formatResult, runHeadless, stripAnsi, type FetchLike, type SimResult } from '../../src/runtime/headless-sim';

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
      '',
    ]);
    expect(calls[0].headers?.['X-SessionId']).toBe('s1');
    // The proxy lock is held from init to the last step, then released.
    expect(calls.map((c) => c.headers?.['X-CPN-Lock'])).toEqual(['hold', 'hold', 'hold', 'hold', 'hold', 'release']);
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
    expect(calls).toHaveLength(2); // init + the lock release, no sim/init
    expect(calls[1].headers?.['X-CPN-Lock']).toBe('release');
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
    expect(out).toContain('p1  0`()');
  });
});

describe('formatResult names', () => {
  const r: SimResult = {
    ok: true,
    steps: 2,
    elapsedMs: 5,
    final: { enableTrans: ['ID9'], tokensAndMark: [{ id: 'ID1', marking: '1`1++\n1`2' }, { id: 'ID22', marking: '' }, { id: 'X', marking: 'empty' }] },
  };

  it('prints places by name, aligned, and lists enabled transitions', () => {
    const names = new Map([['ID1', 'Main/Idle'], ['ID22', 'Main/Critical'], ['ID9', 'Main/Enter']]);
    expect(formatResult(r, names)).toEqual([
      'Simulated 2 step(s) in 5 ms',
      'Final marking:',
      '  Main/Idle      1`1++ 1`2',
      '  Main/Critical  empty',
      '  X              empty',
      'Still enabled: Main/Enter',
    ]);
  });

  it('names validation issues', () => {
    expect(formatResult({ ok: false, issues: { ID1: ['bad'] } }, new Map([['ID1', 'P/A']]))).toEqual(['Validation failed:', '  P/A: ["bad"]']);
  });
});

describe('nodeNames', () => {
  it('maps place and transition ids of a model to Page/Name', () => {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../examples/02-producer-consumer.cpn'), 'utf8');
    const names = nodeNames(xml);
    expect(names.get('ID16')).toBe('ProducerConsumer/Next');
    expect([...names.values()]).toEqual(expect.arrayContaining(['ProducerConsumer/Buffer', 'ProducerConsumer/Produce', 'ProducerConsumer/Consume']));
  });

  it('is empty for text that is not a model', () => {
    expect(nodeNames('not xml').size).toBe(0);
    expect(nodeNames('<a/>').size).toBe(0);
  });
});

describe('stripAnsi', () => {
  it('removes colour codes', () => {
    expect(stripAnsi('17:15 \u001b[35m[qtp-29]\u001b[0;39m \u001b[39mDEBUG\u001b[0;39m c.i.c.X - ok')).toBe('17:15 [qtp-29] DEBUG c.i.c.X - ok');
    expect(stripAnsi('plain')).toBe('plain');
  });
});
