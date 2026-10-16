// vscode-free backend process logic: preflight, port selection, spawn, readiness polling, kill.
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';

export const BACKEND_JAR = 'cpn-ide-back-1.28-SNAPSHOT.jar';

export async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('Could not determine a free port'))));
    });
  });
}

export const LINUX_LOADER = '/lib/ld-linux.so.2';

/** Returns an error message if the local backend cannot run on this platform, else undefined. */
export function preflightError(platform: string, loaderExists: boolean): string | undefined {
  if (platform === 'darwin') {
    return (
      'The bundled CPN simulator is a 32-bit Linux/Windows binary and does not run on macOS. ' +
      'Run the backend in Docker (ghcr.io/alefire99/cpn-ide-backend) and set "cpnIde.backendUrl" to its URL, e.g. http://localhost:8080.'
    );
  }
  if (platform === 'linux' && !loaderExists) {
    return (
      'The CPN simulator needs 32-bit glibc (/lib/ld-linux.so.2), which is missing. Install it:\n' +
      '  Debian/Ubuntu: sudo dpkg --add-architecture i386 && sudo apt update && sudo apt install libc6:i386\n' +
      '  Fedora: sudo dnf install glibc.i686\n' +
      '  Arch: sudo pacman -S lib32-glibc\n' +
      'Alternatively set "cpnIde.backendUrl" to a Docker backend (ghcr.io/alefire99/cpn-ide-backend).'
    );
  }
  return undefined;
}

export function preflight(platform: string): string | undefined {
  return preflightError(platform, platform !== 'linux' || fs.existsSync(LINUX_LOADER));
}

/** Resolve once any HTTP response arrives from url; reject on timeout or if isAlive() turns false. */
export async function waitForHttp(
  url: string,
  timeoutMs: number,
  isAlive: () => boolean = () => true,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error('Backend process exited before becoming ready');
    if (await probeHttp(url)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Backend did not respond at ${url} within ${Math.round(timeoutMs / 1000)}s`);
}

/** True if the URL answers with any HTTP status. */
export function probeHttp(url: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

export interface SpawnOptions {
  javaPath: string;
  backendDir: string;
  userHome: string;
  port: number;
  onOutput: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export function buildBackendArgs(o: Pick<SpawnOptions, 'userHome' | 'port' | 'backendDir'>): string[] {
  return [
    `-Duser.home=${o.userHome}`,
    `-Dserver.port=${o.port}`,
    '-Dserver.address=127.0.0.1', // never expose the simulator API to the LAN
    `-DPROP_FILE=${path.join(o.backendDir, 'application.properties')}`,
    '-jar',
    BACKEND_JAR,
  ];
}

export function spawnBackend(o: SpawnOptions): ChildProcess {
  fs.mkdirSync(o.userHome, { recursive: true });
  const args = buildBackendArgs(o);
  const child = spawn(o.javaPath, args, {
    cwd: o.backendDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', // own process group so we can kill the tree
  });
  child.stdout?.on('data', (d: Buffer) => o.onOutput(d.toString()));
  child.stderr?.on('data', (d: Buffer) => o.onOutput(d.toString()));
  child.on('error', (e) => o.onOutput(`Failed to start backend: ${e.message}\n`));
  child.on('exit', (code, signal) => o.onExit?.(code, signal));
  return child;
}

/** Kill the process and its children. */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    const pid = child.pid;
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, 3000).unref();
  }
}

export interface RunningBackend {
  child: ChildProcess;
  baseUrl: string;
  isAlive: () => boolean;
}

/** Spawn the backend and wait until it answers HTTP. Kills it if startup fails. */
export async function startBackendProcess(
  o: Omit<SpawnOptions, 'port' | 'onExit'> & { port?: number; timeoutMs?: number; onExit?: SpawnOptions['onExit'] },
): Promise<RunningBackend> {
  const port = o.port || (await pickFreePort());
  let alive = true;
  const child = spawnBackend({
    ...o,
    port,
    onExit: (c, s) => {
      alive = false;
      o.onExit?.(c, s);
    },
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${baseUrl}/`, o.timeoutMs ?? 90000, () => alive);
  } catch (e) {
    killTree(child);
    throw e;
  }
  return { child, baseUrl, isAlive: () => alive };
}
