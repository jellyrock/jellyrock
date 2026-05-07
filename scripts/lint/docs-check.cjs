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
//   - Every tech-debt anchor reference (anywhere in scanned files) of
//     the form `tech-debt.md#<anchor>` resolves to a real heading
//     anchor in docs/architecture/tech-debt.md. This is the canonical
//     form for citing a slug or section from outside; narrative-form
//     mentions (a backtick-wrapped kebab string in prose) are
//     intentionally NOT checked, because there's no syntactic signal to
//     distinguish them from any other backtick-wrapped kebab string in
//     the codebase (plugin names, npm scripts, etc.) without a fragile
//     proximity heuristic or a registry of false positives. The
//     anchor-link convention is documented in tech-debt.md's preamble.
//     Catches the failure mode where a slug gets removed from
//     tech-debt.md but anchor refs elsewhere go stale. Surfaced when 4
//     such refs slipped through the v2.15.0 doc audit.
//
// What it doesn't check (yet):
//   - Inline backtick-quoted paths in prose (noise-prone; many false
//     positives for hypothetical/example paths).
//   - Function names referenced in prose (would require a BS-aware
//     parser; deferred to a possible BSC plugin).
//
// Exits 1 on any broken reference, 0 when clean.
//
// Flags:
//   --verbose  per-file counts on stdout
//   --json     emit a single JSON object on stdout: {filesChecked, errorsCount,
//              errors: [{category, file, message, target}]} where category is
//              one of "broken-related-file", "broken-link", or "stale-anchor".
//              Mutually exclusive with --verbose (verbose is a no-op under
//              --json). Exit code semantics unchanged.
//
// npm scripts:
//   lint:docs  → run this check

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { readFrontmatter, parseRelatedFiles, getLastUpdated } = require('../lib/frontmatter.cjs');

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const ARCH_DIR = path.join(ROOT_DIR, 'docs/architecture');
const DEV_DIR = path.join(ROOT_DIR, 'docs/dev');
const DECISIONS_PATH = path.join(ROOT_DIR, 'docs/decisions.md');
const PROGRESS_PATH = path.join(ROOT_DIR, 'docs/progress.md');
const SIGNALS_PATH = path.join(ROOT_DIR, 'docs/signals-backlog.md');
const TECH_DEBT_PATH = path.join(ARCH_DIR, 'tech-debt.md');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');
const JSON_MODE = process.argv.includes('--json');
const VERBOSE = process.argv.includes('--verbose') && !JSON_MODE;

// Journal-staleness gate: progress.md is the live state cursor; FAIL when
// it's gone >7 days without an update AND the repo has had commits since.
// `last-updated` semantics differ from architecture-docs' `last-reviewed`
// (see scripts/lib/frontmatter.cjs comments) — this gate uses the former.
const PROGRESS_STALE_DAYS = 7;

