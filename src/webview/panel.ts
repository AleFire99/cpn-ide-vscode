import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { decodeBytes, encodeText, PathAllowlist, toVsCodeFilters } from './host-core';
import { buildWebviewHtml, makeNonce, type CpnConfig } from './html';

/** Observable by the integration tests through the `cpnIde._lastReady` command. */
export const uiState = { ready: 0, errors: [] as string[], panels: 0, backendUrl: '' };

/** Path string the UI uses for a URI: fsPath for local files, full URI otherwise. */
export function uriToPath(u: vscode.Uri): string {
  return u.scheme === 'file' ? u.fsPath : u.toString();
}

export function pathToUri(p: string): vscode.Uri {
  return /^[a-z][a-z0-9+.-]+:\/\//i.test(p) ? vscode.Uri.parse(p) : vscode.Uri.file(p);
}

export function webviewOptions(ctx: vscode.ExtensionContext): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(ctx.extensionUri, 'resources', 'ui'),
      vscode.Uri.joinPath(ctx.extensionUri, 'media'),
    ],
  };
}

export function renderHtml(ctx: vscode.ExtensionContext, webview: vscode.Webview, backendUrl: string, config: CpnConfig): string {
  uiState.backendUrl = backendUrl;
  const uiDir = vscode.Uri.joinPath(ctx.extensionUri, 'resources', 'ui');
  const indexHtml = fs.readFileSync(path.join(uiDir.fsPath, 'index.html'), 'utf8');
  return buildWebviewHtml({
    indexHtml,
    mapUri: (rel) => webview.asWebviewUri(vscode.Uri.joinPath(uiDir, ...rel.split('/'))).toString(),
    baseUri: webview.asWebviewUri(uiDir).toString(),
    shimUri: webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', 'shim.js')).toString(),
    cspSource: webview.cspSource,
    nonce: makeNonce(),
    backendUrl,
    config,
  });
}

export interface BridgeOptions {
  /** In editor mode: the document path; writes to it go through onWriteDocument instead of the file system. */
  documentPath?: string;
  readDocument?: () => string;
  onWriteDocument?: (text: string) => Thenable<unknown> | void;
}

/**
 * Host side of the shim: serves the Electron-style dialogs / fs calls of the UI.
 *
 * Encoding: files are read as UTF-8; if the bytes are not valid UTF-8 they are decoded as latin1
 * (older models declare iso-8859-1) and written back as latin1, so bytes round-trip.
 * Everything else is written as UTF-8.
 */
export function attachBridge(webview: vscode.Webview, opts: BridgeOptions = {}): vscode.Disposable {
  const allowed = new PathAllowlist(opts.documentPath ? [opts.documentPath] : []);
  const encodings = new Map<string, 'utf8' | 'latin1'>();

  const handlers: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
    async showOpenDialog(a) {
      const o = (a.options ?? {}) as Record<string, unknown>;
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: toVsCodeFilters(o.filters) ?? { 'CPN models': ['cpn', 'CPN'] },
        title: typeof o.title === 'string' ? o.title : undefined,
      });
      const paths = uris?.map(uriToPath);
      paths?.forEach((x) => allowed.add(x));
      return paths;
    },
    async showSaveDialog(a) {
      const o = (a.options ?? {}) as Record<string, unknown>;
      let defaultUri: vscode.Uri | undefined;
      if (typeof o.defaultPath === 'string' && o.defaultPath) {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (path.isAbsolute(o.defaultPath) || /^[a-z][a-z0-9+.-]+:\/\//i.test(o.defaultPath)) defaultUri = pathToUri(o.defaultPath);
        else if (folder) defaultUri = vscode.Uri.joinPath(folder.uri, o.defaultPath);
      }
      const u = await vscode.window.showSaveDialog({
        defaultUri,
        filters: toVsCodeFilters(o.filters) ?? { 'CPN models': ['cpn'] },
        title: typeof o.title === 'string' ? o.title : undefined,
      });
      if (!u) return undefined;
      allowed.add(uriToPath(u));
      return uriToPath(u);
    },
    async readFile(a) {
      const p = String(a.path);
      allowed.assert(p);
      if (opts.documentPath === p && opts.readDocument) return opts.readDocument();
      const d = decodeBytes(await vscode.workspace.fs.readFile(pathToUri(p)));
      encodings.set(p, d.encoding);
      return d.text;
    },
    async writeFile(a) {
      const p = String(a.path);
      allowed.assert(p);
      const data = String(a.data);
      if (opts.documentPath === p && opts.onWriteDocument) {
        await opts.onWriteDocument(data);
        return;
      }
      await vscode.workspace.fs.writeFile(pathToUri(p), encodeText(data, encodings.get(p)));
    },
    async openExternal(a) {
      const url = String(a.url);
      if (/^https?:\/\//i.test(url)) await vscode.env.openExternal(vscode.Uri.parse(url));
    },
    async ready() {
      uiState.ready++;
    },
    async error(a) {
      uiState.errors.push(String(a.message));
    },
  };

  return webview.onDidReceiveMessage(async (m: { type?: string; id?: number; op?: string; args?: Record<string, unknown> }) => {
    if (!m || (m.type !== 'req' && m.type !== 'notify') || !m.op) return;
    const h = handlers[m.op];
    try {
      if (!h) throw new Error(`unsupported operation ${m.op}`);
      const result = await h(m.args ?? {});
      if (m.type === 'req') void webview.postMessage({ type: 'res', id: m.id, ok: true, result });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (m.type === 'req') void webview.postMessage({ type: 'res', id: m.id, ok: false, error });
      else void vscode.window.showErrorMessage(`CPN IDE: ${error}`);
    }
  });
}

/** Free-standing CPN IDE panel (no document bound). */
export function openStandalonePanel(ctx: vscode.ExtensionContext, backendUrl: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel('cpnIde.panel', 'CPN IDE', vscode.ViewColumn.Active, {
    ...webviewOptions(ctx),
    retainContextWhenHidden: true,
  });
  panel.webview.html = renderHtml(ctx, panel.webview, backendUrl, { mode: 'standalone' });
  const bridge = attachBridge(panel.webview);
  uiState.panels++;
  panel.onDidDispose(() => {
    bridge.dispose();
    uiState.panels--;
  });
  return panel;
}
