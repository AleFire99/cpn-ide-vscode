import * as vscode from 'vscode';
import { EXAMPLES } from '../model/examples';
import type { BackendManager } from '../runtime/backend';
import { backendRows, MODEL_GLOB, modelKind, sortModelPaths } from './sidebar-core';

const WALKTHROUGH = 'AleFire99.cpn-ide-vscode#gettingStarted';
const DOCS = 'https://github.com/AleFire99/cpn-ide-vscode#readme';

/** Models view: the .cpn and .petri.json files in the workspace. Elements are the file URIs, so item menus get a Uri. */
class ModelsProvider implements vscode.TreeDataProvider<vscode.Uri>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly watcher = vscode.workspace.createFileSystemWatcher(MODEL_GLOB, false, true, false);
  private readonly subs: vscode.Disposable[];

  constructor() {
    const refresh = () => this.refresh();
    this.subs = [this.watcher, this.watcher.onDidCreate(refresh), this.watcher.onDidDelete(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh)];
  }

  refresh(): void {
    this.changed.fire();
  }

  async getChildren(element?: vscode.Uri): Promise<vscode.Uri[]> {
    if (element || !vscode.workspace.workspaceFolders?.length) return [];
    const uris = await vscode.workspace.findFiles(MODEL_GLOB, '**/node_modules/**');
    const byPath = new Map(uris.map((u) => [vscode.workspace.asRelativePath(u, true), u]));
    return sortModelPaths([...byPath.keys()]).map((p) => byPath.get(p)!);
  }

  getTreeItem(uri: vscode.Uri): vscode.TreeItem {
    const item = new vscode.TreeItem(uri);
    const rel = vscode.workspace.asRelativePath(uri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1);
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    item.description = dir || undefined;
    item.tooltip = rel;
    item.contextValue = modelKind(uri.path);
    item.command = { title: 'Open in CPN IDE', command: 'cpnIde.openInCpnIde', arguments: [uri] };
    return item;
  }

  dispose(): void {
    this.changed.dispose();
    for (const s of this.subs) s.dispose();
  }
}

function leaf(label: string, icon: string, command: vscode.Command, opts: { tooltip?: string; description?: string } = {}): vscode.TreeItem {
  const item = new vscode.TreeItem(label);
  item.iconPath = new vscode.ThemeIcon(icon);
  item.command = command;
  item.tooltip = opts.tooltip;
  item.description = opts.description;
  return item;
}

/** Backend view: the backend state and the actions that apply to it. */
class BackendProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly sub: vscode.Disposable;

  constructor(private readonly backend: BackendManager) {
    this.sub = backend.onDidChangeStatus(() => this.changed.fire());
  }

  dispose(): void {
    this.sub.dispose();
    this.changed.dispose();
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) return [];
    return backendRows(this.backend.status).map((r) => {
      const item = new vscode.TreeItem(r.label);
      item.iconPath = new vscode.ThemeIcon(r.icon);
      item.tooltip = r.tooltip;
      item.description = r.description;
      if (r.command) item.command = { title: r.label, command: r.command, arguments: r.args };
      return item;
    });
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }
}

/** Get Started view: the bundled examples, the walkthrough and the docs. */
class StartProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) return [];
    return [
      ...EXAMPLES.map((e) =>
        leaf(e.label, 'type-hierarchy', { title: 'Open Example', command: 'cpnIde.openExample', arguments: [e.id] }, { tooltip: e.detail, description: 'example' }),
      ),
      leaf('New Net…', 'new-file', { title: 'New Net', command: 'cpnIde.newNet' }),
      leaf('Walkthrough', 'book', { title: 'Open Walkthrough', command: 'workbench.action.openWalkthrough', arguments: [WALKTHROUGH, false] }),
      leaf('Documentation', 'link-external', { title: 'Open Documentation', command: 'vscode.open', arguments: [vscode.Uri.parse(DOCS)] }),
    ];
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }
}

/** The CPN IDE view container in the Activity Bar. */
export function registerSidebar(backend: BackendManager): vscode.Disposable {
  const models = new ModelsProvider();
  const backendView = new BackendProvider(backend);
  return vscode.Disposable.from(
    models,
    backendView,
    vscode.window.registerTreeDataProvider('cpnIde.models', models),
    vscode.window.registerTreeDataProvider('cpnIde.backend', backendView),
    vscode.window.registerTreeDataProvider('cpnIde.start', new StartProvider()),
    vscode.commands.registerCommand('cpnIde.refreshModels', () => models.refresh()),
  );
}
