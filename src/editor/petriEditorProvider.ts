import * as vscode from 'vscode';
import { decompile } from '../model/decompile';
import { ModelError } from '../model/types';
import { declarationsChanged, mergeSpec, parseSpecText, serializeSpec, specBaseName } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { mountEditor } from './cpnEditorProvider';
import { loadModel, PETRI_VIEW_TYPE, readText, smlUriFor, writeText } from './petriModel';
import { PetriSync } from './petriSync';

/**
 * Custom text editor for *.petri.json. The spec and its .sml are compiled to CPN Tools XML for the UI;
 * UI saves are decompiled and merged back: the spec keeps its `$schema` and `declarations`, the pages
 * are replaced, and the .sml is rewritten only when the declarations changed in substance.
 */
export class PetriEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  static register(ctx: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(PETRI_VIEW_TYPE, new PetriEditorProvider(ctx), {
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const sync = PetriSync.get();
    const out = BackendManager.get().output;
    const specUri = document.uri;
    const mounted = await mountEditor(this.ctx, panel, {
      uri: specUri,
      displayName: `${specBaseName(specUri.path)}.cpn`,
      adapter: {
        async loadXml() {
          const m = await loadModel(specUri);
          if (!m.compiled) throw new ModelError(m.issues ?? []);
          return m.compiled.xml;
        },
        async saveXml(xml) {
          const { spec, sml, warnings } = decompile(xml);
          for (const w of warnings) out.appendLine(`[decompile] ${w}`);
          const existing = parseSpecText(document.getText());
          const merged = mergeSpec(existing, spec);
          const text = serializeSpec(merged);
          const smlUri = smlUriFor(specUri, text);
          const oldSml = (await readText(smlUri)) ?? '';
          if (declarationsChanged(oldSml, sml)) {
            sync.noteWrite(smlUri, sml);
            await writeText(smlUri, sml);
            out.appendLine(`[save] declarations written to ${smlUri.fsPath}`);
          }
          if (text !== document.getText()) {
            sync.noteWrite(specUri, text);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(specUri, new vscode.Range(0, 0, document.lineCount, 0), text);
            await vscode.workspace.applyEdit(edit);
          }
          await document.save();
          sync.schedule(specUri, false);
        },
      },
    });
    if (!mounted) return;
    const reg = sync.register({ specUri, reload: mounted.reload });
    panel.onDidDispose(() => reg.dispose());
    sync.schedule(specUri, false);
  }
}
