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
  'macOS',
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

/**
 * The first unescaped regex metacharacter in an entry, or null.
 *
 * A backslash escapes the character after it, so `\.claude` is clean while
 * `.claude` is not. `-` is deliberately absent: it is only special inside a
 * character class, and this file is full of legitimately hyphenated entries.
 */
function unescapedMetacharacters(word) {
  for (let i = 0; i < word.length; i++) {
    if (word[i] === '\\') {
      i++; // skip whatever it escapes
      continue;
    }
    if ('.*+?^$()[]{}|'.includes(word[i])) return word[i];
  }
  return null;
}

function shapeVerdict(word) {
  // Every check below is about what the entry MEANS, not how it is written, so
  // they run against the UNESCAPED literal. Without this, correctly escaping
  // `.claude` to `\.claude` trips the path-separator rule on its own escape
  // character — the audit would reject the very fix it just demanded.
  const literal = word.replace(/\\(.)/g, '$1');

  if (ALLOWLIST.has(literal)) return null;
  if (ACRONYM_PLURAL_RE.test(literal)) return null;

  // Possessive form of an allowlisted entry (e.g., "BrighterScript's")
  if (literal.endsWith("'s") && ALLOWLIST.has(literal.slice(0, -2))) return null;

  if (PATH_SEPARATOR_RE.test(literal)) {
    return {
      reason: 'path separator',
      hint: 'paths should be backticked in markdown, not added here',
    };
  }
  if (FILE_EXTENSION_RE.test(literal)) {
    return {
      reason: 'file extension',
      hint: 'file names should be backticked in markdown, not added here',
    };
  }
  if (CAMEL_CASE_RE.test(literal)) {
    return {
      reason: 'camelCase identifier',
      hint: 'code identifiers should be backticked in markdown, not added here',
    };
  }
  if (IDENTIFIER_PREFIX_RE.test(literal)) {
    return {
      reason: 'class-prefix identifier',
      hint: 'class/component names should be backticked in markdown, not added here',
    };
  }
  const humps = literal.match(PASCAL_HUMP_RE) || [];
  if (humps.length >= 2) {
    return {
      reason: 'PascalCase identifier',
      hint: 'class/component names should be backticked in markdown, not added here',
    };
  }

  return null;
}

/**
 * Two independent problems, in the order their FIXES make sense.
 *
 * An identifier-shaped entry should be DELETED, so it is reported first — telling
 * someone to escape the dot in `package.json` would be advice toward keeping an
 * entry that should never have been added. Only once an entry is otherwise
 * legitimate does an unescaped metacharacter become the actionable problem.
 *
 * The metacharacter check deliberately sits AFTER the allowlist rather than
 * before it: `shapeVerdict` returns null for an allowlisted entry, so control
 * still reaches here and an allowlisted proper noun written with a live
 * metacharacter is caught too.
 */
function classify(word) {
  const shape = shapeVerdict(word);
  if (shape) return shape;

  const meta = unescapedMetacharacters(word);
  if (meta) {
    return {
      reason: `unescaped regex metacharacter ${meta}`,
      hint: `entries compile to anchored regexes — write ${meta} as \\${meta} if you meant it literally`,
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
    `dictionary-audit: found ${violations.length} problem entr${violations.length === 1 ? 'y' : 'ies'} in dictionary.txt:\n`,
  );
  for (const v of violations) {
    console.error(`  dictionary.txt:${v.line}  ${v.word}  (${v.reason})`);
    console.error(`    → ${v.hint}`);
  }
  // The two violation classes have OPPOSITE fixes — an identifier-shaped entry
  // should be deleted, an unescaped metacharacter should be escaped and KEPT — so
  // printing both footers unconditionally tells half the readers to do the wrong
  // thing. Each prints only when its own class is present.
  if (violations.some((v) => !v.reason.startsWith('unescaped regex metacharacter'))) {
    console.error(
      '\nFix: remove the entry, then backtick the identifier in any markdown that referenced it.',
    );
    console.error(
      'If an entry is a legitimate proper noun (product name, brand), add it to ALLOWLIST in scripts/lint/dictionary-audit.cjs.',
    );
  }
  if (violations.some((v) => v.reason.startsWith('unescaped regex metacharacter'))) {
    console.error(
      '\nFix: escape the metacharacter (`.claude` → `\\.claude`) and regenerate the companion dictionary with `npm run dictionary:sentence-final`.',
    );
  }
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { audit, classify, ALLOWLIST };
