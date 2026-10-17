/** vscode-free decision logic for the "open .cpn files in CPN IDE by default?" prompt (#70). */

export type PromptAnswer = 'Yes' | 'Not now' | 'Never';

export interface TextTabInfo {
  /** `file` for a regular editor; `git`, `vscode-scm`, ... for virtual documents. */
  scheme: string;
  path: string;
  /** True for the two sides of a diff editor (TabInputTextDiff). */
  isDiff: boolean;
}

export interface PromptState {
  /** The user answered Never earlier (persisted in globalState). */
  never: boolean;
  /** The user answered Not now in this session. */
  deferred: boolean;
  /** `workbench.editorAssociations` as currently configured. */
  associations: Record<string, string> | undefined;
  /** Paths the user explicitly opened as text via "Reopen as XML Text". */
  openedAsText: ReadonlySet<string>;
}

export function isCpnPath(path: string): boolean {
  return /\.cpn$/i.test(path);
}

/** True when the editor association map already says anything about *.cpn (we never override the user's choice). */
export function hasCpnAssociation(associations: Record<string, string> | undefined): boolean {
  return !!associations && Object.keys(associations).some((k) => /^\*\.cpn$/i.test(k.trim()));
}

/** Whether a newly opened text tab should trigger the prompt. */
export function shouldAsk(tab: TextTabInfo, state: PromptState): boolean {
  if (tab.isDiff || tab.scheme !== 'file' || !isCpnPath(tab.path)) return false;
  if (state.never || state.deferred) return false;
  if (hasCpnAssociation(state.associations)) return false;
  if (state.openedAsText.has(tab.path)) return false;
  return true;
}

/** `workbench.editorAssociations` with `*.cpn` mapped to the viewType; other entries kept. */
export function withCpnAssociation(associations: Record<string, string> | undefined, viewType: string): Record<string, string> {
  return { ...(associations ?? {}), '*.cpn': viewType };
}

/** Only `file` documents boot the backend; `git:` and other virtual schemes (diff sides) get a placeholder. */
export function canMountScheme(scheme: string): boolean {
  return scheme === 'file';
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

export function placeholderHtml(fileName: string, scheme: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);
  return `<!doctype html><html><body style="font-family:sans-serif;padding:1em">
<p>${esc(fileName)} (${esc(scheme)}:) is shown as text. The CPN IDE canvas only opens files on disk.</p>
<button id="b">Open as text</button>
<script>const v=acquireVsCodeApi();document.getElementById('b').onclick=()=>v.postMessage({type:'openAsText'});</script>
</body></html>`;
}
