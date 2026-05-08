// scripts/lint/progress-cursor-nudge.cjs — Advisory nudge for stale
// docs/progress.md state. Two checks, both informational:
//
//   1. last-updated staleness — same threshold as docs-check.cjs's
//      `progress-stale` category (>7 days AND commits since).
//   2. Currently-running cursor likely-shipped — when the cursor's
//      content tokens appear in 2+ recent commit subjects on the current
//      branch, the work it tracks probably already merged.
//
// Always exits 0. Hard enforcement is the lint:docs progress-stale rule
// that fails CI on stale + commits-since. This nudge fires earlier
// (Stop hook + pre-push) so the user can fix it before push time.
//
// Why a separate script and not in docs-check.cjs:
//   - docs-check.cjs is a pure validator (returns categorized findings).
//     This one prints prose advisories with action hints. Different shape.
//   - The cursor-shipped heuristic is fuzzy (token overlap); appropriate
//     for advisory but inappropriate for a CI gate.
//
// Usage:
//   node scripts/lint/progress-cursor-nudge.cjs            # full output
//   node scripts/lint/progress-cursor-nudge.cjs --quiet    # suppress when nothing to nudge

'use strict';

const { execSync } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PROGRESS_PATH = join(REPO_ROOT, 'docs/progress.md');

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
  'when',
  'where',
  'which',
  'while',
  'whom',
  'why',
  'how',
  'than',
  'then',
  'them',
  'they',
  'their',
  'feat',
  'fix',
  'chore',
  'docs',
  'doc',
  'refactor',
  'build',
  'ci',
  'test',
  'perf',
  'style',
  'revert',
  'jellyrock',
  'jellyfin',
  'roku',
  'add',
  'adds',
  'added',
  'update',
  'updates',
  'updated',
  'remove',
  'removes',
  'removed',
  'use',
  'uses',
  'using',
  'make',
  'makes',
  'made',
  'branch',
  'pattern',
]);

