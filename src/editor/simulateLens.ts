import * as vscode from 'vscode';
import { placeLocations } from '../model/placeLocations';
import { finalMarkings } from '../runtime/headless-sim';
import { simulateModel } from './runSimulation';

const STEPS = 100;

/** CodeLenses at the top of `*.petri.json` plus the final marking shown next to each place after a lens run. */
export class SimulateLens implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  /** Document uri -> `Page/Place` -> decoration text. */
  private readonly results = new Map<string, Map<string, string>>();
  private readonly running = new Set<string>();
  private readonly deco = vscode.window.createTextEditorDecorationType({});
  private readonly subs: vscode.Disposable[] = [];

  static register(): SimulateLens {
    const lens = new SimulateLens();
    lens.subs.push(
      vscode.languages.registerCodeLensProvider({ pattern: '**/*.petri.json' }, lens),
      vscode.commands.registerCommand('cpnIde.simulateLens', (uri: vscode.Uri) => lens.simulate(uri)),
      vscode.commands.registerCommand('cpnIde.clearSimulationResults', (uri: vscode.Uri) => lens.clear(uri)),
    );
    return lens;
  }

  private constructor() {
    this.subs.push(
      this.changed,
      this.deco,
      vscode.workspace.onDidChangeTextDocument((e) => e.contentChanges.length > 0 && this.clear(e.document.uri)),
      vscode.workspace.onDidCloseTextDocument((d) => this.clear(d.uri)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.applyAll()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('cpnIde.codeLens') && this.changed.fire()),
    );
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('cpnIde').get<boolean>('codeLens.enabled', true)) return [];
    const range = new vscode.Range(0, 0, 0, 0);
    const lens = (title: string, command: string, args: unknown[] = [doc.uri]) => new vscode.CodeLens(range, { title, command, arguments: args });
    const out = [
      lens(this.running.has(doc.uri.toString()) ? '$(sync~spin) Simulating...' : `$(play) Simulate ${STEPS} steps`, 'cpnIde.simulateLens'),
      lens('Open in CPN IDE', 'cpnIde.openInCpnIde'),
      lens('Export .cpn', 'cpnIde.exportCpn'),
    ];
    if (this.results.has(doc.uri.toString())) out.push(lens('Clear results', 'cpnIde.clearSimulationResults'));
    return out;
  }

  private async simulate(uri?: vscode.Uri): Promise<void> {
    uri ??= vscode.window.activeTextEditor?.document.uri;
    if (!uri) return;
    const key = uri.toString();
    if (this.running.has(key)) return;
    this.running.add(key);
    this.changed.fire();
    try {
      const run = await simulateModel(uri, STEPS);
      const markings = run ? finalMarkings(run.result, run.names) : undefined;
      if (markings?.size) this.results.set(key, markings);
      else this.results.delete(key);
    } finally {
      this.running.delete(key);
      this.applyAll();
      this.changed.fire();
    }
  }

  private clear(uri?: vscode.Uri): void {
    if (!uri || !this.results.delete(uri.toString())) return;
    this.applyAll();
    this.changed.fire();
  }

  private applyAll(): void {
    for (const ed of vscode.window.visibleTextEditors) {
      const markings = this.results.get(ed.document.uri.toString());
      if (!markings) {
        ed.setDecorations(this.deco, []);
        continue;
      }
      const text = ed.document.getText();
      const opts: vscode.DecorationOptions[] = [];
      for (const [name, offset] of placeLocations(text)) {
        const marking = markings.get(name);
        if (marking === undefined) continue;
        const end = ed.document.lineAt(ed.document.positionAt(offset).line).range.end;
        opts.push({
          range: new vscode.Range(end, end),
          renderOptions: { after: { contentText: marking, color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 1.5em' } },
        });
      }
      ed.setDecorations(this.deco, opts);
    }
  }
}
