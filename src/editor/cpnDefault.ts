import * as vscode from 'vscode';
import { VIEW_TYPE } from './cpnEditorProvider';
import { shouldAsk, withCpnAssociation, type PromptAnswer, type TextTabInfo } from './cpn-default-core';

const NEVER_KEY = 'cpnIde.neverAskDefaultEditor';
/** Paths the user explicitly reopened as text ("CPN IDE: Reopen as XML Text"): do not nag about them. */
const openedAsText = new Set<string>();
let deferred = false;
let asking = false;

export function markOpenedAsText(uri: vscode.Uri): void {
  openedAsText.add(uri.path);
}

function textTabInfo(tab: vscode.Tab | undefined): (TextTabInfo & { uri: vscode.Uri }) | undefined {
  const input = tab?.input;
  if (input instanceof vscode.TabInputText) return { uri: input.uri, scheme: input.uri.scheme, path: input.uri.path, isDiff: false };
  return undefined; // TabInputTextDiff, custom editors, webviews, ...
}

async function maybeAsk(ctx: vscode.ExtensionContext, tab: vscode.Tab | undefined): Promise<void> {
  const info = textTabInfo(tab);
  if (!info || asking) return;
  const cfg = vscode.workspace.getConfiguration('workbench');
  const associations = cfg.get<Record<string, string>>('editorAssociations');
  const state = { never: ctx.globalState.get<boolean>(NEVER_KEY, false), deferred, associations, openedAsText };
  if (!shouldAsk(info, state)) return;
  asking = true;
  try {
    const answer = await vscode.window.showInformationMessage<PromptAnswer>('Always open .cpn files in CPN IDE?', 'Yes', 'Not now', 'Never');
    if (answer === 'Yes') {
      await cfg.update('editorAssociations', withCpnAssociation(associations, VIEW_TYPE), vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('vscode.openWith', info.uri, VIEW_TYPE);
      if (tab) await vscode.window.tabGroups.close(tab);
    } else if (answer === 'Never') {
      await ctx.globalState.update(NEVER_KEY, true);
    } else {
      deferred = true; // dismissing counts as Not now: ask again next session
    }
  } finally {
    asking = false;
  }
}

/** Offer once to make the CPN IDE canvas the default editor for *.cpn files (#70). */
export function registerDefaultEditorPrompt(ctx: vscode.ExtensionContext): vscode.Disposable {
  void maybeAsk(ctx, vscode.window.tabGroups.activeTabGroup.activeTab);
  return vscode.window.tabGroups.onDidChangeTabs((e) => {
    for (const tab of e.opened) if (tab.isActive) void maybeAsk(ctx, tab);
  });
}
