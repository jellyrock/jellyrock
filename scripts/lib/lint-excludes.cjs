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
// Agent-facing files (CLAUDE.md, AGENTS.md, anywhere in the tree) are exempt
// — those tolerate technical jargon / code identifiers freely; spell-checking
// them creates noise without protecting against any failure mode that matters.
const SPELL_EXACT = new Set([
  'docs/user/app-settings.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'AGENTS.md',
]);
const SPELL_PREFIXES = ['node_modules/', '.claude/', '.opencode/'];
const SPELL_SUFFIXES = ['/CLAUDE.md', '/AGENTS.md'];

// Markdown lint excludes.
// Mirrors package.json `lint:markdown`.
// Same agent-file carveout as above — relaxed structural rules for files that
// agents read but humans rarely format-review.
const MARKDOWN_EXACT = new Set(['CLAUDE.md', 'AGENTS.md']);
const MARKDOWN_PREFIXES = ['node_modules/', 'out/', 'build/', 'tasks/', '.claude/', '.opencode/'];
const MARKDOWN_SUFFIXES = ['/copilot-instructions.md', '/CLAUDE.md', '/AGENTS.md'];

// JSON lint excludes.
// Mirrors the prefix-shaped excludes in package.json `lint:json` (jshint --exclude).
// Two single-file excludes (`eslint.config.js`, `vitest.config.js`) live only in
// package.json — they exist so jshint doesn't try to parse ESM as ES5 when run
// repo-wide via `./`. They never reach this helper because lint-staged scopes
// jshint to `*.json` files only, so a `.js` config can't be passed in.
const JSON_PREFIXES = [
  'node_modules/',
  'scripts/',
  'tests/scripts/',
  'tasks/',
  'build/',
  'out/',
  'locale/',
  // VSCode's *.json files (settings.json, launch.json, tasks.json,
  // extensions.json, *.code-workspace) are JSONC by convention — they
  // permit // comments and trailing commas. jshint flags those as W094
  // ("Unexpected comma") errors and would block commits. VSCode itself
  // parses these files correctly; nothing else lints them.
  '.vscode/',
  // Generated OpenAPI fingerprints (scripts/generate/spec-fingerprint.js) are
  // ~0.5 MB of JSON.stringify output — valid by construction and drift-checked
  // by docs:spec-fingerprints:check. jshint OOMs (SIGKILL) parsing them, and it
  // would catch nothing the generator doesn't already guarantee.
  'docs/architecture/spec-fingerprints/',
];

function _matches(file, exact, prefixes, suffixes = []) {
  if (exact && exact.has(file)) return true;
  if (prefixes.some((p) => file.startsWith(p))) return true;
  if (suffixes.some((s) => file.endsWith(s))) return true;
  return false;
}

function isSpellExcluded(file) {
  return _matches(file, SPELL_EXACT, SPELL_PREFIXES, SPELL_SUFFIXES);
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
