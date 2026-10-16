import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { killTree, startBackendProcess } from '../../src/runtime/backend-core';

// Real-backend smoke test; needs resources/ populated and Java 17. Run: CPN_IT=1 npm test
describe.skipIf(!process.env.CPN_IT)('real backend', () => {
  it('starts and initialises a net', async () => {
    const root = path.resolve(__dirname, '../../resources');
    const java = process.env.JAVA_BIN ?? 'java';
    const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cpn-it-'));
    const r = await startBackendProcess({
      javaPath: java,
      backendDir: path.join(root, 'backend'),
      userHome,
      onOutput: () => {},
    });
    try {
      const xml = fs.readFileSync(path.join(root, 'ui/assets/cpn/fuelstation-no-mon.cpn'), 'utf8');
      const res = await fetch(`${r.baseUrl}/api/v2/cpn/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SessionId': 'test' },
        body: JSON.stringify({ xml, complex_verify: true, need_sim_restart: true }),
      });
      const body = (await res.json()) as { success: boolean };
      if (!body.success) console.error(res.status, JSON.stringify(body).slice(0, 2000));
      expect(body.success).toBe(true);
    } finally {
      killTree(r.child);
      await new Promise((res) => setTimeout(res, 1000));
      fs.rmSync(userHome, { recursive: true, force: true });
    }
  });
});
