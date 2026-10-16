import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  SIMULATOR_PORT,
  isPortListening,
  killTree,
  preflight,
  probeHttp,
  reapStaleSimulators,
  startBackendProcess,
  type RunningBackend,
} from './backend-core';
import { resolveJava } from './jre';

export class BackendManager implements vscode.Disposable {
  private static instance: BackendManager | undefined;
  private running: RunningBackend | undefined;
  private starting: Promise<string> | undefined;
  readonly output = vscode.window.createOutputChannel('CPN IDE');

  private constructor(private readonly ctx: vscode.ExtensionContext) {}

  static init(ctx: vscode.ExtensionContext): BackendManager {
    BackendManager.instance ??= new BackendManager(ctx);
    return BackendManager.instance;
  }

  static get(): BackendManager {
    if (!BackendManager.instance) throw new Error('BackendManager not initialised');
    return BackendManager.instance;
  }

  /** Start (or reuse) the backend and return its base URL. Shows an error message on failure. */
  ensureStarted(): Promise<string> {
    this.starting ??= this.doEnsureStarted().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async doEnsureStarted(): Promise<string> {
    try {
      const external = vscode.workspace.getConfiguration('cpnIde').get<string>('backendUrl', '').trim();
      if (external) {
        const url = external.replace(/\/+$/, '');
        if (!(await probeHttp(url, 5000))) throw new Error(`No CPN IDE backend reachable at ${url} (cpnIde.backendUrl)`);
        return url;
      }
      if (this.running?.isAlive()) return this.running.baseUrl;

      const problem = preflight(process.platform);
      if (problem) throw new Error(problem);

      const javaPath = await resolveJava(this.ctx, this.output);
      const port = vscode.workspace.getConfiguration('cpnIde').get<number>('port', 0);
      const backendDir = path.join(this.ctx.extensionPath, 'resources', 'backend');

      // One java.io.tmpdir per extension host (named by PID) so windows never clean up each other's simulator.
      const tmpRoot = path.join(this.ctx.globalStorageUri.fsPath, 'tmp');
      const tmpDir = path.join(tmpRoot, String(process.pid));
      const reaped = reapStaleSimulators(tmpRoot);
      if (reaped.length) this.output.appendLine(`[backend] stopped ${reaped.length} leftover simulator process(es) from a previous session`);
      if (await isPortListening(SIMULATOR_PORT)) {
        this.output.appendLine(
          `[warning] 127.0.0.1:${SIMULATOR_PORT} is already in use. The CPN simulator port is fixed, so this backend will ` +
            'connect to that existing simulator daemon (e.g. another VS Code window or user). If you do not recognise it, stop it first.',
        );
      }

      return await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CPN IDE: starting backend...' },
        async () => {
          this.output.appendLine(`[backend] starting with ${javaPath}`);
          const r = await startBackendProcess({
            javaPath,
            backendDir,
            userHome: path.join(this.ctx.globalStorageUri.fsPath, 'data'),
            tmpDir,
            port,
            onOutput: (s) => this.output.append(s),
            onExit: (code, signal) => {
              this.output.appendLine(`[backend] exited (code=${code}, signal=${signal})`);
            },
          });
          this.running = r;
          this.output.appendLine(`[backend] ready at ${r.baseUrl}`);
          return r.baseUrl;
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.output.appendLine(`[error] ${msg}`);
      void vscode.window.showErrorMessage(`CPN IDE: ${msg}`, 'Show Log').then((c) => {
        if (c === 'Show Log') this.showLog();
      });
      throw e;
    }
  }

  stop(): void {
    if (this.running) {
      killTree(this.running.child);
      this.running = undefined;
      this.output.appendLine('[backend] stopped');
    }
  }

  showLog(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.stop();
    this.output.dispose();
    BackendManager.instance = undefined;
  }
}
