import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATCHES, TARGET, patchChecked, patchUi, patchUiDir } from '../../scripts/patch-ui.mjs';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const synthetic = () =>
  'a={multi_step:{steps:50,delay:500},x:1},this.isAnimation=!0,this.b=1;' +
  'f=function(){switch(this.mode){case 1:return+this.c.delay;default:return 500}};';

describe('patchUi', () => {
  it('patches all needles and reads window.__CPN__', () => {
    const out = patchUi(synthetic());
    expect(out).not.toContain('delay:500');
    expect(out).not.toContain('isAnimation=!0');
    expect(out).not.toContain('default:return 500}');
    expect(out.match(/window\.__CPN__\.stepDelayMs/g)).toHaveLength(4); // 2x (check + value)
    expect(out).toContain('this.isAnimation=!window.__CPN__||!1!==window.__CPN__.animate,');
    // unrelated text is untouched
    expect(out).toContain('case 1:return+this.c.delay;');
  });

  it('is idempotent', () => {
    const once = patchUi(synthetic());
    expect(patchUi(once)).toBe(once);
  });

  it('evaluates to the configured delay, 0 included, with 500 as fallback', () => {
    const expr = /default:return (.*)\}\};$/.exec(patchUi(synthetic()))![1];
    const ev = (w: unknown) => new Function('window', `return ${expr}`)(w);
    expect(ev({})).toBe(500);
    expect(ev({ __CPN__: {} })).toBe(500);
    expect(ev({ __CPN__: { stepDelayMs: 0 } })).toBe(0);
    expect(ev({ __CPN__: { stepDelayMs: 100 } })).toBe(100);
  });

  it('refuses missing needles, naming the needle', () => {
    for (const { from } of PATCHES) {
      expect(() => patchUi(synthetic().replace(from, 'zzz'))).toThrow(new RegExp('found 0'));
      expect(() => patchUi(synthetic().replace(from, 'zzz'))).toThrow(JSON.stringify(from).slice(1, 10));
    }
  });

  it('refuses ambiguous needles', () => {
    for (const { from } of PATCHES) {
      expect(() => patchUi(synthetic() + from)).toThrow(/found 2/);
    }
  });
});

describe('patchChecked', () => {
  it('refuses unknown input', () => {
    expect(() => patchChecked(synthetic())).toThrow(/unexpected SHA-256/);
  });

  it('returns null for already patched input and detects hash mismatch', () => {
    const orig = synthetic();
    const t = { original: sha(orig), patched: sha(patchUi(orig)) };
    expect(patchChecked(orig, t)).toBe(patchUi(orig));
    expect(patchChecked(patchUi(orig), t)).toBeNull();
    expect(() => patchChecked(orig, { original: t.original, patched: 'x' })).toThrow(/mismatch/);
  });
});

const realUi = path.resolve(__dirname, '../../resources/ui');
const realMain = fs.existsSync(realUi) ? fs.readdirSync(realUi).find((f) => /^main\..*\.js$/.test(f)) : undefined;

describe.skipIf(!realMain)('real bundle (copy)', () => {
  it('finds every needle exactly once and yields the pinned hash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-ui-'));
    try {
      fs.copyFileSync(path.join(realUi, realMain!), path.join(dir, realMain!));
      const text = fs.readFileSync(path.join(dir, realMain!), 'utf8');
      const patched = text.includes(PATCHES[0].to);
      if (!patched) {
        for (const { from } of PATCHES) expect(text.split(from).length - 1, from).toBe(1);
        expect(sha(text)).toBe(TARGET.original);
        expect(patchUiDir(dir)).toBe(true);
      }
      expect(sha(fs.readFileSync(path.join(dir, realMain!), 'utf8'))).toBe(TARGET.patched);
      expect(patchUiDir(dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
