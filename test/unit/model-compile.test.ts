import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/model/compile';
import { parseSml } from '../../src/model/sml';
import { ModelError, formatIssue, type PetriSpec } from '../../src/model/types';

const root = path.resolve(__dirname, '../..');
const examples = path.join(root, 'examples');

const base = (): PetriSpec => ({
  version: 1,
  pages: [
    {
      name: 'Main',
      places: [
        { name: 'A', type: 'INT', init: '1`1' },
        { name: 'B', type: 'INT' },
      ],
      transitions: [{ name: 'T' }],
      arcs: [
        { from: 'A', to: 'T', inscription: 'x' },
        { from: 'T', to: 'B', inscription: 'x' },
      ],
    },
  ],
});
const SML = 'var x: INT;\n';

const ids = (xml: string) => [...xml.matchAll(/<(?:[a-z_]+) id='(ID\d+)'/g)].map((m) => m[1]);

function issues(spec: unknown, sml = SML) {
  try {
    compile(spec as PetriSpec, sml);
  } catch (e) {
    expect(e).toBeInstanceOf(ModelError);
    return (e as ModelError).issues;
  }
  throw new Error('expected a ModelError');
}

const specExamples = fs.readdirSync(examples).filter((f) => f.endsWith('.petri.json'));

describe('compile examples', () => {
  it.each(specExamples)('%s is well-formed with unique ids and a valid idMap', (file) => {
    const spec = JSON.parse(fs.readFileSync(path.join(examples, file), 'utf8')) as PetriSpec;
    const smlText = fs.readFileSync(path.join(examples, file.replace('.petri.json', '.sml')), 'utf8');
    const { xml, idMap } = compile(spec, smlText);
    expect(XMLValidator.validate(xml)).toBe(true);
    const all = ids(xml);
    expect(new Set(all).size).toBe(all.length);

    const declLines = parseSml(smlText).decls.map((d) => d.line);
    const resolve = (p: string) => p.split('/').slice(1).reduce<any>((o, k) => o?.[k], spec); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Object.keys(idMap).length).toBeGreaterThan(0);
    for (const [id, src] of Object.entries(idMap)) {
      expect(xml).toContain(`id='${id}'`);
      if (src.file === 'sml') expect(declLines).toContain(src.line);
      else expect(resolve(src.path), src.path).toBeDefined();
    }
  });
});

