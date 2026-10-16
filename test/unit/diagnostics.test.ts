import { describe, expect, it, vi } from 'vitest';
import { locatePointer, modelIssuesToFindings, remoteIssuesToFindings, validateRemote, type FetchLike } from '../../src/model/diagnostics';

const TEXT = `{
  "version": 1,
  "pages": [
    { "name": "A", "places": [{ "name": "p\\"q", "type": "X" }], "arcs": [] },
    { "name": "B" }
  ]
}`;
const slice = (p: string) => {
  const r = locatePointer(TEXT, p);
  return r && TEXT.slice(r.start, r.end);
};

describe('locatePointer', () => {
  it('finds nested values', () => {
    expect(slice('/version')).toBe('1');
    expect(slice('/pages/1')).toBe('{ "name": "B" }');
    expect(slice('/pages/0/places/0/type')).toBe('"X"');
    expect(slice('/pages/0/arcs')).toBe('[]');
  });
  it('returns the root for the empty pointer', () => {
    expect(slice('')).toBe(TEXT);
  });
  it('falls back to the nearest enclosing value', () => {
    expect(slice('/pages/1/places/0')).toBe('{ "name": "B" }');
    expect(slice('/pages/7')).toBe(TEXT.slice(TEXT.indexOf('['), TEXT.lastIndexOf(']') + 1));
  });
  it('handles escaped pointer segments and bad text', () => {
    expect(locatePointer('{"a/b":{"c~d":2}}', '/a~1b/c~0d')).toEqual({ start: 14, end: 15 });
    expect(locatePointer('{ nope', '/a')).toBeUndefined();
    expect(locatePointer('', '/a')).toBeUndefined();
  });
});

describe('findings', () => {
  it('maps model issues', () => {
    const f = modelIssuesToFindings([{ message: 'm', source: { file: 'sml', line: 3 } }, { message: 'n' }]);
    expect(f).toEqual([
      { message: 'm', severity: 'error', source: { file: 'sml', line: 3 } },
      { message: 'n', severity: 'error', source: undefined },
    ]);
  });

  it('maps backend issues through the id map, dropping noise', () => {
    const idMap = { ID13: { file: 'spec' as const, path: '/pages/0' }, ID14: { file: 'sml' as const, line: 4 } };
    const f = remoteIssuesToFindings(
      {
        success: false,
        issues: {
          ID13: [
            { id: 'ID13', type: 'page', description: 'ID13: ID13: ' },
            { id: 'ID13', type: 'page', description: ':1.52-1.54 Error: unbound variable or constructor: zz' },
          ],
          ID14: [{ id: 'ID14', type: 'page', description: 'ID14: Caught Error' }],
          ID99: [{ id: 'ID99', type: 'page', description: ' Error in color-set!' }],
        },
      },
      idMap,
    );
    expect(f.map((x) => [x.message, x.source])).toEqual([
      [':1.52-1.54 Error: unbound variable or constructor: zz', idMap.ID13],
      ['Caught Error', idMap.ID14],
      ['Error in color-set!', undefined],
    ]);
  });

  it('reports a bare failure and nothing for success', () => {
    expect(remoteIssuesToFindings({ success: true, issues: {} }, {})).toEqual([]);
    expect(remoteIssuesToFindings({ success: false, issues: {} }, {})).toHaveLength(1);
  });
});

describe('validateRemote', () => {
  it('posts the model with the session header', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => ({ ok: true, status: 200, json: async () => ({ success: true, issues: {} }) }));
    const r = await validateRemote(fetchFn, 'http://h:1/', '<xml/>', 'cpnide-validate-7');
    expect(r.success).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://h:1/api/v2/cpn/init');
    expect(init.method).toBe('POST');
    expect(init.headers['X-SessionId']).toBe('cpnide-validate-7');
    expect(JSON.parse(init.body)).toEqual({ xml: '<xml/>', complex_verify: true, need_sim_restart: true });
  });

  it('throws on HTTP errors', async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(validateRemote(fetchFn, 'http://h:1', 'x', 's')).rejects.toThrow('HTTP 500');
  });
});
