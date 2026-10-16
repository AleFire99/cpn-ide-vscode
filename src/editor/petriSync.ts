import * as vscode from 'vscode';
import { locatePointer, modelIssuesToFindings, remoteIssuesToFindings, validateRemote, type FetchLike, type Finding } from '../model/diagnostics';
import { contentHash, isSpecFile } from '../model/workspace';
import { BackendManager } from '../runtime/backend';
import { uiState } from '../webview/panel';
import { loadModel, readText, smlUriFor, type LoadedModel } from './petriModel';

const DEBOUNCE_MS = 300;

/** What an open .petri.json editor offers to the sync layer. */
export interface OpenPetriEditor {
  specUri: vscode.Uri;
  reload(): Promise<void>;
}

/**
 * Keeps open .petri.json editors and the 'cpn' diagnostics in step with the files on disk:
 * watches *.petri.json and *.sml, debounces per spec, recompiles, re-renders open editors and
 * reports compile / backend-validation problems. Writes made by the editor itself are recognised
 * by content hash and do not cause a re-render.
 */
export class PetriSync implements vscode.Disposable {
  private static instance: PetriSync | undefined;
  private readonly editors = new Set<OpenPetriEditor>();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('cpn');
  private readonly findings = new Map<string, Map<string, { uri: vscode.Uri; diags: vscode.Diagnostic[] }>>();
  private readonly written = new Map<string, string>();
  private readonly pending = new Map<string, { timer: NodeJS.Timeout; reload: boolean; uri: vscode.Uri }>();
  private readonly subs: vscode.Disposable[] = [];
  /** Backend validations run one at a time (see validateRemote). */
  private queue: Promise<unknown> = Promise.resolve();

  static init(): PetriSync {
    PetriSync.instance ??= new PetriSync();
    return PetriSync.instance;
  }

  static get(): PetriSync {
    return PetriSync.init();
  }

  private constructor() {
    for (const glob of ['**/*.petri.json', '**/*.sml']) {
      const w = vscode.workspace.createFileSystemWatcher(glob);
      this.subs.push(
        w,
        w.onDidChange((u) => void this.onFileEvent(u, false)),
        w.onDidCreate((u) => void this.onFileEvent(u, false)),
        w.onDidDelete((u) => void this.onFileEvent(u, true)),
      );
    }
    this.subs.push(this.diagnostics);
  }

  register(editor: OpenPetriEditor): vscode.Disposable {
    this.editors.add(editor);
    return { dispose: () => void this.editors.delete(editor) };
  }

  /** Remember a write the extension is about to make so its watcher echo can be ignored. */
  noteWrite(uri: vscode.Uri, text: string): void {
    this.written.set(uri.toString(), contentHash(text));
  }

  /** Recompile / revalidate a spec soon (debounced). `reload` also re-renders its open editors. */
  schedule(specUri: vscode.Uri, reload: boolean): void {
    const key = specUri.toString();
    const prev = this.pending.get(key);
    if (prev) clearTimeout(prev.timer);
    const entry = {
      uri: specUri,
      reload: reload || (prev?.reload ?? false),
      timer: setTimeout(() => {
        this.pending.delete(key);
        void this.run(specUri, entry.reload).catch((e) => BackendManager.get().output.appendLine(`[sync] ${String(e)}`));
      }, DEBOUNCE_MS),
    };
    this.pending.set(key, entry);
  }

  private async onFileEvent(uri: vscode.Uri, deleted: boolean): Promise<void> {
    try {
      if (isSpecFile(uri.path)) {
        if (deleted) {
          this.findings.delete(uri.toString());
          this.publish();
          return;
        }
        this.schedule(uri, !(await this.isEcho(uri)));
        return;
      }
      const echo = deleted ? false : await this.isEcho(uri);
      for (const spec of await this.specsReferencing(uri)) this.schedule(spec, !echo);
    } catch (e) {
      BackendManager.get().output.appendLine(`[sync] ${String(e)}`);
    }
  }

