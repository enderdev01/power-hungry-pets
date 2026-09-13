import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

/** Only rules this plugin owns; its shared configs assume other plugins. */
const nextRules = Object.fromEntries(
  Object.entries({
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs['core-web-vitals'].rules,
  })
    .filter(([rule]) => rule.startsWith('@next/next/'))
    // App Router only: this rule expects a pages directory we do not have.
    .filter(([rule]) => rule !== '@next/next/no-html-link-for-pages'),
);

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'docs/**',
      'node_modules/**',
      '**/.next/**',
      '**/next-env.d.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    // Browser-facing web app code and its jsdom tests.
    files: ['apps/web/src/**/*.ts?(x)', 'apps/web/tests/**/*.ts?(x)'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
      },
    },
    plugins: { '@next/next': nextPlugin },
    rules: nextRules,
  },
  {
    // The node-environment integration test boots the real Nest server.
    files: ['apps/web/tests/*.integration.test.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
  },
);
