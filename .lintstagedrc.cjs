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
//   - bsc --noEmit (project-wide compile) → pre-push
//   - lint:docs / docs:dev-index:check (cross-doc references) → pre-push
//   - update-translations / docs:dev-index regen (project-wide regen) → pre-push
//
// Excludes mirror package.json's `lint:*` scripts via shared helpers in
// `scripts/lib/lint-excludes.cjs` so all three surfaces (this file,
// `scripts/check-touched-lint.cjs`, package.json) stay in sync.

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
      `npx spellchecker -d dictionary.txt -p ${SPELLCHECKER_PLUGINS} --files`,
      keep(isSpellExcluded)(files),
    );
    return [mdLint, spell].filter(Boolean);
  },

  // JSON syntax — check-only (jshint has no auto-fix).
  '*.json': (files) => {
    const cmd = cmdWithFiles(
      'npx jshint --extra-ext .json --verbose',
      keep(isJsonExcluded)(files),
    );
    return cmd ? [cmd] : [];
  },
};
