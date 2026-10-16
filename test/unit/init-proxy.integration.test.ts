import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIMULATOR_PORT, isPortListening, killTree, startBackendProcess, waitForPortRelease, type RunningBackend } from '../../src/runtime/backend-core';
import { InitProxy } from '../../src/runtime/init-proxy';

// Two concurrent first inits hang one of them in the real backend (#50); through the proxy they must both finish. Run: CPN_IT=1 npm test
describe.skipIf(!process.env.CPN_IT)('init proxy on the real backend', () => {
  let backend: RunningBackend;
  const proxy = new InitProxy();
  let url: string;

  beforeAll(async () => {
    await waitForPortRelease(SIMULATOR_PORT);
    if (await isPortListening(SIMULATOR_PORT)) throw new Error(`port ${SIMULATOR_PORT} is already in use`);
    const root = path.resolve(__dirname, '../../resources');
    const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cpn-px-'));
    backend = await startBackendProcess({
      javaPath: process.env.JAVA_BIN ?? 'java',
      backendDir: path.join(root, 'backend'),
      userHome,
      tmpDir: path.join(userHome, 'tmp'),
      onOutput: () => {},
    });
    url = await proxy.start(backend.baseUrl);
  }, 120000);

  // Leave the fixed simulator port free for the next real-backend test file.
  afterAll(async () => {
    proxy.stop();
    if (!backend) return;
    killTree(backend.child);
    for (const end = Date.now() + 10000; Date.now() < end && (await isPortListening(SIMULATOR_PORT)); ) {
      await new Promise((r) => setTimeout(r, 200));
    }
    await waitForPortRelease(SIMULATOR_PORT);
  }, 90000);

  it('answers two concurrent inits, three rounds', async () => {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../examples/04-hierarchy.cpn'), 'latin1');
    const init = async (session: string) => {
      const res = await fetch(`${url}/api/v2/cpn/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SessionId': session },
        body: JSON.stringify({ xml, complex_verify: true, need_sim_restart: true }),
        signal: AbortSignal.timeout(30000),
      });
      return { status: res.status, body: (await res.json()) as { success: boolean } };
    };
    for (let round = 0; round < 3; round++) {
      const results = await Promise.all([init(`r${round}-a`), init(`r${round}-b`)]);
      for (const r of results) {
        expect(r.status).toBe(200);
        expect(r.body.success).toBe(true);
      }
    }
  }, 120000);
});
