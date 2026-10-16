#!/usr/bin/env node
// Compile the text-model examples (examples/*.petri.json + *.sml) to CPN Tools XML (examples/*.cpn).
// Usage: node scripts/gen-examples.mjs [--check]   (--check: fail if a .cpn is out of date)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(fileURLToPath(import.meta.url), '../..');
const dir = join(root, 'examples');

const bundle = await esbuild.build({
  entryPoints: [join(root, 'src/model/compile.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { compile } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const check = process.argv.includes('--check');
let stale = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.petri.json')).sort()) {
  const spec = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const sml = readFileSync(join(dir, spec.declarations ?? file.replace(/\.petri\.json$/, '.sml')), 'utf8');
  const out = file.replace(/\.petri\.json$/, '.cpn');
  const { xml } = compile(spec, sml);
  if (check) {
    let current = '';
    try {
      current = readFileSync(join(dir, out), 'latin1');
    } catch {
      /* missing */
    }
    if (current !== xml) {
      console.error(`examples/${out} is out of date; run node scripts/gen-examples.mjs`);
      stale++;
    }
  } else {
    writeFileSync(join(dir, out), xml, 'latin1');
    console.log(`wrote examples/${out}`);
  }
}
if (stale) process.exit(1);
