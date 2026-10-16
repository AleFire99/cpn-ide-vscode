// vscode-free helpers for the .petri.json custom editor: file layout, spec merge, serialization.

import { compile, type CompileResult } from './compile';
import { normalizeDecl, parseSml } from './sml';
import { ModelError, type PetriSpec } from './types';

export const SPEC_SUFFIX = '.petri.json';

export const isSpecFile = (p: string): boolean => p.toLowerCase().endsWith(SPEC_SUFFIX);

/** Last path segment of a path or URI string. */
export function baseFileName(p: string): string {
  return p.split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/** `dir/net.petri.json` -> `net` */
export function specBaseName(p: string): string {
  const f = baseFileName(p);
  return isSpecFile(f) ? f.slice(0, -SPEC_SUFFIX.length) : f.replace(/\.[^.]*$/, '');
}

/** Declarations file path relative to the spec file: `declarations` if set, else `<base>.sml`. */
export function smlRelativePath(specPath: string, spec?: Pick<PetriSpec, 'declarations'>): string {
  const d = spec?.declarations;
  return typeof d === 'string' && d.trim() ? d.trim() : `${specBaseName(specPath)}.sml`;
}

/** Resolve a relative path against the directory of `specPath` (works on plain paths and URI strings). */
export function resolveSibling(specPath: string, rel: string): string {
  if (/^([\\/]|[a-z]:[\\/]|[a-z][a-z0-9+.-]*:\/\/)/i.test(rel)) return rel;
  const slash = Math.max(specPath.lastIndexOf('/'), specPath.lastIndexOf('\\'));
  const dir = slash >= 0 ? specPath.slice(0, slash) : '';
  const out: string[] = dir ? dir.split(/[\\/]/) : [];
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 1) out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

/** Merge a decompiled spec into the existing one: keeps `$schema` and `declarations`, takes `realtime` and the pages. */
export function mergeSpec(existing: PetriSpec | undefined, decompiled: PetriSpec): PetriSpec {
  const schema = existing?.$schema ?? decompiled.$schema;
  const declarations = existing?.declarations ?? decompiled.declarations;
  return {
    ...(schema !== undefined ? { $schema: schema } : {}),
    version: 1,
    ...(declarations !== undefined ? { declarations } : {}),
    ...(decompiled.realtime ? { realtime: true } : {}),
    pages: decompiled.pages,
  };
}

/** `<dir>/<base>.petri.json` and `<base>.sml` next to a `.cpn` path (either slash style). */
export function textModelPaths(cpnPath: string): { json: string; sml: string; smlName: string } {
  const slash = Math.max(cpnPath.lastIndexOf('/'), cpnPath.lastIndexOf('\\'));
  const dir = cpnPath.slice(0, slash + 1);
  const base = cpnPath.slice(slash + 1).replace(/\.cpn$/i, '') || 'model';
  return { json: `${dir}${base}${SPEC_SUFFIX}`, sml: `${dir}${base}.sml`, smlName: `${base}.sml` };
}

/** Pretty JSON, 2 spaces, trailing newline; `smlName` sets the declarations file. */
export function serializeSpec(spec: PetriSpec, smlName?: string): string {
  const { $schema, version, declarations, ...rest } = spec;
  const head = { ...($schema !== undefined ? { $schema } : {}), version, ...((smlName ?? declarations) !== undefined ? { declarations: smlName ?? declarations } : {}) };
  return JSON.stringify({ ...head, ...rest }, null, 2) + '\n';
}

const normalizedDecls = (sml: string): string[] => parseSml(sml).decls.map((d) => normalizeDecl(d.text));

/** True if the two declaration files differ in substance (comments / formatting are ignored). */
export function declarationsChanged(oldSml: string, newSml: string): boolean {
  const a = normalizedDecls(oldSml);
  const b = normalizedDecls(newSml);
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}

/** Cheap content hash (FNV-1a, line endings normalised) used to recognise our own writes. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  const t = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${t.length}:${h.toString(16)}`;
}

/** Compile spec text + declarations text. Throws ModelError (also for text that is not valid JSON). */
export function compileSpecText(specText: string, sml: string): CompileResult {
  let spec: PetriSpec;
  try {
    spec = JSON.parse(specText) as PetriSpec;
  } catch (e) {
    throw new ModelError([{ message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` }]);
  }
  return compile(spec, sml);
}

/** Parse spec text; undefined when it is not valid JSON. */
export function parseSpecText(text: string): PetriSpec | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' ? (v as PetriSpec) : undefined;
  } catch {
    return undefined;
  }
}
