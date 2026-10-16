#!/usr/bin/env node
// Make the bundled CPN simulator daemon (cpnmld) listen on 127.0.0.1 only.
//
// Upstream cpnmld does `sin_addr.s_addr = 0` (INADDR_ANY) before bind(), so the
// simulator, which evaluates arbitrary SML code, is reachable from the whole LAN.
// The fix is one instruction: the 32-bit immediate of `mov dword [ebp-0x24], 0`
// becomes 127.0.0.1 in network byte order (7f 00 00 01). The patched binaries live
// inside engine jar -> backend jar; both archives are rewritten with zip(1) and the
// Spring Boot nested jar stays STORED (uncompressed), as required.
//
// Usage: patch-cpnmld.mjs <backend-jar>
// Every binary is SHA-256 checked before patching: the script fails if upstream changed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINE_ENTRY = 'BOOT-INF/lib/org.cpntools.accesscpn.engine_3.0.0.jar';

// i386 `mov DWORD PTR [ebp-0x24], 0x0`; the immediate (last 4 bytes) is sin_addr.
export const NEEDLE = Buffer.from('c745dc00000000', 'hex');
export const LOOPBACK = Buffer.from([0x7f, 0x00, 0x00, 0x01]);

/** SHA-256 of the upstream binaries (CPN IDE 1.24.1031) and of the patched result. */
export const TARGETS = {
  'cpnmld.x86-linux': {
    original: 'f3d76ddf443f160458d6b28fd899e6b5b937eee9a35b4040716a4f255f0857a8',
    patched: '25a762db59c3aca299c3c9292c5aadae18826b4145c3d332266b7ec94978589a',
  },
  'cpnmld.x86-cygwin': {
    original: 'b72941a68f493bcc3d43e3d9ad9edb197ac6004d97c7d9b0b7499529e59da137',
    patched: '18c28bfb2a0ee636e32f90dc2be4ae219a944343328a7d494356899ba4f1fa99',
  },
};

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Pure: returns a copy of buf with the bind address set to 127.0.0.1. Throws unless exactly one site matches. */
export function patchLoopback(buf) {
  const hits = [];
  for (let i = buf.indexOf(NEEDLE); i !== -1; i = buf.indexOf(NEEDLE, i + 1)) hits.push(i);
  if (hits.length !== 1) throw new Error(`expected exactly 1 INADDR_ANY site, found ${hits.length}`);
  const out = Buffer.from(buf);
  LOOPBACK.copy(out, hits[0] + 3);
  return out;
}

/** Patch one named binary given its bytes and expected hashes. Returns null if already patched. */
export function patchChecked(name, buf, t = TARGETS[name]) {
  const h = sha256(buf);
  if (h === t.patched) return null;
  if (h !== t.original) throw new Error(`${name}: unexpected SHA-256 ${h} (upstream changed?); refusing to patch`);
  const out = patchLoopback(buf);
  if (sha256(out) !== t.patched) throw new Error(`${name}: patched SHA-256 mismatch`);
  return out;
}

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
}

export function patchBackendJar(jar) {
  jar = path.resolve(jar);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-cpnmld-'));
  try {
    run('unzip', ['-q', jar, ENGINE_ENTRY, '-d', work]);
    const engine = path.join(work, ENGINE_ENTRY);
    const ex = path.join(work, 'engine');
    fs.mkdirSync(ex);
    const names = [];
    for (const n of Object.keys(TARGETS)) names.push(n, `simulator/${n}`);
    run('unzip', ['-q', engine, ...names, '-d', ex]);
    let changed = false;
    for (const rel of names) {
      const p = path.join(ex, rel);
      const out = patchChecked(path.basename(rel), fs.readFileSync(p));
      if (out) {
        fs.writeFileSync(p, out);
        changed = true;
      }
    }
    if (!changed) return false;
    run('zip', ['-q', '-X', engine, ...names], ex);
    // -0: Spring Boot requires nested jars STORED. Only this entry changes in the outer jar.
    run('zip', ['-q', '-X', '-0', jar, ENGINE_ENTRY], work);
    const method = run('unzip', ['-v', jar, ENGINE_ENTRY]).toString();
    if (!/Stored/.test(method)) throw new Error('nested jar is no longer STORED');
    return true;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const jar = process.argv[2];
  if (!jar) {
    console.error('usage: patch-cpnmld.mjs <backend-jar>');
    process.exit(2);
  }
  try {
    console.log(patchBackendJar(jar) ? 'patch-cpnmld: cpnmld now binds 127.0.0.1' : 'patch-cpnmld: already patched');
  } catch (e) {
    console.error(`patch-cpnmld: ${e.message}`);
    process.exit(1);
  }
}
