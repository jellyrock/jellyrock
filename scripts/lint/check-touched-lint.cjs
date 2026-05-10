// End-of-turn lint check for agent sessions.
//
// The agent's blind spot: CLAUDE.md tells it not to run `npm run lint:*`
// manually (the IDE handles `.bs` live, the pre-push hook is the catch-all
// backstop). That rule means the agent gets *no* live feedback for lint
// categories the IDE doesn't cover — markdown, spelling, JSON. Failures
// surface only at `git push` time, after the agent has already reported
// "done." The user has to debug instead of the agent.
//
// This script closes the gap. It runs the lint categories that the IDE
// doesn't cover, *scoped to files the agent actually changed in this
// session*, and surfaces failures so the agent sees them in the next
// turn's context — in time to fix before reporting done.
//
// Why this hook is non-blocking (exit 0 always):
//   - Hard enforcement is the pre-push hook + CI workflows. They will
//     refuse the push if anything fails.
//   - At the agent harness level, blocking creates a worse failure mode:
//     the agent can't iterate cheaply on a false-positive (e.g., a
//     legitimate new technical word that needs to be added to
//     dictionary.txt). A soft surface lets the agent decide.
//   - Mirrors the design rationale of check-touched-related-files.cjs.
//
// Why scoped to changed files (not whole-repo):
//   - Speed — repo-wide spell + markdown lint takes seconds; per-file is
//     near-instant.
//   - Signal — the agent only cares about issues it caused, not pre-
//     existing repo-wide ones (those are the pre-push hook's problem).
//
// What it does NOT cover:
//   - lint:bs / validate / check-formatting — IDE handles these live.
//   - lint:docs — already covered by check-touched-related-files.cjs
//     (the architecture-doc reminder) plus the CI gate at PR time.
//   - lint:translations / lint:language-coverage — niche; only relevant
//     when locale files / a few specific BS files change. Cost of adding
//     them is low if needed later, but they'd run for almost no PRs.
//
// Output: human-readable summary to stdout. One section per failing tool.
// If there are no failures, no output (assuming --quiet).
//
// Usage:
//   node scripts/lint/check-touched-lint.cjs
//   node scripts/lint/check-touched-lint.cjs --base main
//   node scripts/lint/check-touched-lint.cjs --quiet  (no output if all pass)

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { workingTreeFiles } = require('../lib/changed-files.cjs');
const { isSpellExcluded, isMarkdownExcluded, isJsonExcluded } = require('../lib/lint-excludes.cjs');
const { classify } = require('./dictionary-audit.cjs');

const GENERIC_SPELL_HINT =
  'For a code identifier (variable, function, event name, file/path), wrap in backticks — the spell-checker skips code spans. For legitimate English vocabulary, add to `dictionary.txt`. Otherwise, rephrase. See docs/dev/code-style.md "Markdown conventions" for the rule.';

function buildSpellHint(output) {
  // Pull `Unexpected unknown word \`X\`` out of the spellchecker output and
  // run each through the dictionary-audit classifier. Words that look
  // identifier-shaped get a targeted call-out so the agent doesn't reach
  // for `dictionary.txt` and trip the dictionary-audit lint a step later.
  const wordRe = /Unexpected unknown word `([^`]+)`/g;
  const seen = new Set();
  const identifiers = [];
  for (const match of output.matchAll(wordRe)) {
    const word = match[1];
    if (seen.has(word)) continue;
    seen.add(word);
    if (classify(word)) identifiers.push(word);
  }

  if (identifiers.length === 0) return GENERIC_SPELL_HINT;

  const list = identifiers
    .slice(0, 5)
    .map((w) => `\`${w}\``)
    .join(', ');
  const more = identifiers.length > 5 ? ` (+${identifiers.length - 5} more)` : '';
  const verb = identifiers.length === 1 ? 'looks' : 'look';
  return `${list}${more} ${verb} like code identifier${identifiers.length === 1 ? '' : 's'} — wrap in backticks in the source markdown. DO NOT add to dictionary.txt; \`npm run lint:dictionary\` rejects identifier-shaped entries (PascalCase / camelCase / file extensions / paths). For real English vocabulary missing from the base dictionary, dictionary.txt is the right home; otherwise rephrase. See docs/dev/code-style.md.`;
}

