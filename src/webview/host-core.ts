/** Pure helpers for the extension-host side of the webview bridge. */

export interface Decoded {
  text: string;
  encoding: 'utf8' | 'latin1';
}

/**
 * Decode model bytes. Models are normally UTF-8 but some older ones declare iso-8859-1;
 * fall back to latin1 when the bytes are not valid UTF-8 so non-ASCII text is not mangled.
 */
export function decodeBytes(bytes: Uint8Array): Decoded {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
  } catch {
    return { text: Buffer.from(bytes).toString('latin1'), encoding: 'latin1' };
  }
}

/** Encode text with the encoding the file was originally read with (default UTF-8). */
export function encodeText(text: string, encoding: 'utf8' | 'latin1' = 'utf8'): Uint8Array {
  return encoding === 'latin1' ? Buffer.from(text, 'latin1') : Buffer.from(text, 'utf8');
}

export function fileName(p: string): string {
  const clean = p.split(/[?#]/)[0];
  const last = clean.split(/[\\/]/).filter(Boolean).pop() ?? 'mynet.cpn';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Dialog filters from Electron form ({name, extensions}[]) to VS Code form. */
export function toVsCodeFilters(f: unknown): Record<string, string[]> | undefined {
  if (!Array.isArray(f)) return undefined;
  const out: Record<string, string[]> = {};
  for (const e of f) {
    if (e && typeof e.name === 'string' && Array.isArray(e.extensions)) {
      out[e.name] = e.extensions.filter((x: unknown) => typeof x === 'string' && x !== '*');
    }
  }
  return Object.keys(out).length ? out : undefined;
}
