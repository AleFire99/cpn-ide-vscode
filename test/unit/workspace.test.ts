import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ModelError } from '../../src/model/types';
import {
  compileSpecText,
  contentHash,
  declarationsChanged,
  mergeSpec,
  parseSpecText,
  resolveSibling,
  serializeSpec,
  smlRelativePath,
  specBaseName,
} from '../../src/model/workspace';
import { errorPageHtml } from '../../src/webview/host-core';

const examples = path.resolve(__dirname, '../../examples');

describe('paths', () => {
  it('derives the base name and default .sml', () => {
    expect(specBaseName('/a/b/net.petri.json')).toBe('net');
    expect(specBaseName('file:///a/My%20Net.PETRI.JSON')).toBe('My%20Net');
    expect(smlRelativePath('/a/net.petri.json')).toBe('net.sml');
    expect(smlRelativePath('/a/net.petri.json', { declarations: 'decl/x.sml' })).toBe('decl/x.sml');
    expect(smlRelativePath('/a/net.petri.json', { declarations: '  ' })).toBe('net.sml');
  });

  it('resolves relative to the spec directory', () => {
    expect(resolveSibling('/a/b/net.petri.json', 'net.sml')).toBe('/a/b/net.sml');
    expect(resolveSibling('/a/b/net.petri.json', '../shared/d.sml')).toBe('/a/shared/d.sml');
    expect(resolveSibling('/a/b/net.petri.json', './x/./d.sml')).toBe('/a/b/x/d.sml');
    expect(resolveSibling('/a/b/net.petri.json', '/abs/d.sml')).toBe('/abs/d.sml');
    expect(resolveSibling('C:\\a\\net.petri.json', 'd.sml')).toBe('C:/a/d.sml');
  });
});

describe('mergeSpec / serializeSpec', () => {
  const pages = [{ name: 'P', places: [{ name: 'A', type: 'UNIT' }] }];
  it('keeps $schema and declarations, replaces pages', () => {
    const merged = mergeSpec({ $schema: 's.json', version: 1, declarations: 'd.sml', pages: [{ name: 'old' }] }, { version: 1, pages });
    expect(merged).toEqual({ $schema: 's.json', version: 1, declarations: 'd.sml', pages });
    expect(Object.keys(merged)).toEqual(['$schema', 'version', 'declarations', 'pages']);
  });
  it('works without an existing spec', () => {
    expect(mergeSpec(undefined, { version: 1, pages })).toEqual({ version: 1, pages });
  });
  it('serializes with 2 spaces and a trailing newline', () => {
    const t = serializeSpec({ version: 1, pages: [] });
    expect(t).toBe('{\n  "version": 1,\n  "pages": []\n}\n');
    expect(parseSpecText(t)).toEqual({ version: 1, pages: [] });
    expect(parseSpecText('{')).toBeUndefined();
  });
});

describe('declarationsChanged', () => {
  const a = '(* c *)\ncolset NUM = int;\nvar n : NUM;\n';
  it('ignores comments and formatting', () => {
    expect(declarationsChanged(a, 'colset NUM=int;   var n:NUM;')).toBe(false);
    expect(declarationsChanged(a, '(* other *)\ncolset  NUM = int ;\n\nvar n : NUM ;\n')).toBe(false);
  });
  it('detects substantive changes', () => {
    expect(declarationsChanged(a, 'colset NUM = int;\nvar m : NUM;\n')).toBe(true);
    expect(declarationsChanged(a, 'colset NUM = int;\n')).toBe(true);
    expect(declarationsChanged('', a)).toBe(true);
    expect(declarationsChanged('', '')).toBe(false);
  });
});

describe('contentHash', () => {
  it('is stable, content-sensitive and line-ending agnostic', () => {
    expect(contentHash('a\nb')).toBe(contentHash('a\r\nb'));
    expect(contentHash('a\nb')).not.toBe(contentHash('a\nc'));
  });
});

describe('compileSpecText', () => {
  it('compiles an example', () => {
    const spec = fs.readFileSync(path.join(examples, '01-simple-flow.petri.json'), 'utf8');
    const sml = fs.readFileSync(path.join(examples, '01-simple-flow.sml'), 'utf8');
    expect(compileSpecText(spec, sml).xml).toContain('<workspaceElements>');
  });
  it('reports invalid JSON as a ModelError', () => {
    expect(() => compileSpecText('{ nope', '')).toThrow(ModelError);
  });
});

describe('errorPageHtml', () => {
  it('escapes the issues', () => {
    const h = errorPageHtml('Cannot open <x>', ['a < b & "c"']);
    expect(h).toContain('Cannot open &lt;x&gt;');
    expect(h).toContain('a &lt; b &amp; &quot;c&quot;');
  });
});
