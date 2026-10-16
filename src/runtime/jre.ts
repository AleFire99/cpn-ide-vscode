import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureDownloadedJre, findSystemJava } from './jre-core';

/**
 * Resolve a Java 17+ executable: cpnIde.javaPath, $JAVA_HOME, `java` on PATH,
 * otherwise a downloaded Eclipse Temurin 17 JRE in the extension's global storage.
 */
export async function resolveJava(ctx: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<string> {
  const log = (m: string) => output.appendLine(`[jre] ${m}`);
  const configured = vscode.workspace.getConfiguration('cpnIde').get<string>('javaPath', '');
  const system = await findSystemJava(configured, process.env, process.platform, log);
  if (system) return system;

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CPN IDE: setting up Java 17 runtime',
      cancellable: false,
    },
    (progress) =>
      ensureDownloadedJre({
        jreRoot: path.join(ctx.globalStorageUri.fsPath, 'jre'),
        platform: process.platform,
        arch: process.arch,
        log,
        onProgress: (message, increment) => progress.report({ message, increment }),
      }),
  );
}
