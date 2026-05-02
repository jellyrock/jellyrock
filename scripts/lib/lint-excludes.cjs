// Shared exclude lists for the lint surfaces.
//
// These mirror the excludes baked into `package.json`'s `lint:*` scripts.
// Both `.lintstagedrc.cjs` (pre-commit) and `scripts/lint/check-touched-lint.cjs`
// (end-of-turn hook) import from here so the three sources stay in sync.
// If you change the excludes in package.json, change them here too.
//
// Stdlib only — runs before npm install in fresh checkouts.

'use strict';

// Markdown spell-check excludes.
// Mirrors package.json `lint:spelling`.
const SPELL_EXACT = new Set(['docs/user/app-settings.md', 'CHANGELOG.md']);
const SPELL_PREFIXES = ['node_modules/', '.claude/', '.opencode/'];

// Markdown lint excludes.
// Mirrors package.json `lint:markdown`.
const MARKDOWN_EXACT = new Set(['CLAUDE.md']);
const MARKDOWN_PREFIXES = ['node_modules/', 'out/', 'build/', 'tasks/', '.claude/', '.opencode/'];
const MARKDOWN_SUFFIXES = ['/copilot-instructions.md'];

// JSON lint excludes.
// Mirrors package.json `lint:json` (jshint --exclude).
const JSON_PREFIXES = ['node_modules/', 'scripts/', 'tasks/', 'build/', 'out/', 'locale/'];

function _matches(file, exact, prefixes, suffixes = []) {
  if (exact && exact.has(file)) return true;
  if (prefixes.some((p) => file.startsWith(p))) return true;
  if (suffixes.some((s) => file.endsWith(s))) return true;
  return false;
}

function isSpellExcluded(file) {
  return _matches(file, SPELL_EXACT, SPELL_PREFIXES);
}

function isMarkdownExcluded(file) {
  return _matches(file, MARKDOWN_EXACT, MARKDOWN_PREFIXES, MARKDOWN_SUFFIXES);
}

function isJsonExcluded(file) {
  return _matches(file, null, JSON_PREFIXES);
}

module.exports = {
  isSpellExcluded,
  isMarkdownExcluded,
  isJsonExcluded,
};
