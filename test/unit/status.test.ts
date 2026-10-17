import { describe, expect, it } from 'vitest';
import { isCpnFile, presentStatus } from '../../src/runtime/status-core';

describe('presentStatus', () => {
  it('shows each backend state', () => {
    expect(presentStatus({ kind: 'stopped' }).text).toBe('$(circle-outline) CPN IDE');
    expect(presentStatus({ kind: 'starting' }).text).toBe('$(loading~spin) CPN IDE');
    expect(presentStatus({ kind: 'simulatorDown' })).toMatchObject({ text: '$(error) CPN IDE: simulator down', severity: 'error' });
    expect(presentStatus({ kind: 'error', message: 'no java' })).toMatchObject({ tooltip: 'CPN IDE backend failed: no java', severity: 'error' });
  });

  it('names the backend and Java when ready', () => {
    const local = presentStatus({ kind: 'ready', url: 'http://127.0.0.1:1', java: '/usr/bin/java', external: false });
    expect(local.text).toBe('$(check) CPN IDE');
    expect(local.tooltip).toBe('CPN IDE backend running at http://127.0.0.1:1\nJava: /usr/bin/java');
    expect(local.severity).toBeUndefined();
    expect(presentStatus({ kind: 'ready', url: 'http://h:8080', external: true }).tooltip).toContain('external backend at http://h:8080');
  });
});

describe('isCpnFile', () => {
  it('matches models and declarations only', () => {
    expect(isCpnFile('/a/net.cpn')).toBe(true);
    expect(isCpnFile('/a/net.CPN')).toBe(true);
    expect(isCpnFile('/a/net.petri.json')).toBe(true);
    expect(isCpnFile('/a/net.sml')).toBe(true);
    expect(isCpnFile('/a/package.json')).toBe(false);
    expect(isCpnFile('/a/notes.md')).toBe(false);
  });
});
