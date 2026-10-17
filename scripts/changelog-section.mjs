#!/usr/bin/env node
// Print the CHANGELOG.md section of one version (without its "## X.Y.Z" heading), for GitHub Release notes.
// Usage: node scripts/changelog-section.mjs [version]   (default: the version in package.json)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Body of the `## <version>` section, trimmed; undefined when there is none. */
export function changelogSection(text, version) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`).test(l));
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), '../..');
  const version = process.argv[2] ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const body = changelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version);
  if (!body) {
    console.error(`changelog-section: no "## ${version}" section in CHANGELOG.md`);
    process.exit(1);
  }
  process.stdout.write(body + '\n');
}