// Signals-backlog row schema. Required bullets, valid status values,
// optional `staleness_days` override (must be a positive integer when
// present). The schema is documented in docs/signals-backlog.md's preamble.
const SIGNALS_REQUIRED_BULLETS = [
  'watching',
  'current',
  'latest_upstream',
  'last_checked',
  'action_when_moves',
  'status',
];
const SIGNALS_VALID_STATUSES = ['watching', 'action_pending', 'completed'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
// Tech-debt anchor references — bulletproof check against a single
// canonical form: `tech-debt.md#<anchor>`. Validates that the anchor
// resolves to an actual heading in tech-debt.md.
//
// We deliberately don't try to detect narrative-style slug citations
// (e.g. "see `slug-name`") because there's no syntactic signal that
// disambiguates them from any other backtick-wrapped kebab-case
// identifier in the codebase (plugin names, npm scripts, module IDs).
// Any heuristic for that — proximity windows, registries of "known
// non-slug strings", etc. — is fragile and accumulates maintenance
// debt. The chosen design: declare anchor form canonical, document it
// in tech-debt.md, and validate it strictly.
// ────────────────────────────────────────────────────────────────────

// Reference form: any URL or path ending in `tech-debt.md#<anchor>`.
// The anchor capture is permissive (anything after the # up to a word
// boundary or markdown delimiter) so we catch both slug-style anchors
// (kebab-case) and section-heading anchors (which may have multiple
// consecutive hyphens from punctuation in the heading text).
const ANCHOR_REF_RE = /\btech-debt\.md#([a-z0-9][a-z0-9-]*)(?=[)\s.,;'"`]|$)/gim;

/**
 * Extract the set of valid anchors from tech-debt.md by hashing each
 * heading text via an approximation of GitHub's heading-to-anchor rule:
 * lowercase, strip backticks/emphasis/most punctuation, replace spaces
 * with hyphens. Conservative — handles the heading shapes used in
 * tech-debt.md today (plain prose + backtick-wrapped slugs).
 */
function extractTechDebtAnchors(techDebtPath) {
  if (!fs.existsSync(techDebtPath)) return null;
  const content = fs.readFileSync(techDebtPath, 'utf8');
  const anchors = new Set();
  const headingRe = /^#+\s+(.+?)\s*$/gm;
  let m;
  while ((m = headingRe.exec(content)) !== null) {
    const anchor = headingToAnchor(m[1]);
    if (anchor) anchors.add(anchor);
  }
  return anchors;
}

function headingToAnchor(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '') // strip backticks + emphasis chars
    .replace(/[^a-z0-9\s-]/g, '') // keep only alnum, whitespace, hyphens
    .trim()
    .replace(/\s+/g, '-'); // whitespace runs → single hyphen
}

function checkAnchorRefs(filePath, content) {
  if (!techDebtAnchors) return 0;
  let okCount = 0;
  let m;
  ANCHOR_REF_RE.lastIndex = 0;
  while ((m = ANCHOR_REF_RE.exec(content)) !== null) {
    const anchor = m[1].toLowerCase();
    if (techDebtAnchors.has(anchor)) {
      okCount++;
    } else {
      pushError({
        category: 'stale-anchor',
        file: filePath,
        message:
          `stale tech-debt anchor reference "tech-debt.md#${anchor}" — ` +
          `no heading with that anchor exists in docs/architecture/tech-debt.md. ` +
          `Either restore/rename the heading, or rewrite the reference.`,
        target: anchor,
      });
    }
  }
  return okCount;
}

// ────────────────────────────────────────────────────────────────────

const errors = [];
let filesChecked = 0;
const techDebtAnchors = extractTechDebtAnchors(TECH_DEBT_PATH);

function pushError(err) {
  errors.push(err);
}

function formatError(err) {
  return `${err.file}: ${err.message}`;
}

function checkRelatedFiles(docPath, content) {
  const fm = readFrontmatter(content);
  const related = parseRelatedFiles(fm);
  for (const rel of related) {
    const target = path.resolve(ROOT_DIR, rel);
    if (!fs.existsSync(target)) {
      pushError({
        category: 'broken-related-file',
        file: docPath,
        message: `related-files path does not exist: ${rel}`,
        target: rel,
      });
    }
  }
  return related.length;
}

function checkBodyLinks(docPath, content) {
  const links = findMarkdownLinks(content);
  for (const link of links) {
    const target = path.resolve(path.dirname(docPath), link);
    if (!fs.existsSync(target)) {
      pushError({
        category: 'broken-link',
        file: docPath,
        message: `markdown link target does not exist: ${link}`,
        target: link,
      });
    }
  }
  return links.length;
}

