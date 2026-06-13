const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const pluginN = require('eslint-plugin-n');

module.exports = tseslint.config(
  { ignores: ['out/'] },
  eslint.configs.recommended,
  {
    plugins: { n: pluginN },
    rules: {
      'block-scoped-var': 'error',
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'eol-last': 'error',
      'prefer-arrow-callback': 'error',
      'no-trailing-spaces': 'error',
      quotes: ['warn', 'single', { avoidEscape: true }],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'n/no-missing-import': 'off',
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-missing-require': 'off',
      'no-dupe-class-members': 'off',
      'require-atomic-updates': 'off',
    },
  },
);