  private async isEcho(uri: vscode.Uri): Promise<boolean> {
    const known = this.written.get(uri.toString());
    if (known === undefined) return false;
    const text = await readText(uri);
    return text !== undefined && contentHash(text) === known;
  }

  /** Specs (open editors first, then any in the workspace) whose declarations file is `smlUri`. */
  private async specsReferencing(smlUri: vscode.Uri): Promise<vscode.Uri[]> {
    const candidates = new Map<string, vscode.Uri>();
    for (const e of this.editors) candidates.set(e.specUri.toString(), e.specUri);
    for (const u of await vscode.workspace.findFiles('**/*.petri.json', '**/node_modules/**')) candidates.set(u.toString(), u);
    const out: vscode.Uri[] = [];
    for (const u of candidates.values()) {
      const text = (await readText(u)) ?? '';
      if (smlUriFor(u, text).toString() === smlUri.toString()) out.push(u);
    }
    return out;
  }

  private async run(specUri: vscode.Uri, reload: boolean): Promise<void> {
    const model = await loadModel(specUri);
    if (reload) {
      for (const e of [...this.editors]) if (e.specUri.toString() === specUri.toString()) void e.reload();
    }
    if (!model.compiled) {
      this.findings.set(specUri.toString(), this.toDiagnostics(model, modelIssuesToFindings(model.issues ?? [])));
      this.publish();
      return;
    }
    // It compiles: drop old compile errors now, backend findings follow if the check runs.
    this.findings.set(specUri.toString(), new Map());
    this.publish();
    const compiled = model.compiled;
    const check = async () => {
      // An open CPN IDE panel validates on its own and shows the issues itself.
      const url = BackendManager.get().currentUrl();
      if (!url || uiState.panels > 0) return;
      try {
        const resp = await validateRemote(fetch as unknown as FetchLike, url, compiled.xml, 'cpnide-validate');
        this.findings.set(specUri.toString(), this.toDiagnostics(model, remoteIssuesToFindings(resp, compiled.idMap)));
        this.publish();
      } catch (e) {
        BackendManager.get().output.appendLine(`[validate] ${specUri.fsPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    this.queue = this.queue.then(check, check);
    await this.queue;
  }

  private toDiagnostics(model: LoadedModel, found: Finding[]) {
    const out = new Map<string, { uri: vscode.Uri; diags: vscode.Diagnostic[] }>();
    const add = (uri: vscode.Uri, range: vscode.Range, f: Finding) => {
      const d = new vscode.Diagnostic(range, f.message, f.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      d.source = 'cpn';
      const key = uri.toString();
      if (!out.has(key)) out.set(key, { uri, diags: [] });
      out.get(key)!.diags.push(d);
    };
    const line0 = new vscode.Range(0, 0, 0, 0);
    for (const f of found) {
      const s = f.source;
      if (s?.file === 'sml' && s.line >= 1) {
        add(model.smlUri, new vscode.Range(s.line - 1, 0, s.line - 1, Number.MAX_SAFE_INTEGER), f);
      } else if (s?.file === 'spec') {
        // Approximation: the range of the pointed-to value, or of its nearest enclosing value.
        const r = locatePointer(model.specDoc.getText(), s.path);
        add(model.specUri, r ? new vscode.Range(model.specDoc.positionAt(r.start), model.specDoc.positionAt(r.end)) : line0, f);
      } else {
        add(model.specUri, line0, f);
      }
    }
    return out;
  }

  /** Rebuild the collection from every spec's latest findings. */
  private publish(): void {
    const merged = new Map<string, { uri: vscode.Uri; diags: vscode.Diagnostic[] }>();
    for (const perSpec of this.findings.values()) {
      for (const [k, v] of perSpec) {
        const m = merged.get(k) ?? { uri: v.uri, diags: [] };
        m.diags.push(...v.diags);
        merged.set(k, m);
      }
    }
    this.diagnostics.clear();
    for (const { uri, diags } of merged.values()) this.diagnostics.set(uri, diags);
  }

  dispose(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    for (const s of this.subs) s.dispose();
    PetriSync.instance = undefined;
  }
}