describe('compile output', () => {
  const parse = (xml: string) =>
    new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', isArray: (n) => ['page', 'place', 'trans', 'arc', 'instance', 'fusion', 'fusion_elm'].includes(n) }).parse(xml);

  it('adds the standard declarations', () => {
    const { xml } = compile(base(), SML);
    expect(xml).toContain('<id>INT</id>');
    expect(xml).toContain('val P_HIGH = 100;');
  });

  it('builds the hierarchy: portsock order, nested instances, fusion set', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(examples, '04-hierarchy.petri.json'), 'utf8')) as PetriSpec;
    const { xml } = compile(spec, fs.readFileSync(path.join(examples, '04-hierarchy.sml'), 'utf8'));
    const net = parse(xml).workspaceElements.cpnet;
    const [top, worker] = net.page;
    const sock = top.place.find((p: any) => p.text === 'Jobs')['@id']; // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = top.place.find((p: any) => p.text === 'Results')['@id']; // eslint-disable-line @typescript-eslint/no-explicit-any
    const portIn = worker.place.find((p: any) => p.text === 'In')['@id']; // eslint-disable-line @typescript-eslint/no-explicit-any
    const portOut = worker.place.find((p: any) => p.text === 'Out')['@id']; // eslint-disable-line @typescript-eslint/no-explicit-any
    const subst = top.trans[0].subst;
    expect(subst['@subpage']).toBe(worker['@id']);
    expect(subst['@portsock']).toBe(`(${portIn},${sock})(${portOut},${res})`);
    expect(worker.place.find((p: any) => p.text === 'In').port['@type']).toBe('In'); // eslint-disable-line @typescript-eslint/no-explicit-any

    const [inst, ...rest] = net.instances.instance;
    expect(rest).toEqual([]);
    expect(inst['@page']).toBe(top['@id']);
    expect(inst.instance[0]['@trans']).toBe(top.trans[0]['@id']);

    const [fusion] = net.fusion;
    expect(fusion['@name']).toBe('Counter');
    expect(fusion.fusion_elm.map((f: any) => f['@idref']).sort()).toEqual( // eslint-disable-line @typescript-eslint/no-explicit-any
      [top.place, worker.place].flatMap((ps: any[]) => ps.filter((p) => p.text === 'Count').map((p) => p['@id'])).sort(), // eslint-disable-line @typescript-eslint/no-explicit-any
    );
  });

  it('writes BOTHDIR for bidirectional arcs and PtoT/TtoP otherwise', () => {
    const spec = base();
    spec.pages[0].arcs!.push({ from: 'B', to: 'T', bidirectional: true });
    const { xml } = compile(spec, SML);
    expect(xml.match(/orientation='(\w+)'/g)).toEqual(["orientation='PtoT'", "orientation='TtoP'", "orientation='BOTHDIR'"]);
  });

  it('writes bendpoints in serial order', () => {
    const spec = base();
    spec.pages[0].arcs![0].bends = [[10, 20], [30, 40]];
    const { xml } = compile(spec, SML);
    const bends = [...xml.matchAll(/<bendpoint id='ID\d+' serial='(\d+)'>\s*<posattr x='([\d.-]+)' y='([\d.-]+)'/g)].map((m) => m.slice(1));
    expect(bends).toEqual([['1', '10.000000', '20.000000'], ['2', '30.000000', '40.000000']]);
  });

  it.each([['n <= 5'], ['[n <= 5]'], ['  [n <= 5] ']])('adds guard brackets exactly once (%j)', (guard) => {
    const spec = base();
    spec.pages[0].transitions![0].guard = guard;
    const { xml } = compile(spec, SML);
    expect(xml).toContain('<text tool=\'CPN Tools\' version=\'4.0.1\'>[n &lt;= 5]</text>');
  });

  it('uses positions from the spec and lays out the rest', () => {
    const spec = base();
    spec.pages[0].places![0].pos = [11, 22];
    const { xml } = compile(spec, SML);
    expect(xml).toContain("<posattr x='11.000000' y='22.000000'/>");
    expect(xml).not.toContain('NaN');
  });
});

