// Conditional hard gate for stale documentation.
//
// `docs-stale.cjs` is the soft signal — informational list of docs whose
// `last-reviewed` frontmatter is past the threshold (90 days by default).
// This script is the *blocking* counterpart, designed to run as a required
// CI check on PRs.
//
// The design avoids the "blanket gate blocks every PR after 120 days" trap.
// A blanket gate forces the next PR opened — regardless of what it touches —
// to land the audit, which is the wrong pressure direction. Instead this
// script blocks only when:
//
//   1. A doc is stale (older than --days, default 120), AND
//   2. The PR modifies a path that's in that doc's `related-files:`, AND
//   3. The PR is NOT updating the doc itself in the same change
//
// Result: the audit cost lands on the next person to actually change the
// affected subsystem. Unrelated PRs pass freely. PRs touching the affected
// subsystem must either re-read + update the doc (bumping `last-reviewed`)
// or, if no shape/why change occurred, bump the date as part of the same PR.
//
// Threshold rationale: 120 days is past the soft signal at 90 days, giving
// a one-month grace period after the doc:stale tracker fires before the
// gate kicks in. Adjustable via --days.
//
// Usage:
//   node scripts/docs-stale-blocking.cjs              → CI mode (default base origin/main)
//   node scripts/docs-stale-blocking.cjs --days 90   → custom threshold
//   node scripts/docs-stale-blocking.cjs --base main → custom base ref
//   node scripts/docs-stale-blocking.cjs --verbose   → print pass-through reasoning
//
// Env:
//   BASE_REF  — used as default base (set by the CI workflow to the PR's base ref)
//
// Exit codes:
//   0 — no blocking violations (PR doesn't touch stale territory, or it does
//       but is updating the doc, or no docs are stale)
//   1 — at least one stale doc's territory is touched without a doc update
//   2 — internal error (git diff failed, etc.)

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const FLAG_TAKES_VALUE = new Set(['--days', '--base']);

const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const STALE_DAYS = (() => {
  const v = flagValue('--days');
  if (v === null) return 120;
  const n = Number(v);
  return Number.isFinite(n) ? n : 120;
})();
const BASE_REF = flagValue('--base') || process.env.BASE_REF || 'main';
const VERBOSE = args.includes('--verbose');

const ROOT_DIR = '.';
const ARCH_DIR = path.join(ROOT_DIR, 'docs/architecture');

// Scope: architecture docs only. Dev/how-to guides (Diátaxis terminology)
// document workflows, not subsystem shape — gating on their staleness
// creates noise for code changes that don't affect the workflow. Their
// `related-files` overlap with architecture docs (e.g., `apiPool.bs`
// appears in both `api.md` and `api-patterns.md`); blocking on the
// dev-guide variant would force a `last-reviewed` bump on an unrelated
// how-to. The soft signal in `docs:stale` continues to surface dev-guide
// staleness — that's where the pressure for those lives.

// ────────────────────────────────────────────────────────────────────
// Frontmatter parsing — kept locally to avoid a shared-helper refactor
// in this PR. If a third script needs this, extract to scripts/lib/.
// ────────────────────────────────────────────────────────────────────

function readFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : null;
}

function getLastReviewed(frontmatter) {
  if (!frontmatter) return null;
  const m = frontmatter.match(/^last-reviewed:\s*(\d{4}-\d{2}-\d{2})/m);
  return m ? m[1] : null;
}

function parseRelatedFiles(frontmatter) {
  if (!frontmatter) return [];
  if (/^related-files:\s*\[\s*\]/m.test(frontmatter)) return [];

  const lines = frontmatter.split(/\r?\n/);
  const startIdx = lines.findIndex(l => /^related-files:\s*$/.test(l));
  if (startIdx === -1) return [];

  const items = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s+-\s+(.+?)\s*$/);
    if (m) {
      items.push(m[1]);
      continue;
    }
    if (/^\S/.test(line)) break;
  }
  return items;
}

function daysBetween(isoDate, today) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  return Math.floor((t - d) / (1000 * 60 * 60 * 24));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────────────
// Diff resolution. In CI we have origin/<base> after a checkout with
// fetch-depth: 0. Locally the script falls back to origin/main if the
// configured base isn't available.
// ────────────────────────────────────────────────────────────────────

