// Shared test helpers: temp dirs that are removed after the run, and the real-backend `init` call.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SIMULATOR_PORT, isPortListening, waitForPortRelease, type RunningBackend } from '../../src/runtime/backend-core';

const tempDirs: string[] = [];

/** A new temp dir, removed by `removeTempDirs()` (call it from afterAll / afterEach). */
export function tempDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

export function removeTempDirs(): void {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** POST /api/v2/cpn/init with the options the UI uses. */
export function postInit(baseUrl: string, xml: string, session: string, timeoutMs = 60000): Promise<Response> {
  return fetch(`${baseUrl}/api/v2/cpn/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SessionId': session },
    body: JSON.stringify({ xml, complex_verify: true, need_sim_restart: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Stop a backend and wait until the fixed simulator port is free for the next real-backend test file. */
export async function stopAndReleasePort(backend: RunningBackend): Promise<void> {
  backend.stop();
  for (const end = Date.now() + 10000; Date.now() < end && (await isPortListening(SIMULATOR_PORT)); ) {
    await new Promise((r) => setTimeout(r, 200));
  }
  await waitForPortRelease(SIMULATOR_PORT);
}
