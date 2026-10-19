// "Net" sidebar view: pages, places, transitions and arcs of the text model behind the active tab.

import * as vscode from 'vscode';
import { netSymbols, type NetSymbol, type NetSymbolKind } from '../model/petri-lang';

const ICONS: Record<NetSymbolKind, string> = {
  page: 'symbol-namespace',
  place: 'circle-large-outline',
  transition: 'symbol-event',
  substitution: 'symbol-module',
  arc: 'arrow-right',
};

interface NetNode {
  sym: NetSymbol;
  page?: string;
}

interface Source {
  uri: vscode.Uri;
  /** The active tab is the canvas, so text opens beside it. */
  canvas: boolean;
}

/** The `.petri.json` the active tab shows or sits next to (`NAME.cpn` / `NAME.sml`); undefined if none. */
async function sourceOf(): Promise<Source | undefined> {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!(input instanceof vscode.TabInputText) && !(input instanceof vscode.TabInputCustom)) return undefined;
  const canvas = input instanceof vscode.TabInputCustom;
  const path = input.uri.path;
  if (path.endsWith('.petri.json')) return { uri: input.uri, canvas };
  const m = /^(.*)\.(cpn|sml)$/.exec(path);
  if (!m) return undefined;
  const uri = input.uri.with({ path: `${m[1]}.petri.json` });
  try {
    await vscode.workspace.fs.stat(uri);
    return { uri, canvas };
  } catch {
    return undefined;
  }
}

class NetProvider implements vscode.TreeDataProvider<NetNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<NetNode>;
  private readonly subs: vscode.Disposable[];
  private timer: NodeJS.Timeout | undefined;
  private source: Source | undefined;
  private roots: NetSymbol[] = [];
  private stale = true;

  constructor() {
    this.view = vscode.window.createTreeView('cpnIde.net', { treeDataProvider: this });
    const schedule = () => this.schedule();
    this.subs = [
      this.changed,
      this.view,
      this.view.onDidChangeVisibility((e) => e.visible && this.stale && this.schedule()),
      vscode.window.tabGroups.onDidChangeTabs(schedule),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === this.source?.uri.toString()) schedule();
      }),
    ];
    schedule();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.subs.forEach((s) => s.dispose());
  }

  /** Debounced reload; while the view is hidden it only marks the content stale. */
  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.view.visible) {
      this.stale = true;
      return;
    }
    this.timer = setTimeout(() => void this.reload(), 300);
  }

  private async reload(): Promise<void> {
    this.stale = false;
    const src = await sourceOf();
    let roots: NetSymbol[] = [];
    if (src) {
      try {
        roots = netSymbols((await vscode.workspace.openTextDocument(src.uri)).getText());
      } catch {
        roots = [];
      }
    }
    this.source = src;
    this.roots = roots;
    this.view.description = src ? src.uri.path.slice(src.uri.path.lastIndexOf('/') + 1) : undefined;
    this.changed.fire();
  }

  getChildren(node?: NetNode): NetNode[] {
    if (!node) return this.roots.map((sym) => ({ sym }));
    return node.sym.children.map((sym) => ({ sym, page: node.sym.name }));
  }

  getTreeItem({ sym, page }: NetNode): vscode.TreeItem {
    const state = sym.kind === 'page' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(sym.name, state);
    item.description = sym.detail || undefined;
    item.iconPath = new vscode.ThemeIcon(ICONS[sym.kind]);
    const kind = sym.kind === 'substitution' ? 'substitution transition' : sym.kind;
    item.tooltip = [kind, sym.name, sym.detail && `(${sym.detail})`, page && `on page ${page}`].filter(Boolean).join(' ');
    if (this.source) item.command = { title: 'Show in text', command: 'cpnIde.net.reveal', arguments: [this.source, sym.selection] };
    return item;
  }
}

/** Select the node's JSON in a text editor (beside the canvas when that is the active tab). */
async function reveal(src: Source, sel: [number, number]): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(src.uri);
  const selection = new vscode.Range(doc.positionAt(sel[0]), doc.positionAt(sel[1]));
  await vscode.window.showTextDocument(doc, { selection, preview: true, viewColumn: src.canvas ? vscode.ViewColumn.Beside : undefined });
}

export function registerNetView(): vscode.Disposable {
  return vscode.Disposable.from(new NetProvider(), vscode.commands.registerCommand('cpnIde.net.reveal', reveal));
}
