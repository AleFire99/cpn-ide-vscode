import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

// The `rest` shard excludes *.integration.test.ts, so a real-backend file without its own matrix entry would never run.
describe('ci.yml backend-it shards', () => {
  it('has a matrix entry for every real-backend test file', () => {
    const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    const files = fs.readdirSync(path.join(root, 'test/unit')).filter((f) => f.endsWith('.integration.test.ts'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !ci.includes(`test/unit/${f}`))).toEqual([]);
  });
});
