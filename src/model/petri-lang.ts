// vscode-free language support for `*.petri.json`: where the cursor is, what can go there, and what a
// colour-set reference points to. The JSON schema already covers keys; this covers values that refer to the model.

import { getLocation, type Segment } from 'jsonc-parser';
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
