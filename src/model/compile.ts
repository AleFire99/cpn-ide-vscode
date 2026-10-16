// Text model (*.petri.json + *.sml) -> CPN Tools XML (format 6), the form the CPN IDE UI and
// backend load. Graphics are fixed defaults; positions come from the spec or from layoutPage().
import { layoutPage } from './layout';
import { parseSml, withStandard, type Colset, type Decl } from './sml';
import {
  ModelError,
  nodeKey,
  type ArcSpec,
  type ModelIssue,
  type PageSpec,
  type PetriSpec,
  type PlaceSpec,
  type Pos,
  type SourceRef,
  type TransitionSpec,
} from './types';

export interface CompileResult {
  xml: string;
  /** XML element id -> where it came from, for mapping backend issues back to the sources. */
  idMap: Record<string, SourceRef>;
}

/** Escape for XML text and single-quoted attributes; non-Latin-1 characters become char references. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/[^\x09\x0a\x0d\x20-\xff]/gu, (c) => `&#${c.codePointAt(0)};`);
}

const num = (n: number) => n.toFixed(6);
const ATTRS = `<fillattr colour='White' pattern='' filled='false'/>
<lineattr colour='Black' thick='1' type='Solid'/>
<textattr colour='Black' bold='false'/>`;
const LABEL_ATTRS = `<fillattr colour='White' pattern='Solid' filled='false'/>
<lineattr colour='Black' thick='0' type='Solid'/>
<textattr colour='Black' bold='false'/>`;
const PORT_TYPES = { in: 'In', out: 'Out', io: 'I/O', general: 'General' } as const;

// Simulator options of the CPN IDE template net (resources/ui/assets/cpn/mynet.cpn).
const OPTIONS = (realtime: boolean) => {
  const bools: [string, boolean][] = [
    ['realtimestamp', realtime], ['fair_be', false], ['global_fairness', false],
    ['extensions.10006.enable', true], ['extensions.10001.enable', true], ['extensions.10003.enable', true],
    ['extensions.10005.enable', true], ['extensions.10002.enable', true],
    ['repavg', true], ['repciavg', true], ['repcount', false], ['repfirstval', false], ['replastval', false],
    ['repmax', true], ['repmin', true], ['repssquare', false], ['repssqdev', false], ['repstddev', true],
    ['repsum', false], ['repvariance', false], ['avg', true], ['ciavg', false], ['count', true],
    ['firstval', false], ['lastval', false], ['max', true], ['min', true], ['ssquare', false], ['ssqdev', false],
    ['stddev', false], ['sum', false], ['variance', false], ['firstupdate', false], ['interval', false],
    ['lastupdate', false], ['untimedavg', true], ['untimedciavg', false], ['untimedcount', true],
    ['untimedfirstval', false], ['untimedlastval', false], ['untimedmax', true], ['untimedmin', true],
    ['untimedssquare', false], ['untimedssqdev', false], ['untimedstddev', false], ['untimedsum', true],
    ['untimedvariance', false],
  ];
  const opt = (name: string, value: string) => `<option name='${name}'><value>${value}</value></option>`;
  return [
    '<options>',
    ...bools.slice(0, 3).map(([n, v]) => opt(n, `<boolean>${v}</boolean>`)),
    opt('outputdirectory', '<text>&lt;same as model&gt;</text>'),
    ...bools.slice(3).map(([n, v]) => opt(n, `<boolean>${v}</boolean>`)),
    '</options>',
  ].join('\n');
};

function colsetXml(c: Colset): string {
  const id = (x: string) => `<id>${esc(x)}</id>`;
  const ml = (x: string) => `<ml>${esc(x)}</ml>`;
  const rng = (r?: [string, string]) => (r ? `<with>${ml(r[0])}${ml(r[1])}</with>` : '');
  let body: string;
  switch (c.k) {
    case 'unit':
      body = `<unit>${c.with ? `<with>${id(c.with)}</with>` : ''}</unit>`;
      break;
    case 'bool':
      body = `<bool>${c.with ? `<with>${id(c.with[0])}${id(c.with[1])}</with>` : ''}</bool>`;
      break;
    case 'int':
    case 'intinf':
    case 'real':
      body = `<${c.k}>${rng(c.range)}</${c.k}>`;
      break;
    case 'time':
      body = '<time/>';
      break;
    case 'string':
      body = c.range
        ? `<string><with>${ml(c.range[0])}${ml(c.range[1])}${c.len ? `<and>${ml(c.len[0])}${ml(c.len[1])}</and>` : ''}</with></string>`
        : '<string/>';
      break;
    case 'enum':
      body = `<enum>${c.ids.map(id).join('')}</enum>`;
      break;
    case 'index':
      body = `<index>${ml(c.range[0])}${ml(c.range[1])}${id(c.id)}</index>`;
      break;
    case 'product':
      body = `<product>${c.ids.map(id).join('')}</product>`;
      break;
    case 'record':
      body = `<record>${c.fields.map(([f, t]) => `<recordfield>${id(f)}${id(t)}</recordfield>`).join('')}</record>`;
      break;
    case 'union':
      body = `<union>${c.fields.map(([f, t]) => `<unionfield>${id(f)}${t ? `<type>${id(t)}</type>` : ''}</unionfield>`).join('')}</union>`;
      break;
    case 'list':
      body = `<list>${rng(c.range)}${id(c.of)}</list>`;
      break;
    case 'subset':
      body = `<subset>${id(c.of)}${c.by !== undefined ? `<by>${ml(c.by)}</by>` : `<with>${ml(c.with ?? '')}</with>`}</subset>`;
      break;
    case 'alias':
      body = `<alias>${id(c.of)}</alias>`;
      break;
  }
  return (c.timed ? '<timed/>' : '') + body;
}

function declXml(d: Decl, id: string): string {
  const layout = `<layout>${esc(d.text)}</layout>`;
  switch (d.kind) {
    case 'color':
      return `<color id='${id}'><id>${esc(d.name)}</id>${colsetXml(d.colset)}${layout}</color>`;
    case 'var':
      return `<var id='${id}'><type><id>${esc(d.type)}</id></type>${d.names.map((n) => `<id>${esc(n)}</id>`).join('')}${layout}</var>`;
    case 'globref':
      return `<globref id='${id}'><id>${esc(d.name)}</id><ml>${esc(d.value)}</ml>${layout}</globref>`;
    case 'ml':
      return `<ml id='${id}'>${layout}${esc(d.text)}</ml>`;
  }
}

interface Ctx {
  id: () => string;
  idMap: Record<string, SourceRef>;
  issues: ModelIssue[];
}

/** Nested <block>s from the declarations' block paths, in first-appearance order. */
function globbox(decls: Decl[], ctx: Ctx): string {
  interface Tree {
    name: string;
    items: (Decl | Tree)[];
  }
  const root: Tree = { name: '', items: [] };
  for (const d of decls) {
    let t = root;
    for (const name of d.block) {
      let next = t.items.find((x): x is Tree => 'items' in x && x.name === name);
      if (!next) t.items.push((next = { name, items: [] }));
      t = next;
    }
    t.items.push(d);
  }
  const render = (t: Tree): string =>
    t.items
      .map((x) => {
        const id = ctx.id();
        if ('items' in x) return `<block id='${id}'><id>${esc(x.name)}</id>\n${render(x)}\n</block>`;
        if (x.line > 0) ctx.idMap[id] = { file: 'sml', line: x.line };
        return declXml(x, id);
      })
      .join('\n');
  return `<globbox>\n${render(root)}\n</globbox>`;
}

