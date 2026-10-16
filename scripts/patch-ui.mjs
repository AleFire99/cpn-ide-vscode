#!/usr/bin/env node
// Make the bundled CPN IDE UI (Angular main.*.js) simulation speed configurable.
//
// Upstream hardcodes a 500 ms delay between multi-step simulation steps and always animates
// token movement, although the backend needs only ~4 ms per step. The patched bundle reads
// `window.__CPN__.stepDelayMs` / `window.__CPN__.animate` (set by the extension from the
// cpnIde.simulation.* settings) and falls back to the upstream values when they are absent.
//
// Usage: patch-ui.mjs <ui-dir>
// The bundle is SHA-256 checked before patching; each needle must match exactly once.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DELAY = '(window.__CPN__&&null!=window.__CPN__.stepDelayMs?+window.__CPN__.stepDelayMs:500)';

/** Exact-match replacements: `from` is the upstream text, `to` the patched text. */
export const PATCHES = [
  { from: 'multi_step:{steps:50,delay:500}', to: `multi_step:{steps:50,delay:${DELAY}}` },
  { from: 'this.isAnimation=!0,', to: 'this.isAnimation=!window.__CPN__||!1!==window.__CPN__.animate,' },
  { from: 'default:return 500}', to: `default:return ${DELAY}}` },
];

/** SHA-256 of the upstream main.5bfa8bbb24426505efd3.js (CPN IDE 1.24.1031) and of the patched result. */
export const TARGET = {
  original: '6fc561969e61d73835a9528d4ab3d7ed70bac97cc986908406c224942fc3ef26',
  patched: '2edd65ad52f699c69e7199ab0a98babdc7e9de595486dd35abd1029ec8ab4fe9',
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const count = (text, needle) => {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
};

/** Pure: returns the patched text. Idempotent. Throws naming the needle unless each matches exactly once. */
export function patchUi(text) {
  let out = text;
  for (const { from, to } of PATCHES) {
    if (count(out, to) === 1 && count(out, from) === 0) continue; // already patched
    const n = count(out, from);
    if (n !== 1) throw new Error(`needle ${JSON.stringify(from)}: expected exactly 1 match, found ${n}`);
    out = out.replace(from, () => to);
  }
  return out;
}

/** Hash-checked variant for the real bundle. Returns null if it is already patched. */
export function patchChecked(text, t = TARGET) {
  const h = sha256(text);
  if (h === t.patched) return null;
  if (h !== t.original) throw new Error(`unexpected SHA-256 ${h} (upstream changed?); refusing to patch`);
  const out = patchUi(text);
  if (sha256(out) !== t.patched) throw new Error('patched SHA-256 mismatch');
  return out;
}

/** Patch main.*.js in a UI directory. Returns true if it was changed. */
export function patchUiDir(dir) {
  const mains = fs.readdirSync(dir).filter((f) => /^main\..*\.js$/.test(f));
  if (mains.length !== 1) throw new Error(`expected exactly 1 main.*.js in ${dir}, found ${mains.length}`);
  const file = path.join(dir, mains[0]);
  const out = patchChecked(fs.readFileSync(file, 'utf8'));
  if (out === null) return false;
  fs.writeFileSync(file, out);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: patch-ui.mjs <ui-dir>');
    process.exit(2);
  }
  try {
    console.log(patchUiDir(dir) ? 'patch-ui: simulation speed settings enabled' : 'patch-ui: already patched');
  } catch (e) {
    console.error(`patch-ui: ${e.message}`);
    process.exit(1);
  }
}
