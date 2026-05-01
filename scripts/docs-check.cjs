// Validates references in the architecture docs against the actual repo.
// Catches drift between what docs say exists and what the code does.
//
// Why this exists: the architecture docs (docs/architecture/*.md) reference
// many source files in two ways:
//   1. YAML frontmatter `related-files:` lists, which power agent-context
//      discovery and serve as the doc's "this is what I'm about" claim.
//   2. Inline markdown links to other docs and source files.
//
// When source files get renamed, moved, or removed, these references go
// stale silently. Code review caught two such errors in the v2.15.0 doc
// refresh — Constants.xml at a wrong path, and OSD timeout misattributed
// to OSD.xml when the literal lives in VideoPlayerView.xml. This script
// would have caught both.
//
// What it checks:
//   - Every `related-files:` path in docs/architecture/*.md frontmatter
//     resolves to an existing file (or directory) in the repo.
//   - Every relative markdown link in docs/architecture/*.md and
//     docs/decisions.md resolves (skipping http(s):, mailto:, anchor-only).
//
// What it doesn't check (yet):
//   - Inline backtick-quoted paths in prose (noise-prone; many false
//     positives for hypothetical/example paths).
//   - Function names referenced in prose (would require a BS-aware
//     parser; deferred to a possible BSC plugin).
//
// Exits 1 on any broken reference, 0 when clean.
//
// npm scripts:
//   lint:docs  → run this check

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const ARCH_DIR = path.join(ROOT_DIR, 'docs/architecture');
const DECISIONS_PATH = path.join(ROOT_DIR, 'docs/decisions.md');
const VERBOSE = process.argv.includes('--verbose');

// ────────────────────────────────────────────────────────────────────
// Frontmatter parsing — minimal YAML, no external deps. Supported shapes:
//
//   key: value
//   key: []                         ← empty inline list
//   key:                            ← block list
//     - item
//     - item
//
// Anything else (nested objects, multiline strings) we don't need for
// the current frontmatter format.
// ────────────────────────────────────────────────────────────────────

function readFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : null;
}

function parseRelatedFiles(frontmatter) {
  if (!frontmatter) return [];

  // Inline empty list: "related-files: []" (with optional comment after)
  if (/^related-files:\s*\[\s*\]/m.test(frontmatter)) return [];

  const lines = frontmatter.split(/\r?\n/);
  const startIdx = lines.findIndex(l => /^related-files:\s*$/.test(l));
  if (startIdx === -1) return [];

  const items = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Block list item: leading whitespace + "- " + value
    const m = line.match(/^\s+-\s+(.+?)\s*$/);
    if (m) {
      items.push(m[1]);
      continue;
    }
    // Top-level key (back at column 0) ends the list
    if (/^\S/.test(line)) break;
    // Blank line is allowed within frontmatter; continue scanning
  }
  return items;
}

// ────────────────────────────────────────────────────────────────────
// Markdown link extraction — relative path links only.
// Skips: http(s)://, mailto:, #anchor-only.
// Handles trailing #anchor on relative links (strips before checking).
// ────────────────────────────────────────────────────────────────────

function findMarkdownLinks(content) {
  const links = [];
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    let target = m[1];
    if (target.startsWith('http://') || target.startsWith('https://')) continue;
    if (target.startsWith('mailto:')) continue;
    if (target.startsWith('#')) continue;
    target = target.split('#')[0];
    if (!target) continue;
    links.push(target);
  }
  return links;
}

// ────────────────────────────────────────────────────────────────────

const errors = [];
let filesChecked = 0;

function checkRelatedFiles(docPath, content) {
  const fm = readFrontmatter(content);
  const related = parseRelatedFiles(fm);
  for (const rel of related) {
    const target = path.resolve(ROOT_DIR, rel);
    if (!fs.existsSync(target)) {
      errors.push(`${docPath}: related-files path does not exist: ${rel}`);
    }
  }
  return related.length;
}

function checkBodyLinks(docPath, content) {
  const links = findMarkdownLinks(content);
  for (const link of links) {
    const target = path.resolve(path.dirname(docPath), link);
    if (!fs.existsSync(target)) {
      errors.push(`${docPath}: markdown link target does not exist: ${link}`);
    }
  }
  return links.length;
}

// Architecture docs
if (fs.existsSync(ARCH_DIR)) {
  const archFiles = fs.readdirSync(ARCH_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(ARCH_DIR, f))
    .sort();

  for (const file of archFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relatedCount = checkRelatedFiles(file, content);
    const linkCount = checkBodyLinks(file, content);
    filesChecked++;
    if (VERBOSE) {
      console.log(`  ${path.relative(ROOT_DIR, file)} — ${relatedCount} related, ${linkCount} links`);
    }
  }
}

// Decisions log (no frontmatter; just check body links)
if (fs.existsSync(DECISIONS_PATH)) {
  const content = fs.readFileSync(DECISIONS_PATH, 'utf8');
  const linkCount = checkBodyLinks(DECISIONS_PATH, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(`  ${path.relative(ROOT_DIR, DECISIONS_PATH)} — ${linkCount} links`);
  }
}

if (errors.length > 0) {
  console.error(`docs:check found ${errors.length} broken reference(s):\n`);
  for (const err of errors) console.error(`  ${err}`);
  console.error('');
  process.exit(1);
}

console.log(`docs:check: ${filesChecked} file(s) clean`);
process.exit(0);
