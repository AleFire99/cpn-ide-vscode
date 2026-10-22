import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exploreStateSpace, formatStateSpace, parseReport } from '../../src/runtime/explore-core';
import type { FetchLike } from '../../src/runtime/headless-sim';

interface Rec {
  route: string;
  status: number;
  text: string;
}

// Responses recorded from the real backend (examples 01 and 03) with CPN_RECORD=<file> CPN_IT=1.
const fixture = (name: string): Rec[] => JSON.parse(fs.readFileSync(path.resolve(__dirname, `fixtures/explore-${name}.json`), 'utf8')) as Rec[];

/** Replays the recorded responses in order and checks that the requested routes match the recording. */
function replay(recs: Rec[], tweak?: (r: Rec, i: number) => Rec) {
  const calls: { route: string; headers?: Record<string, string>; body?: string }[] = [];
  const f: FetchLike = async (url, init) => {
    const route = url.replace(/^.*\/api\/v2\/cpn\//, '');
    const i = calls.length;
    calls.push({ route, headers: init?.headers, body: init?.body });
    const rec = recs[i];
    expect(route).toBe(rec.route);
    const r = tweak ? tweak(rec, i) : rec;
    return { status: r.status, text: async () => r.text };
  };
  return { f, calls };
}

const base = { baseUrl: 'http://x', xml: '<workspaceElements/>', sessionId: 's1', userHome: '/home/u' };

describe('exploreStateSpace', () => {
  it('parses a recorded exploration of 03-mutual-exclusion', async () => {
    const { f, calls } = replay(fixture('03-mutual-exclusion'));
    const names = new Map([['ID16', 'P/Idle'], ['ID17', 'P/Lock'], ['ID18', 'P/Critical']]);
    const out = await exploreStateSpace({ ...base, fetch: f, names });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = out.result;
    expect(r.complete).toBe(true);
    expect([r.nodes, r.arcs]).toEqual([3, 4]);
    expect(r.deadMarkings).toEqual([]);
    expect(r.deadTransitions).toEqual([]);
    expect(r.bounds).toEqual({ 'P/Idle': { min: 1, max: 2 }, 'P/Lock': { min: 0, max: 1 }, 'P/Critical': { min: 0, max: 1 } });
    // The simulator is reset and the lock released at the end, with the lock held before.
    expect(calls.at(-2)?.route).toBe('sim/init');
    expect(calls.at(-1)?.route).toBe('');
    expect(calls.at(-1)?.headers?.['X-CPN-Lock']).toBe('release');
    expect(calls[0].headers?.['X-CPN-Lock']).toBe('hold');
    expect(calls.every((c) => c.headers?.['X-SessionId'] === 's1')).toBe(true);
  });

  it('parses dead markings with a trace from a recorded 01-simple-flow run', async () => {
    const { f } = replay(fixture('01-simple-flow'));
    const out = await exploreStateSpace({ ...base, fetch: f });
    expect(out.ok && out.result.deadMarkings).toEqual([
      { node: 4, trace: ['SimpleFlow/Move', 'SimpleFlow/Move', 'SimpleFlow/Move'], marking: { ID14: 'empty', ID15: '3`()' } },
    ]);
    expect(out.ok && out.result.deadTransitions).toEqual([]);
  });

  it('reports validation issues without exploring, and still releases the lock', async () => {
    const { f, calls } = replay([
      { route: 'init', status: 200, text: JSON.stringify({ success: false, issues: { ID1: ['bad'] } }) },
      { route: '', status: 404, text: '' },
    ]);
    const out = await exploreStateSpace({ ...base, fetch: f });
    expect(out).toEqual({ ok: false, issues: { ID1: ['bad'] } });
    expect(calls.map((c) => c.route)).toEqual(['init', '']);
  });

  it('stops slicing on abort, asks for the partial report and resets the simulator', async () => {
    const recs = fixture('03-mutual-exclusion');
    const iSlice = recs.findIndex((r) => r.text.includes('Filename'));
    const ac = new AbortController();
    const partial = recs[iSlice].text.replace('complete 1', 'complete 0');
    const { f, calls } = replay([...recs.slice(0, iSlice), { route: 'sim/script', status: 200, text: partial }, ...recs.slice(iSlice + 1)]);
    const out = await exploreStateSpace({
      ...base,
      fetch: async (u, init) => {
        // Abort as soon as the search is started, before the first slice.
        if (init?.body?.includes('ssStart')) ac.abort();
        return f(u, init);
      },
      signal: ac.signal,
    });
    expect(calls[iSlice].body).toContain('(!ssFin) ()');
    expect(calls.some((c) => c.body?.includes('(!ssSlice)'))).toBe(false);
    expect(out.ok && out.result.complete).toBe(false);
  });

  it('stops at the time cap', async () => {
    const recs = fixture('03-mutual-exclusion');
    const iSlice = recs.findIndex((r) => r.text.includes('Filename'));
    let t = 0;
    const { f, calls } = replay([...recs.slice(0, iSlice), { route: 'sim/script', status: 200, text: recs[iSlice].text }, ...recs.slice(iSlice + 1)]);
    await exploreStateSpace({ ...base, fetch: f, maxMs: 100, now: () => (t += 200) });
    expect(calls[iSlice].body).toContain('(!ssFin) ()');
  });

  it('reports progress between slices until the final report arrives', async () => {
    const recs = fixture('03-mutual-exclusion');
    const iSlice = recs.findIndex((r) => r.text.includes('Filename'));
    const progress = { route: 'sim/script', status: 200, text: JSON.stringify({ extraInfo: '\n\nFilename: x\nnodes 42\n' }) };
    const { f } = replay([...recs.slice(0, iSlice), progress, recs[iSlice], ...recs.slice(iSlice + 1)]);
    const seen: number[] = [];
    const out = await exploreStateSpace({ ...base, fetch: f, onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([42]);
    expect(out.ok && out.result.nodes).toBe(3);
  });

  it('still resets the simulator and releases the lock when a script fails', async () => {
    const recs = fixture('03-mutual-exclusion');
    const { f, calls } = replay(recs.slice(0, 2).concat({ route: 'sim/script', status: 500, text: '{"description":"boom"}' }, recs.slice(-2)));
    await expect(exploreStateSpace({ ...base, fetch: f })).rejects.toThrow(/HTTP 500/);
    expect(calls.map((c) => c.route).slice(-2)).toEqual(['sim/init', '']);
  });
});

describe('parseReport / formatStateSpace', () => {
  it('derives dead transitions and flags incomplete runs', () => {
    const r = parseReport('nodes 5\narcs 4\ncomplete 0\nfired A\'T1\nalltrans A\'T1,A\'T2\nbound p 0 3\nbound q 1000000000 0\ndead 2  # 1`a | empty', ['A/p', 'A/q'], 7);
    expect(r.complete).toBe(false);
    expect(r.deadTransitions).toEqual(['A/T2']);
    expect(r.bounds['A/q']).toEqual({ min: 0, max: 0 });
    expect(r.deadMarkings).toEqual([{ node: 2, trace: [], marking: { 'A/p': '1`a', 'A/q': 'empty' } }]);
    expect(formatStateSpace(r).join('\n')).toContain('incomplete');
  });
});
