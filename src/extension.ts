import * as vscode from 'vscode';
import { CpnEditorProvider, VIEW_TYPE } from './editor/cpnEditorProvider';
import { serializeSpec, textModelPaths } from './model/convert';
import { decompile } from './model/decompile';
import { exportCpn } from './editor/exportCpn';
import { PetriEditorProvider } from './editor/petriEditorProvider';
import { PETRI_VIEW_TYPE } from './editor/petriModel';
import { isSpecFile } from './model/workspace';
import { BackendManager } from './runtime/backend';
import { decodeBytes, encodeText } from './webview/host-core';
import { openStandalonePanel, uiState } from './webview/panel';

export function activate(ctx: vscode.ExtensionContext): void {
  const backend = BackendManager.init(ctx);
  ctx.subscriptions.push(backend, CpnEditorProvider.register(ctx), PetriEditorProvider.register(ctx));

  const openUi = async () => {
    try {
      const url = await backend.ensureStarted();
      openStandalonePanel(ctx, url);
    } catch {
      /* error already reported by BackendManager */
    }
  };

  const openInCpnIde = async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target) return openUi();
    await vscode.commands.executeCommand('vscode.openWith', target, isSpecFile(target.path) ? PETRI_VIEW_TYPE : VIEW_TYPE);
  };

  const openAsText = async (uri?: vscode.Uri) => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const target = uri ?? (input instanceof vscode.TabInputCustom ? input.uri : undefined);
    if (target) await vscode.commands.executeCommand('vscode.openWith', target, 'default');
  };

  const convertToText = async (uri?: vscode.Uri) => {
    const src = uri ?? vscode.window.activeTextEditor?.document.uri;
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
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('cpnIde.open', openUi),
    vscode.commands.registerCommand('cpnIde.newNet', openUi),
    vscode.commands.registerCommand('cpnIde.openInCpnIde', openInCpnIde),
    vscode.commands.registerCommand('cpnIde.openAsText', openAsText),
    vscode.commands.registerCommand('cpnIde.convertToText', convertToText),
    vscode.commands.registerCommand('cpnIde.exportCpn', (uri?: vscode.Uri) => exportCpn(uri)),
    vscode.commands.registerCommand('cpnIde.stopBackend', () => backend.stop()),
    vscode.commands.registerCommand('cpnIde.showLog', () => backend.showLog()),
    // Test hook: reports whether a webview UI finished booting.
    vscode.commands.registerCommand('cpnIde._lastReady', () => ({ ...uiState })),
  );
}

export function deactivate(): void {
  BackendManager.get().stop();
}
