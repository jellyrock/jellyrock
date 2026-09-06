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

import rtaWaitJustified from './scripts/lint/eslint-rules/rta-wait-justified.js';
import rtaSleepBudgeted from './scripts/lint/eslint-rules/rta-sleep-budgeted.js';

/**
 * Focus is WALKED, never teleported.
 *
 * `odc.focusNode` sets focus straight onto a node, which skips the key handler that
 * would have moved it there — so a spec can arrange a state the remote cannot actually
 * reach and still pass green. Four sites used it; all four now press real keys via
 * `walkFocusInto`, and the ladders they walk (`UserSelect.bs:564`,
 * `ItemDetails.bs:4271` / `:3898`) had no coverage at all while the teleports stood in
 * for them. Reasoning: `docs/decisions.md` -> `rta-focus-walked-not-teleported`.
 *
 * Declared once and applied in TWO blocks below because ESLint flat config REPLACES a
 * rule's options rather than merging them: a second `no-restricted-syntax` covering a
 * file the first one also covers would silently drop the `diagnosedError` selector.
 * The two blocks' file sets are therefore disjoint, and this constant is what keeps
 * them from drifting apart.
 */
const NO_FOCUS_TELEPORT = {
  selector: "CallExpression[callee.object.name='odc'][callee.property.name='focusNode']",
  message:
    'RTA focus: walk with `walkFocusInto(key, containerId)` instead of `odc.focusNode`. A teleport skips the key handler under test, so a spec can pass on a state the remote cannot reach.',
};

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
  // `diagnosedError` (tests/rta/lib/diagnostics.js), which attaches the device state
  // at the throw site. A bare throw produces "not found", which cannot be attributed
  // to a cause afterwards.
  //
  // The glob covers the files that own WAITS; a fail-fast that already names its own
  // cause disables the rule on its line with a reason. Adding a new lib file that
  // grows a wait is one line here. Why these and not `specs/` or the other lib
  // modules: docs/dev/rta-tests.md#when-a-wait-times-out-it-reports-what-it-saw.
  //
  // `screens.js` joined them after Phase 3's first baseline run went red and folded
  // with `failures: []` — its content assertions were bare throws, so the one red
  // sample the series produced could be recorded but not attributed. It is the screen
  // REGISTRY, not a spec, so the "spec throws are assertions, not timeouts" carve-out
  // that keeps `specs/` out does not cover it: an assertion that reads device state
  // and finds it wrong is exactly the case that needs the state dumped.
  //
  // `scripts/capture-screenshots.js` joined for the same reason `screens.js` did: it
  // imports the same `waitFor` and drives the same device, so a wait that hangs there
  // burns a device run and reports nothing attributable. It lives outside `tests/rta/`
  // only because its OUTPUT is the store image set rather than a test result.
  {
    files: [
      'tests/rta/lib/nav.js',
      'tests/rta/lib/steps.js',
      'tests/rta/screens.js',
      'tests/rta/demos/**/*.{js,mjs}',
      'scripts/capture-screenshots.js',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Any `new` — not just `Error`. `throw new TypeError(...)` in a wait has the
          // same problem and would otherwise slip a gate that reads as covering it.
          selector: 'ThrowStatement > NewExpression',
          message:
            'RTA waits: throw via `diagnosedError` so the failure reports the device state it saw. A fail-fast that already names its cause may disable this with a reason.',
        },
        NO_FOCUS_TELEPORT,
      ],
    },
  },

  // The same focus-teleport ban for the RTA files the block above does not list —
  // `specs/`, `capture.js`, and the lib modules other than `nav`/`steps`. It is a
  // SEPARATE block, with a file set disjoint from that one, because re-declaring
  // `no-restricted-syntax` for an already-covered file would replace its
  // `diagnosedError` selector rather than add to it. `specs/` deliberately stays out of
  // that selector: a spec's `throw new Error` is a fixture assertion, not a timeout.
  {
    files: ['tests/rta/**/*.{js,mjs}'],
    ignores: [
      'tests/rta/**/*.test.js',
      'tests/rta/lib/nav.js',
      'tests/rta/lib/steps.js',
      'tests/rta/screens.js',
      'tests/rta/demos/**/*.{js,mjs}',
    ],
    rules: {
      'no-restricted-syntax': ['error', NO_FOCUS_TELEPORT],
    },
  },

  // RTA waits — every `waitFor` must fall in a justified category.
  //
  // The harness polls where `roku-test-automation` offers an observer
  // (`onFieldChangeOnce`), which is a deviation from the library's documented practice.
  // The project's bar is that each such wait carries a written justification; the four
  // categories that supply them are in tests/rta/CLAUDE.md → "Why every wait polls".
  // This rule fails a wait that lands in none of them, so the inventory cannot silently
  // grow a member nobody reasoned about.
  //
  // Rationale, the field allowlist and how to extend it live in the rule module. Why a
  // rule module rather than a `no-restricted-syntax` selector: expressing "matches none
  // of four shapes" in esquery needs stacked `:not(:has(...))` plus a long alternation
  // for the allowlist, which produces a line nobody can safely edit.
  //
  // `*.test.js` is excluded — steps.test.js calls `waitFor` against a mocked device to
  // test the wait itself, which is not a wait on real app state.
  //
  // The sibling rule in the same block — `sleep-budgeted` — covers the OTHER half of the
  // same bar. `wait-justified` asks why a wait polls where the library offers an
  // observer; `sleep-budgeted` asks why a wait is a fixed duration where the app offers a
  // signal. Same scope and same exclusion, because a `sleep` in a `*.test.js` paces a
  // mocked clock rather than a real device.
  {
    files: ['tests/rta/**/*.{js,mjs}', 'scripts/capture-screenshots.js'],
    ignores: ['tests/rta/**/*.test.js'],
    plugins: {
      'jellyrock-rta': {
        rules: { 'wait-justified': rtaWaitJustified, 'sleep-budgeted': rtaSleepBudgeted },
      },
    },
    rules: {
      'jellyrock-rta/wait-justified': 'error',
      'jellyrock-rta/sleep-budgeted': 'error',
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
