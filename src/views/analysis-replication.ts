// Analysis view actions: Run N Replications and Export Event Log. Kept apart from analysis.ts.

import { randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadModel } from '../editor/petriModel';
import { nodeNames } from '../model/decompile';
import { formatIssue } from '../model/types';
import { isSpecFile } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { exportEventLog, runReplications, type FetchLike, type PlayOutExport } from '../runtime/replication-core';
import { decodeBytes } from '../webview/host-core';

const isModel = (u: vscode.Uri) => /\.cpn$/i.test(u.path) || isSpecFile(u.path);

function targetModel(): vscode.Uri | undefined {
  const { activeTabGroup, all } = vscode.window.tabGroups;
  const tabs = [activeTabGroup.activeTab, ...all.flatMap((g) => g.tabs)];
  for (const t of tabs) {
    const i = t?.input;
    if ((i instanceof vscode.TabInputCustom || i instanceof vscode.TabInputText) && isModel(i.uri)) return i.uri;
  }
  return undefined;
}

/** The model's `.cpn` XML, compiled from the text model if needed. Undefined (and reported) when it does not compile. */
async function modelXml(uri: vscode.Uri, out: vscode.OutputChannel): Promise<string | undefined> {
  if (!isSpecFile(uri.path)) return decodeBytes(await vscode.workspace.fs.readFile(uri)).text;
  const model = await loadModel(uri);
  if (!model.compiled) {
    for (const i of model.issues ?? []) out.appendLine(`[analysis] ${formatIssue(i)}`);
    void vscode.window.showErrorMessage('CPN IDE: the model has errors, see the CPN IDE output.');
    return undefined;
  }
  return model.compiled.xml;
}

function reportIssues(issues: Record<string, unknown>, xml: string, out: vscode.OutputChannel): void {
  const names = nodeNames(xml);
  out.appendLine('[analysis] Validation failed:');
  for (const [k, v] of Object.entries(issues)) out.appendLine(`  ${names.get(k) ?? k}: ${JSON.stringify(v)}`);
  void vscode.window.showErrorMessage('CPN IDE: the model has validation errors, see the CPN IDE output.');
}

async function replications(): Promise<void> {
  const uri = targetModel();
  if (!uri) return void vscode.window.showInformationMessage('CPN IDE: open a .cpn or .petri.json model first.');
  const n = await vscode.window.showInputBox({ prompt: 'Number of replications', value: '30', validateInput: (v) => (/^[1-9]\d*$/.test(v.trim()) ? undefined : 'Enter a positive integer') });
  if (n === undefined) return;
  const backend = BackendManager.get();
  try {
    const xml = await modelXml(uri, backend.output);
    if (xml === undefined) return;
    const baseUrl = await backend.ensureStarted();
    let last = 0;
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Running ${n} replications` }, (progress) =>
      runReplications({
        fetch: fetch as unknown as FetchLike,
        baseUrl,
        xml,
        sessionId: `replication-${randomUUID()}`,
        repeat: Number(n),
        onProgress: (f) => {
          const pct = Math.round(f * 100);
          progress.report({ increment: Math.max(0, pct - last), message: `${pct}%` });
          last = Math.max(last, pct);
        },
      }),
    );
    if (!r.ok) return reportIssues(r.issues, xml, backend.output);
    backend.output.appendLine(`[analysis] replications: ${r.report}`);
    const report = r.files[0];
    if (!report) return void vscode.window.showInformationMessage('CPN IDE: replications finished, the backend returned no report.');
    const dir = path.join(os.tmpdir(), `cpn-ide-replication-${randomUUID()}`);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    let main: vscode.Uri | undefined;
    for (const f of r.files) {
      const target = vscode.Uri.file(path.join(dir, path.basename(f.fileName)));
      await vscode.workspace.fs.writeFile(target, Buffer.from(f.htmlContent, 'utf8'));
      main ??= target;
    }
    if (main) await vscode.env.openExternal(main);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    backend.output.appendLine(`[analysis] replications failed: ${msg}`);
    void vscode.window.showErrorMessage(`CPN IDE: replications failed: ${msg}`);
  }
}

async function eventLog(): Promise<void> {
  const uri = targetModel();
  if (!uri) return void vscode.window.showInformationMessage('CPN IDE: open a .cpn or .petri.json model first.');
  const format = await vscode.window.showQuickPick(['xes', 'csv'], { placeHolder: 'Event log format' });
  if (!format) return;
  const steps = await vscode.window.showInputBox({ prompt: 'Number of simulation steps to record', value: '100', validateInput: (v) => (/^[1-9]\d*$/.test(v.trim()) ? undefined : 'Enter a positive integer') });
  if (steps === undefined) return;
  const dest = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(uri.fsPath.replace(/(\.petri)?\.(json|cpn)$/i, `.${format}`)), filters: { 'Event log': [format] } });
  if (!dest) return;
  const cfg = vscode.workspace.getConfiguration('cpnIde.eventLog');
  const backend = BackendManager.get();
  try {
    const xml = await modelXml(uri, backend.output);
    if (xml === undefined) return;
    const baseUrl = await backend.ensureStarted();
    const base = path.basename(dest.fsPath).replace(/\.(xes|csv)$/i, '');
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Exporting event log' }, () =>
      exportEventLog({
        fetch: fetch as unknown as FetchLike,
        baseUrl,
        xml,
        sessionId: `playout-${randomUUID()}`,
        maxSteps: Number(steps),
        caseId: cfg.get('caseId', 'i'),
        startDateTime: cfg.get('startDateTime', '2022-01-01T00:00'),
        timeUnit: cfg.get('timeUnit', 'hours'),
        recordedEvents: cfg.get('recordedEvents', 'start+complete'),
        informationLevelIsEvent: cfg.get('informationLevelIsEvent', true),
        exportType: format as PlayOutExport,
        path: path.dirname(dest.fsPath),
        fileName: base,
      }),
    );
    if (!r.ok) return reportIssues(r.issues, xml, backend.output);
    if (r.nofLogEvents === 0) return void vscode.window.showWarningMessage(r.nofPlayOutEvents === 0 ? 'CPN IDE: no events were recorded.' : 'CPN IDE: the event log is empty, check the case id variable.');
    const pick = await vscode.window.showInformationMessage(`CPN IDE: wrote ${r.nofLogEvents} events to ${r.absoluteFileName}`, 'Open');
    if (pick) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(r.absoluteFileName));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    backend.output.appendLine(`[analysis] event log failed: ${msg}`);
    void vscode.window.showErrorMessage(`CPN IDE: event log export failed: ${msg}`);
  }
}

export function registerReplicationCommands(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('cpnIde.runReplications', replications),
    vscode.commands.registerCommand('cpnIde.exportEventLog', eventLog),
  );
}
