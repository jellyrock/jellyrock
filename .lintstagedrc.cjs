// Pre-commit lint configuration (lint-staged).
//
// Runs file-scoped lint + auto-format on staged files at `git commit` time.
// lint-staged automatically re-stages mutations from auto-fix steps, so
// reformatted code lands in the same commit.
//
// Surface ownership (see docs/architecture/build-and-tooling.md):
//   - PostToolUse hook  — bsfmt --write on every agent Write/Edit (Claude Code only)
//   - End-of-turn hook  — spell/markdown/json on uncommitted-only files (agents)
//   - Pre-commit (here) — file-scoped lint+format for everyone (humans + agents)
//   - Pre-push hook     — project-wide checks (validate, bslint, lint:docs, regens)
//   - CI                — same as pre-push, can't bypass
//
// What lives here vs pre-push:
//   - bsfmt --write (file-scoped, fast, auto-fix) → here
//   - bslint (cross-scope; needs full project context, not file-scopable) → pre-push
//   - markdownlint --fix (file-scoped, auto-fix) → here
//   - spellchecker (file-scoped) → here
//   - jshint .json (file-scoped) → here
//   - eslint --fix (file-scoped, auto-fix) → here
//   - prettier --write (file-scoped, auto-fix; .prettierignore handles excludes) → here
//   - bsc --noEmit (project-wide compile) → pre-push
//   - lint:docs / docs:dev-index:check (cross-doc references) → pre-push
//   - update-translations / docs:dev-index regen (project-wide regen) → pre-push
//   - test:scripts (vitest, file-scoping is awkward) → pre-push + CI
//
// Excludes mirror package.json's `lint:*` scripts via shared helpers in
// `scripts/lib/lint-excludes.cjs` so all three surfaces (this file,
// `scripts/lint/check-touched-lint.cjs`, package.json) stay in sync.

'use strict';

const path = require('path');
const {
  isSpellExcluded,
  isMarkdownExcluded,
  isJsonExcluded,
} = require('./scripts/lib/lint-excludes.cjs');

// lint-staged passes ABSOLUTE paths to function configs, but the exclude
// helpers in `lint-excludes.cjs` (and the `lint:*` scripts in package.json
// they mirror) match against repo-relative POSIX-style paths. Normalize
// at this boundary so the exclude check actually fires.
//
// Without this, every prefix/exact exclude (CHANGELOG.md, .claude/**,
// node_modules/**, docs/user/app-settings.md, …) silently failed to
// match. The bug surfaced post-merge when the changelog-sync bot
// committed CHANGELOG.md and lint-staged ran spellchecker on it instead
// of skipping.
const REPO_ROOT = process.cwd();
const toRel = (file) => {
  const rel = path.relative(REPO_ROOT, file);
  // Force POSIX separators so the comparison matches the exclude lists,
  // which use `/` regardless of host OS.
  return rel.split(path.sep).join('/');
};
const keep = (predicate) => (files) => files.filter((f) => !predicate(toRel(f)));

// Shell-quote a single file path. Defensive: file paths can contain spaces,
// quotes, etc. Single-quoting + escaping any single quotes is the safe form.
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Build a `cmd args... files...` invocation, quoting file paths. Returns
// null when there are no files left after filtering — lint-staged treats
// `null` / `[]` / `undefined` as "no work to do" for that glob.
const cmdWithFiles = (cmd, files) => {
  if (files.length === 0) return null;
  return `${cmd} ${files.map(q).join(' ')}`;
};

const SPELLCHECKER_PLUGINS =
  'spell indefinite-article repeated-words syntax-mentions syntax-urls frontmatter';

// A heading whose first word is lowercase (`## decision-id: <slug>`, the schema every
// docs/decisions.md note uses) stops retext treating the PREVIOUS paragraph's final period
// as sentence-final, so that paragraph's last word is looked up with the period glued on —
// `handoff.` rather than `handoff`. Base-dictionary words survive it; words from our own
// dictionary.txt are matched exactly and fail. So appending any decision note could break
// the build on the prose of the note above it, which is a trap for every future
// `/log decision`. Ignore the glued shape: a token is only ever reported WITH a trailing
// period in that mis-tokenized case, so this costs only a real typo that is both
// paragraph-final and directly above a lowercase heading. Keep in sync with the
// `lint:spelling` script in package.json — pre-commit and CI must agree.
const SPELLCHECKER_IGNORE = String.raw`[A-Za-z][A-Za-z0-9'-]*\.`;

module.exports = {
  // BrighterScript format — auto-fix; lint-staged re-stages the result.
  // bslint stays in pre-push (full project context required).
  // No path-based excludes for .bs/.brs today.
  '*.{bs,brs}': (files) => {
    const cmd = cmdWithFiles('npx bsfmt --write', files);
    return cmd ? [cmd] : [];
  },

  // Markdown — auto-fix style + spell-check (no spell auto-fix; check only).
  '*.md': (files) => {
    const mdLint = cmdWithFiles('npx markdownlint-cli2 --fix', keep(isMarkdownExcluded)(files));
    const spell = cmdWithFiles(
      `npx spellchecker -d dictionary.txt -p ${SPELLCHECKER_PLUGINS} -i ${q(SPELLCHECKER_IGNORE)} --files`,
      keep(isSpellExcluded)(files),
    );
    return [mdLint, spell].filter(Boolean);
  },

  // JSON — jshint syntax + duplicate-key check (broad set), then Prettier
  // formatting (curated set via .prettierignore). The two tools have
  // complementary scopes: jshint catches semantics Prettier doesn't (duplicate
  // keys), Prettier catches whitespace drift jshint doesn't.
  '*.json': (files) => {
    const jshint = cmdWithFiles(
      'npx jshint --extra-ext .json --verbose',
      keep(isJsonExcluded)(files),
    );
    const prettier = cmdWithFiles('npx prettier --write --log-level warn', files);
    return [jshint, prettier].filter(Boolean);
  },

  // JS / CJS / ESM — ESLint --fix then Prettier --write.
  // ESLint owns code rules (unused vars, no-var, hashbang, etc.).
  // Prettier owns formatting and runs after to win any whitespace ties
  // (eslint-config-prettier disables ESLint rules that would conflict).
  '*.{js,cjs,mjs}': (files) => {
    const eslint = cmdWithFiles('npx eslint --fix --no-warn-ignored', files);
    const prettier = cmdWithFiles('npx prettier --write --log-level warn', files);
    return [eslint, prettier].filter(Boolean);
  },
};
