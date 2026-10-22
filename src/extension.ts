import * as vscode from 'vscode';
import { markOpenedAsText, registerDefaultEditorPrompt } from './editor/cpnDefault';
import { convertToText } from './editor/convertToText';
import { CpnEditorProvider, VIEW_TYPE } from './editor/cpnEditorProvider';
import { exportCpn } from './editor/exportCpn';
import { newNet } from './editor/newNet';
import { openExample } from './editor/openExample';
import { registerPetriLanguage } from './editor/petriLanguage';
import { PetriEditorProvider } from './editor/petriEditorProvider';
import { PETRI_VIEW_TYPE } from './editor/petriModel';
import { PetriSync } from './editor/petriSync';
import { disposeSimulationOutput, runSimulation } from './editor/runSimulation';
import { SimulateLens } from './editor/simulateLens';
import { isSpecFile } from './model/workspace';
import { BackendManager } from './runtime/backend';
import { initDocker, startDockerBackend, stopDockerBackend, stopDockerOnExit } from './runtime/docker';
import { createStatusBar } from './runtime/statusBar';
import { registerAnalysisView } from './views/analysis';
import { registerNetView } from './views/netView';
import { registerSidebar } from './views/sidebar';
import { openStandalonePanel, uiState } from './webview/panel';

export function activate(ctx: vscode.ExtensionContext): void {
  const backend = BackendManager.init(ctx);
  initDocker(ctx);
  ctx.subscriptions.push(
    backend,
    PetriSync.init(),
    registerPetriLanguage(),
    CpnEditorProvider.register(ctx),
    PetriEditorProvider.register(ctx),
    { dispose: disposeSimulationOutput },
    SimulateLens.register(),
    createStatusBar(backend),
    registerSidebar(backend),
    registerNetView(),
    registerAnalysisView(),
    registerDefaultEditorPrompt(ctx),
  );

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
    if (target) markOpenedAsText(target);
    if (target) await vscode.commands.executeCommand('vscode.openWith', target, 'default');
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand('cpnIde.open', openUi),
    vscode.commands.registerCommand('cpnIde.newNet', newNet),
    vscode.commands.registerCommand('cpnIde.openExample', (id?: string) => openExample(ctx, id)),
    vscode.commands.registerCommand('cpnIde.openInCpnIde', openInCpnIde),
    vscode.commands.registerCommand('cpnIde.openAsText', openAsText),
    vscode.commands.registerCommand('cpnIde.convertToText', convertToText),
    vscode.commands.registerCommand('cpnIde.runSimulation', runSimulation),
    vscode.commands.registerCommand('cpnIde.exportCpn', exportCpn),
    vscode.commands.registerCommand('cpnIde.startBackend', () => backend.ensureStarted().catch(() => undefined)),
    vscode.commands.registerCommand('cpnIde.stopBackend', () => backend.stop()),
    vscode.commands.registerCommand('cpnIde.restartBackend', () => backend.retry()),
    vscode.commands.registerCommand('cpnIde.startDockerBackend', () => startDockerBackend()),
    vscode.commands.registerCommand('cpnIde.stopDockerBackend', stopDockerBackend),
    vscode.commands.registerCommand('cpnIde.showLog', () => backend.showLog()),
    // Test hook: reports whether a webview UI finished booting.
    vscode.commands.registerCommand('cpnIde._lastReady', () => ({ ...uiState })),
  );
}

export function deactivate(): void {
  BackendManager.get().stop();
  stopDockerOnExit();
}
