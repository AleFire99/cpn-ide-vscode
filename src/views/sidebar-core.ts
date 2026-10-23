// vscode-free contents of the CPN IDE sidebar (Activity Bar): which rows the Models view shows.

/** Glob of the files listed in the Models view. */
export const MODEL_GLOB = '**/*.{cpn,petri.json,sml}';

export type ModelKind = 'cpn' | 'petri' | 'sml';

const SUFFIX: Record<ModelKind, string> = { petri: '.petri.json', cpn: '.cpn', sml: '.sml' };
/** Order of a net's files, and which one a click opens (the first of petri, cpn). */
const KIND_ORDER: readonly ModelKind[] = ['petri', 'cpn', 'sml'];

/** Kind of a model file (decides its inline actions), or undefined if the view does not list it. */
export function modelKind(p: string): ModelKind | undefined {
  return KIND_ORDER.find((k) => p.toLowerCase().endsWith(SUFFIX[k]));
}

export interface ModelGroup {
  /** Shared base name of the files. */
  name: string;
  /** Folder of the files (workspace-relative, '' at the root). */
  dir: string;
  /** Workspace-relative paths of the files, text model first. */
  files: { path: string; kind: ModelKind }[];
  /** The file a click opens in the canvas: the .petri.json if present, else the .cpn. */
  open: string;
}

/**
 * Group NAME.petri.json / NAME.cpn / NAME.sml in the same folder into one net, sorted by folder then name,
 * case-insensitively. A lone .sml (declarations without a net) is not listed. Takes workspace-relative paths.
 */
export function groupModels(paths: readonly string[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const path of paths) {
    const kind = modelKind(path);
    if (!kind) continue;
    const i = path.lastIndexOf('/');
    const dir = i < 0 ? '' : path.slice(0, i);
    const name = path.slice(i + 1, path.length - SUFFIX[kind].length);
    const key = `${dir}/${name}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name, dir, files: [], open: '' }));
    g.files.push({ path, kind });
  }
  const result: ModelGroup[] = [];
  for (const g of groups.values()) {
    g.files.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const first = g.files[0];
    if (first.kind === 'sml') continue;
    g.open = first.path;
    result.push(g);
  }
  return result.sort((a, b) => a.dir.toLowerCase().localeCompare(b.dir.toLowerCase()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
