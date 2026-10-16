#!/usr/bin/env node
// Generate the small example models in examples/ (CPN Tools XML, format 6).
// Standard declarations and simulator options are copied from the CPN IDE
// template net (resources/ui/assets/cpn/mynet.cpn, run scripts/fetch-cpn.sh first).
// Usage: node scripts/gen-examples.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(join(root, 'resources/ui/assets/cpn/mynet.cpn'), 'latin1');

const slice = (from, to) => {
  const a = template.indexOf(from);
  const b = template.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`template section ${from} not found`);
  return template.slice(a, b + to.length);
};
// The "Standard priorities" block and the start of "Standard declarations" up to (excluding) the template's own var.
const priorities = slice("<block id='ID1412310166'>", '</block>');
const stdDecls = (() => {
  const a = template.indexOf("<block id='ID1'>");
  const b = template.lastIndexOf('</color>', template.indexOf('<var', a));
  if (a < 0 || b < a) throw new Error('template standard declarations not found');
  return template.slice(a, b + '</color>'.length);
})();
const footer = slice('<options>', '</monitorblock>');

let nextId = 1000;
const id = () => `ID${nextId++}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrs = `<fillattr colour='White' pattern='' filled='false'/>
<lineattr colour='Black' thick='1' type='Solid'/>
<textattr colour='Black' bold='false'/>`;
const label = (tag, x, y, text) => `<${tag} id='${id()}'>
<posattr x='${x}' y='${y}'/>
<fillattr colour='White' pattern='Solid' filled='false'/>
<lineattr colour='Black' thick='0' type='Solid'/>
<textattr colour='Black' bold='false'/>
<text tool='CPN Tools' version='4.0.1'>${esc(text)}</text>
</${tag}>`;

function net({ name, vars, places, transitions, arcs }) {
  const ids = {};
  const varDecls = vars
    .map(
      ([v, type]) => `<var id='${id()}'>
<type><id>${type}</id></type>
<id>${v}</id>
<layout>var ${v}: ${type};</layout>
</var>`,
    )
    .join('\n');
  const placeXml = places
    .map((p) => {
      ids[p.name] = id();
      return `<place id='${ids[p.name]}'>
<posattr x='${p.x}' y='${p.y}'/>
${attrs}
<text>${p.name}</text>
<ellipse w='70.000000' h='40.000000'/>
<token x='-10.000000' y='0.000000'/>
<marking x='0.000000' y='0.000000' hidden='false'><snap snap_id='0' anchor.horizontal='0' anchor.vertical='0'/></marking>
${label('type', p.x + 45, p.y - 30, p.type)}
${label('initmark', p.x + 45, p.y + 30, p.init ?? '')}
</place>`;
    })
    .join('\n');
  const transXml = transitions
    .map((t) => {
      ids[t.name] = id();
      return `<trans id='${ids[t.name]}' explicit='false'>
<posattr x='${t.x}' y='${t.y}'/>
${attrs}
<text>${t.name}</text>
<box w='80.000000' h='40.000000'/>
<binding x='7.200000' y='-3.000000'/>
${label('cond', t.x - 40, t.y + 35, t.guard ? `[${t.guard}]` : '')}
${label('time', t.x + 50, t.y + 35, '')}
${label('code', t.x + 50, t.y - 35, '')}
${label('priority', t.x - 50, t.y - 35, '')}
</trans>`;
    })
    .join('\n');
  const arcXml = arcs
    .map(([from, to, inscription]) => {
      const pToT = from in ids && places.some((p) => p.name === from);
      const [place, trans] = pToT ? [from, to] : [to, from];
      const p = places.find((x) => x.name === place);
      const t = transitions.find((x) => x.name === trans);
      return `<arc id='${id()}' orientation='${pToT ? 'PtoT' : 'TtoP'}' order='1'>
<posattr x='0.000000' y='0.000000'/>
${attrs}
<arrowattr headsize='1.200000' currentcyckle='2'/>
<transend idref='${ids[trans]}'/>
<placeend idref='${ids[place]}'/>
${label('annot', (p.x + t.x) / 2, (p.y + t.y) / 2 + 12, inscription)}
<text></text>
</arc>`;
    })
    .join('\n');
  const pageId = id();
  return `<?xml version="1.0" encoding="iso-8859-1"?>
<!DOCTYPE workspaceElements PUBLIC "-//CPN//DTD CPNXML 1.0//EN" "http://cpntools.org/DTD/6/cpn.dtd">
<workspaceElements>
<generator tool='CPN Tools' version='4.0.1' format='6'/>
<cpnet>
<globbox>
${priorities}
${stdDecls}
${varDecls}
</block>
</globbox>
<page id='${pageId}'>
<pageattr name='${name}'/>
${placeXml}
${transXml}
${arcXml}
<constraints></constraints>
</page>
<instances><instance id='${pageId}itop' page='${pageId}'/></instances>
${footer}
</cpnet>
</workspaceElements>
`;
}

export const examples = {
  // Three UNIT tokens move from Start to Done, one per firing.
  '01-simple-flow.cpn': {
    name: 'SimpleFlow',
    vars: [],
    places: [
      { name: 'Start', type: 'UNIT', init: '3`()', x: -200, y: 0 },
      { name: 'Done', type: 'UNIT', x: 200, y: 0 },
    ],
    transitions: [{ name: 'Move', x: 0, y: 0 }],
    arcs: [
      ['Start', 'Move', '()'],
      ['Move', 'Done', '()'],
    ],
  },
  // A producer numbers items 1..5 into a buffer; a consumer takes them out.
  '02-producer-consumer.cpn': {
    name: 'ProducerConsumer',
    vars: [
      ['n', 'INT'],
      ['x', 'INT'],
    ],
    places: [
      { name: 'Next', type: 'INT', init: '1`1', x: -300, y: -100 },
      { name: 'Buffer', type: 'INT', x: 0, y: 0 },
      { name: 'Consumed', type: 'INT', x: 300, y: 0 },
    ],
    transitions: [
      { name: 'Produce', x: -300, y: 0, guard: 'n <= 5' },
      { name: 'Consume', x: 150, y: 0 },
    ],
    arcs: [
      ['Next', 'Produce', 'n'],
      ['Produce', 'Next', 'n+1'],
      ['Produce', 'Buffer', 'n'],
      ['Buffer', 'Consume', 'x'],
      ['Consume', 'Consumed', 'x'],
    ],
  },
  // Two processes (1 and 2) share one lock: at most one is ever in Critical.
  '03-mutual-exclusion.cpn': {
    name: 'MutualExclusion',
    vars: [['p', 'INT']],
    places: [
      { name: 'Idle', type: 'INT', init: '1`1++1`2', x: -250, y: 0 },
      { name: 'Lock', type: 'UNIT', init: '1`()', x: 0, y: -150 },
      { name: 'Critical', type: 'INT', x: 250, y: 0 },
    ],
    transitions: [
      { name: 'Enter', x: 0, y: -50 },
      { name: 'Leave', x: 0, y: 80 },
    ],
    arcs: [
      ['Idle', 'Enter', 'p'],
      ['Lock', 'Enter', '()'],
      ['Enter', 'Critical', 'p'],
      ['Critical', 'Leave', 'p'],
      ['Leave', 'Idle', 'p'],
      ['Leave', 'Lock', '()'],
    ],
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, 'examples');
  mkdirSync(out, { recursive: true });
  for (const [file, spec] of Object.entries(examples)) {
    writeFileSync(join(out, file), net(spec), 'latin1');
    console.log(`wrote examples/${file}`);
  }
}