function safeExec(cmd) {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(isoA, isoB) {
  const a = Date.UTC(
    ...isoA
      .split('-')
      .map(Number)
      .map((n, i) => (i === 1 ? n - 1 : n)),
  );
  const b = Date.UTC(
    ...isoB
      .split('-')
      .map(Number)
      .map((n, i) => (i === 1 ? n - 1 : n)),
  );
  return Math.floor((b - a) / 86_400_000);
}

function tokenize(text) {
  if (!text) return new Set();
  let s = String(text).toLowerCase();
  s = s.replace(/^[a-z]+(\([^)]*\))?\s*:\s*/, '');
  s = s.replace(/[`*_~"'.,;:!?(){}[\]<>]/g, ' ');
  s = s.replace(/[/-]/g, ' ');
  return new Set(
    s
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => t.length >= 3)
      .filter((t) => !/^\d+$/.test(t))
      .filter((t) => !STOPWORDS.has(t)),
  );
}

function readProgress() {
  if (!existsSync(PROGRESS_PATH)) return null;
  const content = readFileSync(PROGRESS_PATH, 'utf8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const lastUpdatedMatch = fmMatch && fmMatch[1].match(/^last-updated:\s*(\d{4}-\d{2}-\d{2})/m);
  const lastUpdated = lastUpdatedMatch ? lastUpdatedMatch[1] : null;

  const runningMatch = content.match(/##\s+Currently running\s*\n([\s\S]*?)(?=\n##\s|$)/);
  const cursor = runningMatch ? runningMatch[1].trim().replace(/\s+/g, ' ') : '';

  return { lastUpdated, cursor };
}

function checkStale(lastUpdated) {
  if (!lastUpdated) return null;
  const days = daysBetween(lastUpdated, todayIso());
  if (days <= 7) return null;
  const commitsSince =
    parseInt(safeExec(`git rev-list --count --since="${lastUpdated}T00:00:00" HEAD`).trim(), 10) ||
    0;
  if (commitsSince === 0) return null;
  return { days, commitsSince, lastUpdated };
}

function checkCursorShipped(cursor) {
  if (!cursor) return null;
  const cursorTokens = tokenize(cursor);
  if (cursorTokens.size === 0) return null;

  // Look at the last 10 commit subjects on the CURRENT branch (matching what
  // pre-push and Stop hook see). For start-of-branch detection, this catches
  // "cursor still says X but you've shipped Y" cleanly.
  const log = safeExec('git log -10 --format=%s');
  if (!log.trim()) return null;
  const subjects = log.split('\n').filter(Boolean);

  const matchingSubjects = [];
  for (const subj of subjects) {
    const subjTokens = tokenize(subj);
    let overlap = 0;
    for (const t of cursorTokens) if (subjTokens.has(t)) overlap++;
    if (overlap >= 2) matchingSubjects.push({ subj, overlap });
  }

  if (matchingSubjects.length >= 2) {
    return { cursor, matchingSubjects: matchingSubjects.slice(0, 3) };
  }
  return null;
}

function checkBranchReference(cursor) {
  if (!cursor) return null;
  // Cursor often quotes the working branch like "branch: `feat/foo-bar`".
  // When the cursor names a branch that's NOT the branch we're currently
  // on, the cursor is out-of-date for this work session — regardless of
  // whether the named branch still exists. Reasons it would still exist:
  // it merged but wasn't pruned; it's parked for a later session; it was
  // abandoned without deletion. In all three cases the cursor doesn't
  // reflect what we're actually doing now.
  const m = cursor.match(/branch:\s*[`'"]?([\w./-]+)[`'"]?/i);
  if (!m) return null;
  const branchInCursor = m[1];
  const currentBranch = safeExec('git rev-parse --abbrev-ref HEAD').trim();
  if (currentBranch === branchInCursor) return null;
  // Does the named branch still exist? (Affects the nudge wording.)
  const localExists = safeExec(
    `git rev-parse --verify --quiet refs/heads/${branchInCursor}`,
  ).trim();
  const remoteExists = safeExec(
    `git rev-parse --verify --quiet refs/remotes/origin/${branchInCursor}`,
  ).trim();
  return {
    branchInCursor,
    currentBranch,
    branchStillExists: Boolean(localExists || remoteExists),
  };
}

function main() {
  const quiet = process.argv.includes('--quiet');

  const progress = readProgress();
  if (!progress) {
    process.exit(0);
  }

  const stale = checkStale(progress.lastUpdated);
  const cursorShipped = checkCursorShipped(progress.cursor);
  const branchRef = checkBranchReference(progress.cursor);

  const findings = [stale, cursorShipped, branchRef].filter(Boolean);
  if (findings.length === 0) {
    process.exit(0);
  }

  if (quiet) {
    // Quiet mode still prints if there's a finding — quiet means "nothing
    // when clean", not "always silent". The Stop hook and pre-push want
    // SOME output to surface the issue.
  }

  console.log('');
  console.log('📓 progress.md nudge:');
  console.log('');

  if (stale) {
    console.log(
      `   • last-updated is ${stale.lastUpdated} (${stale.days}d ago) with ${stale.commitsSince} commit(s) since.`,
    );
    console.log(
      '     Run `/log followup` for any deferred work, or `/done <slug>` to close one that shipped.',
    );
    console.log('');
  }

  if (branchRef) {
    const stillExists = branchRef.branchStillExists
      ? ' (branch still exists; cursor still out-of-date for this session)'
      : ' (branch no longer exists)';
    console.log(
      `   • Currently running cursor references branch \`${branchRef.branchInCursor}\`; you're on \`${branchRef.currentBranch}\`${stillExists}.`,
    );
    console.log(
      '     Run `/done running` to promote the cursor to Recently shipped, or `/log running "<text>"` to set a fresh cursor for this branch.',
    );
    console.log('');
  } else if (cursorShipped) {
    console.log(
      `   • Currently running cursor overlaps with ${cursorShipped.matchingSubjects.length} recent commit subject(s):`,
    );
    for (const m of cursorShipped.matchingSubjects) {
      console.log(`       "${m.subj}" (${m.overlap} shared tokens)`);
    }
    console.log(
      '     Looks like the cursor work shipped. Run `/done running` to promote → Recently shipped.',
    );
    console.log('');
  }

  console.log(
    '   This nudge is advisory — never blocks. Mechanical close-loop on PR merge happens via .github/workflows/journal-sync.yml.',
  );
  console.log('');

  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  tokenize,
  checkStale,
  checkCursorShipped,
  checkBranchReference,
};
