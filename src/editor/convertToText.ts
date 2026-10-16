import * as vscode from 'vscode';
import { decompile } from '../model/decompile';
import { serializeSpec, textModelPaths } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { decodeBytes, encodeText } from '../webview/host-core';

/** "CPN IDE: Convert to Text Model": write `<name>.petri.json` + `<name>.sml` next to a `.cpn` and open the JSON. */
export async function convertToText(uri?: vscode.Uri): Promise<void> {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const src = uri ?? (tab instanceof vscode.TabInputCustom ? tab.uri : vscode.window.activeTextEditor?.document.uri);
  if (!src || !/\.cpn$/i.test(src.path)) return void vscode.window.showErrorMessage('CPN IDE: select a .cpn file to convert.');
  const out = BackendManager.get().output;
  try {
    const { json, sml, smlName } = textModelPaths(src.fsPath);
    const targets = [vscode.Uri.file(json), vscode.Uri.file(sml)];
    const existing: string[] = [];
    for (const t of targets) {
      try {
        await vscode.workspace.fs.stat(t);
        existing.push(t.fsPath);
      } catch {
        /* does not exist */
      }
    }
    if (existing.length) {
      const ok = await vscode.window.showWarningMessage(`Overwrite ${existing.join(' and ')}?`, { modal: true }, 'Overwrite');
      if (ok !== 'Overwrite') return;
    }
    const r = decompile(decodeBytes(await vscode.workspace.fs.readFile(src)).text);
    await vscode.workspace.fs.writeFile(targets[0], encodeText(serializeSpec(r.spec, smlName)));
    await vscode.workspace.fs.writeFile(targets[1], encodeText(r.sml));
    out.appendLine(`[convert] ${src.fsPath} -> ${json}, ${sml}`);
    for (const w of r.warnings) out.appendLine(`[convert] warning: ${w}`);
    if (r.warnings.length) {
      out.show(true);
      void vscode.window.showWarningMessage(`Converted with ${r.warnings.length} warning(s); see the CPN IDE output.`);
    }
    await vscode.window.showTextDocument(targets[0]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    out.appendLine(`[convert] error: ${msg}`);
    void vscode.window.showErrorMessage(`CPN IDE: could not convert to a text model: ${msg}`);
  }
}
