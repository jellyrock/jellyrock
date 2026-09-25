// scripts/lint/doc-citation-ratchet.js — anti-backslide ratchet for
// line-number citations in tracked documentation.
//
// WHY THIS EXISTS
// ---------------
// A doc that says `ItemDetails.bs:623` names a location the code can move. It
// rots on ANY edit above line 623 — not just an edit to the thing described —
// so it decays faster than any review or freshness gate can catch. Measured
// 2026-09-17 across the 14-ref sample that prompted this: `IconButton.bs:36`
// and `ItemDetails.bs:4271` pointed PAST end-of-file, and `user-journey.md`
// cited `ItemDetails.bs:206` for the `quickPlayNode` self-observer where the
// actual line reads `m.trailerCheckSeq = 0`. That doc's `last-reviewed` was the
// same day: a human re-reading the prose has no way to notice a line number
// drifted, which is exactly why the contextual doc-freshness gates (ADR 0033)
// cannot cover this class.
//
// The fix is not "keep the numbers fresh" — it is to stop storing them. Cite
// the SYMBOL instead (`ItemDetails.launchQueueItemToPlay()`), which is strictly
// better rather than merely more durable: a reader or an agent can GREP a
// symbol, and nobody can grep a line number. The full convention, including
// what to do when a number genuinely is the point, is
// `.claude/rules/derive-dont-duplicate.md`.
//
// THE METRIC
// ----------
// Occurrences of `<path>.<code-ext>:<digits>` (optionally a `-<digits>` range)
// in tracked markdown. Deliberate choices:
//   - Fenced code blocks are STRIPPED before matching. A block showing what a
//     compiler or a lint prints is tool output, not a citation, and rewriting
//     it would falsify the example.
//   - Inline code IS matched. `` `ItemDetails.bs:623` `` is the citation form
//     these docs actually use, so exempting backticks would exempt the problem.
//   - Only code extensions (bs/brs/xml/js/cjs/mjs) count. `localhost:8096` and
//     `10.11:8101` are not citations and must not trip the gate.
//
// SCOPE — tracked docs only
// -------------------------
// `docs/**` (minus `docs/projects/**`), every `CLAUDE.md` / `AGENTS.md`, and
// `.claude/**` (rules + skills). `docs/projects/**` is GITIGNORED: a project
// PLAN.md is archived or deleted the moment its work finishes, so a line ref
// there rots harmlessly and privately. The root AGENTS.md already forbids
// citing those paths from tracked content for the same reason.
//
// PER-FILE BASELINE, not one total
// --------------------------------
// The baseline is a per-file map, which is where this departs from
// `promise-ratchet.cjs`'s single integer — deliberately. The population is ~55
// refs spread over 13 files, so one global total would let a PR add three fresh
// refs to a new doc while an unrelated cleanup removed three elsewhere, and the
// gate would sit green. That is the "silently refill the slack" failure
// promise-ratchet's own advisory warns about; with a per-file map a file may
// only ever improve, and a file absent from the map is allowed ZERO.
//
// FAIL POLICY (mirrors promise-ratchet)
// -------------------------------------
//   count >  allowance → FAIL (exit 1). Net-new line citation — cite the symbol.
//   count <  allowance → PASS (exit 0) + LOUD advisory to lower the baseline, so
//                        the gain is locked in rather than left as slack.
//   count == allowance → PASS, one-line OK.
//   allowance == 0     → an automatic hard guard for that file.
//
// Draining the grandfathered 55 is tracked in issue #959; this gate stops the 56th.

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const BASELINE_REL = '.doc-citation-baseline.json';
const JSON_MODE = process.argv.includes('--json');

// A path-looking token ending in a code extension, then `:digits`, optionally a
// `-digits` range. Leading char class avoids matching mid-word.
const CITATION_RE = /[A-Za-z0-9_][A-Za-z0-9_/.-]*\.(?:bs|brs|xml|js|cjs|mjs):\d+(?:-\d+)?/g;

const SKIP_DIRS = new Set([
  'node_modules',
  'build',
  'build-analysis',
  'out',
  'tasks',
  '.git',
  '.husky',
  'roku_modules',
]);

// Ephemeral, GITIGNORED prose: a project PLAN, a triage handoff, a saved plan.
// Each is archived, pruned or deleted when its work finishes, so a line ref
// inside one rots privately and cheaply. The root AGENTS.md already forbids
// citing these paths FROM tracked content for the same reason.
const EPHEMERAL_RELS = ['docs/projects', '.claude/handoffs', '.claude/plans'];

