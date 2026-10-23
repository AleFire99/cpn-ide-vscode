import { describe, expect, it } from 'vitest';
import { groupModels, modelKind } from '../../src/views/sidebar-core';

describe('modelKind', () => {
  it('lists .cpn, .petri.json and .sml files only', () => {
    expect(modelKind('/a/net.cpn')).toBe('cpn');
    expect(modelKind('/a/net.CPN')).toBe('cpn');
    expect(modelKind('/a/net.petri.json')).toBe('petri');
    expect(modelKind('/a/net.sml')).toBe('sml');
    expect(modelKind('/a/package.json')).toBeUndefined();
  });
});

describe('groupModels', () => {
  it("groups a net's files into one row, text model first", () => {
    expect(groupModels(['a/n.sml', 'a/n.petri.json'])).toEqual([
      {
        name: 'n',
        dir: 'a',
        files: [
          { path: 'a/n.petri.json', kind: 'petri' },
          { path: 'a/n.sml', kind: 'sml' },
        ],
        open: 'a/n.petri.json',
      },
    ]);
  });

  it('hides the .cpn export of a net that has a .petri.json', () => {
    expect(groupModels(['a/n.sml', 'a/n.cpn', 'a/n.petri.json'])).toEqual([
      {
        name: 'n',
        dir: 'a',
        files: [
          { path: 'a/n.petri.json', kind: 'petri' },
          { path: 'a/n.sml', kind: 'sml' },
        ],
        open: 'a/n.petri.json',
      },
    ]);
    expect(groupModels(['n.petri.json', 'n.cpn'])[0].files.map((f) => f.kind)).toEqual(['petri']);
  });

  it('lists a lone .cpn (with its .sml) and opens the .cpn', () => {
    expect(groupModels(['n.sml', 'n.cpn'])).toEqual([
      {
        name: 'n',
        dir: '',
        files: [
          { path: 'n.cpn', kind: 'cpn' },
          { path: 'n.sml', kind: 'sml' },
        ],
        open: 'n.cpn',
      },
    ]);
    expect(groupModels(['a/n.cpn'])[0]).toMatchObject({ dir: 'a', open: 'a/n.cpn', files: [{ path: 'a/n.cpn', kind: 'cpn' }] });
  });

  it('keeps same-named files in different folders apart and skips lone .sml files', () => {
    expect(groupModels(['b/n.cpn', 'a/n.cpn', 'a/shared.sml', 'x.txt']).map((g) => g.dir)).toEqual(['a', 'b']);
  });

  it('sorts by folder, then name, ignoring case', () => {
    expect(groupModels(['b/z.cpn', 'top.cpn', 'a/B.petri.json', 'a/a.cpn', 'b/A.cpn']).map((g) => `${g.dir}/${g.name}`)).toEqual([
      '/top',
      'a/a',
      'a/B',
      'b/A',
      'b/z',
    ]);
  });
});
