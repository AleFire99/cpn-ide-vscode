import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIMULATOR_PORT, isPortListening, startBackendProcess, waitForPortRelease, type RunningBackend } from '../../src/runtime/backend-core';
import { InitProxy } from '../../src/runtime/init-proxy';
import { postInit, removeTempDirs, stopAndReleasePort, tempDir } from './helpers';

// Two concurrent first inits hang one of them in the real backend (#50); through the proxy they must both finish. Run: CPN_IT=1 npm test
describe.skipIf(!process.env.CPN_IT)('init proxy on the real backend', () => {
  let backend: RunningBackend;
  const proxy = new InitProxy();
  let url: string;

  beforeAll(async () => {
    await waitForPortRelease(SIMULATOR_PORT);
    if (await isPortListening(SIMULATOR_PORT)) throw new Error(`port ${SIMULATOR_PORT} is already in use`);
    const root = path.resolve(__dirname, '../../resources');
    const userHome = tempDir('cpn-px-');
    backend = await startBackendProcess({
      javaPath: process.env.JAVA_BIN ?? 'java',
      backendDir: path.join(root, 'backend'),
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

  it('answers two concurrent inits, three rounds', async () => {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../examples/04-hierarchy.cpn'), 'latin1');
    const init = async (session: string) => {
      const res = await postInit(url, xml, session, 30000);
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
