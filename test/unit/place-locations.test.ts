import { describe, expect, it } from 'vitest';
import { placeLocations } from '../../src/model/placeLocations';
import { finalMarkings, markingText, type SimResult } from '../../src/runtime/headless-sim';

const spec = `{
  "version": 1,
  "pages": [
    { "name": "A", "places": [ { "name": "P", "type": "INT" }, { "name": "Q", "type": "INT" } ] },
    {
      "name": "B",
      "places": [
        { "type": "INT", "name": "P \\"x\\"" },
        { "name": "P", "type": "INT" },
        { "name": "P", "type": "INT" }
      ]
    }
  ]
}`;

describe('placeLocations', () => {
  it('maps Page/Place to the offset of the name value', () => {
    const m = placeLocations(spec);
    expect([...m.keys()]).toEqual(['A/P', 'A/Q', 'B/P "x"', 'B/P']);
    expect(spec.slice(m.get('A/Q'))).toMatch(/^"Q"/);
    expect(spec.slice(m.get('A/P'))).toMatch(/^"P"/);
  });
  it('keeps same-named places on different pages apart, first of a page wins', () => {
    const m = placeLocations(spec);
    expect(spec.slice(0, m.get('B/P')).split('\n').length).toBe(9);
    expect(m.get('A/P')).not.toBe(m.get('B/P'));
  });
  it('is empty for invalid or place-less text', () => {
    expect(placeLocations('{ "pages": [').size).toBe(0);
    expect(placeLocations('{"version":1}').size).toBe(0);
    expect(placeLocations('[]').size).toBe(0);
  });
});

describe('decoration text', () => {
  it('formats markings', () => {
    expect(markingText('1`1++ 1`2')).toBe(' → 1`1++1`2');
    expect(markingText('')).toBe(' → empty');
    expect(markingText(' \n ')).toBe(' → empty');
    expect(markingText('1`()')).toBe(' → 1`()');
  });
  it('maps final markings by name and skips unknown ids', () => {
    const r: SimResult = {
      ok: true,
      steps: 1,
      elapsedMs: 1,
      final: { enableTrans: [], tokensAndMark: [{ id: 'p1', marking: '' }, { id: 'p2', marking: '1`3' }, { id: 'zz', marking: '1`1' }] },
    };
    const m = finalMarkings(r, new Map([['p1', 'A/P'], ['p2', 'A/Q']]));
    expect([...m]).toEqual([['A/P', ' → empty'], ['A/Q', ' → 1`3']]);
    expect(finalMarkings({ ok: false, issues: {} }, new Map()).size).toBe(0);
  });
});
