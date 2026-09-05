import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The lint half of the gate. Four things here fail the build rather than warn, because each one is
 * a defect the previous build actually shipped:
 *
 *   - unused imports and locals (D-74) — `security/page.tsx` imported `Navbar`, `StatusBadge`,
 *     `formatDate`, `Clock` and `Calendar` and rendered none of them, and declared an `inputRef` it
 *     attached and never read, so the kiosk's one input was never focused.
 *   - floating promises — an unawaited mutation is why a "success" toast appeared before the write
 *     had happened.
 *   - `console` outside scripts/** — logging is structured and correlated, or it is noise.
 *   - the layering in docs/plan/WIRING.md. `packages/ui` has no data access, ever, and a route
 *     handler authenticates, parses with a contract, calls one service and maps the result. It does
 *     not reach for the database.
 *
 * Type-aware rules need a tsconfig, so files that belong to no project — the harness, the config
 * files, plain JavaScript — keep the syntactic rules and drop the type-aware ones rather than
 * failing to parse.
 */

const WORKSPACE_FILES = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

/** Outside any tsconfig `include`, so `projectService` has no program for them. */
const UNPROJECTED = [
  'test/**/*.ts',
  'packages/*/test/**/*.ts',
  '*.config.ts',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
];

/** Nothing outside packages/db talks to Prisma directly. One client, one schema (D-15). */
const PRISMA_DIRECT = {
  group: ['@prisma/client', '@prisma/client/*', '**/prisma/generated/*'],
  message:
    'Prisma is reached through @oneresi/db, which chooses the engine at boot. Importing the ' +
    'generated client directly is how a second, divergent data layer starts (D-15).',
};

const NOT_IN_UI = {
  group: [
    '@oneresi/db',
    '@oneresi/db/*',
    '@oneresi/domain',
    '@oneresi/domain/*',
    '@oneresi/mail',
    '@oneresi/mail/*',
  ],
  message:
    'packages/ui may import @oneresi/contracts and nothing else — no data access, ever ' +
    '(docs/plan/WIRING.md). Take the data as a prop.',
};

const NOT_IN_A_HANDLER = {
  group: ['@oneresi/db', '@oneresi/db/*'],
  message:
    'A route handler authenticates, parses with a contract, calls one @oneresi/domain service and ' +
    'maps the result. It contains no rule and no query (docs/plan/WIRING.md rule 4).',
};

/** Next.js App Router handlers, and the Pages Router shape in case an app uses it. */
const ROUTE_HANDLERS = [
  'apps/*/src/app/**/route.ts',
  'apps/*/src/app/**/route.tsx',
  'apps/*/app/**/route.ts',
  'apps/*/src/pages/api/**/*.ts',
  'apps/*/pages/api/**/*.ts',
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
      'test-results/**',
      '.data/**',
      'packages/db/prisma/generated/**',
      'infra/**',
      'docs/**',
    ],
  },

  // Without an explicit files list, `eslint .` walks only JavaScript.
  { files: WORKSPACE_FILES },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      // ---------------------------------------------------------------- D-74
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // ---------------------------------------------------------------- awaited work
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'require-atomic-updates': 'error',

      // ---------------------------------------------------------------- logging
      'no-console': 'error',

      // ---------------------------------------------------------------- imports
      'import/first': 'error',
      'import/no-duplicates': 'error',
      'import/no-mutable-exports': 'error',
      'import/no-absolute-path': 'error',
      'import/no-self-import': 'error',
      'import/newline-after-import': 'error',
      'no-restricted-imports': ['error', { patterns: [PRISMA_DIRECT] }],

      // ---------------------------------------------------------------- odds and ends
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },

  // ---------------------------------------------------------------- the layering

  {
    files: ['packages/ui/**/*.ts', 'packages/ui/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NOT_IN_UI, PRISMA_DIRECT] }] },
  },
  {
    files: ROUTE_HANDLERS,
    rules: { 'no-restricted-imports': ['error', { patterns: [NOT_IN_A_HANDLER, PRISMA_DIRECT] }] },
  },

  // ---------------------------------------------------------------- React

  {
    files: ['**/*.tsx', '**/*.jsx'],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '19.0' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      // The modern runtime needs no React in scope, and TypeScript is the prop contract.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-key': 'error',
      'react/no-array-index-key': 'error',
      'react/self-closing-comp': 'error',
    },
  },

  // ---------------------------------------------------------------- exceptions

  {
    // The build scripts are command-line tools. Their output is the interface.
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // Fixtures and helpers assert; they do not need the whole type-aware ceremony, and a test that
    // ignores a promise fails loudly on its own.
    files: ['test/**', 'packages/*/test/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    files: UNPROJECTED,
    ...tseslint.configs.disableTypeChecked,
  },
);
