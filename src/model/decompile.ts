// CPN Tools XML -> text model (the reverse of compile.ts). Graphics, monitors and other
// features the text model has no place for are dropped, each kind with one warning.
import { XMLParser } from 'fast-xml-parser';
import { colsetToSml, isStandardDecl, parseSml, type Colset, type ColsetBody, type Range } from './sml';
import type { PageSpec, PetriSpec, PlaceSpec, PortType, Pos, TransitionSpec } from './types';

interface XNode {
  tag: string;
  attrs: Record<string, string>;
  kids: XNode[];
  /** Own text, trimmed. */
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(\w+));/g, (m, d, h, n) =>
    d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16)) : (ENTITIES[n] ?? m),
  );

type Raw = Record<string, unknown>;

function toNode(raw: Raw): XNode | undefined {
  const tag = Object.keys(raw).find((k) => k !== ':@' && k !== '#text');
  if (tag === undefined) return undefined;
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries((raw[':@'] as Record<string, string>) ?? {})) attrs[k] = decode(String(v));
  const kids: XNode[] = [];
  let text = '';
  for (const c of raw[tag] as Raw[]) {
    if ('#text' in c) text += String(c['#text']);
    else {
      const k = toNode(c);
      if (k) kids.push(k);
    }
  }
  return { tag, attrs, kids, text: decode(text).trim() };
}

const kid = (n: XNode | undefined, tag: string) => n?.kids.find((k) => k.tag === tag);
const kidsOf = (n: XNode | undefined, tag: string) => n?.kids.filter((k) => k.tag === tag) ?? [];
/** Text of a label child such as <type><text>..</text></type>. */
const labelText = (n: XNode, tag: string) => kid(kid(n, tag), 'text')?.text ?? '';
const idText = (n: XNode | undefined) => kid(n, 'id')?.text ?? '';
const int = (v: string | undefined): number | undefined => {
  const x = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(x) ? Math.round(x) || 0 : undefined;
};
const posOf = (n: XNode): Pos | undefined => {
  const p = kid(n, 'posattr');
  const x = int(p?.attrs.x);
  const y = int(p?.attrs.y);
  return x === undefined || y === undefined ? undefined : [x, y];
};

/** Structured <color> contents -> Colset; undefined if the shape is not one the text model supports. */
function colsetFromXml(color: XNode): Colset | undefined {
  const timed = color.kids.some((k) => k.tag === 'timed');
  const body = color.kids.find((k) => !['id', 'timed', 'layout'].includes(k.tag));
  if (!body) return undefined;
  const ids = (n: XNode) => kidsOf(n, 'id').map((i) => i.text);
  const mls = (n: XNode | undefined): string[] => kidsOf(n, 'ml').map((m) => m.text);
  const rng = (n: XNode | undefined): Range | undefined => {
    const m = mls(n);
    return m.length >= 2 ? [m[0], m[1]] : undefined;
  };
  let b: ColsetBody | undefined;
  switch (body.tag) {
    case 'unit': {
      const w = idText(kid(body, 'with'));
      b = w ? { k: 'unit', with: w } : { k: 'unit' };
      break;
    }
    case 'bool': {
      const w = kid(body, 'with');
      b = w && ids(w).length === 2 ? { k: 'bool', with: [ids(w)[0], ids(w)[1]] } : { k: 'bool' };
      break;
    }
    case 'int':
    case 'intinf':
    case 'real': {
      const r = rng(kid(body, 'with'));
      b = r ? { k: body.tag, range: r } : { k: body.tag };
      break;
    }
    case 'time':
      b = { k: 'time' };
      break;
    case 'string': {
      const w = kid(body, 'with');
      const r = rng(w);
      const l = rng(kid(w, 'and'));
      b = r ? (l ? { k: 'string', range: r, len: l } : { k: 'string', range: r }) : { k: 'string' };
      break;
    }
    case 'enum':
      b = { k: 'enum', ids: ids(body) };
      break;
    case 'index': {
      const r = rng(body);
      b = r && { k: 'index', id: idText(body), range: r };
      break;
    }
    case 'product':
      b = { k: 'product', ids: ids(body) };
      break;
    case 'record':
      b = { k: 'record', fields: kidsOf(body, 'recordfield').map((f) => [ids(f)[0], ids(f)[1]] as [string, string]) };
      break;
    case 'union':
      b = {
        k: 'union',
        fields: kidsOf(body, 'unionfield').map((f) => [idText(f), kid(kid(f, 'type'), 'id')?.text || undefined] as [string, string | undefined]),
      };
      break;
    case 'list': {
      const r = rng(kid(body, 'with'));
      b = r ? { k: 'list', of: idText(body), range: r } : { k: 'list', of: idText(body) };
      break;
    }
    case 'subset': {
      const by = kid(body, 'by');
      const w = kid(body, 'with');
      b = by ? { k: 'subset', of: idText(body), by: mls(by)[0] ?? '' } : w ? { k: 'subset', of: idText(body), with: mls(w)[0] ?? '' } : undefined;
      break;
    }
    case 'alias':
      b = { k: 'alias', of: idText(body) };
      break;
  }
  return b && (timed ? { ...b, timed } : b);
}

