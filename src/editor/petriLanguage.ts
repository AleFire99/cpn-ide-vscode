// Completion, hover and go-to-definition for values in `*.petri.json` that refer to the model itself.

import * as vscode from 'vscode';
import { colsetInfo, locate, refAt, suggest } from '../model/petri-lang';
import { parseSpecText } from '../model/workspace';
import { readText, smlUriFor } from './petriModel';

const SELECTOR: vscode.DocumentSelector = { language: 'json', pattern: '**/*.petri.json' };

/** Declarations text next to the spec; an open buffer wins over the disk. */
async function smlOf(doc: vscode.TextDocument): Promise<{ uri: vscode.Uri; text: string }> {
  const uri = smlUriFor(doc.uri, doc.getText());
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  return { uri, text: open ? open.getText() : ((await readText(uri)) ?? '') };
}

const rangeOf = (doc: vscode.TextDocument, r: [number, number]) => new vscode.Range(doc.positionAt(r[0]), doc.positionAt(r[1]));

/** The colour set name under the cursor, if the cursor is on a place `type` value. */
function typeAt(doc: vscode.TextDocument, pos: vscode.Position) {
  const loc = locate(doc.getText(), doc.offsetAt(pos));
  if (refAt(loc.path, loc.atKey)?.kind !== 'colset' || !loc.text) return undefined;
  return { name: loc.text, range: rangeOf(doc, loc.range) };
}

export function registerPetriLanguage(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.languages.registerCompletionItemProvider(
      SELECTOR,
      {
        async provideCompletionItems(doc, pos) {
          const text = doc.getText();
          const loc = locate(text, doc.offsetAt(pos));
          if (!refAt(loc.path, loc.atKey)) return undefined;
          const items = suggest(parseSpecText(text), (await smlOf(doc)).text, loc.path, loc.atKey);
          const range = rangeOf(doc, loc.range);
          return items.map((s) => {
            const item = new vscode.CompletionItem(s.label, vscode.CompletionItemKind.Reference);
            item.detail = s.detail;
            item.range = range;
            return item;
          });
        },
      },
      '"',
    ),
    vscode.languages.registerHoverProvider(SELECTOR, {
      async provideHover(doc, pos) {
        const t = typeAt(doc, pos);
        const info = t && colsetInfo((await smlOf(doc)).text, t.name);
        return info ? new vscode.Hover(new vscode.MarkdownString().appendCodeblock(info.text, 'cpnml'), t.range) : undefined;
      },
    }),
    vscode.languages.registerDefinitionProvider(SELECTOR, {
      async provideDefinition(doc, pos) {
        const t = typeAt(doc, pos);
        if (!t) return undefined;
        const { uri, text } = await smlOf(doc);
        const info = colsetInfo(text, t.name);
        if (info?.offset === undefined) return undefined;
        const sdoc = await vscode.workspace.openTextDocument(uri);
        const start = sdoc.positionAt(info.offset);
        return new vscode.Location(uri, new vscode.Range(start, start.translate(0, t.name.length)));
      },
    }),
  );
}
