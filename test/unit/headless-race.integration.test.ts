import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIMULATOR_PORT, isPortListening, startBackendProcess, waitForPortRelease, type RunningBackend } from '../../src/runtime/backend-core';
import { runHeadless } from '../../src/runtime/headless-sim';
import { InitProxy } from '../../src/runtime/init-proxy';
import { postInit, removeTempDirs, stopAndReleasePort, tempDir } from './helpers';

// A headless run while another session keeps creating nets must not hit "Could not parse declaration" (#75). Run: CPN_IT=1 npm test
describe.skipIf(!process.env.CPN_IT)('headless run next to UI inits on the real backend', () => {
  let backend: RunningBackend;
  const proxy = new InitProxy();
  let url: string;

  beforeAll(async () => {
    await waitForPortRelease(SIMULATOR_PORT);
    if (await isPortListening(SIMULATOR_PORT)) throw new Error(`port ${SIMULATOR_PORT} is already in use`);
    const userHome = tempDir('cpn-race-');
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

  it('simulates when the canvas starts validating between the headless init and sim/init', async () => {
    const xml = fs.readFileSync(path.resolve(__dirname, '../../examples/03-mutual-exclusion.cpn'), 'latin1');
    let ui: Promise<Response> | undefined;
    const run = await runHeadless({
      baseUrl: url,
      xml,
      maxSteps: 20,
      sessionId: 'headless',
      fetch: async (u, init) => {
        const res = await fetch(u, init);
        // Right after the headless init answers, the canvas sends its own init (CreateNewNet in another session).
        if (!ui && u.endsWith('/init') && !u.endsWith('/sim/init')) {
          ui = postInit(url, xml, 'ui', 60000);
          await new Promise((r) => setTimeout(r, 100));
        }
        return res;
      },
    });
    expect(run.ok ? 'ok' : JSON.stringify(run.issues)).toBe('ok');
    expect((await ui!).status).toBe(200);
  }, 180000);
});
