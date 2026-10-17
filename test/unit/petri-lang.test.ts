import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { colsetInfo, locate, suggest } from '../../src/model/petri-lang';
import { parseSpecText } from '../../src/model/workspace';

const ex = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../examples', f), 'utf8');
const hier = ex('04-hierarchy.petri.json');
const hierSml = ex('04-hierarchy.sml');
const spec = parseSpecText(hier);

/** Cursor placed inside the value after `marker`, `inside` chars in. */
const at = (text: string, marker: string, inside = 0) => text.indexOf(marker) + marker.length + inside;
const labels = (text: string, off: number, sml = hierSml) => {
  const loc = locate(text, off);
  return suggest(parseSpecText(text), sml, loc.path, loc.atKey).map((s) => s.label);
};

describe('locate', () => {
  it('finds the path and the string under the cursor', () => {
    const text = '{"pages":[{"name":"P","places":[{"name":"a","type":"INT"}]}]}';
    const loc = locate(text, at(text, '"type":"', 2));
    expect(loc.path).toEqual(['pages', 0, 'places', 0, 'type']);
    expect(loc.atKey).toBe(false);
    expect(loc.text).toBe('INT');
    expect(text.slice(...loc.range)).toBe('INT');
  });

  it('tells keys from values and copes with incomplete JSON', () => {
    const text = '{"pages":[{"arcs":[{"from":"';
    expect(locate(text, text.length).path).toEqual(['pages', 0, 'arcs', 0, 'from']);
    const keyText = '{"pages":[{"transitions":[{"subpage":{"ports":{"A';
    const k = locate(keyText, keyText.length);
    expect(k.atKey).toBe(true);
    expect(k.path.slice(-2)).toEqual(['ports', 'A']);
  });
});

describe('suggest', () => {
  it('arc endpoints are the places and transitions of the same page', () => {
    const off = at(hier, '{ "from": "', 0);
    expect(labels(hier, off)).toEqual(['Jobs', 'Results', 'Count', 'Process']);
  });

  it('place types are the declared colour sets plus the standard ones', () => {
    const l = labels(hier, at(hier, '"type": "', 1));
    expect(l).toContain('JOB');
    expect(l).toContain('RESULT');
    expect(l).toContain('INT');
    expect(l).toContain('UNIT');
    expect(new Set(l).size).toBe(l.length);
  });

  it('subpage page, ports and fusion', () => {
    expect(labels(hier, at(hier, '"subpage": { "page": "'))).toEqual(['Top', 'Worker']);
    expect(labels(hier, at(hier, '"ports": { "'))).toEqual(['Jobs', 'Results', 'Count']);
    expect(labels(hier, at(hier, '"Jobs": "'))).toEqual(['In', 'Out']);
    expect(labels(hier, at(hier, '"fusion": "'))).toEqual(['Counter']);
  });

  it('suggests nothing elsewhere', () => {
    expect(labels(hier, at(hier, '"init": "'))).toEqual([]);
    expect(labels(hier, at(hier, '"name": "'))).toEqual([]);
    expect(spec).toBeDefined();
  });
});

describe('colsetInfo', () => {
  const sml = '(* jobs *)\ncolset JOB = int with 1..3;\ncolset X = string;\n';

  it('returns the declaration text and the name offset', () => {
    const i = colsetInfo(sml, 'JOB');
    expect(i?.text).toBe('colset JOB = int with 1..3;');
    expect(sml.slice(i!.offset, i!.offset! + 3)).toBe('JOB');
  });

  it('falls back to the standard declarations, without an offset', () => {
    const i = colsetInfo(sml, 'BOOL');
    expect(i?.text).toBe('colset BOOL = bool;');
    expect(i?.offset).toBeUndefined();
  });

  it('is undefined for unknown names', () => {
    expect(colsetInfo(sml, 'NOPE')).toBeUndefined();
  });
});
