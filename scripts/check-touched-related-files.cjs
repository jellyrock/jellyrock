// End-of-turn reminder script.
//
// Tool-agnostic. Designed to be invoked from agent harness end-of-session
// hooks (Claude Code `Stop`, opencode `sessionEnd`, Copilot `sessionEnd`).
//
// What it does: compares the current branch's diff against its base,
// cross-references each touched file against the `related-files:`
// frontmatter of every architecture doc, and emits a reminder for each
// match where the architecture doc itself wasn't also touched.
//
// Why end-of-session, not on each tool call: the reminder needs to land
// at the moment the agent is deciding whether their work is done.
// Per-edit reminders would be too noisy (a multi-step refactor touches
// the same file repeatedly); end-of-session sees the full set of changes
// once.
//
// Why this is informational, not blocking:
//   - Hard enforcement is the CI gate (`docs-stale-blocking.cjs`).
//   - At the agent harness level, blocking creates a worse failure mode:
//     the agent feels forced to bump `last-reviewed` to clear the block
//     even when no real review happened, which erodes the freshness
//     signal the date is supposed to carry. A soft reminder lets the
//     agent decide; the date stays meaningful.
//
// Why architecture docs only (not docs/dev/): same reason as
// `docs-stale-blocking.cjs` — dev/how-to guides document workflows, not
// subsystem shape, so a shared related-file appearing in both shouldn't
// double-prompt.
//
// Output: reminders to stdout, one block per affected doc. Exit code is
// always 0 (informational). If you need a non-zero exit for a particular
// harness, wrap with a shell script.
//
// Usage:
//   node scripts/check-touched-related-files.cjs
//   node scripts/check-touched-related-files.cjs --base main
//   node scripts/check-touched-related-files.cjs --quiet  (no output if no matches)
//
// Env:
//   BASE_REF — default base ref (set by harness wrappers if available)

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  readFrontmatter,
  parseRelatedFiles,
  pathMatches,
} = require('./lib/frontmatter.cjs');

const args = process.argv.slice(2);

const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const BASE_REF = flagValue('--base') || process.env.BASE_REF || 'main';
const QUIET = args.includes('--quiet');

const ROOT_DIR = '.';
const ARCH_DIR = path.join(ROOT_DIR, 'docs/architecture');

// ────────────────────────────────────────────────────────────────────
// Build the set of files touched in the current session. Combines:
//   - committed changes since branch base (`git diff <base>...HEAD`)
//   - uncommitted working-tree changes (`git diff HEAD`)
// Union ensures we catch agent work whether it's been committed yet or not.
// ────────────────────────────────────────────────────────────────────

function safeDiff(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function resolveTouched() {
  const candidates = [`origin/${BASE_REF}`, BASE_REF, 'origin/main', 'main'];
  let committed = [];
  for (const base of candidates) {
    try {
      execSync(`git rev-parse --verify ${base}`, { stdio: 'ignore' });
      committed = safeDiff(`git diff ${base}...HEAD --name-only`);
      break;
    } catch {
      // ref not resolvable — try next
    }
  }
  const uncommitted = safeDiff('git diff HEAD --name-only');
  const untracked = safeDiff('git ls-files --others --exclude-standard');
  return Array.from(new Set([...committed, ...uncommitted, ...untracked]));
}

function collectArchDocs() {
  if (!fs.existsSync(ARCH_DIR)) return [];
  return fs.readdirSync(ARCH_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => path.join(ARCH_DIR, f))
    .sort();
}

const touched = resolveTouched();
const docs = collectArchDocs();
const reminders = [];

for (const docPath of docs) {
  const content = fs.readFileSync(docPath, 'utf8');
  const fm = readFrontmatter(content);
  const related = parseRelatedFiles(fm);
  if (related.length === 0) continue;

  const docRel = path.relative(ROOT_DIR, docPath);
  if (touched.includes(docRel)) continue;  // doc was updated — no reminder needed

  const hits = [];
  for (const t of touched) {
    for (const r of related) {
      if (pathMatches(t, r)) {
        hits.push({ touched: t, related: r });
      }
    }
  }
  if (hits.length === 0) continue;

  reminders.push({ doc: docRel, hits });
}

if (reminders.length === 0) {
  if (!QUIET) {
    console.log('check-touched-related-files: no architecture docs need attention.');
  }
  process.exit(0);
}

console.log('');
console.log('📚 Architecture-doc reminder');
console.log('');
console.log(`This session touched files in ${reminders.length} architecture doc(s)' related-files.`);
console.log(`Before you finish, re-read each doc and decide:`);
console.log(`  - If the change altered the subsystem's shape or why → update the doc + bump last-reviewed.`);
console.log(`  - If shape/why is unchanged → no action needed (the doc is still accurate).`);
console.log('');

for (const r of reminders) {
  console.log(`  ${r.doc}`);
  for (const h of r.hits) {
    console.log(`    ← touched: ${h.touched}`);
  }
  console.log('');
}

process.exit(0);
