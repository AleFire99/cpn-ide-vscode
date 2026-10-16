import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SIMULATOR_PORT,
  isPortListening,
  killTree,
  startBackendProcess,
  waitForPortRelease,
  type RunningBackend,
} from '../../src/runtime/backend-core';

interface SimState {
  enableTrans: string[];
  tokensAndMark: { id: string; tokens: number; marking: string }[];
}

const examples = path.resolve(__dirname, '../../examples');

// Validates and simulates every model in examples/ on the real backend. Run: CPN_IT=1 npm test
describe.skipIf(!process.env.CPN_IT)('examples', () => {
  let backend: RunningBackend;

  beforeAll(async () => {
    await waitForPortRelease(SIMULATOR_PORT);
    if (await isPortListening(SIMULATOR_PORT)) throw new Error(`port ${SIMULATOR_PORT} is already in use`);
    const root = path.resolve(__dirname, '../../resources');
    const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cpn-ex-'));
    backend = await startBackendProcess({
      javaPath: process.env.JAVA_BIN ?? 'java',
      backendDir: path.join(root, 'backend'),
      userHome,
      tmpDir: path.join(userHome, 'tmp'),
      onOutput: () => {},
    });
  }, 120000);

  // Leave the fixed simulator port free for the next real-backend test file.
  afterAll(async () => {
    if (!backend) return;
    killTree(backend.child);
    for (const end = Date.now() + 10000; Date.now() < end && (await isPortListening(SIMULATOR_PORT)); ) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await waitForPortRelease(SIMULATOR_PORT);
  }, 90000);

  const api = async <T>(session: string, route: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${backend.baseUrl}/api/v2/cpn/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SessionId': session },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(res.status, `${route}: ${await res.clone().text()}`).toBe(200);
    return (await res.json()) as T;
  };

  /** Validate, initialise and step until nothing is enabled (or maxSteps). Returns steps taken and every state seen. */
  async function run(file: string, maxSteps: number) {
    const session = `ex-${file}`;
    const xml = fs.readFileSync(path.join(examples, file), 'latin1');
    const check = await api<{ success: boolean; issues: Record<string, unknown> }>(session, 'init', {
      xml,
      complex_verify: true,
      need_sim_restart: true,
    });
    expect(check.issues, `${file} has validation issues`).toEqual({});
    expect(check.success).toBe(true);
    const states = [await api<SimState>(session, 'sim/init', {})];
    let steps = 0;
    while (steps < maxSteps && states[states.length - 1].enableTrans.length > 0) {
      states.push(await api<SimState>(session, 'sim/step/multistep'));
      steps++;
    }
    const marks = (s: SimState) => s.tokensAndMark.map((t) => t.marking.replace(/\s+/g, ''));
    return { steps, states, final: marks(states[states.length - 1]), marks };
  }

  it('01-simple-flow: moves 3 tokens from Start to Done, then stops', async () => {
    const r = await run('01-simple-flow.cpn', 10);
    expect(r.steps).toBe(3);
    expect(r.final).toEqual(['empty', '3`()']);
  }, 120000);

  it('02-producer-consumer: produces and consumes items 1..5, then stops', async () => {
    const r = await run('02-producer-consumer.cpn', 30);
    expect(r.steps).toBe(10);
    expect(r.final).toEqual(['1`6', 'empty', '1`1++1`2++1`3++1`4++1`5']);
  }, 120000);

  it('03-mutual-exclusion: never has two processes in Critical', async () => {
    const r = await run('03-mutual-exclusion.cpn', 20);
    expect(r.steps).toBe(20); // never deadlocks
    for (const s of r.states) {
      const critical = s.tokensAndMark[2];
      expect(critical.tokens).toBeLessThanOrEqual(1);
      const lock = s.tokensAndMark[1];
      expect(lock.tokens + critical.tokens).toBe(1); // the lock is either free or held by the process in Critical
    }
  }, 120000);
});
