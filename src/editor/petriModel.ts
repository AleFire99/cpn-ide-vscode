import * as vscode from 'vscode';
import type { CompileResult } from '../model/compile';
import { compileSpecText, parseSpecText, smlRelativePath } from '../model/workspace';
import { ModelError, type ModelIssue } from '../model/types';
import { decodeBytes, encodeText } from '../webview/host-core';

export const PETRI_VIEW_TYPE = 'cpnIde.petriEditor';

/** Text of a file, or undefined when it does not exist / cannot be read. */
export async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return decodeBytes(await vscode.workspace.fs.readFile(uri)).text;
  } catch {
    return undefined;
  }
}

export async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, encodeText(text));
}

export function smlUriFor(specUri: vscode.Uri, specText: string): vscode.Uri {
  const rel = smlRelativePath(specUri.path, parseSpecText(specText));
  return vscode.Uri.joinPath(specUri, '..', ...rel.split(/[\\/]/));
}

export interface LoadedModel {
  specUri: vscode.Uri;
  smlUri: vscode.Uri;
  specDoc: vscode.TextDocument;
  /** Declarations text ('' when the file does not exist yet). */
  sml: string;
  /** Present when compilation succeeded. */
  compiled?: CompileResult;
  /** Present when it failed. */
  issues?: ModelIssue[];
}

/** Read the spec (open buffer wins over disk) and its declarations file, and compile them. */
export async function loadModel(specUri: vscode.Uri): Promise<LoadedModel> {
  const specDoc = await vscode.workspace.openTextDocument(specUri);
  const specText = specDoc.getText();
  const smlUri = smlUriFor(specUri, specText);
  const sml = (await readText(smlUri)) ?? '';
  try {
    return { specUri, smlUri, specDoc, sml, compiled: compileSpecText(specText, sml) };
  } catch (e) {
    if (e instanceof ModelError) return { specUri, smlUri, specDoc, sml, issues: e.issues };
    throw e;
  }
}