// ────────────────────────────────────────────────────────────────────
// Journal-system checks — operate on specific files (progress.md,
// signals-backlog.md) rather than directory iteration. These are post-loop
// because they're whole-file validations, not link / anchor checks.
// ────────────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(isoStart, isoEnd) {
  const a = new Date(isoStart + 'T00:00:00Z');
  const b = new Date(isoEnd + 'T00:00:00Z');
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function checkProgressStaleness() {
  if (!fs.existsSync(PROGRESS_PATH)) return; // silent when absent
  const content = fs.readFileSync(PROGRESS_PATH, 'utf8');
  const fm = readFrontmatter(content);
  const lastUpdated = getLastUpdated(fm);
  if (!lastUpdated) {
    pushError({
      category: 'progress-stale',
      file: PROGRESS_PATH,
      message:
        'progress.md is missing or has malformed `last-updated:` frontmatter (expected ISO YYYY-MM-DD)',
      target: 'last-updated',
    });
    return;
  }
  const today = todayIso();
  const days = daysBetween(lastUpdated, today);
  if (days <= PROGRESS_STALE_DAYS) return;

  // Stale by date alone; only block if commits have happened since.
  // Skips silently on git failure (test fixtures without a git repo, etc.) —
  // the goal is to gate real CI runs, not flake on tempdirs.
  let commitsSince;
  try {
    const out = execSync(`git rev-list --count --since="${lastUpdated}T00:00:00" HEAD`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT_DIR,
    });
    commitsSince = parseInt(out.trim(), 10) || 0;
  } catch {
    return;
  }
  if (commitsSince === 0) return;

  pushError({
    category: 'progress-stale',
    file: PROGRESS_PATH,
    message:
      `progress.md is ${days} days stale (last-updated: ${lastUpdated}) with ` +
      `${commitsSince} commit(s) since. Bump it via /log followup or /done, ` +
      `or update last-updated to today after a manual review.`,
    target: lastUpdated,
  });
}

