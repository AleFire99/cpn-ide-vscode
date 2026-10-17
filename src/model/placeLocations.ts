/** Where each place of a `*.petri.json` sits in its text. vscode-free; a tiny offset-tracking JSON scan, no parser dependency. */

interface Node {
  value?: unknown;
  start: number;
  props?: Map<string, Node>;
  items?: Node[];
}

/** Parse JSON keeping the start offset of every value. Throws on malformed text. */
function scan(text: string): Node {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const str = (): string => {
    const m = /^"(?:[^"\\]|\\.)*"/.exec(text.slice(i));
    if (!m) throw new SyntaxError(`bad string at ${i}`);
    i += m[0].length;
    return JSON.parse(m[0]) as string;
  };
  const val = (): Node => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const props = new Map<string, Node>();
      ws();
      if (text[i] === '}') i++;
      else
        for (;;) {
          ws();
          const k = str();
          ws();
          if (text[i++] !== ':') throw new SyntaxError(`expected : at ${i - 1}`);
          const v = val();
          if (!props.has(k)) props.set(k, v);
          ws();
          const d = text[i++];
          if (d === '}') break;
          if (d !== ',') throw new SyntaxError(`expected , at ${i - 1}`);
        }
      return { start, props };
    }
    if (c === '[') {
      i++;
      const items: Node[] = [];
      ws();
      if (text[i] === ']') i++;
      else
        for (;;) {
          items.push(val());
          ws();
          const d = text[i++];
          if (d === ']') break;
          if (d !== ',') throw new SyntaxError(`expected , at ${i - 1}`);
        }
      return { start, items };
    }
    if (c === '"') return { value: str(), start };
    const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) throw new SyntaxError(`unexpected token at ${i}`);
    i += m[0].length;
    return { value: JSON.parse(m[0]) as unknown, start };
  };
  const root = val();
  ws();
  if (i < text.length) throw new SyntaxError(`trailing text at ${i}`);
  return root;
}

/**
 * `Page/Place` -> offset of the place's `name` value, matching the names headless results use.
 * The first place wins when a page repeats a name. Empty for text that is not valid JSON or has no pages.
 */
export function placeLocations(jsonText: string): Map<string, number> {
  const out = new Map<string, number>();
  let root: Node;
  try {
    root = scan(jsonText);
  } catch {
    return out;
  }
  for (const page of root.props?.get('pages')?.items ?? []) {
    const pageName = page.props?.get('name')?.value;
    if (typeof pageName !== 'string') continue;
    for (const place of page.props?.get('places')?.items ?? []) {
      const name = place.props?.get('name');
      if (typeof name?.value !== 'string') continue;
      const key = `${pageName}/${name.value}`;
      if (!out.has(key)) out.set(key, name.start);
    }
  }
  return out;
}
