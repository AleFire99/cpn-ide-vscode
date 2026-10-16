export const PATCHES: { from: string; to: string }[];
export const TARGET: { original: string; patched: string };
export function patchUi(text: string): string;
export function patchChecked(text: string, t?: { original: string; patched: string }): string | null;
export function patchUiDir(dir: string): boolean;
