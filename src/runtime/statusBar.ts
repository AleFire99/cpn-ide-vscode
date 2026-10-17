import * as vscode from 'vscode';
import type { BackendManager } from './backend';
import { isCpnFile, presentStatus } from './status-core';

export const STATUS_MENU_COMMAND = 'cpnIde.statusMenu';

/** Path of the file in the active tab (text or custom editor), if any. */
function activePath(): string | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) return input.uri.path;
  return undefined;
}

/** Status bar item with the backend state; visible next to CPN files and whenever the backend is not stopped. */
export function createStatusBar(backend: BackendManager): vscode.Disposable {
  const item = vscode.window.createStatusBarItem('cpnIde.backend', vscode.StatusBarAlignment.Left, 50);
  item.name = 'CPN IDE Backend';
  item.command = STATUS_MENU_COMMAND;

  const update = () => {
    const s = backend.status;
    const p = presentStatus(s);
    item.text = p.text;
    item.tooltip = p.tooltip;
    item.backgroundColor = p.severity ? new vscode.ThemeColor(`statusBarItem.${p.severity}Background`) : undefined;
    const path = activePath();
    if (s.kind !== 'stopped' || (path && isCpnFile(path))) item.show();
    else item.hide();
  };
  update();

  const menu = async () => {
    const running = backend.status.kind !== 'stopped';
    const picks: (vscode.QuickPickItem & { run: () => unknown })[] = [
      { label: '$(output) Show Backend Log', run: () => backend.showLog() },
      running
        ? { label: '$(debug-restart) Restart Backend', run: () => backend.retry() }
        : { label: '$(play) Start Backend', run: () => backend.ensureStarted().catch(() => undefined) },
      ...(running ? [{ label: '$(debug-stop) Stop Backend', run: () => backend.stop() }] : []),
      { label: '$(gear) Settings', run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'cpnIde') },
    ];
    const pick = await vscode.window.showQuickPick(picks, { placeHolder: presentStatus(backend.status).tooltip.replace(/\n/g, ' · ') });
    await pick?.run();
  };

  return vscode.Disposable.from(
    item,
    backend.onDidChangeStatus(update),
    vscode.window.tabGroups.onDidChangeTabs(update),
    vscode.window.tabGroups.onDidChangeTabGroups(update),
    vscode.commands.registerCommand(STATUS_MENU_COMMAND, menu),
  );
}
