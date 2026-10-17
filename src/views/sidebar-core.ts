// vscode-free contents of the CPN IDE sidebar (Activity Bar): which rows the Models and Backend views show.
import type { BackendStatus } from '../runtime/status-core';
import { presentStatus } from '../runtime/status-core';

/** Glob of the model files listed in the Models view. */
export const MODEL_GLOB = '**/*.{cpn,petri.json}';

export type ModelKind = 'cpn' | 'petri';

/** Kind of a model file (decides its inline actions), or undefined if the view does not list it. */
export function modelKind(p: string): ModelKind | undefined {
  if (/\.petri\.json$/i.test(p)) return 'petri';
  if (/\.cpn$/i.test(p)) return 'cpn';
  return undefined;
}

/** Sort models by folder, then by name, case-insensitively. Takes workspace-relative paths. */
export function sortModelPaths(paths: readonly string[]): string[] {
  const key = (p: string) => {
    const i = p.lastIndexOf('/');
    return [p.slice(0, i + 1).toLowerCase(), p.slice(i + 1).toLowerCase()] as const;
  };
  return [...paths].sort((a, b) => {
    const [da, na] = key(a);
    const [db, nb] = key(b);
    return da === db ? na.localeCompare(nb) : da.localeCompare(db);
  });
}

export interface BackendRow {
  label: string;
  /** Codicon id. */
  icon: string;
  tooltip?: string;
  command?: string;
  args?: unknown[];
  description?: string;
}

/** Rows of the Backend view: the state (as in the status bar item), then the actions that apply to it. */
export function backendRows(s: BackendStatus): BackendRow[] {
  const p = presentStatus(s);
  const state: BackendRow = {
    label: STATE_LABEL[s.kind],
    icon: s.kind === 'starting' ? 'loading~spin' : s.kind === 'ready' ? 'check' : s.kind === 'stopped' ? 'circle-outline' : 'error',
    tooltip: p.tooltip,
    description: s.kind === 'ready' ? s.url : undefined,
  };
  const running = s.kind !== 'stopped';
  return [
    state,
    running
      ? { label: 'Restart Backend', icon: 'debug-restart', command: 'cpnIde.restartBackend' }
      : { label: 'Start Backend', icon: 'play', command: 'cpnIde.startBackend' },
    ...(running ? [{ label: 'Stop Backend', icon: 'debug-stop', command: 'cpnIde.stopBackend' }] : []),
    { label: 'Show Backend Log', icon: 'output', command: 'cpnIde.showLog' },
    { label: 'Start Docker Backend', icon: 'vm', command: 'cpnIde.startDockerBackend' },
    { label: 'Stop Docker Backend', icon: 'vm-outline', command: 'cpnIde.stopDockerBackend' },
    { label: 'Settings', icon: 'gear', command: 'workbench.action.openSettings', args: ['cpnIde'] },
  ];
}

const STATE_LABEL: Record<BackendStatus['kind'], string> = {
  stopped: 'Not running',
  starting: 'Starting…',
  ready: 'Running',
  simulatorDown: 'Simulator down',
  error: 'Failed',
};
