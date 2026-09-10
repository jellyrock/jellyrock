// End-of-turn reminder script.
//
// Tool-agnostic. Designed to be invoked from agent harness end-of-session
// hooks (Claude Code `Stop`, opencode `sessionEnd`, Copilot `sessionEnd`).
//
// What it does: compares the current branch's diff against its base,
// cross-references each touched file against the `related-files:`
// frontmatter of every architecture doc and dev guide, and emits a
// reminder for each match where the doc itself wasn't also touched.
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
// Why dev guides are covered here but NOT by `docs-stale-blocking.cjs`:
// this reminder is the only freshness pressure `docs/dev/` gets, and a
// how-to that documents a moved path breaks the reader immediately — but
// it does so without changing any subsystem's shape, so it must never
// block a PR. Soft prompt here, hard gate for architecture only.
//
// A related-file shared by an architecture doc and a dev guide prints
// twice. That is intended: the two docs need different edits (shape vs.
// procedure), and a duplicate line is cheaper than a missed one.
//
// Output: reminders to stdout, one block per affected doc. Exit code is
// always 0 (informational). If you need a non-zero exit for a particular
// harness, wrap with a shell script.
//
// Usage:
//   node scripts/lint/check-touched-related-files.cjs
//   node scripts/lint/check-touched-related-files.cjs --base main
//   node scripts/lint/check-touched-related-files.cjs --quiet  (no output if no matches)
//
// Env:
//   BASE_REF — default base ref (set by harness wrappers if available)

'use strict';

const fs = require('fs');
const path = require('path');
const { readFrontmatter, parseRelatedFiles, pathMatches } = require('../lib/frontmatter.cjs');
const { changedFiles } = require('../lib/changed-files.cjs');

const args = process.argv.slice(2);

const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const BASE_REF = flagValue('--base') || process.env.BASE_REF || 'main';
const QUIET = args.includes('--quiet');

const ROOT_DIR = '.';
const ARCH_DIR = path.join(ROOT_DIR, 'docs/architecture');
const DEV_DIR = path.join(ROOT_DIR, 'docs/dev');

function collectDocsIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => path.join(dir, f))
    .sort();
}

// Architecture first so the PR-gated docs lead the reminder list.
function collectDocs() {
  return [...collectDocsIn(ARCH_DIR), ...collectDocsIn(DEV_DIR)];
}

const touched = changedFiles(BASE_REF);
const docs = collectDocs();
const reminders = [];

for (const docPath of docs) {
  const content = fs.readFileSync(docPath, 'utf8');
  const fm = readFrontmatter(content);
  const related = parseRelatedFiles(fm);
  if (related.length === 0) continue;

  const docRel = path.relative(ROOT_DIR, docPath);
  if (touched.includes(docRel)) continue; // doc was updated — no reminder needed

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
    console.log('check-touched-related-files: no docs need attention.');
  }
  process.exit(0);
}

console.log('');
console.log('📚 Doc reminder');
console.log('');
console.log(`This session touched files in ${reminders.length} doc(s)' related-files.`);
console.log(`Before you finish, re-read each doc and decide:`);
console.log(
  `  - If the change altered the subsystem's shape or why → update the doc + bump last-reviewed.`,
);
console.log(`  - If shape/why is unchanged → no action needed (the doc is still accurate).`);
console.log('');

for (const r of reminders) {
  // Architecture docs are additionally PR-gated at 120 days
  // (docs-stale-blocking.cjs); dev guides are informational only. Labelling
  // says which reminders can later turn into a blocked PR.
  const gated = r.doc.startsWith('docs/architecture/');
  console.log(`  ${r.doc}${gated ? '' : '  (dev guide — informational)'}`);
  for (const h of r.hits) {
    console.log(`    ← touched: ${h.touched}`);
  }
  console.log('');
}

process.exit(0);
