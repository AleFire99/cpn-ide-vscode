import * as assert from 'node:assert';
import * as vscode from 'vscode';

interface UiState {
  ready: number;
  errors: string[];
  panels: number;
  backendUrl: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

suite('CPN IDE webview editor', () => {
  test('opens a .cpn in the custom editor, boots the UI and the backend answers', async () => {
    const uri = vscode.Uri.file(process.env.CPN_TEST_FILE as string);
    // openWith triggers activation asynchronously; wait for it so our commands exist.
    const ext = vscode.extensions.getExtension('AleFire99.cpn-ide-vscode');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    await vscode.commands.executeCommand('vscode.openWith', uri, 'cpnIde.editor');

    let state: UiState | undefined;
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      state = await vscode.commands.executeCommand<UiState>('cpnIde._lastReady');
      if (state && state.ready > 0) break;
      await sleep(500);
    }
    assert.ok(state, 'no state returned');
    assert.ok(state.ready > 0, `UI never signalled ready; errors: ${JSON.stringify(state.errors)}`);
    assert.strictEqual(state.panels, 1, 'expected exactly one panel');
    assert.deepStrictEqual(state.errors, [], `UI reported errors: ${state.errors.join('; ')}`);

    assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(state.backendUrl), `unexpected backend url ${state.backendUrl}`);
    const res = await fetch(state.backendUrl + '/');
    assert.ok(res.status > 0, 'backend did not answer');

    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(tab && tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'cpnIde.editor');
  });

  test('title-bar buttons switch between XML text and CPN IDE', async () => {
    const uri = vscode.Uri.file(process.env.CPN_TEST_FILE as string);
    const activeTab = () => vscode.window.tabGroups.activeTabGroup.activeTab?.input;

    await vscode.commands.executeCommand('cpnIde.openAsText');
    let input = activeTab();
    assert.ok(input instanceof vscode.TabInputText, 'expected the XML text editor');
    assert.strictEqual(input.uri.fsPath, uri.fsPath);

    await vscode.commands.executeCommand('cpnIde.openInCpnIde');
    input = activeTab();
    assert.ok(input instanceof vscode.TabInputCustom && input.viewType === 'cpnIde.editor', 'expected the CPN IDE editor');
  });

  test('play button is contributed for .cpn editors', () => {
    const pkg = vscode.extensions.getExtension('AleFire99.cpn-ide-vscode')!.packageJSON;
    const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === 'cpnIde.openInCpnIde');
    assert.strictEqual(cmd.icon, '$(play)');
    const menu = pkg.contributes.menus['editor/title'].find((m: { command: string }) => m.command === 'cpnIde.openInCpnIde');
    assert.strictEqual(menu.group, 'navigation');
  });
});
