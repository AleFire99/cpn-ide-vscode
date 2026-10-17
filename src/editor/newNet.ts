import * as vscode from 'vscode';
import { starterModel, stripSpecSuffix, validateModelName } from '../model/workspace';
import { encodeText } from '../webview/host-core';
import { PETRI_VIEW_TYPE } from './petriModel';

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Folder for the new model: the Explorer folder it was invoked on, else a workspace folder, else one the user picks. */
async function targetFolder(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (uri) {
    try {
      const st = await vscode.workspace.fs.stat(uri);
      return st.type & vscode.FileType.Directory ? uri : vscode.Uri.joinPath(uri, '..');
    } catch {
      /* fall through */
    }
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0].uri;
  if (folders.length > 1) return (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Folder for the new net' }))?.uri;
  const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Create net here' });
  return picked?.[0];
}

/** "CPN IDE: New Net": write `<name>.petri.json` + `<name>.sml` with a starter net and open it in the canvas. */
export async function newNet(uri?: vscode.Uri): Promise<void> {
  const folder = await targetFolder(uri);
  if (!folder) return;
  const name = await vscode.window.showInputBox({
    prompt: 'Name of the new net (creates NAME.petri.json and NAME.sml)',
    value: 'net',
    validateInput: validateModelName,
  });
  if (name === undefined) return;
  const m = starterModel(stripSpecSuffix(name.trim()));
  const jsonUri = vscode.Uri.joinPath(folder, m.jsonName);
  const smlUri = vscode.Uri.joinPath(folder, m.smlName);
  const existing: string[] = [];
  for (const u of [jsonUri, smlUri]) if (await exists(u)) existing.push(vscode.workspace.asRelativePath(u));
  if (existing.length) {
    const ok = await vscode.window.showWarningMessage(`Overwrite ${existing.join(' and ')}?`, { modal: true }, 'Overwrite');
    if (ok !== 'Overwrite') return;
  }
  await vscode.workspace.fs.writeFile(smlUri, encodeText(m.sml));
  await vscode.workspace.fs.writeFile(jsonUri, encodeText(m.json));
  await vscode.commands.executeCommand('vscode.openWith', jsonUri, PETRI_VIEW_TYPE);
}
