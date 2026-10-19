import * as vscode from 'vscode';
import { EXAMPLES } from '../model/examples';
import type { BackendManager } from '../runtime/backend';
import { backendRows, groupModels, MODEL_GLOB, modelKind, type ModelGroup } from './sidebar-core';

const WALKTHROUGH = 'AleFire99.cpn-ide-vscode#gettingStarted';
const DOCS = 'https://github.com/AleFire99/cpn-ide-vscode#readme';

/** A net row: the files sharing one base name in one folder. File rows are their `vscode.Uri`, so item menus get a Uri. */
class NetNode {
  constructor(
    readonly group: ModelGroup,
    readonly openUri: vscode.Uri,
    readonly files: vscode.Uri[],
  ) {}
}
type ModelElement = NetNode | vscode.Uri;

const REFRESH_DELAY_MS = 200;

/** Models view: one row per net, with its .cpn, .petri.json and .sml files as children. */
class ModelsProvider implements vscode.TreeDataProvider<ModelElement>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly loaded = new vscode.EventEmitter<void>();
  /** Fires after the top-level rows have been (re)loaded. */
  readonly onDidLoad = this.loaded.event;
  private readonly watcher = vscode.workspace.createFileSystemWatcher(MODEL_GLOB, false, true, false);
  private readonly subs: vscode.Disposable[];
  private timer: NodeJS.Timeout | undefined;
  private nets: NetNode[] = [];
  private readonly parents = new Map<string, NetNode>();
  private readonly fileUris = new Map<string, vscode.Uri>();

  constructor() {
    const schedule = () => this.scheduleRefresh();
    this.subs = [this.watcher, this.watcher.onDidCreate(schedule), this.watcher.onDidDelete(schedule), vscode.workspace.onDidChangeWorkspaceFolders(schedule)];
  }

  /** Refresh once after a burst of file events (git checkout, unzip). */
  private scheduleRefresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), REFRESH_DELAY_MS);
  }

  refresh(): void {
    clearTimeout(this.timer);
    this.changed.fire();
  }

  /** The element of a listed file, once the tree has been read. */
  fileElement(uri: vscode.Uri): vscode.Uri | undefined {
    return this.fileUris.get(uri.toString());
  }

  async getChildren(element?: ModelElement): Promise<ModelElement[]> {
    if (element instanceof NetNode) return element.files;
    if (element || !vscode.workspace.workspaceFolders?.length) return [];
    const uris = await vscode.workspace.findFiles(MODEL_GLOB, '**/node_modules/**');
    const multiRoot = vscode.workspace.workspaceFolders.length > 1;
    const byPath = new Map(uris.map((u) => [vscode.workspace.asRelativePath(u, multiRoot), u]));
    this.parents.clear();
    this.fileUris.clear();
    this.nets = groupModels([...byPath.keys()]).map((g) => {
      const net = new NetNode(g, byPath.get(g.open)!, g.files.map((f) => byPath.get(f.path)!));
      for (const u of net.files) {
        this.parents.set(u.toString(), net);
        this.fileUris.set(u.toString(), u);
      }
      return net;
    });
    setTimeout(() => this.loaded.fire(), 0); // after VS Code has received the rows
    return this.nets;
  }

  getParent(element: ModelElement): NetNode | undefined {
    return element instanceof NetNode ? undefined : this.parents.get(element.toString());
  }

  getTreeItem(element: ModelElement): vscode.TreeItem {
    if (element instanceof NetNode) {
      const { group } = element;
      const item = new vscode.TreeItem(group.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `${group.dir}/${group.name}`;
      item.description = group.dir || undefined;
      item.tooltip = group.open;
      item.iconPath = new vscode.ThemeIcon('type-hierarchy');
      item.contextValue = 'net';
      item.command = { title: 'Open in CPN IDE', command: 'cpnIde.openInCpnIde', arguments: [element.openUri] };
      return item;
    }
    const item = new vscode.TreeItem(element);
    item.tooltip = vscode.workspace.asRelativePath(element, (vscode.workspace.workspaceFolders?.length ?? 0) > 1);
    const kind = modelKind(element.path);
    item.contextValue = kind;
    item.command =
      kind === 'sml' ? { title: 'Open', command: 'vscode.open', arguments: [element] } : { title: 'Open in CPN IDE', command: 'cpnIde.openInCpnIde', arguments: [element] };
    return item;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.changed.dispose();
    this.loaded.dispose();
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
    this.sub = vscode.Disposable.from(
      backend.onDidChangeStatus(() => this.changed.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('cpnIde.backendUrl') && this.changed.fire()),
    );
  }

  dispose(): void {
    this.sub.dispose();
    this.changed.dispose();
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) return [];
    return backendRows(this.backend.status, {
      isMac: process.platform === 'darwin',
      hasBackendUrl: !!vscode.workspace.getConfiguration('cpnIde').get<string>('backendUrl')?.trim(),
    }).map((r) => {
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

/** The file behind the active tab (text editor or custom editor), if any. */
function activeFile(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

/** The CPN IDE view container in the Activity Bar. */
export function registerSidebar(backend: BackendManager): vscode.Disposable {
  const models = new ModelsProvider();
  const backendView = new BackendProvider(backend);
  const modelsView = vscode.window.createTreeView('cpnIde.models', { treeDataProvider: models });
  /** Select the active model's file row, without taking focus. */
  const reveal = () => {
    const uri = activeFile();
    const element = uri && modelsView.visible ? models.fileElement(uri) : undefined;
    if (element) void Promise.resolve(modelsView.reveal(element, { select: true, focus: false })).catch(() => undefined);
  };
  return vscode.Disposable.from(
    models,
    models.onDidLoad(reveal),
    backendView,
    modelsView,
    modelsView.onDidChangeVisibility(reveal),
    vscode.window.tabGroups.onDidChangeTabs(reveal),
    vscode.window.registerTreeDataProvider('cpnIde.backend', backendView),
    vscode.window.registerTreeDataProvider('cpnIde.start', new StartProvider()),
    vscode.commands.registerCommand('cpnIde.refreshModels', () => models.refresh()),
    vscode.commands.registerCommand('cpnIde.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'cpnIde')),
  );
}
