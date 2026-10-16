import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

interface UiState {
  ready: number;
  errors: string[];
  panels: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const state = () => vscode.commands.executeCommand<UiState>('cpnIde._lastReady');

async function waitFor<T>(what: string, fn: () => Promise<T | undefined> | T | undefined, ms = 150000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

suite('CPN IDE petri model editor', () => {
  const dir = path.dirname(process.env.CPN_TEST_FILE as string);

  test('opens examples/04-hierarchy.petri.json in the petri editor and boots the UI', async () => {
    const ext = vscode.extensions.getExtension('AleFire99.cpn-ide-vscode');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    const before = (await state())?.ready ?? 0;
    const uri = vscode.Uri.file(path.join(dir, '04-hierarchy.petri.json'));
    await vscode.commands.executeCommand('vscode.openWith', uri, 'cpnIde.petriEditor');

    const s = await waitFor('UI ready', async () => {
      const st = await state();
      return st && st.ready > before ? st : undefined;
    });
    assert.deepStrictEqual(s.errors, [], `UI reported errors: ${s.errors.join('; ')}`);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab && tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'cpnIde.petriEditor');
  });

  test('a bad colset raises a diagnostic on the declarations file', async () => {
    const spec = fs.readFileSync(path.join(dir, '04-hierarchy.petri.json'), 'utf8');
    const sml = fs.readFileSync(path.join(dir, '04-hierarchy.sml'), 'utf8');
    fs.writeFileSync(path.join(dir, 'bad.petri.json'), spec.replace(/"declarations":\s*"[^"]*"/, '"declarations": "bad.sml"'));
    fs.writeFileSync(path.join(dir, 'bad.sml'), sml + '\ncolset BROKEN = nonsense of of;\n');
    const specUri = vscode.Uri.file(path.join(dir, 'bad.petri.json'));
    const smlUri = vscode.Uri.file(path.join(dir, 'bad.sml'));
    await vscode.commands.executeCommand('vscode.openWith', specUri, 'cpnIde.petriEditor');

    const diags = await waitFor('a cpn diagnostic', () => {
      const all = [...vscode.languages.getDiagnostics(smlUri), ...vscode.languages.getDiagnostics(specUri)].filter((d) => d.source === 'cpn');
      return all.length ? all : undefined;
    });
    assert.ok(diags.length > 0);

    // Fixing the file clears it again (the file watcher recompiles).
    fs.writeFileSync(path.join(dir, 'bad.sml'), sml);
    await waitFor('diagnostics to clear', () => {
      const all = [...vscode.languages.getDiagnostics(smlUri), ...vscode.languages.getDiagnostics(specUri)].filter((d) => d.source === 'cpn');
      return all.length === 0 ? true : undefined;
    }, 60000);
  });
});
