// vscode-free language support for `*.petri.json`: where the cursor is, what can go there, and what a
// colour-set reference points to. The JSON schema already covers keys; this covers values that refer to the model.

import { findNodeAtLocation, getLocation, parseTree, type Node, type Segment } from 'jsonc-parser';
import { declaredColsets, parseSml, STANDARD_SML } from './sml';
import { nodeKey, type PageSpec, type PetriSpec } from './types';

export interface JsonLocation {
  path: Segment[];
  /** The cursor is in a property name (not a value). */
  atKey: boolean;
  /** Text of the string the cursor is in; '' when not in a string. */
  text: string;
  /** Offsets of that string's content (without quotes); an empty range at the cursor when not in a string. */
  range: [number, number];
}

/** JSON path and string at `offset`. Works on incomplete JSON. */
export function locate(text: string, offset: number): JsonLocation {
  const loc = getLocation(text, offset);
  const n = loc.previousNode;
  if (n && n.type === 'string' && offset > n.offset && offset < n.offset + n.length) {
    return { path: loc.path, atKey: loc.isAtPropertyKey, text: String(n.value ?? ''), range: [n.offset + 1, n.offset + n.length - 1] };
  }
  return { path: loc.path, atKey: loc.isAtPropertyKey, text: '', range: [offset, offset] };
}

export type RefKind = 'node' | 'colset' | 'page' | 'fusion' | 'portKey' | 'portValue';

/** What a position in the spec refers to, from its JSON path; `page` is the index of the page it is in. */
export function refAt(path: Segment[], atKey: boolean): { kind: RefKind; page: number; transition?: number } | undefined {
  if (path[0] !== 'pages' || typeof path[1] !== 'number') return undefined;
  const page = path[1];
  const [coll, idx, f1, f2] = [path[2], path[3], path[4], path[5]];
  if (typeof idx !== 'number') return undefined;
  if (coll === 'arcs' && !atKey && (f1 === 'from' || f1 === 'to') && path.length === 5) return { kind: 'node', page };
  if (coll === 'places' && !atKey && path.length === 5) {
    if (f1 === 'type') return { kind: 'colset', page };
    if (f1 === 'fusion') return { kind: 'fusion', page };
  }
  if (coll === 'transitions' && f1 === 'subpage') {
    if (f2 === 'page' && !atKey && path.length === 6) return { kind: 'page', page };
    if (f2 === 'ports' && path.length === 7) return { kind: atKey ? 'portKey' : 'portValue', page, transition: idx };
  }
  return undefined;
}

export interface Suggestion {
  label: string;
  detail?: string;
}

const dedupe = (xs: Suggestion[]): Suggestion[] => {
  const seen = new Set<string>();
  return xs.filter((s) => s.label !== '' && !seen.has(s.label) && !!seen.add(s.label));
};

/** Colour sets usable as a place `type`: the .sml's own, then the standard ones. */
export function colsetNames(sml: string): Suggestion[] {
  const own = declaredColsets(sml).map((c) => ({ label: c.name, detail: 'colour set' }));
  const std = declaredColsets(STANDARD_SML).map((c) => ({ label: c.name, detail: 'standard colour set' }));
  return dedupe([...own, ...std]);
}

const placeItems = (p?: Pick<PageSpec, 'places'>): Suggestion[] =>
  (p?.places ?? []).map((n) => ({ label: nodeKey(n), detail: `place, type ${n.type ?? '?'}` }));

/** Values to offer at a reference; the editor filters them by what is typed. Empty when the position is not a reference. */
export function suggest(spec: PetriSpec | undefined, sml: string, path: Segment[], atKey: boolean): Suggestion[] {
  const ref = refAt(path, atKey);
  if (!ref) return [];
  const pages = Array.isArray(spec?.pages) ? spec.pages : [];
  const page = pages[ref.page];
  switch (ref.kind) {
    case 'node':
      return dedupe([...placeItems(page), ...(page?.transitions ?? []).map((t) => ({ label: nodeKey(t), detail: 'transition' }))]);
    case 'colset':
      return colsetNames(sml);
    case 'page':
      return dedupe(pages.map((p) => ({ label: p.name, detail: 'page' })));
    case 'fusion':
      return dedupe(
        pages
          .flatMap((p) => (p.places ?? []).map((n) => n.fusion))
          .filter((f): f is string => !!f)
          .map((f) => ({ label: f, detail: 'fusion set' })),
      );
    case 'portKey':
      return dedupe(placeItems(page));
    case 'portValue': {
      const target = page?.transitions?.[ref.transition ?? -1]?.subpage?.page;
      const sub = pages.find((p) => p.name === target);
      if (!sub) return [];
      const all = sub.places ?? [];
      const ports = all.filter((n) => n.port);
      return dedupe(placeItems({ places: ports.length ? ports : all }));
    }
  }
}

