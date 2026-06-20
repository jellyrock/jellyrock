// scripts/lint/decision-shape-nudge.cjs — Advisory pre-push reminder.
//
// Pattern-matches commit messages in the push range for "decision-shaped"
// language ("decided", "switched from", "use X instead of Y", "deprecate",
// "we now use", "replace with", etc.). If any commit matches AND no
// decision-record surface (docs/adr/ for ADR-grade, docs/decisions.md for
// sub-architectural notes) is in the diff, print a friendly nudge pointing at
// /log decision.
//
// **Always exits 0.** This is advisory — the agent-facing CLAUDE.md
// "Capture-discipline rule" provides the hard enforcement (agents are told
// they MUST invoke /log decision in the same change set). Humans see this
// nudge and decide.
//
// Why a nudge and not a hard gate: catching the false positive ("decided to
// rename this var" is not an ADR-grade decision) needs human judgment. A
// blocking gate would either over-fire on routine commits or under-fire if
// the keyword list is too narrow. Advisory keeps the cost of false positives
// at zero (a printed line) and lets the user accept or ignore.
//
// Usage (from .husky/pre-push):
//   node scripts/lint/decision-shape-nudge.cjs || true
// (the `|| true` is belt-and-suspenders — the script also exits 0 on its own)

'use strict';

const { execSync } = require('child_process');

// Decision-shape keywords. Conservative list — false positives are cheap (a
// printed line), false negatives waste an opportunity to capture a decision.
// Word boundaries (\b) prevent matches inside other tokens.
const DECISION_PATTERNS = [
  /\bdecided\b/i,
  /\bswitched\s+from\b/i,
  /\bswitched\s+to\b/i,
  /\binstead\s+of\b/i,
  /\bwe\s+now\s+use\b/i,
  /\bdeprecat(e|ed|ing)\b/i,
  /\breplace(d|s)?\s+with\b/i,
  /\bgoing\s+with\b/i,
  /\bchose\b/i,
  /\brefactor(ed)?\s+to\b/i,
];

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

function resolveRange() {
  // Override (for tests): --range=<x>
  const rangeFlag = process.argv.find((a) => a.startsWith('--range='));
  if (rangeFlag) return rangeFlag.split('=')[1];
  // Mirror .husky/pre-push: prefer @{upstream}, fall back to origin/main.
  const upstream = safeExec('git rev-parse --abbrev-ref --symbolic-full-name @{upstream}').trim();
  if (upstream) return `${upstream}..HEAD`;
  return 'origin/main..HEAD';
}

function main() {
  const range = resolveRange();

  // Commit messages (subject + body) for the range
  const log = safeExec(`git log ${range} --format=%B%n---COMMIT-BREAK---`);
  if (!log) {
    process.exit(0);
  }

  const commits = log
    .split('---COMMIT-BREAK---')
    .map((s) => s.trim())
    .filter(Boolean);

  const matched = [];
  for (const msg of commits) {
    for (const pat of DECISION_PATTERNS) {
      if (pat.test(msg)) {
        matched.push({ msg: msg.split('\n')[0].slice(0, 80), pattern: pat.source });
        break;
      }
    }
  }

  if (matched.length === 0) {
    process.exit(0);
  }

  // Did the range touch a decision-record surface? ADR-grade decisions land in
  // docs/adr/, sub-architectural notes in docs/decisions.md — either counts as
  // "already captured".
  const changed = safeExec(`git diff --name-only ${range}`).split('\n').filter(Boolean);
  if (changed.some((f) => f === 'docs/decisions.md' || f.startsWith('docs/adr/'))) {
    process.exit(0); // already captured
  }

  // Print a friendly advisory.
  console.log('');
  console.log(
    '💭 Decision-shape commit detected without a decision-record change (docs/adr/ or docs/decisions.md):',
  );
  console.log('');
  for (const m of matched.slice(0, 5)) {
    console.log(`   • "${m.msg}"  (matched: /${m.pattern}/)`);
  }
  if (matched.length > 5) {
    console.log(`   • ... + ${matched.length - 5} more`);
  }
  console.log('');
  console.log('   If this represents a decision worth keeping (closes off alternatives, has');
  console.log('   a non-obvious rationale, or a constraint worth re-evaluating), invoke');
  console.log('   `/log decision <slug>` — the agent routes it to an ADR or a sub-ADR note');
  console.log("   so the rationale isn't lost.");
  console.log('');
  console.log('   This nudge is advisory only — the push is not blocked.');
  console.log('');

  process.exit(0);
}

main();
