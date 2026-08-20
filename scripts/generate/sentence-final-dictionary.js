// Generates dictionary-sentence-final.txt — a companion spellchecker dictionary
// holding the sentence-final form of every dictionary.txt entry.
//
// Why this exists: retext mis-tokenizes the last word of a paragraph when the
// next block is a lowercase heading, a list, or a blockquote — it stops treating
// the final period as sentence-final and looks the word up WITH the period glued
// on (`handoff.` rather than `handoff`). Base-dictionary words survive that;
// dictionary.txt entries are matched as anchored regexes and do not, so a
// paragraph ending on one of our own words fails the lint. That is a trap in the
// sanctioned `/log decision` path, whose schema (`## decision-id: <slug>`) puts a
// lowercase heading directly under a paragraph.
//
// Why NOT a broad `ignore` regex: an `ignore` entry matching any token that ends
// in a period also swallows genuine typos in that position. Measured on this repo
// at the time of writing: 47 paragraph-above-a-list sites across 24 of 88 linted
// files, every one of which would stop being spellchecked. This file closes the
// same trap with no coverage loss — a typo is still not in either dictionary, so
// `typoo.` is still reported.
//
// Two ad-hoc versions of this workaround already existed by hand (`codebase.`,
// `globals.`, `lifecycle.`, `lookups.` were sitting in dictionary.txt across two
// separate commits) and each silently accepted `codebaseX` too, because the `.`
// was an unescaped regex wildcard. This generator replaces that pattern.
//
// Run modes:
//   node scripts/generate/sentence-final-dictionary.js          → write (default)
//   node scripts/generate/sentence-final-dictionary.js --check  → fail on drift (CI)
//
// An optional positional argument overrides the root the two files are read from
// and written to — the convention dev-index.cjs and docs-stale.cjs already use, so
// the tests can drive both outcomes against a fixture rather than the live repo.
//
// npm scripts:
//   dictionary:sentence-final        → regenerate (write mode)
//   dictionary:sentence-final:check  → drift check (pre-push + CI)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_NAME = 'dictionary.txt';
const OUTPUT_NAME = 'dictionary-sentence-final.txt';

const HEADER = [
  '# GENERATED FILE — do not edit by hand.',
  '# Source: dictionary.txt. Regenerate with: npm run dictionary:sentence-final',
  '#',
  '# Every entry below is the sentence-final form of a dictionary.txt entry: the',
  '# same pattern, wrapped and followed by an escaped period. It exists because',
  '# retext looks a paragraph-final word up WITH its period attached when the next',
  '# block is a lowercase heading, a list, or a blockquote. See the generator at',
  '# scripts/generate/sentence-final-dictionary.js for the full rationale.',
  '#',
  '# These comment lines contain spaces, so they can never match a word token —',
  '# the same property dictionary.txt relies on for its own header.',
];

// The entries of a spellchecker dictionary file: one per line, blanks and
// `#` comments skipped. Exported for the unit tests.
export function parseEntries(source) {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

// A dictionary entry becomes an anchored regex (`^entry$`), so the sentence-final
// form is the entry followed by an escaped period. The non-capturing group is what
// makes that safe for ANY entry: without it a future entry using alternation
// (`foo|bar`) would bind as `^foo|bar\.$` and match a bare `foo`.
export function sentenceFinalForm(entry) {
  return `(?:${entry})\\.`;
}

export function buildDictionary(source) {
  return [...HEADER, '', ...parseEntries(source).map(sentenceFinalForm), ''].join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const checkMode = argv.includes('--check');
  const root = argv.find((a) => !a.startsWith('--')) ?? SCRIPT_ROOT;
  const sourcePath = join(root, SOURCE_NAME);
  const outputPath = join(root, OUTPUT_NAME);

  const source = readFileSync(sourcePath, 'utf8');
  const expected = buildDictionary(source);

  // Missing and stale are different messages, so read the absence rather than
  // letting a failed read fall through as an empty string.
  let current = null;
  try {
    current = readFileSync(outputPath, 'utf8');
  } catch {
    /* absent — reported as "missing" below */
  }

  if (current === expected) {
    console.log(`${OUTPUT_NAME} is up to date`);
    return 0;
  }

  if (checkMode) {
    console.error(
      current === null
        ? `${OUTPUT_NAME} is missing.`
        : `${OUTPUT_NAME} is out of date with ${SOURCE_NAME}.`,
    );
    console.error("Run 'npm run dictionary:sentence-final' to regenerate.");
    return 1;
  }

  writeFileSync(outputPath, expected, 'utf8');
  console.log(`${OUTPUT_NAME}: regenerated (${parseEntries(source).length} entries).`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exit(main());