export interface ColsetInfo {
  name: string;
  /** Declaration text from the .sml (or the standard declarations). */
  text: string;
  /** Offset of the name in the .sml; absent for a standard colour set. */
  offset?: number;
}

/** The `colset` declaration of `name`: the user's .sml wins over the standard declarations. */
export function colsetInfo(sml: string, name: string): ColsetInfo | undefined {
  const declText = (src: string): string | undefined => {
    const d = parseSml(src).decls.find((x) => x.kind === 'color' && x.name === name);
    return d && fromColset(d.text);
  };
  const own = declaredColsets(sml).find((c) => c.name === name);
  if (own) return { name, text: declText(sml) ?? `colset ${name}`, offset: own.offset };
  const std = declText(STANDARD_SML);
  return std ? { name, text: std } : undefined;
}

/** A declaration's text starts at its first character, which can be a comment line; show from `colset` on. */
function fromColset(text: string): string {
  const m = /(^|\n)colset\s/.exec(text);
  return (m ? text.slice(m.index + m[1].length) : text).trim();
}

export type NetSymbolKind = 'page' | 'place' | 'transition' | 'substitution' | 'arc';

export interface NetSymbol {
  name: string;
  detail: string;
  kind: NetSymbolKind;
  /** Offsets of the whole JSON object. */
  range: [number, number];
  /** Offsets of the name value (the object itself when it has none). */
  selection: [number, number];
  children: NetSymbol[];
}

const strOf = (n: Node | undefined) => (n?.type === 'string' ? String(n.value) : undefined);

/** Pages with their places, transitions and arcs as an outline tree. Tolerates incomplete JSON. */
export function netSymbols(text: string): NetSymbol[] {
  const root = parseTree(text, [], { allowTrailingComma: true });
  const pages = root && findNodeAtLocation(root, ['pages']);
  if (!pages || pages.type !== 'array') return [];
  const sym = (o: Node, kind: NetSymbolKind, name: string, detail: string, nameNode?: Node, children: NetSymbol[] = []): NetSymbol => {
    const sel = nameNode ?? o;
    return { name, detail, kind, range: [o.offset, o.offset + o.length], selection: [sel.offset, sel.offset + sel.length], children };
  };
  const items = (page: Node, key: string) => (findNodeAtLocation(page, [key])?.children ?? []).filter((o) => o.type === 'object');
  const out: NetSymbol[] = [];
  for (const page of pages.children ?? []) {
    if (page.type !== 'object') continue;
    const nameNode = findNodeAtLocation(page, ['name']);
    const children: NetSymbol[] = [];
    for (const o of items(page, 'places')) {
      const n = findNodeAtLocation(o, ['name']);
      const type = strOf(findNodeAtLocation(o, ['type']));
      const port = strOf(findNodeAtLocation(o, ['port']));
      const fusion = strOf(findNodeAtLocation(o, ['fusion']));
      const detail = [type, port && `port ${port}`, fusion && `fusion ${fusion}`].filter(Boolean).join(', ');
      children.push(sym(o, 'place', strOf(n) ?? '?', detail, n));
    }
    for (const o of items(page, 'transitions')) {
      const n = findNodeAtLocation(o, ['name']);
      const sub = strOf(findNodeAtLocation(o, ['subpage', 'page']));
      children.push(sym(o, sub ? 'substitution' : 'transition', strOf(n) ?? '?', sub ? `subpage ${sub}` : '', n));
    }
    for (const o of items(page, 'arcs')) {
      const from = strOf(findNodeAtLocation(o, ['from'])) ?? '?';
      const to = strOf(findNodeAtLocation(o, ['to'])) ?? '?';
      const ins = strOf(findNodeAtLocation(o, ['inscription']));
      children.push(sym(o, 'arc', `${from} → ${to}`, ins ?? ''));
    }
    out.push(sym(page, 'page', strOf(nameNode) ?? '?', '', nameNode, children));
  }
  return out;
}
