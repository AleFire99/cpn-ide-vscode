// "Analysis" sidebar view: Check Model bridges CPN IDE's Validate and lists the findings.

import * as vscode from 'vscode';
import { loadModel } from '../editor/petriModel';
import { nodeNames } from '../model/decompile';
import { locatePointer, modelIssuesToFindings, remoteIssuesToFindings, validateRemote, type FetchLike, type Finding } from '../model/diagnostics';
import { isSpecFile } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { findingsToRows, type AnalysisRow } from './analysis-core';
// #107 (structural analysis and state space)
import { randomUUID } from 'node:crypto';
import { toPTNet } from '../analysis/abstract';
import { decompile } from '../model/decompile';
import type { PetriSpec } from '../model/types';
import { exploreStateSpace, DEFAULT_MAX_NODES, DEFAULT_MAX_MS, type StateSpaceResult } from '../runtime/explore-core';
import { analyseStructure, reportText, stateSpaceRows, structuralRows, type StructuralResults } from './analysis-core';

/** Where a finding's text lives. */
interface Files {
  spec: vscode.Uri;
  sml: vscode.Uri;
}

/** Model file behind the active tab, if it is a `.cpn` or `.petri.json`. */
function activeModel(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!(input instanceof vscode.TabInputText) && !(input instanceof vscode.TabInputCustom)) return undefined;
  const p = input.uri.path.toLowerCase();
  return p.endsWith('.cpn') || isSpecFile(p) ? input.uri : undefined;
}

