import * as vscode from 'vscode';
import { formatIssue } from '../model/types';
import { baseFileName, isSpecFile, specBaseName } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { encodeText } from '../webview/host-core';
import { loadModel } from './petriModel';

/** "CPN IDE: Export .cpn": write the compiled model next to the .petri.json (latin1, like the examples). */
export async function exportCpn(uri?: vscode.Uri): Promise<void> {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const target =
    uri ??
    vscode.window.activeTextEditor?.document.uri ??
    (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined);
  if (!target || !isSpecFile(target.path)) {
    void vscode.window.showErrorMessage('CPN IDE: select a *.petri.json file to export.');
    return;
  }
  const model = await loadModel(target);
  if (!model.compiled) {
    const lines = (model.issues ?? []).map(formatIssue);
    BackendManager.get().output.appendLine(`[export] ${target.fsPath}: cannot compile`);
    for (const l of lines) BackendManager.get().output.appendLine(`  ${l}`);
    void vscode.window.showErrorMessage(`CPN IDE: cannot export, the model has errors: ${lines[0] ?? ''}`, 'Show Log').then((c) => {
      if (c) BackendManager.get().showLog();
    });
    return;
  }
  const dest = vscode.Uri.joinPath(target, '..', `${specBaseName(target.path)}.cpn`);
  let exists = true;
  try {
    await vscode.workspace.fs.stat(dest);
  } catch {
    exists = false;
  }
  if (exists) {
    const pick = await vscode.window.showWarningMessage(`${baseFileName(dest.path)} already exists. Overwrite it?`, { modal: true }, 'Overwrite');
    if (pick !== 'Overwrite') return;
  }
  await vscode.workspace.fs.writeFile(dest, encodeText(model.compiled.xml, 'latin1'));
  void vscode.window.showInformationMessage(`CPN IDE: exported ${baseFileName(dest.path)}`);
}
