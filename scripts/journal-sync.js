// scripts/journal-sync.js — Mechanical post-merge edits to docs/progress.md.
//
// The "ship side" of the four-pillar journal automation. Called by
// .github/workflows/journal-sync.yml after a PR merges to main. Handles only
// the deterministic mechanical edits — judgment-bearing entries (decisions,
// tech-debt, followups) stay on the user-driven /pr → /log path.
//
// What it does:
//   1. Prepends "- YYYY-MM-DD — <pr-title>" to ## Recently shipped.
//   2. Clears ## Currently running when its text overlaps the PR title
//      (>=2 shared content tokens). Otherwise leaves the cursor alone.
//   3. Bumps frontmatter last-updated: to today.
//   4. Prunes ## Recently shipped bullets older than the retention window
//      (RECENTLY_SHIPPED_PRUNE_DAYS) — so the section stays bounded without a
//      manual /catchup sweep.
//
// What it skips (exit 0, prints "skipped: <reason>"):
//   - PRs labeled dependencies / documentation / ci / automated
//   - PRs whose title matches Renovate / Dependabot / Weblate patterns
//   - PRs authored by app/dependabot, app/renovate, jellyrock[bot]
//   - When today's date already has a Recently shipped bullet whose text
//     overlaps the PR title (idempotency for re-runs)
//
// Why a shared script and not inline workflow shell:
//   - Same logic is testable via vitest fixtures (offline, hermetic).
//   - Future callers (a /done-running fallback, a manual re-sync command)
//     get the exact same edit semantics.
//
// Capture-discipline rule note: this script is the SOLE non-skill writer to
// docs/progress.md, sanctioned by .github/workflows/journal-sync.yml. Agents
// still must NOT use Write/Edit on progress.md directly; the rule's intent
// is to protect against agent text-corruption, and CI mechanical edits are
// out-of-scope of that risk.
//
// Usage:
//   node scripts/journal-sync.js ship --pr-title "<title>" \
//                                     [--pr-labels "a,b,c"] \
//                                     [--pr-author "@user"] \
//                                     [--repo-root <path>] \
//                                     [--dry-run]
//
// Exit codes:
//   0  always (skipped or wrote — both are success). Errors print to stderr.
//   2  malformed args / missing required input.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify } from './lint/dictionary-audit.cjs';

const STOPWORDS = new Set([
  // English filler
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
  // Conventional-commit prefixes & cruft (lowercased after prefix-strip)
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
  // Project-specific filler
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
]);

// PR labels that mean "don't add a Recently shipped bullet" — these are
// either auto-generated (Renovate/dependabot) or non-feature noise that
// would clutter the cursor.
const SKIP_LABELS = new Set([
  'dependencies',
  'documentation',
  'docs-only',
  'ci',
  'automated',
  'chore-only',
]);

// Authors whose PRs never get a Recently shipped bullet.
const SKIP_AUTHOR_PATTERNS = [
  /^app\/dependabot/i,
  /^app\/renovate/i,
  /^app\/jellyrock/i,
  /^dependabot(\[bot\])?$/i,
  /^renovate(\[bot\])?$/i,
  /^jellyrock(\[bot\])?$/i,
];

// PR titles that look auto-generated.
const SKIP_TITLE_PATTERNS = [
  /^chore\(deps[):]/i,
  /^chore:?\s*\(deps\)/i,
  /^build\(deps[):]/i,
  /^chore:\s*bump\b/i,
  /^chore:?\s*sync\b.*weblate/i,
  /\btranslations? from weblate\b/i,
  /^renovate\b/i,
  /^update dependency\b/i,
];

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (testable without filesystem)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Tokenize a PR title or cursor paragraph into content words. Lowercases,
 * strips Conventional-commit prefix `feat(scope):`, drops punctuation,
 * splits on whitespace, removes stopwords + numerals + 1-2 char tokens.
 */