function label(tag: string, id: string, [x, y]: Pos, text: string): string {
  return `<${tag} id='${id}'>
<posattr x='${num(x)}' y='${num(y)}'/>
${LABEL_ATTRS}
<text tool='CPN Tools' version='4.0.1'>${esc(text)}</text>
</${tag}>`;
}

interface PageInfo {
  id: string;
  spec: PageSpec;
  path: string;
  /** node key -> XML id */
  ids: Map<string, string>;
  places: Map<string, PlaceSpec>;
  transitions: Map<string, TransitionSpec>;
}

function str(v: unknown, what: string, path: string, ctx: Ctx, optional = true): v is string | undefined {
  if (v === undefined && optional) return true;
  if (typeof v === 'string') return true;
  ctx.issues.push({ message: `${what} must be a string`, source: { file: 'spec', path } });
  return false;
}

function checkPos(v: unknown, path: string, ctx: Ctx): v is Pos | undefined {
  if (v === undefined || (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)))) return true;
  ctx.issues.push({ message: 'pos must be [x, y]', source: { file: 'spec', path } });
  return false;
}

/** Compile a spec and its declarations file to CPN Tools XML. Throws ModelError listing every problem. */
export function compile(spec: PetriSpec, sml: string): CompileResult {
  let next = 1;
  const ctx: Ctx = { id: () => `ID${next++}`, idMap: {}, issues: [] };
  const fail = (message: string, path: string) => ctx.issues.push({ message, source: { file: 'spec', path } });

  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.pages)) throw new ModelError([{ message: 'the model must have a "pages" array' }]);
  if (spec.version !== 1) fail(`unsupported version ${String(spec.version)} (expected 1)`, '/version');

  const parsed = parseSml(sml);
  ctx.issues.push(...parsed.issues);
  const declsXml = globbox(withStandard(parsed.decls), ctx);

  // Pass 1: ids and node tables per page.
  const pages: PageInfo[] = [];
  const byName = new Map<string, PageInfo>();
  spec.pages.forEach((p, pi) => {
    const path = `/pages/${pi}`;
    if (!p || typeof p !== 'object' || !str(p.name, 'page name', `${path}/name`, ctx, false)) return;
    if (byName.has(p.name)) fail(`duplicate page name "${p.name}"`, `${path}/name`);
    const info: PageInfo = { id: ctx.id(), spec: p, path, ids: new Map(), places: new Map(), transitions: new Map() };
    ctx.idMap[info.id] = { file: 'spec', path };
    const add = (kind: 'places' | 'transitions', n: PlaceSpec | TransitionSpec, i: number) => {
      const np = `${path}/${kind}/${i}`;
      if (!n || typeof n !== 'object' || !str(n.name, 'name', `${np}/name`, ctx, false) || !str(n.key, 'key', `${np}/key`, ctx)) return;
      const key = nodeKey(n);
      if (info.ids.has(key)) {
        fail(`duplicate node "${key}" on page "${p.name}" (give one a unique "key")`, np);
        return;
      }
      const id = ctx.id();
      info.ids.set(key, id);
      ctx.idMap[id] = { file: 'spec', path: np };
      if (kind === 'places') info.places.set(key, n as PlaceSpec);
      else info.transitions.set(key, n as TransitionSpec);
    };
    (p.places ?? []).forEach((n, i) => add('places', n, i));
    (p.transitions ?? []).forEach((n, i) => add('transitions', n, i));
    pages.push(info);
    byName.set(p.name, info);
  });

  // Hierarchy: subpage references, port/socket assignments.
  const subpageOf = new Map<string, PageInfo>(); // transition XML id -> subpage
  for (const pg of pages) {
    (pg.spec.transitions ?? []).forEach((t, i) => {
      if (!t?.subpage) return;
      const path = `${pg.path}/transitions/${i}/subpage`;
      const sub = byName.get(t.subpage.page);
      if (!sub) return void fail(`unknown subpage "${t.subpage.page}"`, `${path}/page`);
      if (sub === pg) return void fail('a page cannot be its own subpage', `${path}/page`);
      subpageOf.set(pg.ids.get(nodeKey(t))!, sub);
      for (const [socket, port] of Object.entries(t.subpage.ports ?? {})) {
        if (!pg.places.has(socket)) fail(`socket "${socket}" is not a place on page "${pg.spec.name}"`, `${path}/ports`);
        const pp = sub.places.get(port);
        if (!pp) fail(`port "${port}" is not a place on page "${sub.spec.name}"`, `${path}/ports`);
        else if (!pp.port) fail(`place "${port}" on page "${sub.spec.name}" is not a port (set "port")`, `${path}/ports`);
      }
    });
  }

  // Pass 2: XML per page.
  const fusion = new Map<string, string[]>(); // name -> place ids
  const pagesXml = pages.map((pg) => {
    const p = pg.spec;
    const arcs = p.arcs ?? [];
    const edges: [string, string][] = arcs.filter((a) => a && typeof a === 'object').map((a) => [a.from, a.to]);
    const nodes = (['places', 'transitions'] as const).flatMap((kind) =>
      (p[kind] ?? []).map((n, i) => ({ key: nodeKey(n), pos: checkPos(n?.pos, `${pg.path}/${kind}/${i}/pos`, ctx) ? n?.pos : undefined })),
    );
    const pos = layoutPage(nodes, edges);

    const placeXml = [...pg.places].map(([key, pl]) => {
      const id = pg.ids.get(key)!;
      const path = `${pg.path}/places/${p.places!.indexOf(pl)}`;
      str(pl.type, 'type', `${path}/type`, ctx, false);
      str(pl.init, 'init', `${path}/init`, ctx);
      const [x, y] = pos.get(key)!;
      let extra = '';
      if (pl.fusion !== undefined) {
        if (str(pl.fusion, 'fusion', `${path}/fusion`, ctx)) (fusion.get(pl.fusion) ?? fusion.set(pl.fusion, []).get(pl.fusion)!).push(id);
        extra += `\n<fusioninfo id='${ctx.id()}' name='${esc(pl.fusion)}'>\n<posattr x='${num(x - 40)}' y='${num(y + 30)}'/>\n${LABEL_ATTRS}\n</fusioninfo>`;
      }
      if (pl.port !== undefined) {
        const t = PORT_TYPES[pl.port];
        if (!t) fail(`port must be one of ${Object.keys(PORT_TYPES).join(', ')}`, `${path}/port`);
        else extra += `\n<port id='${ctx.id()}' type='${t}'>\n<posattr x='${num(x - 30)}' y='${num(y - 25)}'/>\n${LABEL_ATTRS}\n<text>${t}</text>\n</port>`;
      }
      return `<place id='${id}'>
<posattr x='${num(x)}' y='${num(y)}'/>
${ATTRS}
<text>${esc(pl.name)}</text>
<ellipse w='70.000000' h='40.000000'/>
<token x='-10.000000' y='0.000000'/>
<marking x='0.000000' y='0.000000' hidden='false'><snap snap_id='0' anchor.horizontal='0' anchor.vertical='0'/></marking>
${label('type', ctx.id(), [x + 45, y - 30], String(pl.type ?? ''))}
${label('initmark', ctx.id(), [x + 45, y + 30], pl.init ?? '')}${extra}
</place>`;
    });

    const transXml = [...pg.transitions].map(([key, t]) => {
      const id = pg.ids.get(key)!;
      const path = `${pg.path}/transitions/${p.transitions!.indexOf(t)}`;
      for (const f of ['guard', 'time', 'code', 'priority'] as const) str(t[f], f, `${path}/${f}`, ctx);
      const [x, y] = pos.get(key)!;
      let subst = '';
      const sub = subpageOf.get(id);
      if (sub && t.subpage) {
        const portsock = Object.entries(t.subpage.ports ?? {})
          .filter(([s, pt]) => pg.ids.has(s) && sub.ids.has(pt))
          .map(([s, pt]) => `(${sub.ids.get(pt)},${pg.ids.get(s)})`)
          .join('');
        subst = `\n<subst subpage='${sub.id}' portsock='${portsock}'>
<subpageinfo id='${ctx.id()}' name='${esc(sub.spec.name)}'>
<posattr x='${num(x)}' y='${num(y - 30)}'/>
${LABEL_ATTRS}
</subpageinfo>
</subst>`;
      }
      const guard = t.guard?.trim() ? `[${t.guard.trim().replace(/^\[([\s\S]*)\]$/, '$1')}]` : '';
      return `<trans id='${id}' explicit='false'>
<posattr x='${num(x)}' y='${num(y)}'/>
${ATTRS}
<text>${esc(t.name)}</text>
<box w='80.000000' h='40.000000'/>${subst}
<binding x='7.200000' y='-3.000000'/>
${label('cond', ctx.id(), [x - 40, y + 35], guard)}
${label('time', ctx.id(), [x + 50, y + 35], t.time ?? '')}
${label('code', ctx.id(), [x + 50, y - 35], t.code ?? '')}
${label('priority', ctx.id(), [x - 50, y - 35], t.priority ?? '')}
</trans>`;
    });

    const arcXml = arcs.map((a: ArcSpec, i) => {
      const path = `${pg.path}/arcs/${i}`;
      if (!a || typeof a !== 'object' || !str(a.from, 'from', `${path}/from`, ctx, false) || !str(a.to, 'to', `${path}/to`, ctx, false)) return '';
      str(a.inscription, 'inscription', `${path}/inscription`, ctx);
      const fromPlace = pg.places.has(a.from);
      const [place, trans] = fromPlace ? [a.from, a.to] : [a.to, a.from];
      const problem = !pg.ids.has(a.from)
        ? [`unknown node "${a.from}" on page "${p.name}"`, `${path}/from`]
        : !pg.ids.has(a.to)
          ? [`unknown node "${a.to}" on page "${p.name}"`, `${path}/to`]
          : !pg.places.has(place) || !pg.transitions.has(trans)
            ? ['an arc must connect a place and a transition', path]
            : undefined;
      if (problem) {
        fail(problem[0], problem[1]);
        return '';
      }
      const id = ctx.id();
      ctx.idMap[id] = { file: 'spec', path };
      const orientation = a.bidirectional ? 'BOTHDIR' : fromPlace ? 'PtoT' : 'TtoP';
      const bends = (a.bends ?? [])
        .filter((b, bi) => checkPos(b, `${path}/bends/${bi}`, ctx))
        .map((b, bi) => `<bendpoint id='${ctx.id()}' serial='${bi + 1}'>\n<posattr x='${num(b[0])}' y='${num(b[1])}'/>\n${ATTRS}\n</bendpoint>\n`)
        .join('');
      const [px, py] = pos.get(place)!;
      const [tx, ty] = pos.get(trans)!;
      return `<arc id='${id}' orientation='${orientation}' order='1'>
<posattr x='0.000000' y='0.000000'/>
${ATTRS}
<arrowattr headsize='1.200000' currentcyckle='2'/>
<transend idref='${pg.ids.get(trans)}'/>
<placeend idref='${pg.ids.get(place)}'/>
${bends}${label('annot', ctx.id(), [(px + tx) / 2, (py + ty) / 2 + 12], a.inscription ?? '')}
<text></text>
</arc>`;
    });

    return `<page id='${pg.id}'>
<pageattr name='${esc(p.name)}'/>
${[...placeXml, ...transXml, ...arcXml].filter(Boolean).join('\n')}
<constraints></constraints>
</page>`;
  });

  // Instance tree: one root per page that is no transition's subpage.
  const usedAsSub = new Set([...subpageOf.values()]);
  const instance = (pg: PageInfo, stack: PageInfo[]): string =>
    [...pg.transitions.keys()]
      .map((k) => pg.ids.get(k)!)
      .filter((tid) => subpageOf.has(tid))
      .map((tid) => {
        const sub = subpageOf.get(tid)!;
        if (stack.includes(sub)) {
          fail(`page "${sub.spec.name}" contains itself through substitution transitions`, sub.path);
          return '';
        }
        return `<instance id='${ctx.id()}' trans='${tid}'>\n${instance(sub, [...stack, sub])}</instance>\n`;
      })
      .join('');
  const roots = pages.filter((pg) => !usedAsSub.has(pg));
  if (pages.length && !roots.length) fail('no top-level page: every page is a subpage', '/pages');
  const instances = roots.map((pg) => `<instance id='${pg.id}itop' page='${pg.id}'>\n${instance(pg, [pg])}</instance>`).join('\n');

  const fusionXml = [...fusion].map(([name, ids]) => `<fusion id='${ctx.id()}' name='${esc(name)}'>\n${ids.map((i) => `<fusion_elm idref='${i}'/>`).join('\n')}\n</fusion>`);

  if (ctx.issues.length) throw new ModelError(ctx.issues);
  const xml = `<?xml version="1.0" encoding="iso-8859-1"?>
<!DOCTYPE workspaceElements PUBLIC "-//CPN//DTD CPNXML 1.0//EN" "http://cpntools.org/DTD/6/cpn.dtd">
<workspaceElements>
<generator tool='CPN Tools' version='4.0.1' format='6'/>
<cpnet>
${declsXml}
${pagesXml.join('\n')}
${fusionXml.join('\n')}
<instances>
${instances}
</instances>
${OPTIONS(spec.realtime === true)}
<binders/>
<monitorblock name='Monitors'/>
</cpnet>
</workspaceElements>
`;
  return { xml, idMap: ctx.idMap };
}
