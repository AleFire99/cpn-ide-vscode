// vscode-free diagnostics logic: JSON pointer location, compile issues, backend validation.

import type { ModelIssue, SourceRef } from './types';

export interface Finding {
  message: string;
  severity: 'error' | 'warning';
  /** Where to report it; absent means "the spec file, line 0". */
  source?: SourceRef;
}

export interface TextRange {
  start: number;
  end: number;
}

/**
 * Locate the value a JSON pointer (RFC 6901) refers to in JSON text, as character offsets.
 * A minimal scanner (no dependency): it walks objects/arrays, skipping over values, and tolerates
 * nothing but well-formed JSON. If the path cannot be followed the deepest ancestor that was found
 * is returned (approximation: the range of the nearest enclosing value); undefined if the text is
 * not parseable at all or empty.
 */
export function locatePointer(text: string, pointer: string): TextRange | undefined {
  const segs = pointer === '' ? [] : pointer.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const str = (): string | undefined => {
    if (text[i] !== '"') return undefined;
    const s = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    try {
      return JSON.parse(text.slice(s, i)) as string;
    } catch {
      return undefined;
    }
  };
  /** Skip one value starting at i (after ws). */
  const skip = (): boolean => {
    ws();
    const c = text[i];
    if (c === '"') return str() !== undefined;
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      i++;
      ws();
      if (text[i] === close) return !!++i;
      for (;;) {
        ws();
        if (c === '{') {
          if (str() === undefined) return false;
          ws();
          if (text[i++] !== ':') return false;
        }
        if (!skip()) return false;
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === close) return !!++i;
        else return false;
      }
    }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?|^true|^false|^null/.exec(text.slice(i, i + 40));
    if (!m) return false;
    i += m[0].length;
    return true;
  };

  ws();
  let best: TextRange | undefined;
  for (let depth = 0; ; depth++) {
    const start = i;
    if (!skip()) return best;
    const range = { start, end: i };
    best = range;
    if (depth === segs.length) return range;
    // Descend into the value into which `segs[depth]` points.
    i = start;
    const seg = segs[depth];
    const c = text[i];
    let found = false;
    if (c === '{') {
      i++;
      for (;;) {
        ws();
        if (text[i] === '}') break;
        const key = str();
        if (key === undefined) return best;
        ws();
        i++; // ':'
        ws();
        if (key === seg) {
          found = true;
          break;
        }
        if (!skip()) return best;
        ws();
        if (text[i] === ',') i++;
      }
    } else if (c === '[') {
      const want = Number(seg);
      i++;
      for (let n = 0; ; n++) {
        ws();
        if (text[i] === ']') break;
        if (n === want) {
          found = true;
          break;
        }
        if (!skip()) return best;
        ws();
        if (text[i] === ',') i++;
      }
    }
    if (!found) return best;
  }
}

export function modelIssuesToFindings(issues: ModelIssue[]): Finding[] {
  return issues.map((i) => ({ message: i.message, severity: 'error', source: i.source }));
}

/** Shape of the backend's `init` answer. */
export interface InitResponse {
  success?: boolean;
  issues?: Record<string, { id?: string; type?: string; description?: string }[]>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Ask a running backend to check a model. Throws on transport / HTTP errors and after `timeoutMs`.
 * The simulator must be restarted: without it, declarations of the previously loaded model leak in
 * and produce bogus issues. Callers must not run two of these (or a UI validation) at once: two
 * concurrent first inits on the backend reliably leave one of them hanging.
 */
export async function validateRemote(fetchFn: FetchLike, baseUrl: string, xml: string, sessionId: string, timeoutMs = 60000): Promise<InitResponse> {
  const res = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/api/v2/cpn/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SessionId': sessionId },
    body: JSON.stringify({ xml, complex_verify: true, need_sim_restart: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`backend answered HTTP ${res.status}`);
  return (await res.json()) as InitResponse;
}

/**
 * Backend issues keyed by XML id -> findings keyed through `idMap`. Observed format: every entry has
 * type "page" regardless of the culprit; the page element also collects empty noise lines such as
 * "ID13: ID13: " which are dropped, and an "IDn: " prefix is stripped. Unknown ids get no source
 * (reported on the spec file, line 0).
 */
export function remoteIssuesToFindings(resp: InitResponse, idMap: Record<string, SourceRef>): Finding[] {
  const out: Finding[] = [];
  for (const [id, list] of Object.entries(resp.issues ?? {})) {
    for (const it of list ?? []) {
      const msg = (it.description ?? '').replace(/^\s*(ID\d+:\s*)+/, '').trim();
      if (!msg) continue;
      out.push({ message: msg, severity: 'error', source: idMap[it.id ?? id] ?? idMap[id] });
    }
  }
  if (resp.success === false && out.length === 0) out.push({ message: 'the backend rejected the model', severity: 'error' });
  return out;
}
