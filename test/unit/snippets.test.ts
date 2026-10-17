import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

interface Snippet {
  prefix: string;
  description?: string;
  body: string | string[];
}

function load(file: string): Record<string, Snippet> {
  return JSON.parse(fs.readFileSync(path.join(root, 'snippets', file), 'utf8')) as Record<string, Snippet>;
}

/** Body as text, with `${n:default}` replaced by its default and bare `$n` / `$0` removed. */
function expand(snippet: Snippet): string {
  const text = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
  return text.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '');
}

describe('snippets/petri.code-snippets', () => {
  const snippets = load('petri.code-snippets');

  it('parses with a prefix and body for every snippet', () => {
    for (const [name, s] of Object.entries(snippets)) {
      expect(s.prefix, name).toMatch(/^[a-z]+$/);
      expect(s.body.length, name).toBeGreaterThan(0);
    }
  });

  it('has the petri skeleton, and it expands to a model with a pages array', () => {
    const model = JSON.parse(expand(snippets['Text model skeleton'])) as { version: number; pages: unknown[] };
    expect(model.version).toBe(1);
    expect(Array.isArray(model.pages)).toBe(true);
    expect(model.pages.length).toBeGreaterThan(0);
  });

  it('expands every fragment snippet to valid JSON', () => {
    for (const name of ['Page', 'Place', 'Transition', 'Arc', 'Subpage transition']) {
      expect(() => JSON.parse(expand(snippets[name])), name).not.toThrow();
    }
  });
});

describe('snippets/cpnml.json', () => {
  const snippets = load('cpnml.json');

  it('parses and offers colset, var, fun and block', () => {
    const prefixes = Object.values(snippets).map((s) => s.prefix).sort();
    expect(prefixes).toEqual(['block', 'colset', 'fun', 'var']);
  });

  it('expands to CPN ML text, and block expands to a (*! Name *) marker', () => {
    expect(expand(snippets['Declaration block'])).toMatch(/^\(\*! Name \*\)/);
    expect(expand(snippets['Colour set'])).toMatch(/^colset NAME = INT;/);
    expect(expand(snippets['Variable'])).toMatch(/^var x: INT;/);
    expect(expand(snippets['Function'])).toMatch(/^fun name \(arg: INT\) = /);
  });
});

describe('snippet registration in package.json', () => {
  it('registers both files, and the cpnml language for .sml', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      contributes: {
        snippets: { language: string; path: string }[];
        languages: { id: string; extensions: string[]; aliases: string[] }[];
      };
    };
    expect(pkg.contributes.snippets).toEqual(
      expect.arrayContaining([
        { language: 'json', path: './snippets/petri.code-snippets' },
        { language: 'cpnml', path: './snippets/cpnml.json' },
      ]),
    );
    expect(pkg.contributes.languages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'cpnml', extensions: ['.sml'] })]),
    );
  });
});
