import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  // ESM entry first: jsonc-parser's UMD main loads its parts with a require() esbuild cannot follow.
  mainFields: ['module', 'main'],
  target: 'node20',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});
if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
