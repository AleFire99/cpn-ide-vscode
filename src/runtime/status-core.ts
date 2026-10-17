// vscode-free backend state and how the status bar item shows it.

export type BackendStatus =
  | { kind: 'stopped' }
  | { kind: 'starting' }
  | { kind: 'ready'; url: string; java?: string; external: boolean }
  | { kind: 'simulatorDown' }
  | { kind: 'error'; message: string };

export interface StatusPresentation {
  text: string;
  tooltip: string;
  /** Use the error/warning background colour. */
  severity?: 'error' | 'warning';
}

export function presentStatus(s: BackendStatus): StatusPresentation {
  switch (s.kind) {
    case 'stopped':
      return { text: '$(circle-outline) CPN IDE', tooltip: 'CPN IDE backend not running. It starts when a model is opened.' };
    case 'starting':
      return { text: '$(loading~spin) CPN IDE', tooltip: 'CPN IDE backend starting…' };
    case 'ready':
      return {
        text: '$(check) CPN IDE',
        tooltip: s.external
          ? `CPN IDE: external backend at ${s.url} (cpnIde.backendUrl)`
          : `CPN IDE backend running at ${s.url}` + (s.java ? `\nJava: ${s.java}` : ''),
      };
    case 'simulatorDown':
      return { text: '$(error) CPN IDE: simulator down', tooltip: 'The CPN simulator could not start. Click to restart or see the log.', severity: 'error' };
    case 'error':
      return { text: '$(error) CPN IDE', tooltip: `CPN IDE backend failed: ${s.message}`, severity: 'error' };
  }
}

/** True for files the status bar item is relevant to (it is also shown whenever the backend is not stopped). */
export const isCpnFile = (p: string): boolean => /\.(cpn|petri\.json|sml)$/i.test(p);