const PORTS: Record<string, PortType> = { In: 'in', Out: 'out', 'I/O': 'io', General: 'general' };

interface Ctx {
  warnings: string[];
  dropped: Map<string, number>;
}

const drop = (ctx: Ctx, what: string, n = 1) => ctx.dropped.set(what, (ctx.dropped.get(what) ?? 0) + n);

/** Declarations as CPN ML text, with `(*! A / B *)` markers for the block structure. */
function globboxToSml(globbox: XNode | undefined, ctx: Ctx): string {
  const parts: string[] = [];
  let cur: string[] | undefined;
  let first = true;
  const emit = (path: string[], text: string) => {
    if (!cur || cur.join('/') !== path.join('/')) {
      parts.push(`${first ? '' : '\n'}(*! ${path.join(' / ')} *)`);
      cur = path;
    }
    first = false;
    parts.push(text);
  };
  const walk = (n: XNode, path: string[]) => {
    for (const k of n.kids) {
      if (k.tag === 'block') walk(k, [...path, idText(k)]);
      else if (['color', 'var', 'globref', 'ml'].includes(k.tag)) {
        const text = declText(k, ctx);
        if (text === undefined) continue;
        // Standard declarations are re-added by the compiler.
        if (parseSml(text).decls.length === 1 && isStandardDecl(parseSml(text).decls[0])) continue;
        emit(path, text);
      } else if (k.tag !== 'id') drop(ctx, `<${k.tag}> declarations`);
    }
  };
  if (globbox) walk(globbox, []);
  return parts.length ? parts.join('\n') + '\n' : '';
}

function declText(d: XNode, ctx: Ctx): string | undefined {
  const layout = kid(d, 'layout')?.text;
  if (layout) {
    if (d.tag === 'ml') return layout;
    // The layout is free text and can be stale or damaged; trust it only if it is exactly this declaration.
    const p = parseSml(layout);
    const ok = p.decls.length === 1 && !p.issues.length && p.decls[0].kind === d.tag;
    if (ok) return layout;
    ctx.warnings.push(`layout of ${d.tag} ${idText(d) || kidsOf(d, 'id').map((i) => i.text).join(', ')} is not a single ${d.tag} declaration, regenerated`);
  }
  switch (d.tag) {
    case 'color': {
      const c = colsetFromXml(d);
      if (c) return colsetToSml(idText(d), c);
      ctx.warnings.push(`color set ${idText(d)} could not be converted and was dropped`);
      return undefined;
    }
    case 'var':
      return `var ${kidsOf(d, 'id').map((i) => i.text).join(', ')}: ${idText(kid(d, 'type'))};`;
    case 'globref':
      return `globref ${idText(d)} = ${kid(d, 'ml')?.text ?? ''};`;
    default:
      return d.text;
  }
}

interface NodeInfo {
  node: XNode;
  isPlace: boolean;
  key: string;
}

