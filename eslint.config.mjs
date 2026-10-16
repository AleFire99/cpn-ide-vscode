import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'out/**', 'resources/**', 'node_modules/**', '*.mjs'] },
  ...tseslint.configs.recommended,
);
