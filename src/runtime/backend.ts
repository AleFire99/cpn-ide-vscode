import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  SIMULATOR_PORT,
  findPortOwner,
  isForeignSimulator,
  isPortListening,
  onlyClosing,
  stopSimulatorProcess,
  waitForPortRelease,
  type PortOwner,
  preflight,
  probeHttp,
  reapStaleSimulators,
  startBackendProcess,
  type RunningBackend,
} from './backend-core';
import { InitProxy } from './init-proxy';
import { stripAnsi } from './headless-sim';
import { resolveJava } from './jre';
import type { BackendStatus } from './status-core';
import { reloadAllWebviews } from '../webview/panel';

export class BackendManager implements vscode.Disposable {
  private static instance: BackendManager | undefined;
  private running: RunningBackend | undefined;
  private starting: Promise<string> | undefined;
  private failureShown = false;
  private initWatchdog: NodeJS.Timeout | undefined;
  private retrying = false;
  // Stable URL in front of the backend (also across restarts) that serializes net creation; see InitProxy.
  private readonly proxy = new InitProxy();
  readonly output = vscode.window.createOutputChannel('CPN IDE');
  private statusValue: BackendStatus = { kind: 'stopped' };
  private readonly statusEmitter = new vscode.EventEmitter<BackendStatus>();
  /** Fires when the backend starts, stops or fails (drives the status bar item). */
  readonly onDidChangeStatus = this.statusEmitter.event;

  private constructor(private readonly ctx: vscode.ExtensionContext) {}

  static init(ctx: vscode.ExtensionContext): BackendManager {
    BackendManager.instance ??= new BackendManager(ctx);
    return BackendManager.instance;
  }

  static get(): BackendManager {
    if (!BackendManager.instance) throw new Error('BackendManager not initialised');
    return BackendManager.instance;
  }

  /** Base URL of the backend if one is already available; never starts anything. */
  currentUrl(): string | undefined {
    const external = vscode.workspace.getConfiguration('cpnIde').get<string>('backendUrl', '').trim();
    // Through the proxy when it runs, so these calls queue up with the UI's inits.
    if (external) return this.proxy.url ?? external.replace(/\/+$/, '');
    return this.running?.isAlive() ? this.proxy.url ?? this.running.baseUrl : undefined;
  }

  get status(): BackendStatus {
    return this.statusValue;
  }

  private setStatus(s: BackendStatus): void {
    this.statusValue = s;
    this.statusEmitter.fire(s);
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
        if (this.statusValue.kind !== 'ready') this.setStatus({ kind: 'starting' });
        if (!(await probeHttp(url, 5000))) throw new Error(`No CPN IDE backend reachable at ${url} (cpnIde.backendUrl)`);
        const proxied = await this.proxy.start(url);
        if (this.statusValue.kind !== 'simulatorDown') this.setStatus({ kind: 'ready', url, external: true });
        return proxied;
      }
      if (this.running?.isAlive()) return await this.proxy.start(this.running.baseUrl);
      this.setStatus({ kind: 'starting' });

      const problem = preflight(process.platform);
      if (problem) throw new Error(problem);

      const javaPath = await resolveJava(this.ctx, this.output);
      const port = vscode.workspace.getConfiguration('cpnIde').get<number>('port', 0);
      const backendDir = path.join(this.ctx.extensionPath, 'resources', 'backend');

      // One java.io.tmpdir per extension host (named by PID) so windows never clean up each other's simulator.
      const tmpDir = path.join(this.tmpRoot, String(process.pid));
      const reaped = reapStaleSimulators(this.tmpRoot);
      if (reaped.length) this.output.appendLine(`[backend] stopped ${reaped.length} leftover simulator process(es) from a previous session`);
      await this.prepareSimulatorPort();

