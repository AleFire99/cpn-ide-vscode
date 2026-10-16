// vscode-free: pre-start the CPN simulator daemon (cpnmld) ourselves.
//
// Access/CPN's DaemonStarter starts cpnmld lazily on the first request and connects after a fixed 1 s
// sleep. If the daemon is not listening yet, the start fails, the daemon is destroyed mid-handshake and
// an orphan cpnmld child is left that blocks every later /cpn/init forever. With the daemon already
// listening, Java's first connect succeeds and that start/destroy path never runs. DaemonStarter only
// copies the simulator files when they are missing, so we extract them to <tmpDir>/accesscpn/simulator.
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { SIMULATOR_PORT, findPortOwner } from './backend-core';

const ENGINE_ENTRY = 'BOOT-INF/lib/org.cpntools.accesscpn.engine_3.0.0.jar';

interface ZipEntry {
  method: number;
  csize: number;
  usize: number;
  headerOffset: number;
}

/** Minimal zip reader over a byte range of a file (enough for jars; no zip64, no encryption). */
class ZipView {
  readonly entries = new Map<string, ZipEntry>();

  constructor(
    private readonly fd: number,
    private readonly base: number,
    size: number,
  ) {
    const tailLen = Math.min(size, 65557);
    const tail = this.read(size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('not a zip file');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = this.read(cdOffset, cdSize);
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      this.entries.set(cd.toString('utf8', p + 46, p + 46 + nameLen), {
        method: cd.readUInt16LE(p + 10),
        csize: cd.readUInt32LE(p + 20),
        usize: cd.readUInt32LE(p + 24),
        headerOffset: cd.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  private read(offset: number, length: number): Buffer {
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = fs.readSync(this.fd, buf, got, length - got, this.base + offset + got);
      if (n <= 0) throw new Error('unexpected end of zip');
      got += n;
    }
    return buf;
  }

  /** Offset (relative to this view) and length of an entry's stored bytes. */
  private dataRange(e: ZipEntry): { offset: number; length: number } {
    const lh = this.read(e.headerOffset, 30);
    return { offset: e.headerOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28), length: e.csize };
  }

  /** A stored (uncompressed) entry as a nested view; undefined if it is missing or compressed. */
  nested(name: string): ZipView | undefined {
    const e = this.entries.get(name);
    if (!e || e.method !== 0) return undefined;
    const r = this.dataRange(e);
    return new ZipView(this.fd, this.base + r.offset, r.length);
  }

  extract(name: string): Buffer {
    const e = this.entries.get(name);
    if (!e) throw new Error(`${name} not found in zip`);
    const r = this.dataRange(e);
    const raw = this.read(r.offset, r.length);
    if (e.method === 0) return raw;
    if (e.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`unsupported zip method ${e.method} for ${name}`);
  }
}

/** Simulator file names for a platform (mirrors DaemonStarter). */
export function simulatorFiles(platform: NodeJS.Platform): { cpnmld: string; run: string; files: string[] } | undefined {
  let suffix: string;
  if (platform === 'linux') suffix = '.x86-linux';
  else if (platform === 'win32') suffix = '.x86-cygwin';
  else return undefined;
  const files = ['cpnmld' + suffix, 'run' + suffix, 'cpn.ML' + suffix];
  if (platform === 'win32') files.push('cygwin1.dll', 'cyggcc_s-1.dll');
  return { cpnmld: files[0], run: files[1], files };
}

/** Extract the simulator files from the backend jar into <tmpDir>/accesscpn/simulator (skipping existing ones). */
export function extractSimulator(backendJar: string, tmpDir: string, platform: NodeJS.Platform = process.platform): string {
  const names = simulatorFiles(platform);
  if (!names) throw new Error(`no bundled simulator for ${platform}`);
  const simDir = path.join(tmpDir, 'accesscpn', 'simulator');
  fs.mkdirSync(simDir, { recursive: true });
  const missing = names.files.filter((f) => !fs.statSync(path.join(simDir, f), { throwIfNoEntry: false })?.isFile());
  if (missing.length) {
    const fd = fs.openSync(backendJar, 'r');
    try {
      const outer = new ZipView(fd, 0, fs.fstatSync(fd).size);
      const engine = outer.nested(ENGINE_ENTRY);
      if (!engine) throw new Error(`${ENGINE_ENTRY} not found (or compressed) in ${backendJar}`);
      for (const f of missing) {
        const tmp = path.join(simDir, f + '.part');
        fs.writeFileSync(tmp, engine.extract(f), { mode: 0o755 });
        fs.renameSync(tmp, path.join(simDir, f));
      }
    } finally {
      fs.closeSync(fd);
    }
  }
  for (const f of [names.cpnmld, names.run]) fs.chmodSync(path.join(simDir, f), 0o755);
  return simDir;
}

/** True if 127.0.0.1:port cannot be bound, i.e. something listens there. Never connects (a probe would upset cpnmld). */
export function portTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(false)));
  });
}

export interface PrestartedSimulator {
  child: ChildProcess;
  /** Kill the daemon's process group (or process tree on Windows). */
  kill: () => void;
}

/** Extract the simulator, start cpnmld and wait until it listens on the fixed port. */
export async function prestartSimulator(
  backendJar: string,
  tmpDir: string,
  log: (s: string) => void,
  timeoutMs = 15000,
  platform: NodeJS.Platform = process.platform,
): Promise<PrestartedSimulator> {
  const names = simulatorFiles(platform);
  if (!names) throw new Error(`no bundled simulator for ${platform}`);
  const simDir = extractSimulator(backendJar, tmpDir, platform);
  const child = spawn(path.join(simDir, names.cpnmld), [String(SIMULATOR_PORT), './' + names.run], {
    cwd: simDir,
    stdio: 'ignore',
    windowsHide: true,
    detached: platform !== 'win32',
  });
  let exited = false;
  child.on('exit', () => (exited = true));
  child.on('error', (e) => {
    exited = true;
    log(`[backend] could not start simulator daemon: ${e.message}\n`);
  });
  const kill = () => {
    if (child.pid === undefined) return;
    if (platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      return;
    }
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  };
  for (const end = Date.now() + timeoutMs; Date.now() < end; ) {
    if (exited) throw new Error(`simulator daemon exited early (see ${path.join(simDir, 'cpnmld.log')})`);
    const up = platform === 'linux' ? findPortOwner(SIMULATOR_PORT)?.pid === child.pid : await portTaken(SIMULATOR_PORT);
    if (up) {
      log(`[backend] simulator daemon pid ${child.pid} listening on 127.0.0.1:${SIMULATOR_PORT}\n`);
      return { child, kill };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  kill();
  throw new Error(`simulator daemon did not start listening on port ${SIMULATOR_PORT} within ${Math.round(timeoutMs / 1000)}s`);
}
