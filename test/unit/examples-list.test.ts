import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples';

describe('EXAMPLES', () => {
  it('lists every example in examples/, each with its text model and .cpn', () => {
    const dir = path.resolve(__dirname, '../../examples');
    const ids = fs.readdirSync(dir).filter((f) => f.endsWith('.petri.json')).map((f) => f.replace('.petri.json', ''));
    expect(EXAMPLES.map((e) => e.id).sort()).toEqual(ids.sort());
    for (const e of EXAMPLES) for (const ext of ['.petri.json', '.sml', '.cpn']) expect(fs.existsSync(path.join(dir, e.id + ext))).toBe(true);
  });
});
