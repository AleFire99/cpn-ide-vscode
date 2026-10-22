// Place/transition view of a net for structural (linear-algebra) analysis. vscode-free.
import type { SourceRef } from '../model/types';

export interface PTNode {
  id: string;
  /** Readable `Page/Name`. */
  label: string;
  source?: SourceRef;
}

export interface PTNet {
  places: PTNode[];
  transitions: PTNode[];
  /** Arc weights, indexed [transition][place]. */
  pre: number[][];
  post: number[][];
  /** Initial token count per place. */
  m0: number[];
  /** True when the token-count abstraction loses nothing (every arc moves a fixed number of tokens). */
  exact: boolean;
  /** Arcs whose token count could not be determined, with the reason. */
  approximations: { element: string; reason: string }[];
}

/** Incidence matrix C = Post − Pre, indexed [place][transition]. */
export const incidence = (n: PTNet): number[][] =>
  n.places.map((_, p) => n.transitions.map((_, t) => n.post[t][p] - n.pre[t][p]));
