// ESLint v10 flat config.
//
// Scope: every `.js`/`.cjs`/`.mjs` outside node_modules/build/out/.git.
// Pairs with Prettier (eslint-config-prettier disables stylistic rules
// that would conflict with Prettier's formatting).
//
// File-system module conventions (see scripts/CLAUDE.md):
//   - `.cjs` = CommonJS. BSC plugins MUST be `.cjs` (BrighterScript's
//     loadPlugins uses require()). Anything require()'d by a `.cjs` file
//     (incl. scripts/lib/*) is also locked to `.cjs`.
//   - `.js`  = ESM (package.json has "type": "module"). Net-new top-level
//     CLI scripts go ESM.
//
// `eslint-plugin-n`'s `flat/mixed-esm-and-cjs` preset handles both.

import js from '@eslint/js';
import nodePlugin from 'eslint-plugin-n';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/',
      'build/',
      'build-analysis/',
      'out/',
      'locale/',
      'tasks/',
      '.claude/',
      'roku_modules/',
      '**/roku_modules/',
    ],
  },

  js.configs.recommended,
  ...nodePlugin.configs['flat/mixed-esm-and-cjs'],

  // Cross-cutting rules — apply to every JS file.
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // CLI scripts legitimately log + exit. Don't flag.
      'no-console': 'off',
      'n/no-process-exit': 'off',

      // Hashbang validation: fix shebangs in CLI files automatically.
      'n/hashbang': 'error',

      // JellyRock is a Roku app, NOT an npm package. Nothing in scripts/ is
      // published to a registry, so devDependencies are effectively just
      // "dependencies for our internal tools." These rules assume a publish
      // model and produce false positives in this repo.
      'n/no-unpublished-import': 'off',
      'n/no-unpublished-require': 'off',

      // `node:fs` over `fs` — only meaningful for ESM (CJS still permits both).
      // Enforced for ESM via the `*.js`/`*.mjs` block below.
    },
  },

  // ESM (`.js`, `.mjs`) — require `node:` protocol on built-in imports.
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: {
      'n/prefer-node-protocol': 'error',
    },
  },

  // RTA waits — a timeout must report what it SAW, so it throws through
  // `diagnosedError` (tests/rta/lib/diagnostics.js), which attaches the device
  // state at the throw site. A bare `new Error` produces "not found", which cannot
  // be attributed to a cause after the fact — and the flake baseline is only worth
  // producing if its failures can be. The rule was prose-only in
  // tests/rta/CLAUDE.md until a spec-level timeout shipped without it.
  //
  // Scoped to the two files that own the waits, deliberately: the other lib
  // modules throw fail-fasts that already name their own cause (a snapshot from
  // the wrong device, a seed that did not take), and gating those would buy four
  // disable comments and no signal. A new file that grows a wait belongs here —
  // adding it is a one-line, reviewable act.
  {
    files: ['tests/rta/lib/nav.js', 'tests/rta/lib/steps.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message:
            'RTA waits: throw via `diagnosedError` so the failure reports the device state it saw. A fail-fast that already names its cause may disable this with a reason.',
        },
      ],
    },
  },

  // Test files — Vitest globals are imported explicitly (see vitest.config.js
  // `globals: false`), but allow looser assertions where useful.
  {
    files: ['tests/scripts/**/*.test.js'],
    rules: {
      // Tests sometimes redeclare common identifiers; tolerate.
      'no-shadow': 'off',
    },
  },

  // Prettier — turns off ESLint formatting rules that would fight Prettier.
  // Must come LAST so it overrides earlier rule activations.
  prettierConfig,
];
