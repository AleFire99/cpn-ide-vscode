import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK,
  STANDARD_SML,
  colsetToSml,
  isStandardDecl,
  normalizeDecl,
  parseColset,
  parseSml,
  stripComments,
  withStandard,
  type Colset,
} from '../../src/model/sml';

const texts = (src: string) => parseSml(src).decls.map((d) => d.text);

describe('stripComments', () => {
  it('removes nested comments but keeps strings', () => {
    expect(stripComments('a (* x (* y *) z *) b "(* k *)"').replace(/\s+/g, ' ')).toBe('a b "(* k *)"');
  });
});

describe('parseSml splitting', () => {
  it('splits on top-level semicolons', () => {
    expect(texts('val a = 1;\nval b = 2;')).toEqual(['val a = 1;', 'val b = 2;']);
  });

  it('handles nested comments containing semicolons', () => {
    expect(texts('val a = 1; (* x; (* y; *) z; *)\nval b = 2;')).toEqual(['val a = 1; (* x; (* y; *) z; *)', 'val b = 2;']);
  });

  it('ignores semicolons in strings', () => {
    expect(texts('val s = "a;b\\";c";\nval t = 1;')).toEqual(['val s = "a;b\\";c";', 'val t = 1;']);
  });

  it('keeps let ... end and local ... end together', () => {
    const src = 'val a = let val x = 1; val y = 2 in x + y end;\nlocal val h = 1; in val g = h; end;\nval z = 3;';
    expect(texts(src)).toEqual(['val a = let val x = 1; val y = 2 in x + y end;', 'local val h = 1; in val g = h; end;', 'val z = 3;']);
  });

  it('ignores semicolons inside brackets', () => {
    expect(texts('val a = (1; 2);\nval b = 3;')).toHaveLength(2);
  });

  it('attaches a trailing same-line comment to the previous declaration', () => {
    expect(texts('val a = 1; (* one *)\nval b = 2;')).toEqual(['val a = 1; (* one *)', 'val b = 2;']);
  });

  it('keeps a leading comment with its declaration', () => {
    expect(texts('(* about b *)\nval b = 2;')).toEqual(['(* about b *)\nval b = 2;']);
  });

  it('does not treat a trailing block marker as a comment of the previous declaration', () => {
    const { decls } = parseSml('val a = 1; (*! B *)\nval b = 2;');
    expect(decls.map((d) => d.block)).toEqual([[DEFAULT_BLOCK], ['B']]);
  });

  it('uses block markers, nested with "/", defaulting to Declarations', () => {
    const { decls } = parseSml('val a = 1;\n(*! A / B *)\nval b = 2;\n(*! C *)\nval c = 3;');
    expect(decls.map((d) => d.block)).toEqual([[DEFAULT_BLOCK], ['A', 'B'], ['C']]);
  });

  it('drops comments before a marker', () => {
    const { decls } = parseSml('val a = 1;\n(* orphan *)\n(*! B *)\nval b = 2;');
    expect(decls.map((d) => d.text)).toEqual(['val a = 1;', 'val b = 2;']);
    expect(decls[1].block).toEqual(['B']);
  });

  it('records 1-based line numbers of the first character', () => {
    const { decls } = parseSml('\n\nval a = 1;\n\n(* c *)\nval b =\n  2;\nval c = 3;');
    expect(decls.map((d) => d.line)).toEqual([3, 5, 8]);
  });

  it('keeps an unterminated last declaration', () => {
    expect(texts('val a = 1;\nval b = 2')).toEqual(['val a = 1;', 'val b = 2']);
  });

  it('ignores comment-only input', () => {
    expect(parseSml('(* nothing *)\n').decls).toEqual([]);
  });
});

describe('parseSml classification', () => {
  it('classifies colsets', () => {
    const [d] = parseSml('colset JOB = int with 1..10;').decls;
    expect(d).toMatchObject({ kind: 'color', name: 'JOB', colset: { k: 'int', range: ['1', '10'] } });
  });

  it('classifies var with several names', () => {
    const [d] = parseSml('var a, b ,c: INT;').decls;
    expect(d).toMatchObject({ kind: 'var', names: ['a', 'b', 'c'], type: 'INT' });
  });

  it('classifies globref and ml', () => {
    const { decls } = parseSml('globref limit = 5;\nfun f x = x + 1;\nval v = 2;');
    expect(decls[0]).toMatchObject({ kind: 'globref', name: 'limit', value: '5' });
    expect(decls[1].kind).toBe('ml');
    expect(decls[2].kind).toBe('ml');
  });

  it('reports unsupported and malformed declarations with their line', () => {
    const { decls, issues } = parseSml('val a = 1;\ncolset X = int declare foo;\nvar q;\ncolset ;');
    expect(decls).toHaveLength(1);
    expect(issues.map((i) => i.source)).toEqual([
      { file: 'sml', line: 2 },
      { file: 'sml', line: 3 },
      { file: 'sml', line: 4 },
    ]);
    expect(issues[0].message).toMatch(/Unsupported color set/);
    expect(issues[1].message).toMatch(/variable/);
    expect(issues[2].message).toMatch(/Cannot parse color set/);
  });
});

