import { execFile, execFileSync } from 'node:child_process';
import * as vscode from 'vscode';
import { pickFreePort, waitForHttp } from './backend-core';
import { BackendManager } from './backend';
import { CONTAINER_NAME, ensureContainer, stopArgs, type DockerExec } from './docker-core';

const STOP_ON_EXIT_KEY = 'cpnIde.docker.stopOnExit';
const OFFERED_KEY = 'cpnIde.docker.offered';

let globalState: vscode.Memento | undefined;
let startedThisSession = false;

const exec: DockerExec = (args) =>
  new Promise((resolve) => {
    execFile('docker', args, { timeout: 120000 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      if (e?.code === 'ENOENT') return resolve({ code: null, stdout, stderr, notFound: true });
      resolve({ code: !e ? 0 : typeof e.code === 'number' ? e.code : null, stdout, stderr });
    });
  });

export function initDocker(ctx: vscode.ExtensionContext): void {
  globalState = ctx.globalState;
}

/** Ask where to store the URL when a workspace is open; undefined if dismissed. */
async function pickTarget(): Promise<vscode.ConfigurationTarget | undefined> {
  if (!vscode.workspace.workspaceFolders?.length) return vscode.ConfigurationTarget.Global;
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Workspace', description: 'only this workspace', target: vscode.ConfigurationTarget.Workspace },
      { label: 'User', description: 'all workspaces', target: vscode.ConfigurationTarget.Global },
    ],
    { placeHolder: 'Where should cpnIde.backendUrl be saved?' },
  );
  return pick?.target;
}

/** Start (or reuse) the Docker container, point cpnIde.backendUrl at it and reconnect open editors. */
export async function startDockerBackend(opts: { reconnect?: boolean } = {}): Promise<boolean> {
  const backend = BackendManager.get();
  let url: string;
  try {
    url = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'CPN IDE: starting Docker backend...' },
      async () => {
        const u = await ensureContainer(exec, pickFreePort);
        backend.output.appendLine(`[docker] container ${CONTAINER_NAME} at ${u}, waiting for the backend`);
        await waitForHttp(u, 120000);
        return u;
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    backend.output.appendLine(`[docker] ${msg}`);
    void vscode.window.showErrorMessage(`CPN IDE: ${msg}`, 'Show Log').then((c) => {
      if (c === 'Show Log') backend.showLog();
    });
    return false;
  }
  startedThisSession = true;
  const target = await pickTarget();
  if (target === undefined) return false;
  await vscode.workspace.getConfiguration('cpnIde').update('backendUrl', url, target);
  void vscode.window.showInformationMessage(`CPN IDE: Docker backend running at ${url}.`);
  // Nothing reacts to backendUrl changes by itself: retry() reconnects the proxy and reloads open tabs.
  if (opts.reconnect !== false) await backend.retry();
  await askStopOnExit();
  return true;
}

/** Ask once whether to stop the container when VS Code exits. */
async function askStopOnExit(): Promise<void> {
  if (!globalState || globalState.get<boolean>(STOP_ON_EXIT_KEY) !== undefined) return;
  const c = await vscode.window.showInformationMessage(
    'Stop the CPN IDE Docker container when VS Code exits?',
    'Yes, stop it',
    'No, keep it running',
  );
  if (c) await globalState.update(STOP_ON_EXIT_KEY, c === 'Yes, stop it');
}

export async function stopDockerBackend(): Promise<void> {
  const r = await exec(stopArgs());
  if (r.notFound) void vscode.window.showErrorMessage('CPN IDE: Docker is not installed.');
  else if (r.code !== 0) void vscode.window.showWarningMessage(`CPN IDE: the Docker backend is not running (${r.stderr.trim() || `exit ${r.code}`}).`);
  else void vscode.window.showInformationMessage('CPN IDE: Docker backend stopped.');
}

/** macOS only: the first time a model is opened without a backend URL, offer the Docker backend (once). */
export async function offerDockerBackend(): Promise<void> {
  if (process.platform !== 'darwin' || !globalState || globalState.get<boolean>(OFFERED_KEY)) return;
  if (vscode.workspace.getConfiguration('cpnIde').get<string>('backendUrl', '').trim()) return;
  await globalState.update(OFFERED_KEY, true);
  const c = await vscode.window.showInformationMessage(
    'The CPN simulator cannot run on macOS. Start the backend in Docker?',
    'Start Docker Backend',
    'Not now',
  );
  if (c === 'Start Docker Backend') await startDockerBackend({ reconnect: false });
}

/** Called from deactivate: stop the container if the user asked for that. Short and synchronous. */
export function stopDockerOnExit(): void {
  if (!startedThisSession || globalState?.get<boolean>(STOP_ON_EXIT_KEY) !== true) return;
  try {
    execFileSync('docker', stopArgs(), { timeout: 10000, stdio: 'ignore' });
  } catch {
    /* best effort */
  }
}
