import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

// End to end: the Analysis view's commands on a model opened in VS Code (#127).
suite('CPN IDE Analysis view', () => {
  const philosophers = () => {
    const dir = path.dirname(process.env.CPN_TEST_FILE ?? '');
    return vscode.Uri.file(path.join(dir, '05-dining-philosophers.petri.json'));
  };

  suiteSetup(async () => {
    await vscode.extensions.getExtension('AleFire99.cpn-ide-vscode')!.activate();
    await vscode.window.showTextDocument(philosophers());
  });

  test('Structural Analysis finds the philosophers deadlock candidate (no backend needed)', async () => {
    const text = (await vscode.commands.executeCommand<string[]>('cpnIde.structuralAnalysis')) ?? [];
    const all = text.join('\n');
    assert.match(all, /Boundedness/);
    assert.match(all, /Invariants/);
    assert.match(all, /Deadlock candidate \(state equation\)|Commoner: possible deadlock/, all);
  });

  test('Analyse State Space confirms the deadlock (real backend)', async function () {
    if (!process.env.CPN_IT) this.skip();
    this.timeout(240000);
    await vscode.window.showTextDocument(philosophers());
    const text = (await vscode.commands.executeCommand<string[]>('cpnIde.analyseStateSpace')) ?? [];
    const all = text.join('\n');
    assert.match(all, /Deadlock confirmed by the state space/, all);
    assert.match(all, /State space/);
  });
});
