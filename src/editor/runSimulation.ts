import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { nodeNames } from '../model/decompile';
import { formatIssue } from '../model/types';
import { isSpecFile } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { formatResult, runHeadless } from '../runtime/headless-sim';
import { decodeBytes } from '../webview/host-core';
import { loadModel } from './petriModel';

let simOutput: vscode.OutputChannel | undefined;

/** Results of headless runs get their own channel, apart from the backend log. */
export function simulationOutput(): vscode.OutputChannel {
  return (simOutput ??= vscode.window.createOutputChannel('CPN IDE: Simulation'));
}

export const disposeSimulationOutput = (): void => {
  simOutput?.dispose();
  simOutput = undefined;
};

/** "CPN IDE: Run Simulation (No UI)": simulate a .cpn / .petri.json on the backend and print the final marking to its output channel. */
export async function runSimulation(uri?: vscode.Uri): Promise<void> {
  const backend = BackendManager.get();
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const target = uri ?? (input instanceof vscode.TabInputCustom ? input.uri : vscode.window.activeTextEditor?.document.uri);
  if (!target || !(/\.cpn$/i.test(target.path) || isSpecFile(target.path))) {
    void vscode.window.showErrorMessage('CPN IDE: open or select a .cpn or .petri.json file to simulate.');
    return;
  }
  const steps = await vscode.window.showInputBox({
    prompt: 'Number of simulation steps',
    value: '100',
    validateInput: (v) => (/^[1-9]\d*$/.test(v.trim()) ? undefined : 'Enter a positive integer'),
  });
  if (steps === undefined) return;
  const out = simulationOutput();
  out.show(true);
  try {
    let xml: string;
    if (isSpecFile(target.path)) {
      const model = await loadModel(target);
      if (!model.compiled) {
        for (const i of model.issues ?? []) out.appendLine(`[sim] ${formatIssue(i)}`);
        return;
      }
      xml = model.compiled.xml;
    } else {
      xml = decodeBytes(await vscode.workspace.fs.readFile(target)).text;
    }
    const base = await backend.ensureStarted();
    out.appendLine(`[sim] ${target.fsPath}: up to ${steps.trim()} step(s)`);
    const r = await runHeadless({
      fetch: (url, init) => fetch(url, init),
      baseUrl: base,
      xml,
      maxSteps: Number(steps),
      sessionId: `headless-${randomUUID()}`,
    });
    for (const l of formatResult(r, nodeNames(xml))) out.appendLine(l);
  } catch (e) {
    out.appendLine(`[sim] failed: ${e instanceof Error ? e.message : String(e)} (see "CPN IDE: Show Backend Log")`);
  }
}
