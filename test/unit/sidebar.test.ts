import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backendRows, modelKind, sortModelPaths } from '../../src/views/sidebar-core';

describe('modelKind', () => {
  it('lists .cpn and .petri.json files only', () => {
    expect(modelKind('/a/net.cpn')).toBe('cpn');
    expect(modelKind('/a/net.CPN')).toBe('cpn');
    expect(modelKind('/a/net.petri.json')).toBe('petri');
    expect(modelKind('/a/net.sml')).toBeUndefined();
    expect(modelKind('/a/package.json')).toBeUndefined();
  });
});

describe('sortModelPaths', () => {
  it('groups by folder, then sorts by name ignoring case', () => {
    expect(sortModelPaths(['b/z.cpn', 'top.cpn', 'a/B.petri.json', 'a/a.cpn', 'b/A.cpn'])).toEqual([
      'top.cpn',
      'a/a.cpn',
      'a/B.petri.json',
      'b/A.cpn',
      'b/z.cpn',
    ]);
  });
});

describe('backendRows', () => {
  const commands = (rows: ReturnType<typeof backendRows>) => rows.map((r) => r.command).filter(Boolean);

  it('offers Start when stopped and Restart/Stop otherwise', () => {
    const stopped = backendRows({ kind: 'stopped' });
    expect(stopped[0]).toMatchObject({ label: 'Not running', icon: 'circle-outline' });
    expect(commands(stopped)).toContain('cpnIde.startBackend');
    expect(commands(stopped)).not.toContain('cpnIde.stopBackend');

    const ready = backendRows({ kind: 'ready', url: 'http://127.0.0.1:1', external: false });
    expect(ready[0]).toMatchObject({ label: 'Running', icon: 'check', description: 'http://127.0.0.1:1' });
    expect(commands(ready)).toEqual(expect.arrayContaining(['cpnIde.restartBackend', 'cpnIde.stopBackend']));
    expect(commands(ready)).not.toContain('cpnIde.startBackend');
  });

  it('shows failures with the status bar tooltip', () => {
    expect(backendRows({ kind: 'error', message: 'no java' })[0]).toMatchObject({ icon: 'error', tooltip: 'CPN IDE backend failed: no java' });
  });

  it('only uses commands the extension contributes (or VS Code built-ins)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    const contributed = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const kind of ['stopped', 'starting'] as const)
      for (const c of commands(backendRows({ kind }))) if (!c!.startsWith('workbench.')) expect(contributed).toContain(c);
  });
});
