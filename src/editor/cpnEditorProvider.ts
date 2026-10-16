import * as vscode from 'vscode';
import { ModelError, formatIssue } from '../model/types';
import { BackendManager } from '../runtime/backend';
import { errorPageHtml, fileName } from '../webview/host-core';
import { attachBridge, registerReloader, renderHtml, uiState, uriToPath, webviewOptions } from '../webview/panel';

export const VIEW_TYPE = 'cpnIde.editor';

/** Where an editor gets its CPN Tools XML from and where UI saves go. */
export interface ModelAdapter {
  loadXml(): Promise<string>;
  saveXml(xml: string): Promise<void>;
}

export interface MountOptions {
  /** URI of the document the editor is bound to (what the UI treats as its file). */
  uri: vscode.Uri;
  /** Name shown by the UI; defaults to the document's file name. */
  displayName?: string;
  adapter: ModelAdapter;
}

export interface MountedEditor {
  /** Reload the model from the adapter and re-render the webview. */
  reload(): Promise<void>;
}

/**
 * Shared editor plumbing: boots the backend, renders the UI with the adapter's XML as startup model,
 * bridges UI saves to the adapter. Load failures (including ModelError) show an error page instead.
 */
export async function mountEditor(
  ctx: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  o: MountOptions,
): Promise<MountedEditor | undefined> {
  panel.webview.options = webviewOptions(ctx);
  let baseUrl: string;
  try {
    baseUrl = await BackendManager.get().ensureStarted();
  } catch {
    panel.webview.html =
      '<body style="font-family:sans-serif;padding:1em">CPN IDE backend failed to start. See the "CPN IDE" output channel.</body>';
    return undefined;
  }
  const docPath = uriToPath(o.uri);
  const name = o.displayName ?? fileName(docPath);
  let seq = 0;
  const render = async (url: string) => {
    baseUrl = url;
    const mine = ++seq;
    try {
      const xml = await o.adapter.loadXml();
      if (mine !== seq) return;
      panel.webview.html = renderHtml(ctx, panel.webview, url, { mode: 'editor', fileName: name, filePath: docPath, initialXml: xml });
    } catch (e) {
      if (mine !== seq) return;
      const lines = e instanceof ModelError ? e.issues.map(formatIssue) : [e instanceof Error ? e.message : String(e)];
      const out = BackendManager.get().output;
      out.appendLine(`[model] ${name}: cannot open`);
      for (const l of lines) out.appendLine(`  ${l}`);
      panel.webview.html = errorPageHtml(`Cannot open ${name}`, lines);
    }
  };
  await render(baseUrl);
  const reloader = registerReloader((url) => void render(url));
  const bridge = attachBridge(panel.webview, {
    documentPath: docPath,
    readDocument: () => o.adapter.loadXml(),
    onWriteDocument: (text) => o.adapter.saveXml(text),
  });
  uiState.panels++;
  panel.onDidDispose(() => {
    bridge.dispose();
    reloader.dispose();
    uiState.panels--;
  });
  return { reload: () => render(baseUrl) };
}

/**
 * Custom text editor for *.cpn. The document text is handed to the UI as its startup model.
 * Saves from the UI replace the document text and save the document. Edits made in the UI are
 * not mirrored into the text buffer until the UI saves (no live dirty tracking).
 */
export class CpnEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  static register(ctx: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(VIEW_TYPE, new CpnEditorProvider(ctx), {
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    await mountEditor(this.ctx, panel, {
      uri: document.uri,
      adapter: {
        loadXml: async () => document.getText(),
        saveXml: async (text) => {
          if (text !== document.getText()) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
            await vscode.workspace.applyEdit(edit);
          }
          await document.save();
        },
      },
    });
  }
}