class AnalysisProvider implements vscode.TreeDataProvider<AnalysisRow>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<AnalysisRow>;
  private readonly sub: vscode.Disposable;
  private rows: AnalysisRow[] = [];
  /** The model last seen in an editor, used when the active tab is something else. */
  private lastModel: vscode.Uri | undefined;
  private files: Files | undefined;
  // --- #107 results
  private structural: StructuralResults | undefined;
  private stateSpace: StateSpaceResult | undefined;
  private resultModel: vscode.Uri | undefined;

  constructor() {
    this.view = vscode.window.createTreeView('cpnIde.analysis', { treeDataProvider: this });
    this.lastModel = activeModel();
    this.sub = vscode.window.tabGroups.onDidChangeTabs(() => (this.lastModel = activeModel() ?? this.lastModel));
  }

  dispose(): void {
    this.sub.dispose();
    this.view.dispose();
    this.changed.dispose();
  }

  getChildren(row?: AnalysisRow): AnalysisRow[] {
    if (row) return row.children ?? [];
    return [...this.rows, ...this.resultSections()];
  }

  getTreeItem(row: AnalysisRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, row.kind === 'section' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    item.description = row.description;
    item.tooltip = row.description ? `${row.label} (${row.description})` : row.label;
    item.iconPath = new vscode.ThemeIcon(row.icon);
    if (row.command) item.command = { title: row.label, command: row.command };
    if (row.kind === 'finding' && this.files) item.command = { title: 'Show source', command: 'cpnIde.analysis.reveal', arguments: [this.files, row] };
    return item;
  }

  /** Validate the active model (or the last one seen) and show the findings. */
  async check(): Promise<void> {
    const uri = activeModel() ?? this.lastModel;
    if (!uri) {
      void vscode.window.showInformationMessage('CPN IDE: open a .cpn or .petri.json model to check.');
      return;
    }
    const backend = BackendManager.get();
    let url = backend.currentUrl();
    if (!url) {
      const pick = await vscode.window.showInformationMessage('CPN IDE: the backend is not running.', 'Start Backend');
      if (pick !== 'Start Backend') return;
    }
    await vscode.window.withProgress({ location: { viewId: 'cpnIde.analysis' }, title: 'Checking model' }, async () => {
      try {
        url ??= await backend.ensureStarted();
        await this.run(uri, url);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        backend.output.appendLine(`[analysis] ${uri.fsPath}: ${msg}`);
        void vscode.window.showErrorMessage(`CPN IDE: Check Model failed: ${msg}`);
      }
    });
  }

  // ---- #107: Structural Analysis, Analyse State Space, Save Report ----

  private resultSections(): AnalysisRow[] {
    const out: AnalysisRow[] = [];
    if (this.structural) out.push(...structuralRows(this.structural, this.stateSpace));
    if (this.stateSpace) out.push(...stateSpaceRows(this.stateSpace));
    return out;
  }

  private target(): vscode.Uri | undefined {
    const uri = activeModel() ?? this.lastModel;
    if (!uri) void vscode.window.showInformationMessage('CPN IDE: open a .cpn or .petri.json model first.');
    return uri;
  }

  /** Forget results of another model. */
  private adopt(uri: vscode.Uri): void {
    if (this.resultModel?.toString() !== uri.toString()) {
      this.structural = undefined;
      this.stateSpace = undefined;
    }
    this.resultModel = uri;
  }

  private show(uri: vscode.Uri): void {
    this.view.description = uri.path.slice(uri.path.lastIndexOf('/') + 1);
    this.changed.fire();
  }

  /** The `.cpn` XML (absent when a text model does not compile), and the `PetriSpec` and declarations for the structural view. */
  private async source(uri: vscode.Uri): Promise<{ xml?: string; spec: PetriSpec; sml: string }> {
    if (isSpecFile(uri.path)) {
      const model = await loadModel(uri);
      return { xml: model.compiled?.xml, spec: JSON.parse(model.specDoc.getText()) as PetriSpec, sml: model.sml };
    }
    const xml = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const d = decompile(xml);
    return { xml, spec: d.spec, sml: d.sml };
  }

  async structuralAnalysis(): Promise<void> {
    const uri = this.target();
    if (!uri) return;
    try {
      const { spec, sml } = await this.source(uri);
      this.adopt(uri);
      this.structural = analyseStructure(toPTNet(spec, sml));
      this.show(uri);
    } catch (e) {
      void vscode.window.showErrorMessage(`CPN IDE: Structural Analysis failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async analyseStateSpace(): Promise<void> {
    const uri = this.target();
    if (!uri) return;
    const cfg = vscode.workspace.getConfiguration('cpnIde');
    const maxNodes = cfg.get<number>('stateSpace.maxStates', DEFAULT_MAX_NODES);
    const maxMs = cfg.get<number>('stateSpace.timeoutSeconds', DEFAULT_MAX_MS / 1000) * 1000;
    const backend = BackendManager.get();
    try {
      const { xml, spec, sml } = await this.source(uri);
      if (!xml) {
        void vscode.window.showErrorMessage('CPN IDE: the model does not compile; fix its errors first (Check Model).');
        return;
      }
      const outcome = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CPN IDE: exploring the state space', cancellable: true },
        async (progress, token) => {
          const base = await backend.ensureStarted();
          const ac = new AbortController();
          token.onCancellationRequested(() => ac.abort());
          return exploreStateSpace({
            fetch: (url, init) => fetch(url, init),
            baseUrl: base,
            xml,
            sessionId: `statespace-${randomUUID()}`,
            userHome: backend.userHome(),
            names: nodeNames(xml),
            maxNodes,
            maxMs,
            signal: ac.signal,
            onProgress: (n) => progress.report({ message: `${n} states` }),
          });
        },
      );
      if (!outcome.ok) {
        void vscode.window.showErrorMessage(`CPN IDE: the model has errors: ${JSON.stringify(outcome.issues).slice(0, 300)}`);
        return;
      }
      this.adopt(uri);
      this.stateSpace = outcome.result;
      // Show the structural results next to it, so a deadlock candidate is confirmed or refuted in place.
      if (!this.structural) {
        try {
          this.structural = analyseStructure(toPTNet(spec, sml));
        } catch {
          // The state space stands on its own.
        }
      }
      this.show(uri);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      backend.output.appendLine(`[state space] ${uri.fsPath}: ${msg}`);
      void vscode.window.showErrorMessage(`CPN IDE: Analyse State Space failed: ${msg}`);
    }
  }

  async saveReport(): Promise<void> {
    if (!this.resultModel || (!this.structural && !this.stateSpace)) {
      void vscode.window.showInformationMessage('CPN IDE: run Structural Analysis or Analyse State Space first.');
      return;
    }
    const name = this.resultModel.path.slice(this.resultModel.path.lastIndexOf('/') + 1);
    const base = name.replace(/\.(petri\.json|cpn)$/i, '');
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(this.resultModel, '..', `${base}.analysis.txt`),
      filters: { Text: ['txt'] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(reportText(name, this.structural, this.stateSpace), 'utf8'));
    void vscode.window.showInformationMessage(`CPN IDE: report saved to ${target.fsPath}`);
  }

  private async run(uri: vscode.Uri, url: string): Promise<void> {
    const fetchFn = fetch as unknown as FetchLike;
    let findings: Finding[];
    if (isSpecFile(uri.path)) {
      const model = await loadModel(uri);
      this.files = { spec: uri, sml: model.smlUri };
      findings = model.compiled
        ? remoteIssuesToFindings(await validateRemote(fetchFn, url, model.compiled.xml, 'cpnide-analysis'), model.compiled.idMap)
        : modelIssuesToFindings(model.issues ?? []);
    } else {
      const xml = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      this.files = { spec: uri, sml: uri };
      // A .cpn has no id map to a source line, so name the element in the message instead.
      const names = nodeNames(xml);
      const resp = await validateRemote(fetchFn, url, xml, 'cpnide-analysis');
      findings = Object.entries(resp.issues ?? {}).flatMap(([id, list]) =>
        remoteIssuesToFindings({ issues: { [id]: list } }, {}).map((f) => (names.has(id) ? { ...f, message: `${names.get(id)}: ${f.message}` } : f)),
      );
      if (resp.success === false && findings.length === 0) findings = remoteIssuesToFindings(resp, {});
    }
    this.rows = findingsToRows(findings);
    this.view.description = uri.path.slice(uri.path.lastIndexOf('/') + 1);
    this.changed.fire();
  }
}

/** Open the finding's source: the declarations line, the JSON value, or the model file itself. */
async function reveal(files: Files, row: AnalysisRow): Promise<void> {
  const s = row.source;
  const inSml = s?.file === 'sml' && s.line >= 1;
  const doc = await vscode.workspace.openTextDocument(inSml ? files.sml : files.spec);
  let range = new vscode.Range(0, 0, 0, 0);
  if (s?.file === 'sml' && inSml) range = new vscode.Range(s.line - 1, 0, s.line - 1, Number.MAX_SAFE_INTEGER);
  else if (s?.file === 'spec') {
    const r = locatePointer(doc.getText(), s.path);
    if (r) range = new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end));
  }
  await vscode.window.showTextDocument(doc, { selection: range, preview: true });
}

export function registerAnalysisView(): vscode.Disposable {
  const provider = new AnalysisProvider();
  return vscode.Disposable.from(
    provider,
    vscode.commands.registerCommand('cpnIde.checkModel', () => provider.check()),
    vscode.commands.registerCommand('cpnIde.analysis.reveal', reveal),
    // #107
    vscode.commands.registerCommand('cpnIde.structuralAnalysis', () => provider.structuralAnalysis()),
    vscode.commands.registerCommand('cpnIde.analyseStateSpace', () => provider.analyseStateSpace()),
    vscode.commands.registerCommand('cpnIde.saveAnalysisReport', () => provider.saveReport()),
  );
}
