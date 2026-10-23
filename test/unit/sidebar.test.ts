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
    expect(groupModels(['a/n.sml', 'a/n.cpn', 'a/n.petri.json'])).toEqual([
      {
        name: 'n',
        dir: 'a',
        files: [
          { path: 'a/n.petri.json', kind: 'petri' },
          { path: 'a/n.cpn', kind: 'cpn' },
          { path: 'a/n.sml', kind: 'sml' },
        ],
        open: 'a/n.petri.json',
      },
    ]);
  });

  it('opens the .cpn when there is no text model', () => {
    expect(groupModels(['n.sml', 'n.cpn'])[0]).toMatchObject({ dir: '', open: 'n.cpn' });
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
