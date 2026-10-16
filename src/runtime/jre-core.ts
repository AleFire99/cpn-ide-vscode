// Pure (vscode-free) logic for locating or downloading a Java 17+ runtime.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MIN_JAVA_MAJOR = 17;

export type AdoptiumOs = 'linux' | 'windows' | 'mac';
export type AdoptiumArch = 'x64' | 'aarch64';

/** Map Node's process.platform / process.arch to Adoptium names. */
export function adoptiumPlatform(
  platform: string,
  arch: string,
): { os: AdoptiumOs; architecture: AdoptiumArch } | undefined {
  const os: AdoptiumOs | undefined =
    platform === 'linux' ? 'linux' : platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : undefined;
  const architecture: AdoptiumArch | undefined = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'aarch64' : undefined;
  return os && architecture ? { os, architecture } : undefined;
}

export function buildAdoptiumUrl(os: AdoptiumOs, architecture: AdoptiumArch): string {
  const q = new URLSearchParams({ architecture, image_type: 'jre', os, vendor: 'eclipse' });
  return `https://api.adoptium.net/v3/assets/latest/17/hotspot?${q.toString()}`;
}

/**
 * Parse the major version from `java -version` output
 * (e.g. `openjdk version "17.0.20"`, `java version "1.8.0_292"`, `openjdk version "21"`).
 */
export function parseJavaMajor(output: string): number | undefined {
  const m = /version "(\d+)(?:\.(\d+))?[^"]*"/.exec(output);
  if (!m) return undefined;
  const first = parseInt(m[1], 10);
  if (first === 1 && m[2] !== undefined) return parseInt(m[2], 10);
  return first;
}

export function javaExecutableName(platform: string): string {
  return platform === 'win32' ? 'java.exe' : 'java';
}

/** Run `<javaPath> -version`; resolves to the major version or undefined if not runnable. */
export function getJavaMajor(javaPath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve(undefined);
      resolve(parseJavaMajor(`${stderr}\n${stdout}`));
    });
  });
}

/** Candidate java commands in priority order: setting, JAVA_HOME, PATH. */
export function javaCandidates(configured: string, env: NodeJS.ProcessEnv, platform: string): string[] {
  const list: string[] = [];
  if (configured.trim()) list.push(configured.trim());
  if (env.JAVA_HOME) list.push(path.join(env.JAVA_HOME, 'bin', javaExecutableName(platform)));
  list.push('java');
  return list;
}

/** First candidate that runs and is Java >= 17. */
export async function findSystemJava(
  configured: string,
  env: NodeJS.ProcessEnv,
  platform: string,
  log: (m: string) => void,
): Promise<string | undefined> {
  for (const c of javaCandidates(configured, env, platform)) {
    const major = await getJavaMajor(c);
    if (major === undefined) {
      log(`Java candidate "${c}": not usable`);
    } else if (major >= MIN_JAVA_MAJOR) {
      log(`Using Java ${major} at "${c}"`);
      return c;
    } else {
      log(`Java candidate "${c}": version ${major} is older than ${MIN_JAVA_MAJOR}`);
    }
  }
  return undefined;
}

export interface JreAsset {
  link: string;
  checksum: string;
  name: string;
  release: string;
}

export async function fetchJreAsset(os: AdoptiumOs, arch: AdoptiumArch): Promise<JreAsset> {
  const res = await fetch(buildAdoptiumUrl(os, arch));
  if (!res.ok) throw new Error(`Adoptium API returned HTTP ${res.status}`);
  const body = (await res.json()) as Array<{
    release_name: string;
    binary: { package: { link: string; checksum: string; name: string } };
  }>;
  const first = body[0];
  if (!first) throw new Error('Adoptium API returned no JRE for this platform');
  return {
    link: first.binary.package.link,
    checksum: first.binary.package.checksum,
    name: first.binary.package.name,
    release: first.release_name,
  };
}

