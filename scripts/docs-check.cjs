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
//   - Every tech-debt slug reference (in markdown narrative or in plugin
//     .cjs file headers / diagnostic strings) points to a slug that
//     actually exists in docs/architecture/tech-debt.md. Two reference
//     forms are recognized:
//        1. Anchor link:    tech-debt.md#slug-name
//        2. Narrative form: `tech-debt[.md]` followed within 20 chars
//                           by a backtick-wrapped kebab-case slug.
//     Catches the failure mode where a slug gets removed from tech-debt.md
//     (because its work is done) but narrative references in other files
//     are left dangling. Surfaced when 4 such refs slipped through the
//     v2.15.0 doc audit.
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
const DEV_DIR = path.join(ROOT_DIR, 'docs/dev');
const DECISIONS_PATH = path.join(ROOT_DIR, 'docs/decisions.md');
const TECH_DEBT_PATH = path.join(ARCH_DIR, 'tech-debt.md');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');
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
// Tech-debt slug references — extract the canonical slug set from
// tech-debt.md, then check that every reference elsewhere points to one
// of those slugs. Two reference forms supported:
//   1. Anchor:     tech-debt.md#slug-name           (any file)
//   2. Narrative:  `tech-debt[.md]` ... `slug-name` (within 20 chars)
// The narrative form's tight window keeps false positives down — a
// hyphenated identifier in a separate sentence won't match.
// ────────────────────────────────────────────────────────────────────

// Slug shape: starts with a letter, has at least one hyphen, kebab-case.
// Matches both narrative slugs and anchor slugs uniformly.
const SLUG_PATTERN = '[a-z][a-z0-9]*(?:-[a-z0-9]+)+';
const ANCHOR_REF_RE = new RegExp(`\\btech-debt\\.md#(${SLUG_PATTERN})\\b`, 'gi');
const NARRATIVE_REF_RE = new RegExp(
  `\\btech-debt(?:\\.md)?[^\\n]{0,20}?\`(${SLUG_PATTERN})\``,
  'gi'
);

function extractTechDebtSlugs(techDebtPath) {
  if (!fs.existsSync(techDebtPath)) return null;
  const content = fs.readFileSync(techDebtPath, 'utf8');
  const slugs = new Set();
  const headingRe = /^####\s+`([a-z][a-z0-9-]+)`/gm;
  let m;
  while ((m = headingRe.exec(content)) !== null) {
    slugs.add(m[1]);
  }
  return slugs;
}

function findSlugRefs(content) {
  const refs = [];
  let m;
  ANCHOR_REF_RE.lastIndex = 0;
  while ((m = ANCHOR_REF_RE.exec(content)) !== null) {
    refs.push({ slug: m[1].toLowerCase(), form: 'anchor' });
  }
  NARRATIVE_REF_RE.lastIndex = 0;
  while ((m = NARRATIVE_REF_RE.exec(content)) !== null) {
    refs.push({ slug: m[1].toLowerCase(), form: 'narrative' });
  }
  return refs;
}

function checkSlugRefs(filePath, content) {
  if (!knownSlugs) return 0;
  const refs = findSlugRefs(content);
  let okCount = 0;
  for (const ref of refs) {
    if (knownSlugs.has(ref.slug)) {
      okCount++;
    } else {
      errors.push(
        `${filePath}: stale tech-debt slug reference "${ref.slug}" (${ref.form} form). ` +
        `Either restore the slug in docs/architecture/tech-debt.md or rewrite the reference.`
      );
    }
  }
  return okCount;
}

// ────────────────────────────────────────────────────────────────────

const errors = [];
let filesChecked = 0;
const knownSlugs = extractTechDebtSlugs(TECH_DEBT_PATH);

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

function checkDirOfMds(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(dir, f))
    .sort();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relatedCount = checkRelatedFiles(file, content);
    const linkCount = checkBodyLinks(file, content);
    const slugCount = checkSlugRefs(file, content);
    filesChecked++;
    if (VERBOSE) {
      console.log(`  ${path.relative(ROOT_DIR, file)} — ${relatedCount} related, ${linkCount} links, ${slugCount} slugs`);
    }
  }
}

// Architecture docs
checkDirOfMds(ARCH_DIR);

// Dev how-to guides
checkDirOfMds(DEV_DIR);

// Decisions log (no frontmatter; just check body links + slug refs)
if (fs.existsSync(DECISIONS_PATH)) {
  const content = fs.readFileSync(DECISIONS_PATH, 'utf8');
  const linkCount = checkBodyLinks(DECISIONS_PATH, content);
  const slugCount = checkSlugRefs(DECISIONS_PATH, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(`  ${path.relative(ROOT_DIR, DECISIONS_PATH)} — ${linkCount} links, ${slugCount} slugs`);
  }
}

// CLAUDE.md files — root + every subdir-scoped one. These are the agent-context
// rules; their cross-references to docs/architecture/ go stale the same way
// and are equally important to validate.
function findClaudeMds(rootDir) {
  const found = [];
  // Skip directories that don't host project source / docs
  const skipDirs = new Set(['node_modules', 'build', 'out', 'tasks', '.git', '.husky']);
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skipDirs.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name));
      } else if (e.name === 'CLAUDE.md') {
        found.push(path.join(dir, e.name));
      }
    }
  }
  walk(rootDir);
  return found.sort();
}

for (const file of findClaudeMds(ROOT_DIR)) {
  const content = fs.readFileSync(file, 'utf8');
  const linkCount = checkBodyLinks(file, content);
  const slugCount = checkSlugRefs(file, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(`  ${path.relative(ROOT_DIR, file)} — ${linkCount} links, ${slugCount} slugs`);
  }
}

// BSC convention plugin sources — their JSDoc headers + diagnostic strings
// frequently cite tech-debt slugs (the plugins enforce conventions documented
// there). These are .cjs, not .md, but the slug-ref regex doesn't care.
function findPluginScripts() {
  if (!fs.existsSync(SCRIPTS_DIR)) return [];
  return fs.readdirSync(SCRIPTS_DIR)
    .filter(f => f.startsWith('bsc-plugin-') && f.endsWith('.cjs'))
    .map(f => path.join(SCRIPTS_DIR, f))
    .sort();
}

for (const file of findPluginScripts()) {
  const content = fs.readFileSync(file, 'utf8');
  const slugCount = checkSlugRefs(file, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(`  ${path.relative(ROOT_DIR, file)} — ${slugCount} slugs`);
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