function checkSignalsSchema() {
  if (!fs.existsSync(SIGNALS_PATH)) return;
  const content = fs.readFileSync(SIGNALS_PATH, 'utf8');
  const lines = content.split(/\r?\n/);

  let inCodeFence = false;
  let currentSlug = null;
  let currentStartLine = 0;
  let currentBullets = {};

  function finalize() {
    if (!currentSlug) return;
    for (const required of SIGNALS_REQUIRED_BULLETS) {
      if (!(required in currentBullets)) {
        pushError({
          category: 'signals-schema-invalid',
          file: SIGNALS_PATH,
          message:
            `signals row "${currentSlug}" (line ${currentStartLine + 1}) is ` +
            `missing required bullet \`**${required}**\``,
          target: currentSlug,
        });
      }
    }
    if ('status' in currentBullets && !SIGNALS_VALID_STATUSES.includes(currentBullets.status)) {
      pushError({
        category: 'signals-schema-invalid',
        file: SIGNALS_PATH,
        message:
          `signals row "${currentSlug}" has invalid status "${currentBullets.status}" — ` +
          `must be one of: ${SIGNALS_VALID_STATUSES.join(', ')}`,
        target: currentSlug,
      });
    }
    if ('last_checked' in currentBullets && !ISO_DATE_RE.test(currentBullets.last_checked)) {
      pushError({
        category: 'signals-schema-invalid',
        file: SIGNALS_PATH,
        message:
          `signals row "${currentSlug}" has invalid last_checked ` +
          `"${currentBullets.last_checked}" — must be ISO YYYY-MM-DD`,
        target: currentSlug,
      });
    }
    if ('staleness_days' in currentBullets) {
      const n = Number(currentBullets.staleness_days);
      if (!Number.isInteger(n) || n <= 0) {
        pushError({
          category: 'signals-schema-invalid',
          file: SIGNALS_PATH,
          message:
            `signals row "${currentSlug}" has invalid staleness_days ` +
            `"${currentBullets.staleness_days}" — must be a positive integer`,
          target: currentSlug,
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    // H2 boundary closes any active row
    if (/^##\s+/.test(line)) {
      finalize();
      currentSlug = null;
      currentBullets = {};
      continue;
    }

    // H3 starts a new row: ### <slug>: <label>
    const h3 = line.match(/^###\s+([a-z0-9][a-z0-9-]*)\s*:/);
    if (h3) {
      finalize();
      currentSlug = h3[1];
      currentBullets = {};
      currentStartLine = i;
      continue;
    }

    if (!currentSlug) continue;

    // Bullet: - **key**: value
    const bullet = line.match(/^-\s+\*\*([a-z_]+)\*\*:\s*(.+?)\s*$/);
    if (bullet) {
      currentBullets[bullet[1]] = bullet[2];
    }
  }
  finalize();
}

function checkDirOfMds(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f))
    .sort();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relatedCount = checkRelatedFiles(file, content);
    const linkCount = checkBodyLinks(file, content);
    const anchorCount = checkAnchorRefs(file, content);
    filesChecked++;
    if (VERBOSE) {
      console.log(
        `  ${path.relative(ROOT_DIR, file)} — ${relatedCount} related, ${linkCount} links, ${anchorCount} anchors`,
      );
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
  const anchorCount = checkAnchorRefs(DECISIONS_PATH, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(
      `  ${path.relative(ROOT_DIR, DECISIONS_PATH)} — ${linkCount} links, ${anchorCount} anchors`,
    );
  }
}

// Progress journal — body links + tech-debt anchor refs. Schema gate runs
// post-loop in checkProgressStaleness().
if (fs.existsSync(PROGRESS_PATH)) {
  const content = fs.readFileSync(PROGRESS_PATH, 'utf8');
  const linkCount = checkBodyLinks(PROGRESS_PATH, content);
  const anchorCount = checkAnchorRefs(PROGRESS_PATH, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(
      `  ${path.relative(ROOT_DIR, PROGRESS_PATH)} — ${linkCount} links, ${anchorCount} anchors`,
    );
  }
}

// Signals backlog — same. Schema gate runs post-loop in checkSignalsSchema().
if (fs.existsSync(SIGNALS_PATH)) {
  const content = fs.readFileSync(SIGNALS_PATH, 'utf8');
  const linkCount = checkBodyLinks(SIGNALS_PATH, content);
  const anchorCount = checkAnchorRefs(SIGNALS_PATH, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(
      `  ${path.relative(ROOT_DIR, SIGNALS_PATH)} — ${linkCount} links, ${anchorCount} anchors`,
    );
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
  const anchorCount = checkAnchorRefs(file, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(`  ${path.relative(ROOT_DIR, file)} — ${linkCount} links, ${anchorCount} anchors`);
  }
}

// BSC convention plugin sources — their JSDoc headers + diagnostic strings
// frequently cite tech-debt slugs (the plugins enforce conventions documented
// there). These are .cjs, not .md, but the slug-ref regex doesn't care.
function findPluginScripts() {
  const pluginsDir = path.join(SCRIPTS_DIR, 'bsc-plugins');
  if (!fs.existsSync(pluginsDir)) return [];
  return fs
    .readdirSync(pluginsDir)
    .filter((f) => f.endsWith('.cjs'))
    .map((f) => path.join(pluginsDir, f))
    .sort();
}

for (const file of findPluginScripts()) {
  const content = fs.readFileSync(file, 'utf8');
  const anchorCount = checkAnchorRefs(file, content);
  filesChecked++;
  if (VERBOSE) {
    console.log(`  ${path.relative(ROOT_DIR, file)} — ${anchorCount} anchors`);
  }
}

// Post-loop journal-system checks. These don't iterate files (they target
// specific paths) so they run after the per-file scan so their errors
// participate in the same accumulator.
checkProgressStaleness();
checkSignalsSchema();

if (JSON_MODE) {
  // Single-line JSON to stdout regardless of pass/fail. Exit code carries
  // the pass/fail signal so a consumer can pipe + check in one shot.
  process.stdout.write(
    JSON.stringify({
      filesChecked,
      errorsCount: errors.length,
      errors,
    }) + '\n',
  );
  process.exit(errors.length > 0 ? 1 : 0);
}

if (errors.length > 0) {
  console.error(`docs:check found ${errors.length} broken reference(s):\n`);
  for (const err of errors) console.error(`  ${formatError(err)}`);
  console.error('');
  process.exit(1);
}

console.log(`docs:check: ${filesChecked} file(s) clean`);
process.exit(0);