const args = process.argv.slice(2);
const QUIET = args.includes('--quiet');

function binExists(name) {
  const local = path.join('node_modules', '.bin', name);
  return fs.existsSync(local);
}

function runBin(name, runArgs) {
  const local = path.join('node_modules', '.bin', name);
  const result = spawnSync(local, runArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// Working-tree-only — committed files are pre-commit's job, so this hook
// focuses on what `lint-staged` couldn't have seen yet (uncommitted work
// + untracked files). Avoids redundant work.
const touched = workingTreeFiles();

const mdFiles = touched.filter((f) => f.endsWith('.md')).filter((f) => fs.existsSync(f));

const jsonFiles = touched.filter((f) => f.endsWith('.json')).filter((f) => fs.existsSync(f));

const findings = [];

// ────────────────────────────────────────────────────────────────────
// Spell check (spellchecker-cli)
// ────────────────────────────────────────────────────────────────────

const spellTargets = mdFiles.filter((f) => !isSpellExcluded(f));

if (spellTargets.length > 0 && binExists('spellchecker')) {
  const { code, stdout, stderr } = runBin('spellchecker', [
    '-d',
    'dictionary.txt',
    '-p',
    'spell',
    'indefinite-article',
    'repeated-words',
    'syntax-mentions',
    'syntax-urls',
    'frontmatter',
    '--files',
    ...spellTargets,
  ]);
  if (code !== 0) {
    const output = (stdout + stderr).trim();
    findings.push({
      tool: 'spell',
      title: 'Spell check found unknown words in changed `.md` files',
      output,
      hint: buildSpellHint(output),
    });
  }
}

// ────────────────────────────────────────────────────────────────────
// Markdown lint (markdownlint-cli2)
// ────────────────────────────────────────────────────────────────────

const mdLintTargets = mdFiles.filter((f) => !isMarkdownExcluded(f));

if (mdLintTargets.length > 0 && binExists('markdownlint-cli2')) {
  const { code, stdout, stderr } = runBin('markdownlint-cli2', mdLintTargets);
  if (code !== 0) {
    findings.push({
      tool: 'markdown',
      title: 'Markdown lint failed on changed `.md` files',
      output: (stdout + stderr).trim(),
      hint: 'Fix the reported violations (line length, heading style, link refs, etc.) or — only if the rule is genuinely wrong for the case — add a scoped disable comment.',
    });
  }
}

// ────────────────────────────────────────────────────────────────────
// JSON lint (jshint --extra-ext .json)
// ────────────────────────────────────────────────────────────────────
//
// jshint's CLI defaults to JS files; --extra-ext lets it accept .json.
// Per-file invocation is fine — fast and avoids the package.json script's
// project-wide excludes scan.

const jsonTargets = jsonFiles.filter((f) => !isJsonExcluded(f));

if (jsonTargets.length > 0 && binExists('jshint')) {
  const { code, stdout, stderr } = runBin('jshint', [
    '--extra-ext',
    '.json',
    '--verbose',
    ...jsonTargets,
  ]);
  if (code !== 0) {
    findings.push({
      tool: 'json',
      title: 'JSON syntax check failed on changed `.json` files',
      output: (stdout + stderr).trim(),
      hint: 'Fix the syntax error at the line/column reported.',
    });
  }
}

// ────────────────────────────────────────────────────────────────────
// Output
// ────────────────────────────────────────────────────────────────────

if (findings.length === 0) {
  if (!QUIET) {
    console.log('check-touched-lint: spell / markdown / json all clean for changed files.');
  }
  process.exit(0);
}

console.log('');
console.log('🔎 Lint check on changed files');
console.log('');
console.log(`Found ${findings.length} issue group(s) before you finish your turn.`);
console.log('Pre-push will reject these — fix now while context is fresh.');
console.log('');

for (const f of findings) {
  console.log(`── ${f.title} ──`);
  console.log('');
  console.log(f.output);
  console.log('');
  console.log(`  Hint: ${f.hint}`);
  console.log('');
}

process.exit(0);