/** Unique key per node on a page: the name when it is unique, else `Name#2` (`P1`/`T1` when empty). */
function assignKeys(nodes: { node: XNode; isPlace: boolean }[]): NodeInfo[] {
  const used = new Set<string>();
  const names = new Set(nodes.map((n) => nodeName(n.node)).filter(Boolean));
  const keys = new Map<XNode, string>();
  for (const n of nodes) {
    const name = nodeName(n.node);
    if (name && !used.has(name)) {
      used.add(name);
      keys.set(n.node, name);
    }
  }
  const fresh = (base: string, sep: string, from: number) => {
    let i = from;
    while (used.has(base + sep + i) || names.has(base + sep + i)) i++;
    used.add(base + sep + i);
    return base + sep + i;
  };
  for (const n of nodes) if (!keys.has(n.node)) keys.set(n.node, nodeName(n.node) ? fresh(nodeName(n.node), '#', 2) : fresh(n.isPlace ? 'P' : 'T', '', 1));
  return nodes.map((n) => ({ ...n, key: keys.get(n.node)! }));
}
const nodeName = (n: XNode) => kid(n, 'text')?.text ?? '';

export function decompile(xml: string): { spec: PetriSpec; sml: string; warnings: string[] } {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
  });
  const roots = (parser.parse(xml.replace(/\r\n?/g, '\n')) as Raw[]).map(toNode).filter((n): n is XNode => !!n);
  const cpnet = kid(roots.find((r) => r.tag === 'workspaceElements'), 'cpnet') ?? roots.find((r) => r.tag === 'cpnet');
  if (!cpnet) throw new Error('not a CPN Tools model: no <cpnet> element');
  const ctx: Ctx = { warnings: [], dropped: new Map() };

  const sml = globboxToSml(kid(cpnet, 'globbox'), ctx);

  // Global fusion sets: place id -> name.
  const fusionOf = new Map<string, string>();
  for (const f of kidsOf(cpnet, 'fusion')) for (const e of kidsOf(f, 'fusion_elm')) fusionOf.set(e.attrs.idref, f.attrs.name);

  // Pass 1: page names and node keys.
  const pageNodes = kidsOf(cpnet, 'page');
  const pageNames = new Map<string, string>(); // page id -> unique name
  const usedNames = new Set<string>();
  const rawNames = pageNodes.map((p) => kid(p, 'pageattr')?.attrs.name ?? '');
  pageNodes.forEach((p, i) => {
    let name = rawNames[i] || 'Page';
    if (usedNames.has(name) || !rawNames[i]) {
      let n = rawNames[i] ? 2 : 1;
      while (usedNames.has(`${name}${rawNames[i] ? '#' : ''}${n}`) || rawNames.includes(`${name}${rawNames[i] ? '#' : ''}${n}`)) n++;
      const renamed = `${name}${rawNames[i] ? '#' : ''}${n}`;
      ctx.warnings.push(`${rawNames[i] ? 'duplicate' : 'empty'} page name "${rawNames[i]}" renamed to "${renamed}"`);
      name = renamed;
    }
    usedNames.add(name);
    pageNames.set(p.attrs.id, name);
  });

  const infos = new Map<string, NodeInfo[]>(); // page id -> nodes
  const keyById = new Map<string, string>(); // node id -> key
  for (const p of pageNodes) {
    const list = assignKeys([...kidsOf(p, 'place').map((node) => ({ node, isPlace: true })), ...kidsOf(p, 'trans').map((node) => ({ node, isPlace: false }))]);
    infos.set(p.attrs.id, list);
    for (const n of list) {
      keyById.set(n.node.attrs.id, n.key);
      if (n.key !== nodeName(n.node)) ctx.warnings.push(`page "${pageNames.get(p.attrs.id)}": node "${nodeName(n.node)}" is not unique, referenced as "${n.key}"`);
    }
  }

  const KNOWN_PAGE = new Set(['pageattr', 'place', 'trans', 'arc', 'constraints']);
  const pages: PageSpec[] = pageNodes.map((p) => {
    const pname = pageNames.get(p.attrs.id)!;
    for (const k of p.kids) if (!KNOWN_PAGE.has(k.tag)) drop(ctx, `<${k.tag}> on pages`);
    const list = infos.get(p.attrs.id)!;

    const places: PlaceSpec[] = list
      .filter((n) => n.isPlace)
      .map(({ node, key }) => {
        const name = nodeName(node);
        const pl: PlaceSpec = { name, type: labelText(node, 'type') };
        if (key !== name) pl.key = key;
        const init = labelText(node, 'initmark');
        if (init) pl.init = init;
        const pos = posOf(node);
        if (pos) pl.pos = pos;
        const port = PORTS[kid(node, 'port')?.attrs.type ?? ''];
        if (port) pl.port = port;
        const fusion = fusionOf.get(node.attrs.id) ?? kid(node, 'fusioninfo')?.attrs.name;
        if (fusion) pl.fusion = fusion;
        return pl;
      });

    const transitions: TransitionSpec[] = list
      .filter((n) => !n.isPlace)
      .map(({ node, key }) => {
        const name = nodeName(node);
        const t: TransitionSpec = { name };
        if (key !== name) t.key = key;
        const guard = labelText(node, 'cond').replace(/^\[([\s\S]*)\]$/, '$1').trim();
        if (guard) t.guard = guard;
        for (const f of ['time', 'code', 'priority'] as const) {
          const v = labelText(node, f);
          if (v) t[f] = v;
        }
        const pos = posOf(node);
        if (pos) t.pos = pos;
        const subst = kid(node, 'subst');
        if (subst) {
          const subId = subst.attrs.subpage;
          const sub: TransitionSpec['subpage'] = { page: pageNames.get(subId) ?? kid(kid(subst, 'subpageinfo'), 'text')?.text ?? kid(subst, 'subpageinfo')?.attrs.name ?? '' };
          if (!pageNames.has(subId)) ctx.warnings.push(`page "${pname}": transition "${key}" refers to an unknown subpage`);
          const ports: Record<string, string> = {};
          for (const m of (subst.attrs.portsock ?? '').matchAll(/\(([^,()]+),([^,()]+)\)/g)) {
            const port = keyById.get(m[1].trim());
            const socket = keyById.get(m[2].trim());
            if (port && socket) ports[socket] = port;
          }
          if (Object.keys(ports).length) sub.ports = ports;
          t.subpage = sub;
        }
        return t;
      });

    const arcs: NonNullable<PageSpec['arcs']> = [];
    for (const a of kidsOf(p, 'arc')) {
      const place = keyById.get(kid(a, 'placeend')?.attrs.idref ?? '');
      const trans = keyById.get(kid(a, 'transend')?.attrs.idref ?? '');
      if (!place || !trans) {
        ctx.warnings.push(`page "${pname}": arc ${a.attrs.id} has a missing end and was dropped`);
        continue;
      }
      const o = a.attrs.orientation;
      const spec: NonNullable<PageSpec['arcs']>[number] = o === 'TtoP' ? { from: trans, to: place } : { from: place, to: trans };
      const insc = labelText(a, 'annot');
      if (insc) spec.inscription = insc;
      if (o === 'BOTHDIR') spec.bidirectional = true;
      const bends = kidsOf(a, 'bendpoint')
        .map((b) => ({ serial: parseInt(b.attrs.serial ?? '0', 10) || 0, pos: posOf(b) }))
        .filter((b): b is { serial: number; pos: Pos } => !!b.pos)
        .sort((x, y) => x.serial - y.serial);
      if (bends.length) spec.bends = bends.map((b) => b.pos);
      arcs.push(spec);
    }

    const page: PageSpec = { name: pname };
    if (places.length) page.places = places;
    if (transitions.length) page.transitions = transitions;
    if (arcs.length) page.arcs = arcs;
    return page;
  });

  // Unsupported top-level features.
  const monitors = (n: XNode): number => (n.tag === 'monitor' ? 1 : n.kids.reduce((s, k) => s + monitors(k), 0));
  const nMon = kidsOf(cpnet, 'monitorblock').reduce((s, m) => s + monitors(m), 0);
  if (nMon) drop(ctx, 'monitors', nMon);
  if (kidsOf(cpnet, 'binders').some((b) => b.kids.length)) drop(ctx, 'binders (sheets)');
  for (const k of cpnet.kids) {
    if (!['globbox', 'page', 'fusion', 'instances', 'options', 'binders', 'monitorblock'].includes(k.tag)) drop(ctx, `<${k.tag}>`);
  }
  for (const [what, n] of ctx.dropped) ctx.warnings.push(`${what} are not supported by the text model and were dropped${n > 1 ? ` (${n})` : ''}`);

  const rt = kidsOf(kid(cpnet, 'options'), 'option').find((o) => o.attrs.name === 'realtimestamp');
  const spec: PetriSpec = { version: 1, pages };
  if (kid(kid(rt, 'value'), 'boolean')?.text === 'true') spec.realtime = true;

  return { spec, sml, warnings: ctx.warnings };
}
