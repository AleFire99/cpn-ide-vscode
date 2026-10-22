// Token-count abstraction: PetriSpec -> PTNet (flattened hierarchy, arc weight = tokens moved). vscode-free.
import { nodeKey, type PetriSpec } from '../model/types';
import type { PTNet, PTNode } from './ptnet';

interface Count {
  n: number;
  /** Reason when the count is a best guess. */
  approx?: string;
}

/** Split on `++` outside brackets and strings. */
function splitTerms(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      const j = s.indexOf('"', i + 1);
      const end = j < 0 ? s.length : j + 1;
      cur += s.slice(i, end);
      i = end - 1;
    } else if ('([{'.includes(c)) { depth++; cur += c; }
    else if (')]}'.includes(c)) { depth--; cur += c; }
    else if (depth === 0 && c === '+' && s[i + 1] === '+') { out.push(cur); cur = ''; i++; }
    else cur += c;
  }
  out.push(cur);
  return out.map((t) => t.trim());
}

/** Top-level tokens of an expression: operand ('o') or operator ('p'). Groups and strings are one operand. */
function tokens(s: string): { k: 'o' | 'p'; t: string }[] {
  const out: { k: 'o' | 'p'; t: string }[] = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    let j = i + 1;
    let k: 'o' | 'p' = 'o';
    if ('([{'.includes(c)) {
      for (let d = 1; j < s.length && d > 0; j++) d += '([{'.includes(s[j]) ? 1 : ')]}'.includes(s[j]) ? -1 : 0;
    } else if (c === '"') {
      const e = s.indexOf('"', i + 1);
      j = e < 0 ? s.length : e + 1;
    } else if (/[\w'.]/.test(c)) {
      while (j < s.length && /[\w'.]/.test(s[j])) j++;
    } else {
      k = 'p';
      while (j < s.length && !/[\s\w'.([{")\]}]/.test(s[j])) j++;
    }
    out.push({ k, t: s.slice(i, j) });
    i = j;
  }
  return out;
}

/** Tokens in one multiset term (the part between `++`). */
function termCount(term: string, vals: Map<string, string>, depth: number): Count {
  if (term === '') return { n: 1, approx: 'empty term' };
  const m = /^([A-Za-z0-9_']+)\s*`([\s\S]*)$/.exec(term);
  let n = 1;
  let rest = term;
  if (m) {
    rest = m[2].trim();
    if (/^\d+$/.test(m[1])) n = Number(m[1]);
    else {
      const v = depth < 4 ? vals.get(m[1]) : undefined;
      if (v !== undefined && /^\d+$/.test(v.trim())) n = Number(v.trim());
      else return { n: 1, approx: `variable count \`${m[1]}\`` };
    }
  } else if (/^[A-Za-z_][\w']*$/.test(term) && vals.has(term) && depth < 4) {
    return exprCount(vals.get(term)!, vals, depth + 1); // a named multiset value
  }
  const ts = tokens(rest);
  if (ts.length && /^(if|case|let|fn)$/.test(ts[0].t)) return { n, approx: `\`${ts[0].t}\` expression` };
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].t[0] === '[') return { n, approx: 'list value' };
    if (ts[i].k === 'p' && /^(::|@)$/.test(ts[i].t)) return { n, approx: 'list operator' };
    if (i > 0 && ts[i].k === 'o' && ts[i - 1].k === 'o') return { n, approx: `function application in "${rest}"` };
  }
  return { n };
}

/** Tokens in a multiset expression `a ++ b`. */
function exprCount(e: string, vals: Map<string, string>, depth = 0): Count {
  let n = 0;
  let approx: string | undefined;
  for (const t of splitTerms(e)) {
    const c = termCount(t, vals, depth);
    n += c.n;
    approx ??= c.approx;
  }
  return approx ? { n, approx } : { n };
}

/** Simple `val x = expr;` declarations. */
function simpleVals(sml: string): Map<string, string> {
  const vals = new Map<string, string>();
  const re = /\bval\s+([A-Za-z_][\w']*)\s*=\s*([^;]+);/g;
  for (let m; (m = re.exec(sml)); ) vals.set(m[1], m[2].trim());
  return vals;
}

/** Color-set names declared as `unit` or `list` in the sml. */
function declaredKinds(sml: string, kind: string): Set<string> {
  const out = new Set<string>(kind === 'unit' ? ['UNIT'] : []);
  const re = new RegExp(`\\bcol(?:or)?set\\s+([A-Za-z_][\\w']*)\\s*=\\s*(?:timed\\s+)?${kind}\\b`, 'g');
  for (let m; (m = re.exec(sml)); ) out.add(m[1]);
  return out;
}

export function toPTNet(spec: PetriSpec, sml: string): PTNet {
  const vals = simpleVals(sml);
  const units = declaredKinds(sml, 'unit');
  const lists = declaredKinds(sml, 'list');
  const isList = (type: string) => /^\s*list\b/.test(type) || lists.has(type.trim());
  const pageIdx = new Map(spec.pages.map((p, i) => [p.name, i]));
  const approximations: PTNet['approximations'] = [];

  // Raw places: one per (page instance, place). Union-find merges sockets/ports and fusion sets.
  interface Raw { label: string; source: PTNode['source']; init: number; bound: boolean }
  const raws: Raw[] = [];
  const parent: number[] = [];
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => { parent[Math.max(find(a), find(b))] = Math.min(find(a), find(b)); };
  const fusion = new Map<string, number>();
  const trans: PTNode[] = [];
  const arcs: { t: number; p: number; w: number; dir: 'pre' | 'post' }[] = [];

  // Pages instantiated more than once get the substitution transition name in their labels.
  const uses = new Map<string, number>();
  for (const pg of spec.pages) for (const t of pg.transitions ?? []) if (t.subpage) uses.set(t.subpage.page, (uses.get(t.subpage.page) ?? 0) + 1);

  const instantiate = (pi: number, inst: string, stack: number[]): Map<string, number> => {
    const pg = spec.pages[pi];
    const prefix = inst ? `${pg.name}@${inst}` : pg.name;
    const placeIds = new Map<string, number>();
    const placeType = new Map<string, string>();
    (pg.places ?? []).forEach((pl, j) => {
      const id = raws.length;
      const { n, approx } = pl.init ? exprCount(pl.init, vals) : { n: 0, approx: undefined };
      if (approx) approximations.push({ element: `${prefix}/${pl.name} init`, reason: approx });
      raws.push({ label: `${prefix}/${pl.name}`, source: { file: 'spec', path: `/pages/${pi}/places/${j}` }, init: n, bound: false });
      parent.push(id);
      placeIds.set(nodeKey(pl), id);
      placeType.set(nodeKey(pl), pl.type);
      if (pl.fusion !== undefined) {
        const f = fusion.get(pl.fusion);
        if (f === undefined) fusion.set(pl.fusion, id);
        else union(f, id);
      }
    });
    const transIds = new Map<string, number>();
    (pg.transitions ?? []).forEach((t, j) => {
      if (!t.subpage) {
        transIds.set(nodeKey(t), trans.length);
        trans.push({ id: `t${trans.length}`, label: `${prefix}/${t.name}`, source: { file: 'spec', path: `/pages/${pi}/transitions/${j}` } });
        return;
      }
      const si = pageIdx.get(t.subpage.page);
      if (si === undefined || stack.includes(si)) return;
      const child = instantiate(si, (uses.get(t.subpage.page) ?? 0) > 1 ? t.name : '', [...stack, si]);
      for (const [socket, port] of Object.entries(t.subpage.ports ?? {})) {
        const a = placeIds.get(socket);
        const b = child.get(port);
        if (a === undefined || b === undefined) continue;
        raws[b].bound = true;
        union(a, b);
      }
    });
    (pg.arcs ?? []).forEach((a) => {
      const place = placeIds.has(a.from) ? a.from : placeIds.has(a.to) ? a.to : undefined;
      const tkey = place === a.from ? a.to : a.from;
      if (place === undefined || !transIds.has(tkey)) return; // substitution arcs are covered by port binding
      const type = placeType.get(place)!;
      const insc = a.inscription?.trim() ?? '';
      let c: Count;
      if (insc === '') c = units.has(type.trim()) ? { n: 1 } : { n: 1, approx: 'empty inscription on a non-UNIT place' };
      else c = exprCount(insc, vals);
      if (!c.approx && isList(type)) c = { n: c.n, approx: 'list-typed place' };
      if (c.approx) approximations.push({ element: `${prefix}/${a.from}->${a.to}`, reason: c.approx });
      const p = placeIds.get(place)!;
      const t = transIds.get(tkey)!;
      if (a.bidirectional) arcs.push({ t, p, w: c.n, dir: 'pre' }, { t, p, w: c.n, dir: 'post' });
      else arcs.push({ t, p, w: c.n, dir: place === a.from ? 'pre' : 'post' });
    });
    return placeIds;
  };

  const referenced = new Set(uses.keys());
  let roots = spec.pages.map((_, i) => i).filter((i) => !referenced.has(spec.pages[i].name));
  if (!roots.length && spec.pages.length) roots = [0];
  for (const r of roots) instantiate(r, '', [r]);

  // Collapse merged raw places into net places, keeping first-appearance order.
  const index = new Map<number, number>();
  const places: PTNode[] = [];
  const m0: number[] = [];
  raws.forEach((r, i) => {
    const root = find(i);
    let k = index.get(root);
    if (k === undefined) {
      k = places.length;
      index.set(root, k);
      places.push({ id: `p${k}`, label: raws[root].label, source: raws[root].source });
      m0.push(0);
    }
    if (!r.bound) m0[k] = Math.max(m0[k], r.init); // members of a fusion set share one marking
  });

  const pre = trans.map(() => places.map(() => 0));
  const post = trans.map(() => places.map(() => 0));
  for (const a of arcs) (a.dir === 'pre' ? pre : post)[a.t][index.get(find(a.p))!] += a.w;

  return { places, transitions: trans, pre, post, m0, exact: approximations.length === 0, approximations };
}
