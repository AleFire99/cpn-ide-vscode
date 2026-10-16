import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'resources/**', 'media/**', '.vscode-test/**', 'node_modules/**', '*.mjs'] },
  ...tseslint.configs.recommended,
);
