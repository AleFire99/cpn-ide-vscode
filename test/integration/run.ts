import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // On headless Linux, re-run ourselves under xvfb-run when it is available.
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.CPN_UNDER_XVFB) {
    const r = spawnSync('xvfb-run', ['-a', process.execPath, __filename], {
      stdio: 'inherit',
      env: { ...process.env, CPN_UNDER_XVFB: '1' },
    });
    process.exit(r.status ?? 1);
  }

  delete process.env.ELECTRON_RUN_AS_NODE;
  const root = path.resolve(__dirname, '../../..');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cpn-it-'));
  // Work on a copy so saves never touch the committed fixture.
  fs.copyFileSync(path.join(root, 'test/fixtures/sample.cpn'), path.join(work, 'sample.cpn'));
  for (const f of ['04-hierarchy.petri.json', '04-hierarchy.sml', '05-dining-philosophers.petri.json', '05-dining-philosophers.sml']) fs.copyFileSync(path.join(root, 'examples', f), path.join(work, f));
  try {
    await runTests({
      // Offline runs (e.g. inside `unshare -rn`) can point at an already downloaded VS Code.
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'suite/index'),
      extensionTestsEnv: { CPN_TEST_FILE: path.join(work, 'sample.cpn'), CPN_IT: process.env.CPN_IT },
      launchArgs: [work, '--disable-extensions', '--user-data-dir', path.join(work, 'user-data'), '--no-sandbox'],
    });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