export function safeDirName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Download a URL to a file, returning the SHA-256 hex digest. */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const hash = createHash('sha256');
  let received = 0;
  const source = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  source.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    received += chunk.length;
    onProgress?.(received, total);
  });
  await pipeline(source, createWriteStream(dest));
  return hash.digest('hex');
}

export function extractArchive(archive: string, destDir: string): Promise<void> {
  // bsdtar (Windows 10+, macOS) and GNU tar both handle .tar.gz; bsdtar also handles .zip.
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xf', archive, '-C', destDir], { windowsHide: true }, (err, _o, stderr) =>
      err ? reject(new Error(`tar failed: ${stderr || err.message}`)) : resolve(),
    );
  });
}

/** Find bin/java[.exe] within a few levels of dir. */
export async function findJavaIn(dir: string, platform: string, depth = 4): Promise<string | undefined> {
  const exe = path.join(dir, 'bin', javaExecutableName(platform));
  try {
    await fs.access(exe);
    return exe;
  } catch {
    /* keep looking */
  }
  if (depth === 0) return undefined;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = await findJavaIn(path.join(dir, e.name), platform, depth - 1);
      if (found) return found;
    }
  }
  return undefined;
}

export interface EnsureJreOptions {
  jreRoot: string; // <globalStorage>/jre
  platform: string;
  arch: string;
  log: (m: string) => void;
  onProgress?: (message: string, increment?: number) => void;
}

/** Download (if needed) a Temurin 17 JRE into jreRoot/<release>/ and return the java executable. */
export async function ensureDownloadedJre(opts: EnsureJreOptions): Promise<string> {
  const { jreRoot, platform, arch, log, onProgress } = opts;
  const target = adoptiumPlatform(platform, arch);
  if (!target) throw new Error(`No Java runtime available for ${platform}/${arch}. Install Java 17 and set cpnIde.javaPath.`);

  // Reuse any previously downloaded runtime (offline-friendly).
  try {
    for (const rel of (await fs.readdir(jreRoot)).sort().reverse()) {
      const existing = await findJavaIn(path.join(jreRoot, rel), platform);
      if (existing && (await getJavaMajor(existing)) !== undefined) {
        log(`Reusing downloaded JRE at ${existing}`);
        return existing;
      }
    }
  } catch {
    /* no jre dir yet */
  }

  onProgress?.('Looking up Java 17 runtime...');
  const asset = await fetchJreAsset(target.os, target.architecture);
  log(`Downloading ${asset.name} (${asset.release})`);
  const releaseDir = path.join(jreRoot, safeDirName(asset.release));
  const tmp = `${releaseDir}.partial`;
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
  const archive = path.join(tmp, asset.name);
  let lastPct = 0;
  const digest = await downloadFile(asset.link, archive, (rec, total) => {
    if (!total) return;
    const pct = Math.floor((rec / total) * 100);
    if (pct > lastPct) {
      onProgress?.(`Downloading Java 17 runtime (${pct}%)`, pct - lastPct);
      lastPct = pct;
    }
  });
  if (digest.toLowerCase() !== asset.checksum.toLowerCase()) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw new Error(`Checksum mismatch for ${asset.name}: expected ${asset.checksum}, got ${digest}`);
  }
  onProgress?.('Extracting Java runtime...');
  const extractDir = path.join(tmp, 'x');
  await fs.mkdir(extractDir);
  await extractArchive(archive, extractDir);
  await fs.rm(archive, { force: true });
  await fs.rm(releaseDir, { recursive: true, force: true });
  await fs.rename(extractDir, releaseDir);
  await fs.rm(tmp, { recursive: true, force: true });
  const java = await findJavaIn(releaseDir, platform);
  if (!java) throw new Error('Downloaded JRE does not contain bin/java');
  if (platform !== 'win32') await fs.chmod(java, 0o755);
  log(`JRE ready at ${java}`);
  return java;
}
