import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backendRows, groupModels, modelKind } from '../../src/views/sidebar-core';

describe('modelKind', () => {
  it('lists .cpn, .petri.json and .sml files only', () => {
    expect(modelKind('/a/net.cpn')).toBe('cpn');
    expect(modelKind('/a/net.CPN')).toBe('cpn');
    expect(modelKind('/a/net.petri.json')).toBe('petri');
    expect(modelKind('/a/net.sml')).toBe('sml');
    expect(modelKind('/a/package.json')).toBeUndefined();
  });
});

describe('groupModels', () => {
  it("groups a net's files into one row, text model first", () => {
    expect(groupModels(['a/n.sml', 'a/n.cpn', 'a/n.petri.json'])).toEqual([
      {
        name: 'n',
        dir: 'a',
        files: [
          { path: 'a/n.petri.json', kind: 'petri' },
          { path: 'a/n.cpn', kind: 'cpn' },
          { path: 'a/n.sml', kind: 'sml' },
        ],
        open: 'a/n.petri.json',
      },
    ]);
  });

  it('opens the .cpn when there is no text model', () => {
    expect(groupModels(['n.sml', 'n.cpn'])[0]).toMatchObject({ dir: '', open: 'n.cpn' });
  });

  it('keeps same-named files in different folders apart and skips lone .sml files', () => {
    expect(groupModels(['b/n.cpn', 'a/n.cpn', 'a/shared.sml', 'x.txt']).map((g) => g.dir)).toEqual(['a', 'b']);
  });

  it('sorts by folder, then name, ignoring case', () => {
    expect(groupModels(['b/z.cpn', 'top.cpn', 'a/B.petri.json', 'a/a.cpn', 'b/A.cpn']).map((g) => `${g.dir}/${g.name}`)).toEqual([
      '/top',
      'a/a',
      'a/B',
      'b/A',
      'b/z',
    ]);
  });
});

describe('backendRows', () => {
  const linux = { isMac: false, hasBackendUrl: false };
  const mac = { isMac: true, hasBackendUrl: false };
  const commands = (rows: ReturnType<typeof backendRows>) => rows.map((r) => r.command).filter(Boolean);

  it('offers Start when stopped and Restart/Stop otherwise', () => {
    const stopped = backendRows({ kind: 'stopped' }, linux);
    expect(stopped[0]).toMatchObject({ label: 'Not running', icon: 'circle-outline' });
    expect(commands(stopped)).toContain('cpnIde.startBackend');
    expect(commands(stopped)).not.toContain('cpnIde.stopBackend');

    const ready = backendRows({ kind: 'ready', url: 'http://127.0.0.1:1', external: false }, linux);
    expect(ready[0]).toMatchObject({ label: 'Running', icon: 'check', description: 'http://127.0.0.1:1' });
    expect(commands(ready)).toEqual(expect.arrayContaining(['cpnIde.restartBackend', 'cpnIde.stopBackend']));
    expect(commands(ready)).not.toContain('cpnIde.startBackend');
  });

  it('shows failures with the status bar tooltip', () => {
    expect(backendRows({ kind: 'error', message: 'no java' }, linux)[0]).toMatchObject({ icon: 'error', tooltip: 'CPN IDE backend failed: no java' });
  });

  it('shows the Docker rows on macOS, with a backend URL, or after a failure', () => {
    const docker = (rows: ReturnType<typeof backendRows>) => commands(rows).includes('cpnIde.startDockerBackend') && commands(rows).includes('cpnIde.stopDockerBackend');
    expect(docker(backendRows({ kind: 'stopped' }, linux))).toBe(false);
    expect(docker(backendRows({ kind: 'stopped' }, mac))).toBe(true);
    expect(docker(backendRows({ kind: 'stopped' }, { isMac: false, hasBackendUrl: true }))).toBe(true);
    expect(docker(backendRows({ kind: 'error', message: 'x' }, linux))).toBe(true);
    expect(docker(backendRows({ kind: 'simulatorDown' } as never, linux))).toBe(true);
  });

  it('only uses commands the extension contributes (or VS Code built-ins)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    const contributed = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const kind of ['stopped', 'starting'] as const)
      for (const c of commands(backendRows({ kind }, mac))) if (!c!.startsWith('workbench.')) expect(contributed).toContain(c);
  });
});