      return await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CPN IDE: starting backend...' },
        async () => {
          this.failureShown = false;
          this.output.appendLine(`[backend] starting with ${javaPath}`);
          const r = await startBackendProcess({
            javaPath,
            backendDir,
            userHome: path.join(this.ctx.globalStorageUri.fsPath, 'data'),
            tmpDir,
            port,
            onOutput: (s) => {
              this.output.append(stripAnsi(s));
              if (s.includes('Error starting simulator')) void this.reportSimulatorFailure();
              this.watchInit(s);
            },
            onExit: (code, signal) => {
              this.output.appendLine(`[backend] exited (code=${code}, signal=${signal})`);
              // An exit we did not ask for (stop() clears `running` first).
              if (this.running && !this.running.isAlive()) {
                this.running = undefined;
                this.setStatus({ kind: 'error', message: `backend exited (code ${code ?? signal})` });
              }
            },
          });
          this.running = r;
          this.output.appendLine(`[backend] ready at ${r.baseUrl}`);
          const proxied = await this.proxy.start(r.baseUrl);
          // A simulator failure reported while starting stays visible.
          if (this.statusValue.kind === 'starting') this.setStatus({ kind: 'ready', url: r.baseUrl, java: javaPath, external: false });
          return proxied;
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.output.appendLine(`[error] ${msg}`);
      this.setStatus({ kind: 'error', message: msg });
      void vscode.window.showErrorMessage(`CPN IDE: ${msg}`, 'Show Log').then((c) => {
        if (c === 'Show Log') this.showLog();
      });
      throw e;
    }
  }

  /** Watchdog: a net creation that never leaves the lock (hung simulator handshake) is treated like a start failure. */
  private watchInit(chunk: string): void {
    if (chunk.includes('After Lock: CreateNewNet')) {
      clearTimeout(this.initWatchdog);
      this.initWatchdog = undefined;
    } else if (chunk.includes('Before Lock: CreateNewNet') && !this.initWatchdog) {
      this.initWatchdog = setTimeout(() => {
        this.initWatchdog = undefined;
        this.output.appendLine('[error] net creation has not finished after 60 s; the simulator is probably hung');
        void this.reportSimulatorFailure();
      }, 60000);
    }
  }

  private get tmpRoot(): string {
    return path.join(this.ctx.globalStorageUri.fsPath, 'tmp');
  }

  /** A same-user cpnmld outside our tmp root holding the simulator port (Linux only). */
  private findForeignOwner(): PortOwner | undefined {
    if (process.platform !== 'linux') return undefined;
    const owner = findPortOwner(SIMULATOR_PORT);
    return owner && isForeignSimulator(owner, this.tmpRoot) ? owner : undefined;
  }

  private async stopForeign(owner: PortOwner): Promise<void> {
    this.output.appendLine(`[backend] stopping simulator daemon pid ${owner.pid} (${owner.cmdline})`);
    await stopSimulatorProcess(owner.pid);
  }

  /** Wait for a port with only closing sockets (TIME-WAIT, FIN-WAIT, ...) to clear (Linux), with a progress notification. */
  private async waitForPort(): Promise<void> {
    if (process.platform !== 'linux' || !onlyClosing(SIMULATOR_PORT)) return;
    this.output.appendLine(`[backend] port ${SIMULATOR_PORT} still has closing connections; waiting for it to be released`);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Waiting for the simulator port to be released…' },
      () => waitForPortRelease(SIMULATOR_PORT, 70000),
    );
  }

  /** Before spawning: deal with a foreign simulator daemon on the fixed port and with closing-socket leftovers. */
  private async prepareSimulatorPort(): Promise<void> {
    const foreign = this.findForeignOwner();
    if (foreign) {
      for (;;) {
        const c = await vscode.window.showWarningMessage(
          `CPN IDE: another simulator daemon (pid ${foreign.pid}, started from ${foreign.cwd}) holds port ${SIMULATOR_PORT}. ` +
            'If it is stale, the simulator will fail to start.',
          'Stop it',
          'Keep using it',
          'Show Log',
        );
        if (c === 'Show Log') {
          this.output.appendLine(`[warning] port ${SIMULATOR_PORT} is held by pid ${foreign.pid}: ${foreign.cmdline} (cwd ${foreign.cwd})`);
          this.showLog();
          continue;
        }
        if (c === 'Stop it') await this.stopForeign(foreign);
        break;
      }
    } else if (await isPortListening(SIMULATOR_PORT)) {
      this.output.appendLine(
        `[warning] 127.0.0.1:${SIMULATOR_PORT} is already in use. The CPN simulator port is fixed, so this backend will ` +
          'connect to that existing simulator daemon (e.g. another VS Code window or user). If you do not recognise it, stop it first.',
      );
    }
    await this.waitForPort();
  }

  /** The backend reported (or the UI saw) that the simulator could not start. Shown once per backend session. */
  async reportSimulatorFailure(): Promise<void> {
    if (this.failureShown || this.retrying) return;
    this.failureShown = true;
    this.setStatus({ kind: 'simulatorDown' });
    const foreign = this.findForeignOwner();
    this.output.appendLine('[error] the simulator could not start');
    const buttons = [...(foreign ? ['Stop stale simulator'] : []), 'Retry', 'Show Log'];
    const c = await vscode.window.showErrorMessage(
      'CPN IDE: the simulator could not start.' +
        (foreign ? ` A stale simulator daemon (pid ${foreign.pid}) is holding port ${SIMULATOR_PORT}.` : ''),
      ...buttons,
    );
    if (c === 'Show Log') {
      this.showLog();
    } else if (c === 'Retry') {
      await this.retry();
    } else if (c === 'Stop stale simulator' && foreign) {
      const ok = await vscode.window.showWarningMessage(
        `Stop simulator daemon pid ${foreign.pid} and its simulator processes?`,
        { modal: true, detail: `${foreign.cmdline}\n${foreign.cwd}` },
        'Stop it',
      );
      if (ok === 'Stop it') {
        await this.stopForeign(foreign);
        await this.retry();
      }
    }
  }

  /** Restart the backend (after the port is free) and reload every open CPN IDE webview. */
  async retry(): Promise<void> {
    if (this.retrying) return;
    this.retrying = true;
    try {
      this.stop();
      await new Promise((r) => setTimeout(r, 500));
      await this.waitForPort();
      const url = await this.ensureStarted();
      reloadAllWebviews(url);
    } catch {
      /* ensureStarted already reported */
    } finally {
      this.retrying = false;
    }
  }

  stop(): void {
    clearTimeout(this.initWatchdog);
    this.initWatchdog = undefined;
    if (this.running) {
      const r = this.running;
      this.running = undefined;
      r.stop();
      this.output.appendLine('[backend] stopped');
    }
    this.setStatus({ kind: 'stopped' });
  }

  showLog(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.stop();
    this.proxy.stop();
    this.output.dispose();
    this.statusEmitter.dispose();
    BackendManager.instance = undefined;
  }
}
