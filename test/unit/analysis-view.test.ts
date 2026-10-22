import { describe, expect, it } from 'vitest';
import { findingsToRows, locationLabel, summaryText } from '../../src/views/analysis-core';

describe('summaryText', () => {
  it('reports a clean model', () => {
    expect(summaryText([])).toBe('No errors');
  });
  it('counts errors and warnings with plurals', () => {
    expect(summaryText([{ message: 'a', severity: 'error' }])).toBe('1 error');
    expect(
      summaryText([
        { message: 'a', severity: 'error' },
        { message: 'b', severity: 'error' },
        { message: 'c', severity: 'warning' },
      ]),
    ).toBe('2 errors, 1 warning');
  });
});

describe('locationLabel', () => {
  it('describes sml lines and spec pointers', () => {
    expect(locationLabel({ file: 'sml', line: 12 })).toBe('line 12');
    expect(locationLabel({ file: 'spec', path: '/pages/0' })).toBe('/pages/0');
    expect(locationLabel({ file: 'sml', line: 0 })).toBeUndefined();
    expect(locationLabel(undefined)).toBeUndefined();
  });
});

describe('findingsToRows', () => {
  it('gives only a passing summary for no findings', () => {
    expect(findingsToRows([])).toEqual([{ kind: 'summary', label: 'No errors', icon: 'pass' }]);
  });
  it('lists a summary row then one row per finding', () => {
    const source = { file: 'spec' as const, path: '/x' };
    const rows = findingsToRows([
      { message: 'bad arc', severity: 'error', source },
      { message: 'odd', severity: 'warning' },
    ]);
    expect(rows.map((r) => [r.kind, r.label, r.icon, r.description])).toEqual([
      ['summary', '1 error, 1 warning', 'error', undefined],
      ['finding', 'bad arc', 'error', '/x'],
      ['finding', 'odd', 'warning', undefined],
    ]);
    expect(rows[1].source).toBe(source);
  });
  it('uses a warning summary when there are only warnings', () => {
    expect(findingsToRows([{ message: 'w', severity: 'warning' }])[0].icon).toBe('warning');
  });
});
