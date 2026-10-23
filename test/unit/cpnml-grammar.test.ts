import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const readJson = (p: string): Json => JSON.parse(readFileSync(join(root, p), 'utf8'));

const grammar = readJson('language/cpnml.tmLanguage.json');
const repo: Record<string, Json> = grammar.repository;

/** Every rule object in the grammar, however deeply nested. */
function rules(node: Json, out: Json[] = []): Json[] {
  if (Array.isArray(node)) node.forEach((n) => rules(n, out));
  else if (node && typeof node === 'object') {
    out.push(node);
    Object.values(node).forEach((v) => rules(v, out));
  }
  return out;
}

describe('CPN ML grammar', () => {
  it('is well formed', () => {
    expect(grammar.scopeName).toBe('source.cpnml');
    for (const rule of rules(grammar)) {
      if (typeof rule.include === 'string') {
        expect(repo[rule.include.slice(1)], rule.include).toBeTruthy();
      }
    }
  });

  it('has regexes that compile in JS', () => {
    let n = 0;
    for (const rule of rules(grammar)) {
      for (const key of ['match', 'begin', 'end']) {
        if (typeof rule[key] === 'string') {
          expect(() => new RegExp(rule[key]), rule[key]).not.toThrow();
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it('is registered in package.json and not excluded from the VSIX', () => {
    const pkg = readJson('package.json');
    expect(pkg.contributes.languages).toContainEqual(
      expect.objectContaining({ id: 'cpnml', aliases: ['CPN ML'], extensions: ['.sml'] }),
    );
    expect(pkg.contributes.grammars).toContainEqual(
      expect.objectContaining({ language: 'cpnml', scopeName: 'source.cpnml' }),
    );
    const ignore = readFileSync(join(root, '.vscodeignore'), 'utf8');
    expect(ignore).not.toMatch(/language/);
  });

  it('has a language configuration', () => {
    const cfg = readJson('language/cpnml.language-configuration.json');
    expect(cfg.comments.blockComment).toEqual(['(*', '*)']);
    expect(cfg.brackets.length).toBeGreaterThan(0);
    expect(cfg.autoClosingPairs.length).toBeGreaterThan(0);
    expect(cfg.surroundingPairs.length).toBeGreaterThan(0);
  });

  it('matches block markers, and comments nest', () => {
    const marker = new RegExp(repo['block-marker'].match);
    expect(marker.test('(*! Types *)')).toBe(true);
    expect(marker.test('(* plain *)')).toBe(false);
    const c = repo.comment;
    expect(new RegExp(c.begin).test('(* x')).toBe(true);
    expect(new RegExp(c.end).test('x *)')).toBe(true);
    expect(c.patterns).toContainEqual({ include: '#comment' });
  });

  it('matches colset declarations', () => {
    const m = new RegExp(repo['colset-decl'].match).exec('colset JOB = int with 1..10;');
    expect(m?.[1]).toBe('colset');
    expect(m?.[2]).toBe('JOB');
  });

  it('matches keywords, including CPN ML ones', () => {
    const [ctl, kw] = repo.keyword.patterns.map((p: Json) => new RegExp(p.match));
    for (const w of ['colset', 'var', 'globref', 'product', 'record', 'timed', 'union', 'subset', 'index', 'by', 'fun', 'val']) {
      expect(kw.test(w), w).toBe(true);
    }
    for (const w of ['let', 'in', 'end', 'if', 'then', 'else', 'case', 'fn', 'andalso', 'orelse']) {
      expect(ctl.test(w), w).toBe(true);
    }
    expect(kw.test('variable')).toBe(false);
  });

  it('matches numbers, including negative ints and reals', () => {
    const [hex, real, int] = repo.number.patterns.map((p: Json) => new RegExp(p.match));
    expect(int.exec('x = ~1;')?.[0]).toBe('~1');
    expect(int.exec('with 1..10')?.[0]).toBe('1');
    expect(real.exec('3.14')?.[0]).toBe('3.14');
    expect(real.exec('~1.5e~3')?.[0]).toBe('~1.5e~3');
    expect(hex.test('0xFF')).toBe(true);
    expect(int.test('abc1')).toBe(false);
  });

  it('matches strings, chars and multiset operators', () => {
    expect(new RegExp(repo.string.begin).test('"hi"')).toBe(true);
    expect(new RegExp(repo.char.match).test('#"a"')).toBe(true);
    const op = new RegExp(repo.operator.patterns[0].match);
    for (const s of ['1`x', 'a ++ b', 'a -- b', 'a @ b']) expect(op.test(s), s).toBe(true);
  });

  it('matches standard colour sets', () => {
    const re = new RegExp(repo['standard-colset'].match);
    for (const s of ['UNIT', 'BOOL', 'INT', 'STRING', 'TIME']) expect(re.test(s), s).toBe(true);
    expect(re.test('INTEGER')).toBe(false);
  });
});