// Append-only dated records. A skill's AUDIT-LOG entry says what a given run saw
// on a given date, so a line number in one is a historical measurement — the one
// form the rule explicitly allows (clause 3). Rewriting it would falsify the
// record rather than repair it.
const SKIP_FILES = new Set(['AUDIT-LOG.md']);

/** Blank out fenced code blocks, preserving line count so reported lines stay true. */
function stripFencedBlocks(text) {
  const lines = text.split('\n');
  let fenced = false;
  return lines
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced;
        return '';
      }
      return fenced ? '' : line;
    })
    .join('\n');
}

/** Every tracked markdown file this gate governs. */
function collectDocs(rootDir) {
  const found = [];
  function walk(dir, insideClaude) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        // `.claude` is the one dot-dir in scope; skip the rest (.github etc. hold
        // no prose this gate governs).
        if (e.name.startsWith('.') && e.name !== '.claude') continue;
        const rel = path.relative(rootDir, full).split(path.sep).join('/');
        if (EPHEMERAL_RELS.includes(rel)) continue;
        // A directory with its own `.git` (a file for a worktree, a directory for a
        // clone) is a separate checkout — `.claude/worktrees/<name>` holds a whole copy
        // of the repo — so its docs belong to its own branch's run, not this one.
        if (fs.existsSync(path.join(full, '.git'))) continue;
        walk(full, insideClaude || e.name === '.claude');
        continue;
      }
      if (!e.name.endsWith('.md') || SKIP_FILES.has(e.name)) continue;
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      const governed =
        rel.startsWith('docs/') || insideClaude || e.name === 'CLAUDE.md' || e.name === 'AGENTS.md';
      if (governed) found.push(rel);
    }
  }
  walk(rootDir, false);
  return found.sort();
}

function countCitations(relPath) {
  const text = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
  const matches = stripFencedBlocks(text).match(CITATION_RE);
  return matches ? matches : [];
}

const baselinePath = path.join(ROOT_DIR, BASELINE_REL);
let baseline = {};
if (fs.existsSync(baselinePath)) {
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (e) {
    console.error(`doc-citation-ratchet: ${BASELINE_REL} is not valid JSON — ${e.message}`);
    process.exit(1);
  }
} else {
  console.error(`doc-citation-ratchet: missing baseline file ${BASELINE_REL}`);
  process.exit(1);
}

const actual = {};
for (const rel of collectDocs(ROOT_DIR)) {
  const hits = countCitations(rel);
  if (hits.length) actual[rel] = hits;
}

const over = [];
const under = [];
for (const rel of new Set([...Object.keys(baseline), ...Object.keys(actual)])) {
  const allowed = baseline[rel] ?? 0;
  const hits = actual[rel] ?? [];
  if (hits.length > allowed)
    over.push({ file: rel, allowed, count: hits.length, samples: hits.slice(0, 4) });
  else if (hits.length < allowed) under.push({ file: rel, allowed, count: hits.length });
}

const total = Object.values(actual).reduce((n, h) => n + h.length, 0);
const allowedTotal = Object.values(baseline).reduce((n, v) => n + v, 0);

if (JSON_MODE) {
  process.stdout.write(JSON.stringify({ total, allowedTotal, over, under }) + '\n');
  process.exit(over.length > 0 ? 1 : 0);
}

if (over.length > 0) {
  console.error(
    `doc-citation-ratchet: ${over.length} file(s) gained line-number citations.\n\n` +
      `A line number rots on any edit above it. Cite the SYMBOL instead —\n` +
      `\`ItemDetails.launchQueueItemToPlay()\`, not \`ItemDetails.bs:623\` — which a\n` +
      `reader or an agent can grep. See .claude/rules/derive-dont-duplicate.md.\n`,
  );
  for (const o of over) {
    console.error(`  ${o.file}: ${o.count} (allowed ${o.allowed}) — e.g. ${o.samples.join(', ')}`);
  }
  console.error('');
  process.exit(1);
}

if (under.length > 0) {
  console.error(
    `doc-citation-ratchet: ${total} citation(s), under the baseline of ${allowedTotal}.`,
  );
  console.error(`LOWER THE BASELINE in ${BASELINE_REL} to lock the gain in:\n`);
  for (const u of under) {
    const line =
      u.count === 0
        ? `  ${u.file}: remove the entry (was ${u.allowed})`
        : `  ${u.file}: ${u.allowed} → ${u.count}`;
    console.error(line);
  }
  console.error('');
  process.exit(0);
}

console.log(
  `doc-citation-ratchet: OK — ${total} line-number citation(s) in tracked docs, at the committed baseline.`,
);
process.exit(0);
