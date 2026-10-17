import * as vscode from 'vscode';
import { EXAMPLES } from '../model/examples';
import { PETRI_VIEW_TYPE } from './petriModel';

const EXT = ['.petri.json', '.sml', '.cpn'];

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** `<workspace>/cpn-examples`, or a folder the user picks when no folder is open. */
async function examplesFolder(): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const root =
    folders.length === 1
      ? folders[0].uri
      : folders.length > 1
        ? (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Copy the example into' }))?.uri
        : (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Copy example here' }))?.[0];
  return root && (folders.length ? vscode.Uri.joinPath(root, 'cpn-examples') : root);
}

/** "CPN IDE: Open Example": copy a bundled example into the workspace (once) and open it in the canvas. */
export async function openExample(ctx: vscode.ExtensionContext, id?: string): Promise<void> {
  const ex =
    EXAMPLES.find((e) => e.id === id) ??
    (await vscode.window.showQuickPick(
      EXAMPLES.map((e) => ({ ...e, description: e.id })),
      { placeHolder: 'Example model to open' },
    ));
  if (!ex) return;
  const folder = await examplesFolder();
  if (!folder) return;
  await vscode.workspace.fs.createDirectory(folder);
  // Never overwrite: a copy the user already edited is opened as it is.
  for (const ext of EXT) {
    const dest = vscode.Uri.joinPath(folder, ex.id + ext);
    if (!(await exists(dest))) await vscode.workspace.fs.copy(vscode.Uri.joinPath(ctx.extensionUri, 'examples', ex.id + ext), dest);
  }
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(folder, `${ex.id}.petri.json`), PETRI_VIEW_TYPE);
}
