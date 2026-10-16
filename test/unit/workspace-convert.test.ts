import { describe, expect, it } from 'vitest';
import { serializeSpec, textModelPaths } from '../../src/model/workspace';

describe('textModelPaths', () => {
  it('puts the text model next to the .cpn', () => {
    expect(textModelPaths('/a/b/My Net.CPN')).toEqual({ json: '/a/b/My Net.petri.json', sml: '/a/b/My Net.sml', smlName: 'My Net.sml' });
    expect(textModelPaths('C:\\x\\net.cpn').json).toBe('C:\\x\\net.petri.json');
  });
});

describe('serializeSpec', () => {
  it('adds the declarations file', () => {
    const t = serializeSpec({ version: 1, pages: [{ name: 'P' }] }, 'n.sml');
    expect(JSON.parse(t)).toEqual({ version: 1, declarations: 'n.sml', pages: [{ name: 'P' }] });
    expect(t.endsWith('\n')).toBe(true);
  });
});
