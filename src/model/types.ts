// Text model of a CPN: a `*.petri.json` net structure plus a `*.sml` declarations file.
// Mirrors schema/petri.schema.json. vscode-free.

export type Pos = [number, number];

export type PortType = 'in' | 'out' | 'io' | 'general';

export interface PlaceSpec {
  name: string;
  /** Unique reference on the page when `name` is not unique (or empty). Defaults to `name`. */
  key?: string;
  type: string;
  init?: string;
  pos?: Pos;
  port?: PortType;
  fusion?: string;
}

export interface SubpageSpec {
  page: string;
  /** Socket place on this page -> port place on the subpage (by key). */
  ports?: Record<string, string>;
}

export interface TransitionSpec {
  name: string;
  key?: string;
  /** Without the surrounding brackets, e.g. "n <= 5". */
  guard?: string;
  time?: string;
  code?: string;
  priority?: string;
  pos?: Pos;
  subpage?: SubpageSpec;
}

export interface ArcSpec {
  from: string;
  to: string;
  inscription?: string;
  /** Double arc (CPN Tools BOTHDIR). */
  bidirectional?: boolean;
  bends?: Pos[];
}

export interface PageSpec {
  name: string;
  places?: PlaceSpec[];
  transitions?: TransitionSpec[];
  arcs?: ArcSpec[];
}

export interface PetriSpec {
  $schema?: string;
  version: 1;
  /** Declarations file, relative to the spec file. */
  declarations?: string;
  /** Real-valued model time (CPN Tools option "realtimestamp"), e.g. for `@+ 1.5`. */
  realtime?: boolean;
  pages: PageSpec[];
}

/** Where an element of the compiled XML came from. */
export type SourceRef = { file: 'sml'; line: number } | { file: 'spec'; path: string };

export interface ModelIssue {
  message: string;
  source?: SourceRef;
}

export class ModelError extends Error {
  constructor(readonly issues: ModelIssue[]) {
    super(issues.map(formatIssue).join('\n'));
    this.name = 'ModelError';
  }
}

export function formatIssue(i: ModelIssue): string {
  if (!i.source) return i.message;
  return i.source.file === 'sml' ? `sml:${i.source.line}: ${i.message}` : `${i.source.path}: ${i.message}`;
}

export const nodeKey = (n: { name: string; key?: string }): string => n.key ?? n.name;