export function tokenize(text) {
  if (!text) return new Set();
  let s = String(text).toLowerCase();
  // Strip leading conventional-commit prefix `type(scope):` / `type:` so the
  // scope doesn't drown out the actual subject.
  s = s.replace(/^[a-z]+(\([^)]*\))?\s*:\s*/, '');
  // Drop backticks, code fences, common punctuation.
  s = s.replace(/[`*_~"'.,;:!?(){}[\]<>]/g, ' ');
  // Slashes/hyphens become spaces so feat/skills-and-agents → words.
  s = s.replace(/[/-]/g, ' ');
  const tokens = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Count overlapping tokens between two strings. Used to decide whether a
 * PR title represents the same work as the Currently-running cursor.
 */
export function tokenOverlap(a, b) {
  const sa = tokenize(a);
  const sb = tokenize(b);
  let n = 0;
  for (const t of sa) if (sb.has(t)) n++;
  return n;
}

/**
 * Extract the body paragraph between "## Currently running" and the next
 * "## " heading. Returns the trimmed paragraph (single-line collapsed) or
 * '' when empty.
 *
 * The `[^\n]*\n` after the heading matches only the rest of the heading
 * line (always empty in practice) — using `\s*\n` instead would let the
 * engine swallow body whitespace via greedy `\s*`.
 */
export function extractCurrentlyRunning(content) {
  const m = content.match(/##\s+Currently running[^\n]*\n([\s\S]*?)(?=\n##\s|$)/);
  if (!m) return '';
  return m[1].trim().replace(/\s+/g, ' ');
}

/**
 * Decide whether a ship action should be skipped. Pure function over inputs;
 * returns null when the action should proceed, or a string reason when it
 * should skip.
 */
export function shouldSkip({ prTitle, prLabels = [], prAuthor = '' }) {
  if (!prTitle || !prTitle.trim()) {
    return 'empty pr-title';
  }
  for (const label of prLabels) {
    if (SKIP_LABELS.has(String(label).toLowerCase())) {
      return `label "${label}" is in skip set`;
    }
  }
  for (const pat of SKIP_AUTHOR_PATTERNS) {
    if (pat.test(prAuthor)) {
      return `author "${prAuthor}" matches bot pattern`;
    }
  }
  for (const pat of SKIP_TITLE_PATTERNS) {
    if (pat.test(prTitle)) {
      return `title matches auto-generated pattern ${pat}`;
    }
  }
  return null;
}

/**
 * Apply the mechanical edits to a progress.md content string. Pure — does
 * not touch the filesystem. Returns the new content + a metadata object
 * describing what changed. When idempotent (today's bullet already lists
 * an overlapping title), returns the input unchanged with `idempotent: true`.
 */
export function applyShipEdit(content, { prTitle, today }) {
  if (!content) {
    throw new Error('progress.md content is empty — refusing to write blind');
  }

  // Idempotency check: scan Recently shipped section for a bullet dated
  // today whose text contains the PR title verbatim (case-insensitive
  // substring). Substring is the right semantic for re-run detection —
  // token overlap is for the fuzzier cursor-clear decision below.
  const recentMatch = content.match(/##\s+Recently shipped[^\n]*\n([\s\S]*?)(?=\n##\s|$)/);
  if (recentMatch) {
    const titleLc = prTitle.toLowerCase().trim();
    const todayBullets = recentMatch[1].split(/\r?\n/).filter((l) => l.startsWith(`- ${today}`));
    for (const bullet of todayBullets) {
      if (bullet.toLowerCase().includes(titleLc)) {
        return { content, changed: false, idempotent: true, reason: 'duplicate' };
      }
    }
  }

  // Cursor-clear decision: token overlap >= 2 between cursor body and PR
  // title means the running work is what just shipped. Otherwise the
  // cursor stays — user is on a different feature than the merging PR.
  const cursor = extractCurrentlyRunning(content);
  const cursorOverlap = cursor ? tokenOverlap(cursor, prTitle) : 0;
  const clearCursor = cursor !== '' && cursorOverlap >= 2;

  // 1. Prepend Recently shipped bullet. Match the heading + the optional
  //    intro paragraph (e.g. "Newest first...") so the new bullet lands
  //    BELOW the intro, not above it. Falls back to inserting right after
  //    the heading when there's no intro.
  let next = content.replace(
    /(##\s+Recently shipped[^\n]*\n\n(?:Newest first[^\n]*\n\n)?)/,
    (_match, header) => `${header}- ${today} — ${prTitle}\n`,
  );
  if (next === content) {
    next = next.replace(
      /(##\s+Recently shipped[^\n]*\n)/,
      (_match, header) => `${header}\n- ${today} — ${prTitle}\n`,
    );
  }

  // 2. Clear Currently running if appropriate. `[^\n]*\n` after the heading
  //    avoids the `\s*\n` greedy-swallow trap (which would consume the
  //    body's leading newlines and leave the body unmatched).
  if (clearCursor) {
    next = next.replace(
      /(##\s+Currently running[^\n]*\n)([\s\S]*?)(?=\n##\s)/,
      (_match, header) => `${header}\n`,
    );
  }

  // 3. Bump frontmatter last-updated.
  next = next.replace(/^(---\s*\nlast-updated:\s*)\d{4}-\d{2}-\d{2}/, `$1${today}`);

  // 4. Prune Recently shipped bullets older than the retention window. This runs
  //    in the same post-merge commit that prepends the new bullet, so the section
  //    stays bounded automatically instead of relying on a manual /catchup sweep.
  //    The just-prepended bullet is dated `today`, so it is always retained.
  next = pruneRecentlyShipped(next, today, RECENTLY_SHIPPED_PRUNE_DAYS);

  return {
    content: next,
    changed: true,
    idempotent: false,
    cursorCleared: clearCursor,
    cursorOverlap,
  };
}

// Retention window for the "Recently shipped" list. Bullets older than this are
// pruned by applyShipEdit (post-merge). ~2 weeks keeps the section a useful
// "what shipped lately" glance without unbounded growth.
const RECENTLY_SHIPPED_PRUNE_DAYS = 14;

// Returns the ISO date (YYYY-MM-DD) `days` before `isoDate`.
function isoDaysBefore(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Removes "- YYYY-MM-DD — …" bullets older than `maxAgeDays` from the Recently
// shipped section ONLY. Scoped by the section regex so dated bullets elsewhere
// (e.g. Open followups) are untouched. ISO dates compare lexically = chrono, so
// a string >= is a correct date comparison. Non-bullet lines (heading intro,
// blanks) and bullets within the window are kept verbatim. Exported for tests.
export function pruneRecentlyShipped(content, today, maxAgeDays) {
  const cutoff = isoDaysBefore(today, maxAgeDays);
  return content.replace(
    /(##\s+Recently shipped[^\n]*\n)([\s\S]*?)(?=\n##\s|$)/,
    (_match, header, body) => {
      const kept = body
        .split('\n')
        .filter((line) => {
          const m = line.match(/^- (\d{4}-\d{2}-\d{2}) /);
          return !m || m[1] >= cutoff;
        })
        .join('\n');
      return header + kept;
    },
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Dictionary check — keep PR-title-derived words from landing in progress.md
// without first being added to dictionary.txt. The PR-time precheck workflow
// runs `check`, and `ship` runs the same check as a safety net before write.
// ──────────────────────────────────────────────────────────────────────────

// Same plugin set and dictionary path as `npm run lint:spelling`. Keeping them
// in sync is load-bearing — if the bullet passes here, it must pass the lint
// on the next PR that touches a .md file.
const SPELL_PLUGINS = [
  'spell',
  'indefinite-article',
  'repeated-words',
  'syntax-mentions',
  'syntax-urls',
  'frontmatter',
];

// Resolve spellchecker-cli's binary from THIS script's own node_modules so
// runs against a fixture repo (test or CI checkout of a different working
// tree) still find the tool. The `dictionary.txt` location stays governed by
// the caller's `repoRoot` — different concern, different source.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SPELLCHECKER_BIN = resolve(SCRIPT_DIR, '..', 'node_modules', '.bin', 'spellchecker');

/**
 * Default runner: spawns spellchecker-cli against a temp file holding the
 * candidate content. When the binary isn't present (e.g., a test fixture
 * without an `npm install`), returns `{ ok: true, output: 'skipped: ...' }`
 * — production runs always have it installed (the workflow `npm ci`s).
 * Injectable via `runner` on checkBulletAgainstDictionary so unit tests can
 * short-circuit the spawn explicitly.
 */
export function defaultSpellRunner(content, repoRoot) {
  if (!existsSync(SPELLCHECKER_BIN)) {
    return {
      ok: true,
      output: `skipped: spellchecker binary not found at ${SPELLCHECKER_BIN}`,
    };
  }
  const dictPath = join(repoRoot, 'dictionary.txt');
  if (!existsSync(dictPath)) {
    return {
      ok: true,
      output: `skipped: ${dictPath} not present (test fixture or fresh checkout)`,
    };
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'journal-sync-spell-'));
  const tmpFile = join(tmpDir, 'candidate.md');
  try {
    writeFileSync(tmpFile, content);
    const res = spawnSync(
      SPELLCHECKER_BIN,
      ['-d', join(repoRoot, 'dictionary.txt'), '-p', ...SPELL_PLUGINS, '--files', tmpFile],
      { encoding: 'utf8' },
    );
    return { ok: res.status === 0, output: (res.stdout || '') + (res.stderr || '') };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Build the candidate progress.md bullet from a PR title and run it through
 * the spell runner. Returns `{ ok, output }` — `ok: true` means the bullet
 * would lint cleanly. Pure over its `runner` arg.
 */
export function checkBulletAgainstDictionary({ today, prTitle, repoRoot, runner }) {
  const bullet = `- ${today} — ${prTitle}\n`;
  return runner(bullet, repoRoot);
}

/**
 * Pull the flagged words out of spellchecker output. Each violation line looks
 * like: `… warning Unexpected unknown word `JRPlaceholder` jrplaceholder …`.
 * The offending word is the one wrapped in backticks. Deduplicated, order
 * preserved.
 */
export function extractFlaggedWords(output) {
  const seen = new Set();
  const words = [];
  const re = /Unexpected unknown word `([^`]+)`/g;
  let m;
  while ((m = re.exec(output || '')) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      words.push(m[1]);
    }
  }
  return words;
}

// ──────────────────────────────────────────────────────────────────────────
// CLI shell
// ──────────────────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out[a.slice(2)] = argv[++i];
      } else {
        out[a.slice(2)] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function shipCommand(args) {
  const prTitle = args['pr-title'];
  const prLabels = (args['pr-labels'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const prAuthor = args['pr-author'] || '';
  const repoRoot = resolve(args['repo-root'] || process.cwd());
  const dryRun = Boolean(args['dry-run']);

  if (!prTitle) {
    console.error('error: --pr-title is required');
    process.exit(2);
  }

  const skipReason = shouldSkip({ prTitle, prLabels, prAuthor });
  if (skipReason) {
    console.log(`skipped: ${skipReason}`);
    process.exit(0);
  }

  const progressPath = join(repoRoot, 'docs/progress.md');
  if (!existsSync(progressPath)) {
    console.error(`error: ${progressPath} not found`);
    process.exit(2);
  }

  const before = readFileSync(progressPath, 'utf8');
  const result = applyShipEdit(before, { prTitle, today: todayIso() });

  if (result.idempotent) {
    console.log(`skipped: ${result.reason} (today's bullet already covers this PR)`);
    process.exit(0);
  }

  if (dryRun) {
    process.stdout.write(result.content);
    console.error(
      `dry-run: would write progress.md (cursorCleared=${result.cursorCleared}, overlap=${result.cursorOverlap})`,
    );
    process.exit(0);
  }

  // Safety net — the PR-time precheck workflow should have caught a dirty
  // title before merge. If we reach this point with one (admin bypass,
  // mid-merge label flip), refuse to corrupt progress.md.
  const spell = checkBulletAgainstDictionary({
    today: todayIso(),
    prTitle,
    repoRoot,
    runner: defaultSpellRunner,
  });
  if (!spell.ok) {
    console.error(
      'refusing to write progress.md: PR title would introduce un-dictionarized word(s).',
    );
    console.error(spell.output);
    console.error(
      'Add the missing word(s) to dictionary.txt (alphabetically) and re-run this workflow.',
    );
    process.exit(3);
  }

  writeFileSync(progressPath, result.content);
  console.log(
    `shipped: ${prTitle} (cursorCleared=${result.cursorCleared}, overlap=${result.cursorOverlap})`,
  );
  process.exit(0);
}

function checkCommand(args) {
  const prTitle = args['pr-title'];
  const prLabels = (args['pr-labels'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const prAuthor = args['pr-author'] || '';
  const repoRoot = resolve(args['repo-root'] || process.cwd());

  if (!prTitle) {
    console.error('error: --pr-title is required');
    process.exit(2);
  }

  const skipReason = shouldSkip({ prTitle, prLabels, prAuthor });
  if (skipReason) {
    console.log(`check skipped: ${skipReason} (no progress.md write would happen)`);
    process.exit(0);
  }

  const spell = checkBulletAgainstDictionary({
    today: todayIso(),
    prTitle,
    repoRoot,
    runner: defaultSpellRunner,
  });
  if (spell.ok) {
    console.log('check passed: PR title would write cleanly to docs/progress.md');
    process.exit(0);
  }

  console.error(
    'PR title would introduce un-dictionarized word(s) into docs/progress.md after merge:',
  );
  console.error(spell.output);

  // Distinguish real-word typos (fixable via dictionary.txt) from code
  // identifiers (PascalCase class/component names etc.). Adding an identifier
  // to dictionary.txt would pass THIS check but then fail `lint:dictionary`,
  // whose dictionary-audit rejects identifier-shaped entries — a dead end.
  // For those the fix is to BACKTICK them in the PR title: the spellchecker
  // skips backticked tokens and the title renders as code when the post-merge
  // sync writes it into docs/progress.md. Rephrasing to drop the reference is a
  // fallback, not the goal. Reuse the audit's own `classify` so the two gates
  // can't drift on what counts as identifier-shaped.
  const flagged = extractFlaggedWords(spell.output);
  const identifierShaped = flagged.filter((w) => classify(w) !== null);

  console.error('Fix one of:');
  if (identifierShaped.length > 0) {
    const backticked = identifierShaped.map((w) => '`' + w + '`').join(', ');
    console.error(
      `  1. Backtick them in the PR title: ${backticked}. ` +
        'They are code identifiers (class/component/file names); backticking lets ' +
        'the spellchecker skip them and renders them as code in docs/progress.md. ' +
        'Keep the reference — do NOT rephrase the title to remove it.',
    );
    console.error(
      '  2. (Fallback) rephrase the title to avoid them. Do not add them to ' +
        'dictionary.txt — `lint:dictionary` rejects identifier-shaped entries.',
    );
    const realWords = flagged.filter((w) => classify(w) === null);
    if (realWords.length > 0) {
      console.error(
        `  3. For the non-identifier word(s) (${realWords.join(', ')}), either ` +
          'rephrase or add them to dictionary.txt alphabetically.',
      );
    }
  } else {
    console.error('  1. Add the missing word(s) to dictionary.txt alphabetically.');
    console.error('  2. Rephrase the PR title to avoid those words.');
  }
  process.exit(1);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (cmd === 'ship') {
    shipCommand(args);
    return;
  }
  if (cmd === 'check') {
    checkCommand(args);
    return;
  }
  console.error(
    'usage:\n' +
      '  node scripts/journal-sync.js ship  --pr-title "<title>" [--pr-labels a,b] [--pr-author "@user"] [--repo-root <path>] [--dry-run]\n' +
      '  node scripts/journal-sync.js check --pr-title "<title>" [--pr-labels a,b] [--pr-author "@user"] [--repo-root <path>]',
  );
  process.exit(2);
}

// ESM "are we the entrypoint" check.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
