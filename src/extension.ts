import * as vscode from 'vscode';
import { CpnEditorProvider, VIEW_TYPE } from './editor/cpnEditorProvider';
import { BackendManager } from './runtime/backend';
import { openStandalonePanel, uiState } from './webview/panel';

export function activate(ctx: vscode.ExtensionContext): void {
  const backend = BackendManager.init(ctx);
  ctx.subscriptions.push(backend, CpnEditorProvider.register(ctx));

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
    await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('cpnIde.open', openUi),
    vscode.commands.registerCommand('cpnIde.newNet', openUi),
    vscode.commands.registerCommand('cpnIde.openInCpnIde', openInCpnIde),
    vscode.commands.registerCommand('cpnIde.stopBackend', () => backend.stop()),
    vscode.commands.registerCommand('cpnIde.showLog', () => backend.showLog()),
    // Test hook: reports whether a webview UI finished booting.
    vscode.commands.registerCommand('cpnIde._lastReady', () => ({ ...uiState })),
  );
}

export function deactivate(): void {
  BackendManager.get().stop();
}