function resolveDiff(baseRef) {
  const candidates = [
    `origin/${baseRef}`,
    baseRef,
    'origin/main',
    'main'
  ];

  let diffOutput = null;
  let usedBase = null;
  for (const base of candidates) {
    try {
      const out = execSync(`git diff ${base}...HEAD --name-only`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      diffOutput = out;
      usedBase = base;
      break;
    } catch {
      // try next candidate
    }
  }

  if (diffOutput === null) {
    console.error(`docs-stale-blocking: could not resolve a base ref for the diff.`);
    console.error(`  Tried: ${candidates.join(', ')}`);
    console.error(`  Make sure the base branch is fetched (CI: actions/checkout fetch-depth: 0).`);
    process.exit(2);
  }

  return {
    base: usedBase,
    files: diffOutput.split(/\r?\n/).filter(Boolean)
  };
}

// ────────────────────────────────────────────────────────────────────
// Path matching. A `related-files:` entry can be a file or a directory;
// directory entries match any touched path under them.
// ────────────────────────────────────────────────────────────────────

function pathMatches(touched, related) {
  if (touched === related) return true;
  // Directory match: related-files entry is a real directory; touched
  // path lives under it.
  try {
    const stat = fs.statSync(related);
    if (stat.isDirectory()) {
      const prefix = related.endsWith('/') ? related : related + '/';
      return touched.startsWith(prefix);
    }
  } catch {
    // entry doesn't exist on disk — `lint:docs` will catch that separately.
    // For matching purposes, treat as exact-only.
  }
  return false;
}

function anyMatch(touchedFiles, relatedEntries) {
  for (const touched of touchedFiles) {
    for (const related of relatedEntries) {
      if (pathMatches(touched, related)) return { touched, related };
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────

function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => path.join(dir, f))
    .sort();
}

const { base, files: touchedFiles } = resolveDiff(BASE_REF);
const today = todayIso();
const allDocs = collect(ARCH_DIR);

const violations = [];
const passes = [];

for (const docPath of allDocs) {
  const content = fs.readFileSync(docPath, 'utf8');
  const fm = readFrontmatter(content);
  const date = getLastReviewed(fm);
  if (!date) continue;  // no-date docs are surfaced by docs:stale; not blocking here

  const days = daysBetween(date, today);
  if (days <= STALE_DAYS) continue;

  const related = parseRelatedFiles(fm);
  if (related.length === 0) continue;  // doc claims no specific territory

  const docRel = path.relative(ROOT_DIR, docPath);
  const docTouched = touchedFiles.includes(docRel);
  const territoryHit = anyMatch(touchedFiles, related);

  if (territoryHit && !docTouched) {
    violations.push({
      doc: docRel,
      days,
      touched: territoryHit.touched,
      related: territoryHit.related
    });
  } else if (territoryHit && docTouched && VERBOSE) {
    passes.push({ doc: docRel, days, reason: 'doc updated alongside' });
  } else if (VERBOSE) {
    passes.push({ doc: docRel, days, reason: 'PR doesn\'t touch related-files' });
  }
}

console.log(`docs-stale-blocking — threshold ${STALE_DAYS} days, base: ${base}`);
console.log(`  ${touchedFiles.length} file(s) in PR diff, ${allDocs.length} doc(s) tracked`);
console.log('');

if (VERBOSE && passes.length > 0) {
  console.log(`  Stale docs not blocking this PR:`);
  for (const p of passes) {
    console.log(`    ${p.doc}  (${p.days}d) — ${p.reason}`);
  }
  console.log('');
}

if (violations.length === 0) {
  console.log('  ✓ No stale-doc territory violations.');
  process.exit(0);
}

console.error(`  ✗ ${violations.length} stale-doc territory violation(s):`);
console.error('');
for (const v of violations) {
  console.error(`    ${v.doc}  (${v.days} days stale)`);
  console.error(`      this PR modifies: ${v.touched}`);
  console.error(`      which is in related-files as: ${v.related}`);
  console.error('');
}
console.error('  To unblock: re-read the listed doc(s) against current code.');
console.error('  - If the shape/why is unchanged, bump `last-reviewed` and commit.');
console.error('  - If shape/why changed, update the doc to match and bump `last-reviewed`.');
console.error('  Either way, include the doc edit in this PR.');
console.error('');
process.exit(1);
