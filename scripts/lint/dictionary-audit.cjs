// scripts/lint/dictionary-audit.cjs — Audit dictionary.txt for identifier-shaped entries.
//
// The spellchecker dictionary should hold real English words, acronyms, and
// legitimate technical terms — never code identifiers, file names, class
// names, or path fragments. Adding identifiers defeats the spellchecker for
// any actual typo that happens to collide with an identifier name.
//
// This script flags entries that look identifier-shaped:
//   - contain a path separator (/, \)
//   - end with a known source/asset file extension
//   - camelCase (lowercase prefix → internal uppercase)
//   - identifier-prefix (2+ uppercase → lowercase, e.g. JRRowItem)
//   - 2+ uppercase→lowercase humps (e.g. ItemDetails, MusicArtist)
//
// Acronym plurals (URLs, URIs, FAQs) and product names (BrighterScript,
// JavaScript) are allowed via an explicit allowlist.
//
// Exits 1 on violations. Wired into `npm run lint:dictionary`.

'use strict';

const fs = require('fs');
const path = require('path');

const DICTIONARY_PATH = path.join(__dirname, '..', '..', 'dictionary.txt');

// Product / brand / service names and CS-domain proper nouns that
// legitimately use mixed case or PascalCase but ARE referenced in prose
// (not as code identifiers). Add new entries only when the entry is a
// proper noun, not a class/component name from this codebase.
const ALLOWLIST = new Set([
  // Product / brand names
  'BrighterScript',
  'BrightScript',
  'sgRouter',
  'JavaScript',
  'TypeScript',
  'GitHub',
  'YouTube',
  'JellyRock',
  'Jellyfin',
  'OAuth',
  'OpenAPI',
  'OpenSSL',
  'GraphQL',
  'WebKit',
  'WebAssembly',
  'PostgreSQL',
  'MariaDB',
  'MySQL',
  'PowerShell',
  'MacOS',
  'iOS',
  // Tools / methodologies
  'ESLint',
  'JSDoc',
  'ImageMagick',
  'GitOps',
  'GitOps-adjacent',
  'Keep-a-Changelog',
  'VSCode',
  // Roku / SceneGraph platform vocabulary used in prose
  'SceneGraph',
  'ContentNode',
  // Hyphenated compounds with brand terms
  'Non-Jellyfin',
  // CS / domain terms that happen to be PascalCase by convention
  'camelCase',
  'PascalCase',
  // Video / codec shorthand
  'DoVi',
]);

// Acronym-plural and acronym-possessive patterns. Words like URLs / APIs /
// PNGs / READMEs / BSC's are legitimate dictionary entries that the base
// retext-spell does not know — they look identifier-prefix-shaped only by
// coincidence, so bypass them rather than allowlisting each one.
const ACRONYM_PLURAL_RE = /^[A-Z]{2,}'?s$/;

const FILE_EXTENSIONS = [
  'bs',
  'brs',
  'xml',
  'json',
  'jsonc',
  'js',
  'cjs',
  'mjs',
  'ts',
  'tsx',
  'md',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'sh',
  'yml',
  'yaml',
  'toml',
  'css',
  'scss',
  'html',
  'htm',
  'sql',
  'env',
  'lock',
];

const FILE_EXTENSION_RE = new RegExp(`\\.(?:${FILE_EXTENSIONS.join('|')})$`, 'i');
const PATH_SEPARATOR_RE = /[/\\]/;
const CAMEL_CASE_RE = /^[a-z]+[A-Z]/;
const IDENTIFIER_PREFIX_RE = /^[A-Z]{2,}[a-z]/;
const PASCAL_HUMP_RE = /[A-Z][a-z]+/g;

function classify(word) {
  if (ALLOWLIST.has(word)) return null;
  if (ACRONYM_PLURAL_RE.test(word)) return null;

  // Possessive form of an allowlisted entry (e.g., "BrighterScript's")
  if (word.endsWith("'s") && ALLOWLIST.has(word.slice(0, -2))) return null;

  if (PATH_SEPARATOR_RE.test(word)) {
    return {
      reason: 'path separator',
      hint: 'paths should be backticked in markdown, not added here',
    };
  }
  if (FILE_EXTENSION_RE.test(word)) {
    return {
      reason: 'file extension',
      hint: 'file names should be backticked in markdown, not added here',
    };
  }
  if (CAMEL_CASE_RE.test(word)) {
    return {
      reason: 'camelCase identifier',
      hint: 'code identifiers should be backticked in markdown, not added here',
    };
  }
  if (IDENTIFIER_PREFIX_RE.test(word)) {
    return {
      reason: 'class-prefix identifier',
      hint: 'class/component names should be backticked in markdown, not added here',
    };
  }
  const humps = word.match(PASCAL_HUMP_RE) || [];
  if (humps.length >= 2) {
    return {
      reason: 'PascalCase identifier',
      hint: 'class/component names should be backticked in markdown, not added here',
    };
  }

  return null;
}

function audit() {
  const contents = fs.readFileSync(DICTIONARY_PATH, 'utf8');
  const lines = contents.split('\n');
  const violations = [];

  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    if (trimmed !== line) return;

    const verdict = classify(trimmed);
    if (verdict) {
      violations.push({
        line: idx + 1,
        word: trimmed,
        reason: verdict.reason,
        hint: verdict.hint,
      });
    }
  });

  return violations;
}

function main() {
  const violations = audit();

  if (violations.length === 0) {
    console.log('dictionary-audit: no identifier-shaped entries found.');
    return 0;
  }

  console.error(
    `dictionary-audit: found ${violations.length} identifier-shaped entr${violations.length === 1 ? 'y' : 'ies'} in dictionary.txt:\n`,
  );
  for (const v of violations) {
    console.error(`  dictionary.txt:${v.line}  ${v.word}  (${v.reason})`);
    console.error(`    → ${v.hint}`);
  }
  console.error(
    '\nFix: remove the entry, then backtick the identifier in any markdown that referenced it.',
  );
  console.error(
    'If an entry is a legitimate proper noun (product name, brand), add it to ALLOWLIST in scripts/lint/dictionary-audit.cjs.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { audit, classify, ALLOWLIST };
