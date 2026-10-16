import * as vscode from 'vscode';

/** Placeholder: the real webview panel arrives with issue #5. */
export async function openPanel(baseUrl: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(baseUrl));
}
