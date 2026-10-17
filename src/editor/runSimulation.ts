import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { formatIssue } from '../model/types';
import { isSpecFile } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { formatResult, runHeadless } from '../runtime/headless-sim';
import { decodeBytes } from '../webview/host-core';
import { loadModel } from './petriModel';

const isModel = (u: vscode.Uri) => /\.cpn$/i.test(u.path) || isSpecFile(u.path);

const tabUri = (t: vscode.Tab | undefined) =>
  t?.input instanceof vscode.TabInputCustom || t?.input instanceof vscode.TabInputText ? t.input.uri : undefined;

/** The model in the active tab, else in any other open tab (e.g. when run from the walkthrough). */
function openModelUri(): vscode.Uri | undefined {
  const { activeTabGroup, all } = vscode.window.tabGroups;
  const tabs = [activeTabGroup.activeTab, ...all.map((g) => g.activeTab), ...all.flatMap((g) => g.tabs)];
  return tabs.map(tabUri).find((u): u is vscode.Uri => !!u && isModel(u));
}

/** "CPN IDE: Run Simulation (No UI)": simulate a .cpn / .petri.json on the backend and print the final marking to the output channel. */
export async function runSimulation(uri?: vscode.Uri): Promise<void> {
  const backend = BackendManager.get();
  const target = uri ?? openModelUri();
  if (!target || !isModel(target)) {
    void vscode.window.showErrorMessage('CPN IDE: open or select a .cpn or .petri.json file to simulate.');
    return;
  }
  const steps = await vscode.window.showInputBox({
    prompt: 'Number of simulation steps',
    value: '100',
    validateInput: (v) => (/^[1-9]\d*$/.test(v.trim()) ? undefined : 'Enter a positive integer'),
  });
  if (steps === undefined) return;
  const out = backend.output;
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
    for (const l of formatResult(r)) out.appendLine(l);
  } catch (e) {
    out.appendLine(`[sim] failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
