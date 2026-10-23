import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIMULATOR_PORT, isPortListening, startBackendProcess, waitForPortRelease, type RunningBackend } from '../../src/runtime/backend-core';
import { exploreStateSpace, type StateSpaceResult } from '../../src/runtime/explore-core';
import { type FetchLike } from '../../src/runtime/headless-sim';
import { InitProxy } from '../../src/runtime/init-proxy';
import { nodeNames } from '../../src/model/decompile';
import { removeTempDirs, stopAndReleasePort, tempDir } from './helpers';

// State space exploration on the real backend (#106). Run: CPN_IT=1 npm test
describe.skipIf(!process.env.CPN_IT)('state space exploration on the real backend', () => {
  let backend: RunningBackend;
  const proxy = new InitProxy();
  let url: string;
  let userHome: string;
  const doFetch: FetchLike = (u, init) => fetch(u, init);
  // Optional hook for capturing the fixtures of explore-core.test.ts (CPN_RECORD=<file>).
  const recordFile = process.env.CPN_RECORD;
  const recorded: { route: string; body?: string; status: number; text: string }[] = [];
  const recordingFetch: FetchLike = async (u, init) => {
    const res = await fetch(u, init);
    const text = await res.text();
    recorded.push({ route: u.replace(/^.*\/api\/v2\/cpn\//, ''), body: init?.body, status: res.status, text });
    return { status: res.status, text: async () => text };
  };

  beforeAll(async () => {
    await waitForPortRelease(SIMULATOR_PORT);
    if (await isPortListening(SIMULATOR_PORT)) throw new Error(`port ${SIMULATOR_PORT} is already in use`);
    userHome = tempDir('cpn-explore-');
    backend = await startBackendProcess({
      javaPath: process.env.JAVA_BIN ?? 'java',
      backendDir: path.resolve(__dirname, '../../resources/backend'),
      userHome,
      tmpDir: path.join(userHome, 'tmp'),
      onOutput: () => {},
    });
    url = await proxy.start(backend.baseUrl);
  }, 120000);

  afterAll(async () => {
    proxy.stop();
    if (backend) await stopAndReleasePort(backend);
    removeTempDirs();
  }, 90000);

  const explore = async (example: string, maxNodes?: number): Promise<StateSpaceResult> => {
    const xml = fs.readFileSync(path.resolve(__dirname, `../../examples/${example}.cpn`), 'latin1');
    const out = await exploreStateSpace({
      fetch: recordFile ? recordingFetch : doFetch,
      baseUrl: url,
      xml,
      sessionId: 'explore',
      userHome,
      names: nodeNames(xml),
      maxNodes,
    });
    if (!out.ok) throw new Error(JSON.stringify(out.issues));
    if (recordFile) {
      // The model xml is large and not needed for replay.
      const slim = recorded.map((r) => (r.route === 'init' ? { ...r, body: undefined } : r));
      fs.writeFileSync(recordFile.replace('%', example), JSON.stringify(slim, null, 1));
      recorded.length = 0;
    }
    return out.result;
  };

  it('03-mutual-exclusion: complete, no dead marking, mutex bound 1', async () => {
    const r = await explore('03-mutual-exclusion');
    expect(r.complete).toBe(true);
    expect(r.nodes).toBe(3);
    expect(r.arcs).toBe(4);
    expect(r.deadMarkings).toEqual([]);
    expect(r.deadTransitions).toEqual([]);
    const lock = Object.entries(r.bounds).find(([n]) => /lock/i.test(n));
    expect(lock?.[1].max).toBe(1);
  }, 120000);

  it('05-dining-philosophers: reaches a dead marking (everyone holds one fork)', async () => {
    const r = await explore('05-dining-philosophers');
    expect(r.complete).toBe(true);
    expect(r.unbounded).toBeUndefined();
    expect(r.deadMarkings.length).toBeGreaterThan(0);
    expect(r.deadMarkings[0].trace.length).toBeGreaterThan(0);
  }, 120000);

  it('06-unbounded-producer: stops early with an unbounded witness', async () => {
    const r = await explore('06-unbounded-producer', 50);
    expect(r.complete).toBe(false);
    expect(r.unbounded).toBeDefined();
    expect(r.unbounded?.trace.length).toBeGreaterThan(0);
    expect(r.nodes).toBeLessThan(50);
  }, 120000);

  it('01-simple-flow: has a dead marking reached by named transitions', async () => {
    const r = await explore('01-simple-flow');
    expect(r.complete).toBe(true);
    expect(r.deadMarkings).toHaveLength(1);
    expect(r.deadMarkings[0].trace.length).toBeGreaterThan(0);
    expect(r.deadMarkings[0].trace.every((t) => t.includes('/'))).toBe(true);
  }, 120000);

  it('stops early when aborted and reports an incomplete result', async () => {
    const ac = new AbortController();
    ac.abort();
    const xml = fs.readFileSync(path.resolve(__dirname, '../../examples/02-producer-consumer.cpn'), 'latin1');
    const out = await exploreStateSpace({ fetch: doFetch, baseUrl: url, xml, sessionId: 'explore', userHome, signal: ac.signal });
    expect(out.ok && out.result.complete).toBe(false);
  }, 120000);

  it('leaves the simulator usable: sim/init and one step still work afterwards', async () => {
    await explore('03-mutual-exclusion');
    const call = async (route: string, body?: unknown) => {
      const res = await fetch(`${url}/api/v2/cpn/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SessionId': 'explore' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { enableTrans: string[] };
    };
    const s0 = await call('sim/init', {});
    expect(s0.enableTrans.length).toBeGreaterThan(0);
    const s1 = await call('sim/step/multistep');
    expect(s1.enableTrans).toBeDefined();
  }, 120000);
});
