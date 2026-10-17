import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { changelogSection } from '../../scripts/changelog-section.mjs';

const root = path.resolve(__dirname, '../..');

describe('changelogSection', () => {
  const text = '# Changelog\n\n## 1.1.0 — 2026-01-02\n\nIntro.\n\n### New\n\n- a\n\n## 1.0.0 — 2026-01-01\n\n- b\n';

  it('returns the body of one version, without its heading', () => {
    expect(changelogSection(text, '1.1.0')).toBe('Intro.\n\n### New\n\n- a');
    expect(changelogSection(text, '1.0.0')).toBe('- b');
  });

  it('matches the version exactly', () => {
    expect(changelogSection(text, '1.0')).toBeUndefined();
    expect(changelogSection(text, '1x1.0')).toBeUndefined();
    expect(changelogSection(text, '2.0.0')).toBeUndefined();
  });

  it('has release notes for the version in package.json', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    expect(changelogSection(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version)).toBeTruthy();
  });
});
