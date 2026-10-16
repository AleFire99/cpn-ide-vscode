// CPN ML declarations file (*.sml): split into declarations, classify them, and parse color sets
// into the structured form CPN Tools XML needs (the backend rejects a <color> with only a <layout>).
import type { ModelIssue } from './types';

export type Range = [string, string];

export type ColsetBody =
  | { k: 'unit'; with?: string }
  | { k: 'bool'; with?: [string, string] }
  | { k: 'int' | 'intinf' | 'real'; range?: Range }
  | { k: 'time' }
  | { k: 'string'; range?: Range; len?: Range }
  | { k: 'enum'; ids: string[] }
  | { k: 'index'; id: string; range: Range }
  | { k: 'product'; ids: string[] }
  | { k: 'record'; fields: [string, string][] }
  | { k: 'union'; fields: [string, string | undefined][] }
  | { k: 'list'; of: string; range?: Range }
  | { k: 'subset'; of: string; by?: string; with?: string }
  | { k: 'alias'; of: string };

export type Colset = ColsetBody & { timed?: boolean };

interface DeclBase {
  /** Declaration text as written, comments included (becomes the CPN <layout>). */
  text: string;
  /** 1-based line of the first character. */
  line: number;
  /** Block path from `(*! A / B *)` markers. */
  block: string[];
}

export type Decl =
  | (DeclBase & { kind: 'color'; name: string; colset: Colset })
  | (DeclBase & { kind: 'var'; names: string[]; type: string })
  | (DeclBase & { kind: 'globref'; name: string; value: string })
  | (DeclBase & { kind: 'ml' });

export const DEFAULT_BLOCK = 'Declarations';

const ID = String.raw`[A-Za-z][A-Za-z0-9_']*`;
const NESTING_OPEN = new Set(['let', 'local', 'struct', 'sig']);

/** Remove (possibly nested) SML comments; strings are kept intact. */
export function stripComments(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    if (s.startsWith('(*', i)) {
      i = skipComment(s, i);
      out += ' ';
    } else if (s[i] === '"') {
      const j = skipString(s, i);
      out += s.slice(i, j);
      i = j;
    } else out += s[i++];
  }
  return out;
}

function skipComment(s: string, i: number): number {
  let depth = 0;
  while (i < s.length) {
    if (s.startsWith('(*', i)) {
      depth++;
      i += 2;
    } else if (s.startsWith('*)', i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else i++;
  }
  return i;
}

function skipString(s: string, i: number): number {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '"') return i + 1;
  }
  return i;
}

const lineAt = (s: string, i: number) => s.slice(0, i).split('\n').length;

/** Split a declarations file into declarations and classify each one. */
export function parseSml(src: string): { decls: Decl[]; issues: ModelIssue[] } {
  const decls: Decl[] = [];
  const issues: ModelIssue[] = [];
  let block: string[] = [];
  let start = -1; // start of the current declaration (first non-blank, non-marker char)
  let code = false; // the current declaration has more than comments
  let depth = 0;
  let nesting = 0;

  const finish = (end: number) => {
    const text = src.slice(start, end).trim();
    const line = lineAt(src, start);
    start = -1;
    code = false;
    if (!stripComments(text).trim()) return;
    const d = classify(text, line, block.length ? block : [DEFAULT_BLOCK]);
    if ('issue' in d) issues.push(d.issue);
    else decls.push(d);
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (src.startsWith('(*', i)) {
      const end = skipComment(src, i);
      const marker = /^\(\*!([\s\S]*)\*\)$/.exec(src.slice(i, end));
      if (marker && !code) {
        // A block marker; comments before it belong to no declaration.
        start = -1;
        block = marker[1]
          .split('/')
          .map((x) => x.trim())
          .filter(Boolean);
      } else if (start < 0) start = i;
      i = end;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (start < 0) start = i;
    code = true;
    if (c === '"') {
      i = skipString(src, i);
      continue;
    }
    if (c === '#' && src[i + 1] === '"') {
      i = skipString(src, i + 1);
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z][A-Za-z0-9_']*/.exec(src.slice(i, i + 64)) as RegExpExecArray;
      if (NESTING_OPEN.has(m[0])) nesting++;
      else if (m[0] === 'end') nesting = Math.max(0, nesting - 1);
      i += m[0].length;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0 && nesting === 0) {
      let end = i + 1;
      // A comment on the same line after the ';' belongs to this declaration.
      for (;;) {
        const ws = /^[ \t]*/.exec(src.slice(end))![0];
        if (src.startsWith('(*', end + ws.length) && !src.startsWith('(*!', end + ws.length)) {
          end = skipComment(src, end + ws.length);
        } else break;
      }
      finish(end);
      i = end;
      continue;
    }
    i++;
  }
  if (start >= 0) finish(src.length);
  return { decls, issues };
}

function classify(text: string, line: number, block: string[]): Decl | { issue: ModelIssue } {
  const code = stripComments(text).replace(/\s+/g, ' ').trim();
  const source = { file: 'sml' as const, line };
  let m: RegExpExecArray | null;
  if ((m = new RegExp(String.raw`^colset (${ID}) ?= ?(.*?) ?;?$`).exec(code))) {
    const colset = parseColset(m[2]);
    if (!colset) return { issue: { message: `Unsupported color set: ${code}`, source } };
    return { kind: 'color', name: m[1], colset, text, line, block };
  }
  if (/^colset\b/.test(code)) return { issue: { message: `Cannot parse color set: ${code}`, source } };
  if ((m = new RegExp(String.raw`^var (${ID}(?: ?, ?${ID})*) ?: ?(${ID}) ?;?$`).exec(code))) {
    return { kind: 'var', names: m[1].split(',').map((x) => x.trim()), type: m[2], text, line, block };
  }
  if (/^var\b/.test(code)) return { issue: { message: `Cannot parse variable declaration: ${code}`, source } };
  if ((m = new RegExp(String.raw`^globref (${ID}) ?= ?(.*?) ?;?$`).exec(code))) {
    return { kind: 'globref', name: m[1], value: m[2], text, line, block };
  }
  return { kind: 'ml', text, line, block };
}

/** Split on a separator at bracket depth 0 (outside strings). */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') i = skipString(s, i) - 1;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      out.push(s.slice(last, i).trim());
      last = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(s.slice(last).trim());
  return out;
}

