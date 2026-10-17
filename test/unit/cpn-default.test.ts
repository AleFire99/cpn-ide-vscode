import { describe, expect, it } from 'vitest';
import { canMountScheme, hasCpnAssociation, placeholderHtml, shouldAsk, withCpnAssociation, type PromptState, type TextTabInfo } from '../../src/editor/cpn-default-core';

const tab: TextTabInfo = { scheme: 'file', path: '/w/a.cpn', isDiff: false };
const state: PromptState = { never: false, deferred: false, associations: undefined, openedAsText: new Set() };

describe('shouldAsk', () => {
  it('asks for a plain .cpn text tab', () => {
    expect(shouldAsk(tab, state)).toBe(true);
    expect(shouldAsk({ ...tab, path: '/w/A.CPN' }, state)).toBe(true);
  });
  it('ignores diffs, other schemes and other files', () => {
    expect(shouldAsk({ ...tab, isDiff: true }, state)).toBe(false);
    expect(shouldAsk({ ...tab, scheme: 'git' }, state)).toBe(false);
    expect(shouldAsk({ ...tab, scheme: 'vscode-scm' }, state)).toBe(false);
    expect(shouldAsk({ ...tab, path: '/w/a.xml' }, state)).toBe(false);
  });
  it('respects Never, Not now, existing associations and explicit text opens', () => {
    expect(shouldAsk(tab, { ...state, never: true })).toBe(false);
    expect(shouldAsk(tab, { ...state, deferred: true })).toBe(false);
    expect(shouldAsk(tab, { ...state, associations: { '*.cpn': 'default' } })).toBe(false);
    expect(shouldAsk(tab, { ...state, associations: { '*.png': 'x' } })).toBe(true);
    expect(shouldAsk(tab, { ...state, openedAsText: new Set(['/w/a.cpn']) })).toBe(false);
  });
});

describe('associations', () => {
  it('detects and merges', () => {
    expect(hasCpnAssociation({ '*.cpn': 'x' })).toBe(true);
    expect(hasCpnAssociation(undefined)).toBe(false);
    expect(withCpnAssociation({ '*.png': 'p' }, 'cpnIde.editor')).toEqual({ '*.png': 'p', '*.cpn': 'cpnIde.editor' });
    expect(withCpnAssociation(undefined, 'v')).toEqual({ '*.cpn': 'v' });
  });
});

describe('scheme guard', () => {
  it('mounts only file documents', () => {
    expect(canMountScheme('file')).toBe(true);
    expect(canMountScheme('git')).toBe(false);
    expect(placeholderHtml('a<b>.cpn', 'git')).toContain('a&lt;b&gt;.cpn');
  });
});