const KINDS: [string, Colset][] = [
  ['unit', { k: 'unit' }],
  ['unit with u', { k: 'unit', with: 'u' }],
  ['bool', { k: 'bool' }],
  ['bool with (no, yes)', { k: 'bool', with: ['no', 'yes'] }],
  ['int', { k: 'int' }],
  ['int with 1..5', { k: 'int', range: ['1', '5'] }],
  ['int with ~3..(n+1)', { k: 'int', range: ['~3', '(n+1)'] }],
  ['intinf', { k: 'intinf' }],
  ['intinf with 0..9', { k: 'intinf', range: ['0', '9'] }],
  ['real', { k: 'real' }],
  ['real with 0.0..1.0', { k: 'real', range: ['0.0', '1.0'] }],
  ['time', { k: 'time' }],
  ['string', { k: 'string' }],
  ['string with "a".."z"', { k: 'string', range: ['"a"', '"z"'] }],
  ['string with "a".."z" and 1..4', { k: 'string', range: ['"a"', '"z"'], len: ['1', '4'] }],
  ['with red | green | blue', { k: 'enum', ids: ['red', 'green', 'blue'] }],
  ['index ix with 1..3', { k: 'index', id: 'ix', range: ['1', '3'] }],
  ['product INT * BOOL * STRING', { k: 'product', ids: ['INT', 'BOOL', 'STRING'] }],
  ['record a: INT * b: BOOL', { k: 'record', fields: [['a', 'INT'], ['b', 'BOOL']] }],
  ['union num: INT + none', { k: 'union', fields: [['num', 'INT'], ['none', undefined]] }],
  ['list INT', { k: 'list', of: 'INT' }],
  ['list INT with 1..4', { k: 'list', of: 'INT', range: ['1', '4'] }],
  ['subset INT by even', { k: 'subset', of: 'INT', by: 'even' }],
  ['subset INT with [1, 2]', { k: 'subset', of: 'INT', with: '[1, 2]' }],
  ['INT', { k: 'alias', of: 'INT' }],
];

describe('parseColset', () => {
  it.each(KINDS)('parses %s', (body, expected) => {
    expect(parseColset(body)).toEqual(expected);
  });

  it('parses timed on every kind', () => {
    expect(parseColset('unit timed')).toEqual({ k: 'unit', timed: true });
    expect(parseColset('int with 1..3 timed')).toEqual({ k: 'int', range: ['1', '3'], timed: true });
    expect(parseColset('product INT * BOOL timed')).toEqual({ k: 'product', ids: ['INT', 'BOOL'], timed: true });
    expect(parseColset('INT timed')).toEqual({ k: 'alias', of: 'INT', timed: true });
  });

  it('tolerates whitespace and newlines', () => {
    expect(parseColset('  product\n  A *\n  B ')).toEqual({ k: 'product', ids: ['A', 'B'] });
  });

  it.each(['declare', 'int declare x', 'product INT', 'record a INT', 'int with 1', 'with a | 1', '1 + 2'])(
    'returns undefined for unsupported %j',
    (body) => {
      expect(parseColset(body)).toBeUndefined();
    },
  );

  it('round-trips colsetToSml for every kind, with and without timed', () => {
    for (const [, c] of KINDS) {
      for (const colset of [c, { ...c, timed: true } as Colset]) {
        const text = colsetToSml('X', colset);
        expect(text).toMatch(/^colset X = .*;$/);
        expect(parseColset(text.replace(/^colset X = /, '').replace(/;$/, ''))).toEqual(colset);
      }
    }
  });
});

describe('withStandard', () => {
  it('adds the standard declarations before the user ones', () => {
    const ds = withStandard(parseSml('val x = 1;').decls);
    expect(ds.at(-1)!.text).toBe('val x = 1;');
    expect(ds.slice(0, -1).every((d) => d.line === 0)).toBe(true);
    expect(ds.flatMap((d) => (d.kind === 'color' ? [d.name] : []))).toEqual(['UNIT', 'BOOL', 'INT', 'INTINF', 'TIME', 'REAL', 'STRING']);
  });

  it('lets a user colset override the standard one', () => {
    const ds = withStandard(parseSml('colset INT = int with 1..3;').decls);
    const ints = ds.filter((d) => d.kind === 'color' && d.name === 'INT');
    expect(ints).toHaveLength(1);
    expect(ints[0]).toMatchObject({ colset: { k: 'int', range: ['1', '3'] }, line: 1 });
  });

  it('lets a user val override a standard priority', () => {
    const texts = withStandard(parseSml('val P_HIGH = 5;').decls).map((d) => d.text);
    expect(texts.filter((t) => t.startsWith('val P_HIGH'))).toEqual(['val P_HIGH = 5;']);
    expect(texts).toContain('val P_LOW = 10000;');
  });
});

describe('normalizeDecl / isStandardDecl', () => {
  it('ignores comments, whitespace and the final semicolon', () => {
    expect(normalizeDecl('colset  INT = int ; (* c *)')).toBe(normalizeDecl('colset INT=int'));
    expect(normalizeDecl('(* a *) var x , y : INT;')).toBe('var x,y:INT');
  });

  it('recognises exactly the standard declarations', () => {
    for (const d of parseSml(STANDARD_SML).decls) expect(isStandardDecl(d)).toBe(true);
    const [custom, plain, other] = parseSml('colset INT = int with 1..3;\ncolset  BOOL = bool ; (* hi *)\nval P_HIGH = 7;').decls;
    expect(isStandardDecl(custom)).toBe(false);
    expect(isStandardDecl(plain)).toBe(true);
    expect(isStandardDecl(other)).toBe(false);
  });
});
