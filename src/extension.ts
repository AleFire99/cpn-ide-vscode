import * as vscode from 'vscode';
import { BackendManager } from './runtime/backend';
import { openPanel } from './webview/panel';

export function activate(ctx: vscode.ExtensionContext): void {
  const backend = BackendManager.init(ctx);
  ctx.subscriptions.push(backend);

  const openUi = async () => {
    try {
      const url = await backend.ensureStarted();
      void vscode.window.showInformationMessage(`CPN IDE backend running at ${url}`);
      await openPanel(url);
    } catch {
      /* error already reported by BackendManager */
    }
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('cpnIde.open', openUi),
    vscode.commands.registerCommand('cpnIde.newNet', openUi),
    vscode.commands.registerCommand('cpnIde.stopBackend', () => backend.stop()),
    vscode.commands.registerCommand('cpnIde.showLog', () => backend.showLog()),
  );
}

export function deactivate(): void {
  BackendManager.get().stop();
}