function range(s: string): Range | undefined {
  const parts = splitTop(s, '..');
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : undefined;
}

const isId = (s: string) => new RegExp(`^${ID}$`).test(s);

/** Parse the right-hand side of `colset X = ...` (comments already removed). Undefined if unsupported. */
export function parseColset(body: string): Colset | undefined {
  let s = body.replace(/\s+/g, ' ').trim();
  let timed = false;
  if (/ timed$/.test(s) || s === 'timed') {
    timed = true;
    s = s.replace(/ ?timed$/, '');
  }
  if (/\bdeclare\b/.test(s)) return undefined;
  const t = (b: ColsetBody): Colset => (timed ? { ...b, timed } : b);
  let m: RegExpExecArray | null;

  if (s === 'unit') return t({ k: 'unit' });
  if ((m = new RegExp(`^unit with (${ID})$`).exec(s))) return t({ k: 'unit', with: m[1] });
  if (s === 'bool') return t({ k: 'bool' });
  if ((m = new RegExp(String.raw`^bool with \( ?(${ID}) ?, ?(${ID}) ?\)$`).exec(s))) return t({ k: 'bool', with: [m[1], m[2]] });
  if (s === 'time') return t({ k: 'time' });
  if ((m = /^(int|intinf|real)(?: with (.+))?$/.exec(s))) {
    const k = m[1] as 'int' | 'intinf' | 'real';
    if (!m[2]) return t({ k });
    const r = range(m[2]);
    return r && t({ k, range: r });
  }
  if ((m = /^string(?: with (.+))?$/.exec(s))) {
    if (!m[1]) return t({ k: 'string' });
    const [chars, len, ...rest] = splitTop(m[1], ' and ');
    const r = range(chars);
    const l = len === undefined ? undefined : range(len);
    if (!r || rest.length || (len !== undefined && !l)) return undefined;
    return t(l ? { k: 'string', range: r, len: l } : { k: 'string', range: r });
  }
  if ((m = /^with (.+)$/.exec(s))) {
    const ids = splitTop(m[1], '|');
    return ids.every(isId) ? t({ k: 'enum', ids }) : undefined;
  }
  if ((m = new RegExp(`^index (${ID}) with (.+)$`).exec(s))) {
    const r = range(m[2]);
    return r && t({ k: 'index', id: m[1], range: r });
  }
  if ((m = /^product (.+)$/.exec(s))) {
    const ids = splitTop(m[1], '*');
    return ids.length >= 2 && ids.every(isId) ? t({ k: 'product', ids }) : undefined;
  }
  if ((m = /^record (.+)$/.exec(s))) {
    const fields = splitTop(m[1], '*').map((f) => f.split(':').map((x) => x.trim()));
    if (!fields.every((f) => f.length === 2 && isId(f[0]) && isId(f[1]))) return undefined;
    return t({ k: 'record', fields: fields as [string, string][] });
  }
  if ((m = /^union (.+)$/.exec(s))) {
    const fields = splitTop(m[1], '+').map((f) => f.split(':').map((x) => x.trim()));
    if (!fields.every((f) => (f.length === 1 || f.length === 2) && f.every(isId))) return undefined;
    return t({ k: 'union', fields: fields.map((f) => [f[0], f[1]] as [string, string | undefined]) });
  }
  if ((m = new RegExp(`^list (${ID})(?: with (.+))?$`).exec(s))) {
    if (!m[2]) return t({ k: 'list', of: m[1] });
    const r = range(m[2]);
    return r && t({ k: 'list', of: m[1], range: r });
  }
  if ((m = new RegExp(`^subset (${ID}) (by|with) (.+)$`).exec(s))) {
    return t(m[2] === 'by' ? { k: 'subset', of: m[1], by: m[3] } : { k: 'subset', of: m[1], with: m[3] });
  }
  if (isId(s)) return t({ k: 'alias', of: s });
  return undefined;
}

