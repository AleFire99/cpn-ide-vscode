import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/model/compile';
import { decompile } from '../../src/model/decompile';
import { normalizeDecl, parseSml } from '../../src/model/sml';
import type { PetriSpec } from '../../src/model/types';

const root = path.resolve(__dirname, '../..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const examples = fs.readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.petri.json'));
const decls = (sml: string) => parseSml(sml).decls.map((d) => `${d.block.join('/')}|${normalizeDecl(d.text)}`);

/** Nodes the spec left unplaced get a layout position when compiled; drop those again. */
function withoutAutoPos(got: PetriSpec, want: PetriSpec): PetriSpec {
  const out: PetriSpec = JSON.parse(JSON.stringify(got));
  out.pages.forEach((p, i) => {
    for (const kind of ['places', 'transitions'] as const) {
      p[kind]?.forEach((n, j) => {
        if (!want.pages[i][kind]?.[j]?.pos) delete n.pos;
      });
    }
  });
  return out;
}

describe('decompile', () => {
  it.each(examples)('round-trips %s', (file) => {
    const spec = JSON.parse(read('examples', file)) as PetriSpec;
    const sml = read('examples', file.replace('.petri.json', '.sml'));
    const back = decompile(compile(spec, sml).xml);
    expect(back.warnings).toEqual([]);
    const want = { ...spec };
    delete want.declarations;
    expect(withoutAutoPos(back.spec, spec)).toEqual(want);
    expect(decls(back.sml)).toEqual(decls(sml));
  });

  it('keeps positions', () => {
    const spec: PetriSpec = {
      version: 1,
      pages: [{ name: 'P', places: [{ name: 'a', type: 'INT', pos: [-10, 20] }], transitions: [{ name: 't', pos: [30, 40] }], arcs: [{ from: 'a', to: 't', bends: [[1, 2]] }] }],
    };
    expect(decompile(compile(spec, '').xml).spec).toEqual(spec);
  });

  it('gives duplicate and empty names unique keys, renames duplicate pages', () => {
    const spec: PetriSpec = {
      version: 1,
      pages: [
        {
          name: 'A',
          places: [{ name: 'p', type: 'INT' }, { name: 'p', key: 'p2', type: 'INT' }, { name: '', key: 'e', type: 'INT' }],
          transitions: [{ name: 'p', key: 't' }, { name: '', key: 'u' }],
          arcs: [{ from: 'p2', to: 't' }],
        },
        { name: 'B' },
      ],
    };
    const r = decompile(compile(spec, '').xml.replace("name='B'", "name='A'"));
    expect(r.spec.pages.map((p) => p.name)).toEqual(['A', 'A#2']);
    expect(r.warnings.join('\n')).toMatch(/duplicate page name/);
    const keys = [...r.spec.pages[0].places!, ...r.spec.pages[0].transitions!].map((n) => n.key ?? n.name);
    expect(new Set(keys).size).toBe(5);
    expect(r.spec.pages[0].arcs).toEqual([{ from: keys[1], to: keys[3] }]);
    expect(() => compile(r.spec, r.sml)).not.toThrow();
  });

  it('handles CRLF, double-quoted attributes and character references', () => {
    const { xml } = compile({ version: 1, pages: [{ name: 'P', places: [{ name: 'λ<', type: 'INT' }] }] }, '');
    const r = decompile(xml.replace(/'/g, '"').replace(/&apos;/g, "'").replace(/\n/g, '\r\n'));
    expect(r.spec.pages[0].places![0].name).toBe('λ<');
  });

  it('keeps the real-time option', () => {
    const spec: PetriSpec = { version: 1, realtime: true, pages: [{ name: 'P' }] };
    expect(decompile(compile(spec, '').xml).spec).toEqual(spec);
  });

  it('warns about monitors', () => {
    const { xml } = compile({ version: 1, pages: [{ name: 'P' }] }, '');
    const r = decompile(xml.replace("<monitorblock name='Monitors'/>", "<monitorblock name='Monitors'><monitor id='ID9'/></monitorblock>"));
    expect(r.warnings.join('\n')).toMatch(/monitors/);
  });
});

const models: [string, string][] = [
  ['sample.cpn', path.join(root, 'test/fixtures/sample.cpn')],
  ['fuelstation-no-mon.cpn', path.join(root, 'test/fixtures/fuelstation-no-mon.cpn')],
];
const assets = path.join(root, 'resources/ui/assets/cpn');
if (fs.existsSync(assets)) for (const f of fs.readdirSync(assets).filter((f) => f.endsWith('.cpn'))) models.push([`assets/${f}`, path.join(assets, f)]);

const count = (xml: string, tag: string) => (xml.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length;

describe('decompile real models', () => {
  it.each(models)('%s', (_n, file) => {
    const xml = fs.readFileSync(file, 'latin1');
    const { spec, sml } = decompile(xml);
    expect(spec.pages).toHaveLength(count(xml, 'page'));
    const nodes = (k: 'places' | 'transitions') => spec.pages.reduce((s, p) => s + (p[k]?.length ?? 0), 0);
    expect(nodes('places')).toBe(count(xml, 'place'));
    expect(nodes('transitions')).toBe(count(xml, 'trans'));
    expect(spec.pages.reduce((s, p) => s + (p.arcs?.length ?? 0), 0)).toBe(count(xml, 'arc'));
    const pageNames = [...xml.matchAll(/<pageattr name=(['"])(.*?)\1/g)].map((m) => m[2].replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
    expect(spec.pages.map((p) => p.name)).toEqual(pageNames);
    expect(() => compile(spec, sml)).not.toThrow();
  });
});
