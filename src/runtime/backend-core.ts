// vscode-free backend process logic: preflight, port selection, spawn, readiness polling, kill.
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { portTaken, prestartSimulator, type PrestartedSimulator } from './simulator-prestart';

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

const LINUX_LOADER = '/lib/ld-linux.so.2';

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
  /** Private java.io.tmpdir: Access/CPN unpacks the simulator daemon into <tmpDir>/accesscpn. */
  tmpDir: string;
  port: number;
  onOutput: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export function buildBackendArgs(o: Pick<SpawnOptions, 'userHome' | 'tmpDir' | 'port' | 'backendDir'>): string[] {
  return [
    `-Duser.home=${o.userHome}`,
    `-Djava.io.tmpdir=${o.tmpDir}`, // per-user simulator files instead of the shared /tmp/accesscpn
    `-Dserver.port=${o.port}`,
    '-Dserver.address=127.0.0.1', // never expose the simulator API to the LAN
    `-DPROP_FILE=${path.join(o.backendDir, 'application.properties')}`,
    '-jar',
    BACKEND_JAR,
  ];
}

function spawnBackend(o: SpawnOptions): ChildProcess {
  fs.mkdirSync(o.userHome, { recursive: true });
  fs.mkdirSync(o.tmpDir, { recursive: true });
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
  child.on('exit', (code, signal) => {
    killGroup(child.pid, 'SIGKILL'); // the simulator daemon (cpnmld/run.x86) must not outlive the backend
    o.onExit?.(code, signal);
  });
  return child;
}

/** Signal every process in the backend's own process group (POSIX only). */
function killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined || process.platform === 'win32') return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* group already gone */
  }
}

/** Fixed port hard-coded in Access/CPN's DaemonSimulator. */
export const SIMULATOR_PORT = 20001;

/** True if something accepts TCP connections on 127.0.0.1:port. */
export function isPortListening(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
  });
}

/** Linux: PIDs of processes whose cwd or executable is inside <tmpDir>/accesscpn (simulator daemon and its per-session forks). */
export function findSimulatorPids(tmpDir: string, procRoot = '/proc'): number[] {
  const base = path.join(tmpDir, 'accesscpn') + path.sep;
  const pids: number[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return pids;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    for (const link of ['cwd', 'exe']) {
      try {
        if ((fs.readlinkSync(path.join(procRoot, e, link)) + path.sep).startsWith(base)) {
          pids.push(Number(e));
          break;
        }
      } catch {
        /* process vanished or not ours */
      }
    }
  }
  return pids;
}

/** Kill simulator processes left behind in tmpDir by a backend that was killed hard. Returns the PIDs signalled. */
function reapSimulators(tmpDir: string): number[] {
  const pids = findSimulatorPids(tmpDir);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  return pids;
}

/** Kill the process and its children, synchronously (nothing is left to a timer that an exiting host would never run). */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    killGroup(child.pid, 'SIGKILL');
  }
}

export interface RunningBackend {
  child: ChildProcess;
  baseUrl: string;
  isAlive: () => boolean;
  /** Synchronously kill java, the simulator daemon and every simulator process under tmpDir. Safe to call twice. */
  stop: () => void;
}

