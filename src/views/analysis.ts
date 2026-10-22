// "Analysis" sidebar view: Check Model bridges CPN IDE's Validate and lists the findings.

import * as vscode from 'vscode';
import { loadModel } from '../editor/petriModel';
import { nodeNames } from '../model/decompile';
import { locatePointer, modelIssuesToFindings, remoteIssuesToFindings, validateRemote, type FetchLike, type Finding } from '../model/diagnostics';
import { isSpecFile } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { findingsToRows, type AnalysisRow } from './analysis-core';
import { registerReplicationCommands } from './analysis-replication';

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

  getChildren(): AnalysisRow[] {
    return this.rows;
  }

  getTreeItem(row: AnalysisRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label);
    item.description = row.description;
    item.tooltip = row.description ? `${row.label} (${row.description})` : row.label;
    item.iconPath = new vscode.ThemeIcon(row.icon);
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
    registerReplicationCommands(),
  );
}
