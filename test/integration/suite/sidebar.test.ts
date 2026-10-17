import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('CPN IDE sidebar', () => {
  test('the Activity Bar container and its views open', async () => {
    const ext = vscode.extensions.getExtension('AleFire99.cpn-ide-vscode');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    // Each focus command exists only if the view is contributed, and fails if no provider is registered.
    await vscode.commands.executeCommand('workbench.view.extension.cpnIde');
    for (const view of ['cpnIde.models', 'cpnIde.backend', 'cpnIde.start']) await vscode.commands.executeCommand(`${view}.focus`);
    await vscode.commands.executeCommand('cpnIde.refreshModels');
  });
});