/** Spawn the backend and wait until it answers HTTP. Kills it if startup fails. */
export async function startBackendProcess(
  o: Omit<SpawnOptions, 'port' | 'onExit'> & {
    port?: number;
    timeoutMs?: number;
    onExit?: SpawnOptions['onExit'];
    /** Start the simulator daemon ourselves before java (default true; see simulator-prestart.ts). */
    prestartSimulator?: boolean;
  },
): Promise<RunningBackend> {
  const port = o.port || (await pickFreePort());
  let daemon: PrestartedSimulator | undefined;
  if (o.prestartSimulator !== false && (process.platform === 'linux' || process.platform === 'win32')) {
    if (await portTaken(SIMULATOR_PORT)) {
      o.onOutput(`[backend] port ${SIMULATOR_PORT} is in use; not starting a simulator daemon\n`);
    } else {
      try {
        daemon = await prestartSimulator(path.join(o.backendDir, BACKEND_JAR), o.tmpDir, o.onOutput);
      } catch (e) {
        // Fall back to Access/CPN's lazy start.
        o.onOutput(`[backend] simulator pre-start failed: ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }
  }
  let alive = true;
  const stop = () => {
    killTree(child);
    daemon?.kill();
    reapSimulators(o.tmpDir);
  };
  const child = spawnBackend({
    ...o,
    port,
    onExit: (c, s) => {
      alive = false;
      stop();
      o.onExit?.(c, s);
    },
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHttp(`${baseUrl}/`, o.timeoutMs ?? 90000, () => alive);
  } catch (e) {
    stop();
    throw e;
  }
  return { child, baseUrl, isAlive: () => alive, stop };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * tmpRoot holds one directory per extension host, named by its PID. Kill simulator
 * processes and delete the directory of every owner that is no longer running
 * (host crashed or was SIGKILLed). Returns the PIDs signalled.
 */
export function reapStaleSimulators(tmpRoot: string, isAlive: (pid: number) => boolean = pidAlive): number[] {
  const reaped: number[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(tmpRoot);
  } catch {
    return reaped;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e) || isAlive(Number(e))) continue;
    const dir = path.join(tmpRoot, e);
    reaped.push(...reapSimulators(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return reaped;
}

// ---- Port ownership (Linux, via /proc) ----

export interface PortOwner {
  pid: number;
  cmdline: string;
  cwd: string;
  uid: number;
}

const TCP_LISTEN = '0A';
// FIN_WAIT1, FIN_WAIT2, TIME_WAIT, CLOSE, CLOSE_WAIT, LAST_ACK, CLOSING: sockets of a gone daemon that still block a new bind().
const TCP_CLOSING = new Set(['04', '05', '06', '07', '08', '09', '0B']);

interface TcpRow {
  state: string;
  inode: string;
}

/** Parse /proc/net/tcp[6] text: rows whose local port is `port`. */
export function parseProcNetTcp(text: string, port: number): TcpRow[] {
  const hexPort = port.toString(16).toUpperCase().padStart(4, '0');
  const rows: TcpRow[] = [];
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || !f[1].toUpperCase().endsWith(`:${hexPort}`)) continue;
    rows.push({ state: f[3].toUpperCase(), inode: f[9] });
  }
  return rows;
}

function readTcpRows(port: number, procRoot: string): TcpRow[] {
  const rows: TcpRow[] = [];
  for (const f of ['tcp', 'tcp6']) {
    try {
      rows.push(...parseProcNetTcp(fs.readFileSync(path.join(procRoot, 'net', f), 'utf8'), port));
    } catch {
      /* not available */
    }
  }
  return rows;
}

/** Linux: the process (of this user) holding a LISTEN socket on `port`, or undefined. */
export function findPortOwner(port: number, procRoot = '/proc'): PortOwner | undefined {
  const inodes = new Set(readTcpRows(port, procRoot).filter((r) => r.state === TCP_LISTEN && r.inode !== '0').map((r) => r.inode));
  if (!inodes.size) return undefined;
  let entries: string[];
  try {
    entries = fs.readdirSync(procRoot);
  } catch {
    return undefined;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    const dir = path.join(procRoot, e);
    try {
      const hit = fs.readdirSync(path.join(dir, 'fd')).some((fd) => {
        const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(path.join(dir, 'fd', fd)));
        return !!m && inodes.has(m[1]);
      });
      if (!hit) continue;
      const cmdline = fs.readFileSync(path.join(dir, 'cmdline'), 'utf8').split('\0').filter(Boolean).join(' ');
      const cwd = fs.readlinkSync(path.join(dir, 'cwd'));
      const uidM = /^Uid:\s+(\d+)/m.exec(fs.readFileSync(path.join(dir, 'status'), 'utf8'));
      return { pid: Number(e), cmdline, cwd, uid: uidM ? Number(uidM[1]) : -1 };
    } catch {
      /* other user's process or vanished */
    }
  }
  return undefined;
}

/** A cpnmld of the current user that does not belong to our private tmp root (e.g. the standalone CPN IDE's). */
export function isForeignSimulator(owner: PortOwner, ourTmpRoot: string, uid = process.getuid?.() ?? -1): boolean {
  if (!/cpnmld/.test(owner.cmdline) || owner.uid !== uid) return false;
  const root = path.resolve(ourTmpRoot) + path.sep;
  return !(path.resolve(owner.cwd) + path.sep).startsWith(root);
}

/** True if the port only has closing sockets left (TIME-WAIT, FIN-WAIT, ...): no listener, no live connection. */
export function onlyClosing(port: number, procRoot = '/proc'): boolean {
  const rows = readTcpRows(port, procRoot);
  return rows.length > 0 && rows.every((r) => TCP_CLOSING.has(r.state));
}

/** Descendant PIDs (recursive) of a process, from the ppid field of /proc/<pid>/stat. */
export function descendantPids(root: number, procRoot = '/proc'): number[] {
  const parent = new Map<number, number>();
  try {
    for (const e of fs.readdirSync(procRoot)) {
      if (!/^\d+$/.test(e)) continue;
      try {
        const s = fs.readFileSync(path.join(procRoot, e, 'stat'), 'utf8');
        parent.set(Number(e), Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]));
      } catch {
        /* vanished */
      }
    }
  } catch {
    return [];
  }
  const out: number[] = [];
  const queue = [root];
  while (queue.length) {
    const p = queue.shift()!;
    for (const [pid, ppid] of parent) {
      if (ppid === p && !out.includes(pid)) {
        out.push(pid);
        queue.push(pid);
      }
    }
  }
  return out;
}

/** SIGTERM a simulator daemon and its run.x86 children, SIGKILL whatever is left after graceMs. */
export async function stopSimulatorProcess(pid: number, graceMs = 3000): Promise<void> {
  const all = [pid, ...descendantPids(pid)];
  const send = (sig: NodeJS.Signals) => {
    for (const p of all) {
      try {
        process.kill(p, sig);
      } catch {
        /* gone */
      }
    }
  };
  send('SIGTERM');
  for (const end = Date.now() + graceMs; Date.now() < end; ) {
    if (!all.some((p) => pidAlive(p))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  send('SIGKILL');
  await new Promise((r) => setTimeout(r, 200));
}

/** Resolve true once the port has no closing sockets left, false after timeoutMs. */
export async function waitForPortRelease(port: number, timeoutMs = 70000, procRoot = '/proc'): Promise<boolean> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; ) {
    if (!onlyClosing(port, procRoot)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return !onlyClosing(port, procRoot);
}