/** CPN ML text of a color set declaration, for declarations that have no layout. */
export function colsetToSml(name: string, c: Colset): string {
  const r = (x: Range) => `${x[0]}..${x[1]}`;
  let body: string;
  switch (c.k) {
    case 'unit':
      body = c.with ? `unit with ${c.with}` : 'unit';
      break;
    case 'bool':
      body = c.with ? `bool with (${c.with[0]}, ${c.with[1]})` : 'bool';
      break;
    case 'int':
    case 'intinf':
    case 'real':
      body = c.range ? `${c.k} with ${r(c.range)}` : c.k;
      break;
    case 'time':
      body = 'time';
      break;
    case 'string':
      body = c.range ? `string with ${r(c.range)}${c.len ? ` and ${r(c.len)}` : ''}` : 'string';
      break;
    case 'enum':
      body = `with ${c.ids.join(' | ')}`;
      break;
    case 'index':
      body = `index ${c.id} with ${r(c.range)}`;
      break;
    case 'product':
      body = `product ${c.ids.join(' * ')}`;
      break;
    case 'record':
      body = `record ${c.fields.map(([f, ty]) => `${f}: ${ty}`).join(' * ')}`;
      break;
    case 'union':
      body = `union ${c.fields.map(([f, ty]) => (ty ? `${f}: ${ty}` : f)).join(' + ')}`;
      break;
    case 'list':
      body = c.range ? `list ${c.of} with ${r(c.range)}` : `list ${c.of}`;
      break;
    case 'subset':
      body = c.by !== undefined ? `subset ${c.of} by ${c.by}` : `subset ${c.of} with ${c.with}`;
      break;
    case 'alias':
      body = c.of;
      break;
  }
  return `colset ${name} = ${body}${c.timed ? ' timed' : ''};`;
}

/** Declarations every CPN Tools net starts with; added at compile time unless the .sml declares the same name. */
export const STANDARD_SML = `(*! Standard priorities *)
val P_HIGH = 100;
val P_NORMAL = 1000;
val P_LOW = 10000;
(*! Standard declarations *)
colset UNIT = unit;
colset BOOL = bool;
colset INT = int;
colset INTINF = intinf;
colset TIME = time;
colset REAL = real;
colset STRING = string;
`;

/** The name a declaration binds, used to let the user override a standard declaration. */
function declName(d: Decl): string | undefined {
  if (d.kind === 'color' || d.kind === 'globref') return d.name;
  if (d.kind === 'ml') return new RegExp(`^val (${ID})`).exec(stripComments(d.text).trim().replace(/\s+/g, ' '))?.[1];
  return undefined;
}

/** Comparable form of a declaration: no comments, no insignificant whitespace, no trailing ';'. */
export function normalizeDecl(text: string): string {
  return stripComments(text)
    .replace(/\s+/g, ' ')
    .replace(/ ?([=:,;*|()[\]+]) ?/g, '$1')
    .replace(/;+$/, '')
    .trim();
}

/** Standard declarations not overridden by the user's, followed by the user's. */
export function withStandard(user: Decl[]): Decl[] {
  const declared = new Set(user.map(declName).filter((n): n is string => !!n));
  const std = parseSml(STANDARD_SML).decls.filter((d) => {
    const n = declName(d);
    return !n || !declared.has(n);
  });
  return [...std.map((d) => ({ ...d, line: 0 })), ...user];
}

/** True if this declaration is exactly one of the standard ones (so a decompiled file can leave it out). */
export function isStandardDecl(d: Decl): boolean {
  const n = normalizeDecl(d.text);
  return parseSml(STANDARD_SML).decls.some((s) => normalizeDecl(s.text) === n);
}
