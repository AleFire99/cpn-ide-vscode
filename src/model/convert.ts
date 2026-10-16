// Pure helpers for "Convert to Text Model": output file names and spec serialization. vscode-free.
import type { PetriSpec } from './types';

/** `<dir>/<base>.petri.json` and `<base>.sml` next to a `.cpn` path (either slash style). */
export function textModelPaths(cpnPath: string): { json: string; sml: string; smlName: string } {
  const slash = Math.max(cpnPath.lastIndexOf('/'), cpnPath.lastIndexOf('\\'));
  const dir = cpnPath.slice(0, slash + 1);
  const base = cpnPath.slice(slash + 1).replace(/\.cpn$/i, '') || 'model';
  return { json: `${dir}${base}.petri.json`, sml: `${dir}${base}.sml`, smlName: `${base}.sml` };
}

/** The spec as the text of its `.petri.json`, pointing at the declarations file. */
export function serializeSpec(spec: PetriSpec, smlName: string): string {
  const { version, ...rest } = spec;
  return JSON.stringify({ version, declarations: smlName, ...rest }, null, 2) + '\n';
}
