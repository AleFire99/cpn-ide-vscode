import * as vscode from 'vscode';
import { BackendManager } from '../runtime/backend';
import { fileName } from '../webview/host-core';
import { attachBridge, renderHtml, uiState, uriToPath, webviewOptions } from '../webview/panel';

export const VIEW_TYPE = 'cpnIde.editor';

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
    panel.webview.options = webviewOptions(this.ctx);
    let baseUrl: string;
    try {
      baseUrl = await BackendManager.get().ensureStarted();
    } catch {
      panel.webview.html =
        '<body style="font-family:sans-serif;padding:1em">CPN IDE backend failed to start. See the "CPN IDE" output channel.</body>';
      return;
    }
    const docPath = uriToPath(document.uri);
    panel.webview.html = renderHtml(this.ctx, panel.webview, baseUrl, {
      mode: 'editor',
      fileName: fileName(docPath),
      filePath: docPath,
      initialXml: document.getText(),
    });
    const bridge = attachBridge(panel.webview, {
      documentPath: docPath,
      readDocument: () => document.getText(),
      onWriteDocument: async (text) => {
        if (text !== document.getText()) {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
          await vscode.workspace.applyEdit(edit);
        }
        await document.save();
      },
    });
    uiState.panels++;
    panel.onDidDispose(() => {
      bridge.dispose();
      uiState.panels--;
    });
  }
}