describe('ModelError', () => {
  it('reports unknown arc nodes with their source', () => {
    const spec = base();
    spec.pages[0].arcs!.push({ from: 'Nope', to: 'T' }, { from: 'T', to: 'Gone' });
    const is = issues(spec);
    expect(is).toEqual([
      { message: 'unknown node "Nope" on page "Main"', source: { file: 'spec', path: '/pages/0/arcs/2/from' } },
      { message: 'unknown node "Gone" on page "Main"', source: { file: 'spec', path: '/pages/0/arcs/3/to' } },
    ]);
  });

  it('rejects place-place and transition-transition arcs', () => {
    const spec = base();
    spec.pages[0].transitions!.push({ name: 'U' });
    spec.pages[0].arcs!.push({ from: 'A', to: 'B' }, { from: 'T', to: 'U' });
    expect(issues(spec).map((i) => [i.message, (i.source as { path: string }).path])).toEqual([
      ['an arc must connect a place and a transition', '/pages/0/arcs/2'],
      ['an arc must connect a place and a transition', '/pages/0/arcs/3'],
    ]);
  });

  it('rejects duplicate keys but allows distinct keys for equal names', () => {
    const spec = base();
    spec.pages[0].places!.push({ name: 'A', type: 'INT' });
    expect(issues(spec)[0]).toMatchObject({ message: expect.stringContaining('duplicate node "A"'), source: { path: '/pages/0/places/2' } });
    spec.pages[0].places![2].key = 'A2';
    expect(() => compile(spec, SML)).not.toThrow();
  });

  it('rejects unknown subpages and sockets/ports', () => {
    const spec = base();
    spec.pages[0].transitions![0].subpage = { page: 'Missing' };
    expect(issues(spec)[0]).toMatchObject({ message: 'unknown subpage "Missing"', source: { path: '/pages/0/transitions/0/subpage/page' } });
  });

  it('rejects a port that is not marked as a port', () => {
    const spec = base();
    spec.pages.push({ name: 'Sub', places: [{ name: 'P', type: 'INT' }] });
    spec.pages[0].transitions![0].subpage = { page: 'Sub', ports: { A: 'P', Nowhere: 'P', B: 'Q' } };
    const is = issues(spec);
    expect(is.map((i) => i.message)).toEqual([
      'place "P" on page "Sub" is not a port (set "port")',
      'socket "Nowhere" is not a place on page "Main"',
      'place "P" on page "Sub" is not a port (set "port")',
      'port "Q" is not a place on page "Sub"',
    ]);
    expect(is.every((i) => i.source && 'path' in i.source && i.source.path === '/pages/0/transitions/0/subpage/ports')).toBe(true);
  });

  it('rejects recursive subpages', () => {
    const spec: PetriSpec = {
      version: 1,
      pages: [
        { name: 'Top', transitions: [{ name: 'T', subpage: { page: 'A' } }] },
        { name: 'A', transitions: [{ name: 'U', subpage: { page: 'B' } }] },
        { name: 'B', transitions: [{ name: 'V', subpage: { page: 'A' } }] },
      ],
    };
    expect(issues(spec).map((i) => i.message)).toEqual(['page "A" contains itself through substitution transitions']);
    spec.pages[0].transitions![0].subpage = { page: 'Top' };
    expect(issues(spec).map((i) => i.message)).toContain('a page cannot be its own subpage');
  });

  it('rejects bad positions on nodes and bends', () => {
    const spec = base();
    spec.pages[0].places![0].pos = [1] as never;
    spec.pages[0].transitions![0].pos = ['x', 2] as never;
    spec.pages[0].arcs![0].bends = [[1, NaN]];
    expect(issues(spec).map((i) => (i.source as { path: string }).path)).toEqual([
      '/pages/0/places/0/pos',
      '/pages/0/transitions/0/pos',
      '/pages/0/arcs/0/bends/0',
    ]);
  });

  it('rejects unsupported colsets with the sml line', () => {
    const is = issues(base(), 'var x: INT;\ncolset Bad = int declare foo;\n');
    expect(is).toHaveLength(1);
    expect(is[0]).toMatchObject({ source: { file: 'sml', line: 2 } });
    expect(formatIssue(is[0])).toMatch(/^sml:2: Unsupported color set/);
  });

  it('lists all issues from spec and sml together, joined in the message', () => {
    const spec = base();
    spec.version = 2 as never;
    spec.pages[0].arcs!.push({ from: 'Nope', to: 'T' });
    let err: ModelError | undefined;
    try {
      compile(spec, 'colset Bad = int declare foo;');
    } catch (e) {
      err = e as ModelError;
    }
    expect(err!.issues).toHaveLength(3);
    expect(err!.message.split('\n')).toHaveLength(3);
    expect(err!.message).toContain('/version: unsupported version 2');
  });

  it('rejects a spec without pages', () => {
    expect(issues({ version: 1 })).toEqual([{ message: 'the model must have a "pages" array' }]);
  });
});

describe('gen-examples', () => {
  it('committed examples/*.cpn are up to date', () => {
    expect(() => execFileSync(process.execPath, [path.join(root, 'scripts/gen-examples.mjs'), '--check'], { cwd: root, stdio: 'pipe' })).not.toThrow();
  }, 60000);
});
