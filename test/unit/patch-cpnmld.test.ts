import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LOOPBACK, NEEDLE, patchChecked, patchLoopback } from '../../scripts/patch-cpnmld.mjs';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function synthetic(sites = 1): Buffer {
  const parts: Buffer[] = [Buffer.from('7f454c46aabbcc', 'hex')];
  for (let i = 0; i < sites; i++) parts.push(NEEDLE, Buffer.from('8d45d8', 'hex'));
  return Buffer.concat(parts);
}

describe('patchLoopback', () => {
  it('rewrites only the sin_addr immediate to 127.0.0.1', () => {
    const buf = synthetic();
    const out = patchLoopback(buf);
    expect(out.length).toBe(buf.length);
    const diff = [...buf.keys()].filter((i) => buf[i] !== out[i]);
    expect(diff.length).toBe(2); // 00 00 00 00 -> 7f 00 00 01
    expect(out.subarray(7 + 3, 7 + 7).equals(LOOPBACK)).toBe(true);
    expect(buf.subarray(7 + 3, 7 + 7).equals(Buffer.alloc(4))).toBe(true); // input untouched
  });

  it('refuses ambiguous or missing patch sites', () => {
    expect(() => patchLoopback(synthetic(0))).toThrow(/found 0/);
    expect(() => patchLoopback(synthetic(2))).toThrow(/found 2/);
  });
});

describe('patchChecked', () => {
  const buf = synthetic();
  const t = { original: sha(buf), patched: sha(patchLoopback(buf)) };

  it('patches the expected original and is idempotent', () => {
    const out = patchChecked('x', buf, t);
    expect(out).not.toBeNull();
    expect(patchChecked('x', out as Buffer, t)).toBeNull();
  });

  it('fails loudly when upstream changed', () => {
    expect(() => patchChecked('x', Buffer.concat([buf, Buffer.from('00', 'hex')]), t)).toThrow(/unexpected SHA-256/);
  });
});
