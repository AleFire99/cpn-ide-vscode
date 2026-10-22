import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import {
  BACKEND_JAR,
  SIMULATOR_PORT,
  findPortOwner,
  findSimulatorPids,
  isForeignSimulator,
  isPortListening,
  shimEnv,
  startBackendProcess,
  stopSimulatorProcess,
  waitForPortRelease,
} from '../../src/runtime/backend-core';
import { postInit, removeTempDirs, tempDir } from './helpers';

/** Local addresses of TCP listeners on `port` from /proc/net/tcp (IPv4, state 0A), e.g. "127.0.0.1". */
function listenAddrs(port: number): string[] {
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
  return fs
    .readFileSync('/proc/net/tcp', 'utf8')
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f[3] === '0A' && f[1]?.endsWith(`:${hexPort}`))
    .map((f) => (f[1].slice(0, 8).match(/../g) ?? []).reverse().map((h) => parseInt(h, 16)).join('.'));
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return cond();
}

// Real-backend test; needs resources/ populated and Java 17. Run: CPN_IT=1 npm test
// The simulator daemon uses the fixed port 20001, so this also needs that port free.
describe.skipIf(!process.env.CPN_IT)('real backend', () => {
  // Temp dirs go once every backend is stopped.
  afterAll(removeTempDirs);

  it('starts, binds the simulator to loopback only, and leaves no processes behind', async () => {
    if (await isPortListening(SIMULATOR_PORT)) {
      throw new Error(`port ${SIMULATOR_PORT} is already in use (another CPN IDE running?); stop it or run in a container`);
    }
    const root = path.resolve(__dirname, '../../resources');
    const java = process.env.JAVA_BIN ?? 'java';
    const userHome = tempDir('cpn-it-');
    const tmpDir = path.join(userHome, 'tmp');
    const r = await startBackendProcess({
      javaPath: java,
      backendDir: path.join(root, 'backend'),
      userHome,
      tmpDir,
      onOutput: (s: string) => { if (process.env.CI) process.stderr.write(s); },
    });
    try {
      const xml = fs.readFileSync(path.join(root, 'ui/assets/cpn/fuelstation-no-mon.cpn'), 'utf8');
      const res = await postInit(r.baseUrl, xml, 'test');
      const body = (await res.json()) as { success: boolean };
      if (!body.success) console.error(res.status, JSON.stringify(body).slice(0, 2000));
      expect(body.success).toBe(true);

      // The simulator daemon is up, runs from our private tmpdir, and is not reachable from the network.
      expect(listenAddrs(SIMULATOR_PORT)).toEqual(['127.0.0.1']);
      expect(findSimulatorPids(tmpDir).length).toBeGreaterThan(0);
    } finally {
      r.stop();
    }

    // Stopping the backend must take the daemon and its workers down with it.
    const gone = await waitFor(() => findSimulatorPids(tmpDir).length === 0 && !listenAddrs(SIMULATOR_PORT).length, 10000);
    const left = findSimulatorPids(tmpDir);
    for (const pid of left) process.kill(pid, 'SIGKILL'); // do not leak on failure
    expect(left).toEqual([]);
    expect(gone).toBe(true);
  });

  it('detects a foreign simulator daemon, stops it, and then initialises a net', async () => {
    if (await isPortListening(SIMULATOR_PORT)) throw new Error(`port ${SIMULATOR_PORT} is already in use`);
    // The previous test's daemon leaves 127.0.0.1:20001 in TIME-WAIT, which makes a new cpnmld fail to bind.
    expect(await waitForPortRelease(SIMULATOR_PORT, 70000)).toBe(true);
    const root = path.resolve(__dirname, '../../resources');
    const userHome = tempDir('cpn-it-');
    const tmpDir = path.join(userHome, 'tmp');
    const foreignDir = tempDir('cpn-foreign-');
    // Extract the simulator from the backend jar's nested engine jar.
    const engine = path.join(foreignDir, 'engine.jar');
    execFileSync('sh', ['-c', `unzip -p "${path.join(root, 'backend', BACKEND_JAR)}" BOOT-INF/lib/org.cpntools.accesscpn.engine_3.0.0.jar > "${engine}"`]);
    execFileSync('unzip', ['-qo', engine, 'cpnmld.x86-linux', 'run.x86-linux', 'cpn.ML.x86-linux', '-d', foreignDir]);
    for (const f of ['cpnmld.x86-linux', 'run.x86-linux']) fs.chmodSync(path.join(foreignDir, f), 0o755);
    const daemon = spawn(path.join(foreignDir, 'cpnmld.x86-linux'), [String(SIMULATOR_PORT), './run.x86-linux'], {
      cwd: foreignDir,
      env: shimEnv(path.join(root, 'backend')),
      stdio: 'ignore',
    });
    let started: Awaited<ReturnType<typeof startBackendProcess>> | undefined;
    try {
      const up = await waitFor(() => !!findPortOwner(SIMULATOR_PORT), 10000);
      if (!up) {
        const log = fs.existsSync(path.join(foreignDir, 'cpnmld.log')) ? fs.readFileSync(path.join(foreignDir, 'cpnmld.log'), 'utf8') : '(no log)';
        throw new Error(`daemon not found: exit=${daemon.exitCode} sig=${daemon.signalCode} uid=${process.getuid?.()} log=${log} tcp=${fs.readFileSync('/proc/net/tcp', 'utf8')}`);
      }
      const owner = findPortOwner(SIMULATOR_PORT)!;
      expect(owner.pid).toBe(daemon.pid);
      expect(isForeignSimulator(owner, tmpDir)).toBe(true);
      expect(isForeignSimulator({ ...owner, cwd: path.join(tmpDir, '1', 'accesscpn', 'simulator') }, tmpDir)).toBe(false);

      await stopSimulatorProcess(owner.pid);
      expect(await waitFor(() => !findPortOwner(SIMULATOR_PORT), 5000)).toBe(true);
      expect(await waitForPortRelease(SIMULATOR_PORT, 70000)).toBe(true);

      started = await startBackendProcess({
        javaPath: process.env.JAVA_BIN ?? 'java',
        backendDir: path.join(root, 'backend'),
        userHome,
        tmpDir,
        onOutput: () => {},
      });
      const xml = fs.readFileSync(path.join(root, 'ui/assets/cpn/fuelstation-no-mon.cpn'), 'utf8');
      const res = await postInit(started.baseUrl, xml, 'test');
      expect(((await res.json()) as { success: boolean }).success).toBe(true);
    } finally {
      if (started) started.stop();
      try { daemon.kill('SIGKILL'); } catch { /* gone */ }
      await waitFor(() => findSimulatorPids(tmpDir).length === 0, 10000);
      for (const pid of findSimulatorPids(tmpDir)) process.kill(pid, 'SIGKILL');
    }
  }, 180000);

  it('survives overlapping first inits and a stop/start cycle (simulator pre-started)', async () => {
    expect(await waitForPortRelease(SIMULATOR_PORT, 70000)).toBe(true);
    if (await isPortListening(SIMULATOR_PORT)) throw new Error(`port ${SIMULATOR_PORT} is already in use`);
    const root = path.resolve(__dirname, '../../resources');
    const userHome = tempDir('cpn-it-');
    const tmpDir = path.join(userHome, 'tmp');
    const xml = fs.readFileSync(path.join(root, 'ui/assets/cpn/fuelstation-no-mon.cpn'), 'utf8');
    const init = async (baseUrl: string, session: string) => {
      const res = await postInit(baseUrl, xml, session);
      return ((await res.json()) as { success: boolean }).success;
    };
    const start = async (log: string[]) =>
      startBackendProcess({
        javaPath: process.env.JAVA_BIN ?? 'java',
        backendDir: path.join(root, 'backend'),
        userHome,
        tmpDir,
        onOutput: (s) => log.push(s),
      });
    const log: string[] = [];
    let r: Awaited<ReturnType<typeof startBackendProcess>> | undefined;
    try {
      r = await start(log);
      expect(log.join('')).toContain('simulator daemon pid');
      // The backend itself hangs on truly simultaneous inits (#50; InitProxy serializes them in the extension),
      // so overlap the requests a few seconds apart here.
      const first = init(r.baseUrl, 'a');
      await new Promise((res) => setTimeout(res, 3000));
      expect(await Promise.all([first, init(r.baseUrl, 'b')])).toEqual([true, true]);
      expect(log.join('')).not.toContain('Error starting simulator');
      r.stop();
      expect(await waitFor(() => !r!.isAlive() && findSimulatorPids(tmpDir).length === 0, 10000)).toBe(true);
      expect(await waitForPortRelease(SIMULATOR_PORT, 70000)).toBe(true);
      r = await start(log);
      expect(await init(r.baseUrl, 'c')).toBe(true);
    } finally {
      if (r) r.stop();
      await waitFor(() => findSimulatorPids(tmpDir).length === 0, 10000);
      for (const pid of findSimulatorPids(tmpDir)) process.kill(pid, 'SIGKILL');
      if (process.env.CI) process.stderr.write(log.join(''));
    }
  }, 240000);
});
