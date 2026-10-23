import { execFileSync } from 'node:child_process';
import Module from 'node:module';
import * as path from 'node:path';
import { expect, it } from 'vitest';

// The bundle must load without node_modules (the VSIX ships none): a dependency esbuild could not inline shows up as
// "Cannot find module" only when VS Code activates the extension.
it('builds a bundle that loads on its own', () => {
  const root = path.resolve(__dirname, '../..');
  const bundle = path.join(root, 'dist/extension.js');
  execFileSync(process.execPath, ['scripts/esbuild.mjs'], { cwd: root, stdio: 'pipe' });
  const stub: unknown = new Proxy(() => stub, { get: () => stub, apply: () => stub, construct: () => stub as object });
  const mod = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const load = mod._load;
  const required: string[] = [];
  mod._load = function (request: string, ...rest: unknown[]) {
    if (request === 'vscode') return stub;
    if (request !== bundle) required.push(request);
    return load.call(this, request, ...rest);
  };
  try {
    const ext = Module.createRequire(__filename)(bundle) as { activate?: unknown };
    expect(typeof ext.activate).toBe('function');
  } finally {
    mod._load = load;
  }
  // Only Node built-ins may stay external.
  expect(required.filter((r) => !r.startsWith('node:') && !Module.isBuiltin(r))).toEqual([]);
}, 60000);
