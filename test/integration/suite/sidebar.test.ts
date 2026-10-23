import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('CPN IDE sidebar', () => {
  test('the Activity Bar container and its views open', async () => {
    const ext = vscode.extensions.getExtension('AleFire99.cpn-ide-vscode');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    // Each focus command exists only if the view is contributed, and fails if no provider is registered.
    await vscode.commands.executeCommand('workbench.view.extension.cpnIde');
    for (const view of ['cpnIde.models', 'cpnIde.net', 'cpnIde.analysis']) await vscode.commands.executeCommand(`${view}.focus`);
    await vscode.commands.executeCommand('cpnIde.refreshModels');
  });

  test('the Analysis view and its Check Model command are registered', async () => {
    const ext = vscode.extensions.getExtension('AleFire99.cpn-ide-vscode');
    assert.ok(ext, 'extension not found');
    await ext.activate();
    assert.ok((await vscode.commands.getCommands(true)).includes('cpnIde.checkModel'));
    await vscode.commands.executeCommand('cpnIde.analysis.focus');
  });
});
