/**
 * Fail a PR whose description is still a blank template.
 *
 * ## Why this is a gate rather than a review habit
 *
 * The repo merges squash-only with `squash_merge_commit_message=PR_BODY`, so a PR
 * description is not a courtesy to reviewers — it is the **permanent commit message**
 * of everything that lands on `main`. An unfilled template therefore does not produce
 * a thin PR page that someone might nag about; it produces a commit whose whole body
 * reads `-` and `[ ] None`, forever, and nothing downstream can recover what the
 * author knew at the time.
 *
 * That failure is silent by construction: the PR still merges, CI is still green, and
 * the loss only surfaces months later when someone runs `git log` against a line they
 * do not understand. A red check at PR time is the only point where it is cheap.
 *
 * ## What it does NOT do
 *
 * It does not judge prose quality, length, or whether the description is *true* — a
 * lint cannot, and pretending otherwise would make it a nuisance that gets skipped.
 * It asserts only that each section the template ships was actually answered, which
 * is the part a machine can check and the part that actually goes blank.
 *
 * ## Skips
 *
 * Reuses `shouldSkip` from `scripts/journal-sync.js` — the same predicate that decides
 * whether a PR reaches `progress.md` — so Renovate/Dependabot and
 * `dependencies`/`docs-only`/`ci`/`automated` PRs are exempt. We do not author those
 * bodies and should not gate them. Release branches are exempt for the same reason:
 * their description is assembled by the release flow, not typed by a person.
 *
 * Usage:
 *   PR_BODY="$BODY" node scripts/lint/pr-body-check.js \
 *     --pr-title "..." --pr-author "..." --pr-labels "a,b" --pr-head-ref "..."
 */
import { shouldSkip } from '../journal-sync.js';

/** Head branches whose body is generated rather than authored. */
const SKIP_HEAD_REF_PATTERNS = [/^release[-/]/i, /^renovate\//i, /^dependabot\//i];

/**
 * The template's sections and what "answered" means for each.
 *
 * `rule` is deliberately per-section: a bare `-` is a filled Overview's worth of
 * nothing under Changes, and an all-unticked checklist is the Docs section's version
 * of the same. One generic "is it non-empty" test would pass both.
 */
const SECTIONS = [
  { heading: '# Overview', rule: 'prose', want: 'a sentence describing what changed and why' },
  { heading: '## Changes', rule: 'bullets', want: 'at least one bullet with text after the "-"' },
  { heading: '## Follow-ups', rule: 'prose', want: '"None", or bullets linking a tech-debt slug' },
  { heading: '## Issues', rule: 'prose', want: '"None", or "Fixes #N" / "Ref #N"' },
  {
    heading: '## Docs / context updates',
    rule: 'checkbox',
    want: 'at least one ticked "- [x]" box',
  },
];

/** Strip HTML comments, including multi-line ones — they are prompts, not answers. */
export function stripComments(text) {
  return String(text ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * The lines belonging to `heading`, up to the NEXT HEADING OF ANY LEVEL.
 * Returns null when the heading is absent, which is itself a finding.
 *
 * "Any level" rather than the usual markdown "same or higher": the template's sections
 * are peers in intent but not in level — `# Overview` is an h1 and every other section
 * is an h2. Under the markdown rule an h2 does not close an h1, so Overview swallowed
 * the entire rest of the document and could never be reported empty (it inherited
 * whatever `Follow-ups` said). Caught by the template test below, which is the case
 * that test exists for.
 *
 * The cost of the flat rule is that a `###` subheading also closes a section, so only
 * the prose ABOVE it counts. That is harmless here — this asks whether a section was
 * answered at all, and an answer that begins with a subheading and no lead-in is not a
 * shape worth supporting.
 */
export function sectionBody(body, heading) {
  const lines = stripComments(body).split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const nextHeading = rest.findIndex((l) => /^#+\s/.test(l));
  return (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).join('\n');
}

const RULES = {
  // Any non-blank line. "None" counts — it is a real answer to Follow-ups and Issues.
  prose: (s) => s.split('\n').some((l) => l.trim().length > 0),
  // A dash followed by actual content. The template ships a bare "-", which must not pass.
  bullets: (s) => s.split('\n').some((l) => /^\s*[-*]\s+\S/.test(l)),
  // At least one ticked box. "None — this PR doesn't change any of the above" is a
  // legitimate tick, so this does not care WHICH box, only that a choice was made.
  checkbox: (s) => /^\s*[-*]\s*\[x\]/im.test(s),
};

/** @returns {string[]} human-readable problems; empty means the body is filled in. */
export function checkPrBody(body) {
  if (!String(body ?? '').trim()) {
    return [
      'the PR description is empty — it becomes the squash commit message, so it cannot be blank',
    ];
  }
  const problems = [];
  for (const { heading, rule, want } of SECTIONS) {
    const section = sectionBody(body, heading);
    if (section === null) {
      problems.push(`"${heading}" section is missing — expected ${want}`);
    } else if (!RULES[rule](section)) {
      problems.push(`"${heading}" is empty or still the template placeholder — expected ${want}`);
    }
  }
  return problems;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? '' : (process.argv[i + 1] ?? '');
}

function main() {
  const prTitle = arg('pr-title');
  const prAuthor = arg('pr-author');
  const prLabels = arg('pr-labels')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const headRef = arg('pr-head-ref');

  const skip = shouldSkip({ prTitle, prLabels, prAuthor });
  if (skip) {
    console.log(`pr-body-check: skipped — ${skip}`);
    return;
  }
  if (SKIP_HEAD_REF_PATTERNS.some((p) => p.test(headRef))) {
    console.log(`pr-body-check: skipped — head ref "${headRef}" is a generated-body branch`);
    return;
  }

  const problems = checkPrBody(process.env.PR_BODY);
  if (!problems.length) {
    console.log('pr-body-check: PR description is filled in — OK');
    return;
  }

  console.error('pr-body-check: the PR description still has unfilled sections.\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\nThis repo squash-merges with the PR description as the commit message, so these\n' +
      'blanks would land in `git log` on main permanently. Fill them in and the check\n' +
      're-runs on edit — no new push needed.\n' +
      '\nThe `/pr` skill renders a filled body from .github/pull_request_template.md.',
  );
  process.exitCode = 1;
}

// Only run when invoked directly, so the unit tests can import the pure helpers.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
