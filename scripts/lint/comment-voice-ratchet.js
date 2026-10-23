// scripts/lint/comment-voice-ratchet.js: anti-backslide ratchet for the house voice
// (docs/dev/writing-style.md) in the COMMENTS of tracked code.
//
// Markdown is not checked here. `.claude/skills/log/voice-check.sh` holds every tracked
// Markdown file to the same voice (and to the line-number citation rule) against
// `.voice-baseline.tsv`; run it with `npm run lint:voice`.
//
// WHY THIS EXISTS
// ---------------
// Comments are read by people and agents like any doc, and a comment that makes the reader
// work costs every reader every time. The mechanical rules of the writing style guide are
// counted here, per file, so new comments start clean while old ones are reworded phase by
// phase: a ratchet forces no rewrite, it only stops new hits.
//
// THE METRIC
// ----------
// Five categories, counted in the comments of each tracked code file: em dashes, filler
// words, capitals used for emphasis, `→` outside a bold UI path, and `e.g.` / `i.e.`.
// Each file has a count per category in `.doc-voice-baseline.json`; a file absent from it
// is allowed zero. Only the comment text is read, never the code: an apostrophe or `//`
// inside a string is not a comment, so each language goes through a real parser.
//   - `.bs` / `.brs`: the BrighterScript lexer. It files comments (`'` and `REM`) as
//     leading trivia of the next token, not as tokens of their own.
//   - `.js` / `.mjs` / `.cjs`: espree with `comment: true`. A hashbang is skipped.
//     A file that does not parse stops the run, naming the file.
//   - `.yml` / `.yaml`: the `yaml` package's lexer, so a `#` inside a quoted value or
//     a URL fragment is not a comment. A document with a parse error stops the run.
//   - `.xml`: `<!-- -->` blocks, matched by regex (XML comments cannot nest).
//   - `.sh` and the extensionless hooks directly under `.husky/`: whole-line `#`
//     comments only. See `shellComments()` for why.
// Inline code and URLs are stripped. Vendored and generated code is out of scope:
// `components/vendor/`, `locale/`, `roku_modules/`, `node_modules/`, `build/` and `out/`.
// A directory with its own `.git` is a separate checkout and is skipped, and so is
// anything git ignores.
//
// FAIL POLICY (mirrors promise-ratchet)
// -------------------------------------
//   count >  allowance: FAIL (exit 1). Reword the new comment; never raise the baseline.
//   count <  allowance: PASS (exit 0) + advisory to lower the baseline, so the gain is
//                       locked in rather than left as slack.
//   count == allowance: PASS, one-line OK.
//   allowance == 0:     an automatic hard guard for that file.
//
// FLAGS
// -----
//   --lower-voice-baseline  lowers each allowance to the current count and never raises
//                           one, so a rewrite locks its gain in without hand-editing. It
//                           also drops entries for files that no longer have any hits,
//                           which is how the old per-Markdown entries leave the file.
//   --init-comment-baseline seeds the code-file entries once (creating the file when it
//                           is missing). It refuses when the file already has any, because
//                           the allowances are then a decision.
//   --json                  prints the result as JSON: `{ voice: { total, allowedTotal,
//                           over, under } }`.
// An optional first argument that does not start with `--` is the root to scan.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Lexer, TokenKind } from 'brighterscript';
import * as espree from 'espree';
import YAML from 'yaml';

// git-safe clears GIT_DIR and friends, which git sets for a hook run in a worktree.
const { git } = createRequire(import.meta.url)('../lib/git-safe.cjs');

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const JSON_MODE = process.argv.includes('--json');
const VOICE_BASELINE_REL = '.doc-voice-baseline.json';
const LOWER_VOICE = process.argv.includes('--lower-voice-baseline');
const INIT_COMMENT = process.argv.includes('--init-comment-baseline');

// The house-voice categories (docs/dev/writing-style.md). Each regex runs over comment
// text with inline code and URLs already removed; `prose-arrow` also has bold removed
// first, because a bold UI path (**Settings → Playback**) is the allowed use.
const VOICE_RULES = [
  { id: 'em-dash', re: /—/g },
  {
    id: 'filler',
    re: /\b(?:load-bearing|deliberately|genuinely|crucially|simply|just|note that)\b/gi,
  },
  { id: 'caps-emphasis', re: /(?<![\w-])(?:NOT|ONLY|NEVER|MUST|ALWAYS|EVERY)(?![\w-])/g },
  { id: 'prose-arrow', re: /→/g, withoutBold: true },
  { id: 'latin-abbrev', re: /\b(?:e\.g\.|i\.e\.)/gi },
];

// Out of scope (see the header): translated or vendored.
const VOICE_EXCLUDED_RELS = ['locale', 'components/vendor'];

const SKIP_DIRS = new Set([
  'node_modules',
  'build',
  'build-analysis',
  'out',
  '.git',
  'roku_modules',
]);

// Dot-directories the walk enters. `.husky` holds the git hooks, which are shell
// scripts without an extension; its generated `_` subdirectory is skipped below.
const DOT_DIRS_WALKED = new Set(['.claude', '.github', '.husky']);

// Code files whose comments the voice gate reads, by extension.
const CODE_EXTS = new Set(['.bs', '.brs', '.js', '.cjs', '.mjs', '.xml', '.yml', '.yaml', '.sh']);

/** The language of a code file, or null for a path the comment gate does not read. */
function codeLang(rel) {
  const ext = path.posix.extname(rel);
  if (CODE_EXTS.has(ext)) return ext.slice(1);
  // A git hook directly under .husky has no extension and is shell.
  if (path.posix.dirname(rel) === '.husky' && ext === '') return 'sh';
  return null;
}

// Ephemeral, GITIGNORED folders: a project PLAN, a triage handoff, a saved plan.
// Each is archived, pruned or deleted when its work finishes, so it is not governed.
const EPHEMERAL_RELS = ['docs/projects', '.claude/handoffs', '.claude/plans'];

// The repo-root `tasks/` is gitignored (`/tasks/`, anchored to the root). A nested
// `components/tasks/` is tracked source, so only the root one is skipped.
const ROOT_ONLY_SKIP_RELS = ['tasks'];

/**
 * The repo-relative paths git considers part of the checkout: tracked files plus
 * untracked files that are not ignored. A gitignored scratch folder (for example
 * `.claude/worktrees/<name>/` without its own `.git`) is therefore not governed,
 * which matches CI, where a clean checkout never has one. Returns null when `rootDir`
 * is not a git repository or git is missing, and the caller then walks everything.
 */
function gitVisiblePaths(rootDir) {
  let out;
  try {
    out = git(rootDir, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  } catch {
    return null;
  }
  return new Set(out.split('\0').filter(Boolean));
}

/** Every tracked code file whose comments the ratchet reads, as `{ rel }`. */
function collectCodeFiles(rootDir) {
  const found = [];
  const voiceExcluded = (rel) =>
    VOICE_EXCLUDED_RELS.some((x) => rel === x || rel.startsWith(`${x}/`));
  const visible = gitVisiblePaths(rootDir);
  function walk(dir) {
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
        // Walk only the dot-dirs in `DOT_DIRS_WALKED`; skip the rest.
        if (e.name.startsWith('.') && !DOT_DIRS_WALKED.has(e.name)) continue;
        const rel = path.relative(rootDir, full).split(path.sep).join('/');
        if (EPHEMERAL_RELS.includes(rel) || ROOT_ONLY_SKIP_RELS.includes(rel)) continue;
        if (rel === '.husky/_') continue;
        // A directory with its own `.git` (a file for a worktree, a directory for a
        // clone) is a separate checkout (`.claude/worktrees/<name>` holds a whole copy
        // of the repo), so its files belong to its own branch's run, not this one.
        if (fs.existsSync(path.join(full, '.git'))) continue;
        walk(full);
        continue;
      }
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      // Skip what git ignores. A tracked file deleted from disk is never visited.
      if (visible && !visible.has(rel)) continue;
      if (codeLang(rel) && !voiceExcluded(rel)) found.push({ rel });
    }
  }
  walk(rootDir);
  return found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Comment text only, with inline code and URLs removed. Comments hold no tables or links. */
function commentProse(text) {
  return text
    .replace(/``[^`]*``/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/https?:\/\/\S+/g, '');
}

/** Stop the run, naming the file. A file we cannot read is never silently skipped. */
function parseFailure(rel, e) {
  console.error(`comment-voice-ratchet: cannot read the comments of ${rel}: ${e.message}`);
  process.exit(2);
}

/**
 * Whole-line `#` comments only, and never a `#!` line (the shebang). A trailing `#` can
 * sit inside a string or a URL, and nothing here parses shell, so it is not counted.
 */
function shellComments(src) {
  return src
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#') && !line.startsWith('#!'));
}

/** Every comment in a code file, as a list of strings. */
function extractComments(rel, src) {
  const lang = codeLang(rel);
  try {
    switch (lang) {
      case 'bs':
      case 'brs': {
        const out = [];
        for (const token of Lexer.scan(src).tokens)
          for (const trivia of token.leadingTrivia ?? [])
            if (trivia.kind === TokenKind.Comment) out.push(trivia.text);
        return out;
      }
      case 'js':
      case 'mjs':
      case 'cjs':
        return espree
          .parse(src, {
            ecmaVersion: 'latest',
            sourceType: lang === 'cjs' ? 'script' : 'module',
            comment: true,
          })
          .comments.filter((c) => c.type !== 'Hashbang')
          .map((c) => c.value);
      case 'yml':
      case 'yaml': {
        const errors = YAML.parseDocument(src).errors;
        if (errors.length) throw errors[0];
        return [...new YAML.Lexer().lex(src)].filter((t) => t.startsWith('#'));
      }
      case 'xml':
        return [...src.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
      default:
        return shellComments(src);
    }
  } catch (e) {
    return parseFailure(rel, e);
  }
}

/** `{ category: [hits] }` for one file, only the categories with hits. */
function countVoice(relPath) {
  const text = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
  const prose = commentProse(extractComments(relPath, text).join('\n'));
  const withoutBold = prose.replace(/\*\*[^*\n]+\*\*/g, '');
  const hits = {};
  for (const rule of VOICE_RULES) {
    const found = (rule.withoutBold ? withoutBold : prose).match(rule.re);
    if (found) hits[rule.id] = found;
  }
  return hits;
}

/** Read a JSON baseline, or exit 1 with a clear message. */
function readBaseline(rel, missingHint = '') {
  const abs = path.join(ROOT_DIR, rel);
  if (!fs.existsSync(abs)) {
    console.error(`comment-voice-ratchet: missing baseline file ${rel}${missingHint}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    console.error(`comment-voice-ratchet: ${rel} is not valid JSON — ${e.message}`);
    process.exit(1);
  }
}

const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
const writeJson = (rel, obj) =>
  fs.writeFileSync(path.join(ROOT_DIR, rel), JSON.stringify(obj, null, 2) + '\n');

const files = collectCodeFiles(ROOT_DIR);

const voiceActual = {};
for (const d of files) {
  const hits = countVoice(d.rel);
  if (Object.keys(hits).length) voiceActual[d.rel] = hits;
}
const isCodeFile = (rel) => codeLang(rel) !== null;
const voiceCounts = (hits) =>
  Object.fromEntries(Object.entries(hits).map(([cat, h]) => [cat, h.length]));

if (INIT_COMMENT) {
  // A missing baseline starts empty: this flag is also how the file is first created.
  const existing = fs.existsSync(path.join(ROOT_DIR, VOICE_BASELINE_REL))
    ? readBaseline(VOICE_BASELINE_REL)
    : {};
  if (Object.keys(existing).some(isCodeFile)) {
    console.error(
      `comment-voice-ratchet: ${VOICE_BASELINE_REL} already has code-file entries. ` +
        `--init-comment-baseline seeds them once; use --lower-voice-baseline to lock in a gain.`,
    );
    process.exit(1);
  }
  const seeded = { ...existing };
  for (const [rel, hits] of Object.entries(voiceActual))
    if (isCodeFile(rel)) seeded[rel] = sortKeys(voiceCounts(hits));
  writeJson(VOICE_BASELINE_REL, sortKeys(seeded));
  console.log(
    `comment-voice-ratchet: seeded ${Object.keys(seeded).length - Object.keys(existing).length} ` +
      `code file(s) in ${VOICE_BASELINE_REL}.`,
  );
  process.exit(0);
}

let voiceBaseline = readBaseline(
  VOICE_BASELINE_REL,
  '. Create it once with `node scripts/lint/comment-voice-ratchet.js --init-comment-baseline`.',
);

if (LOWER_VOICE) {
  const lowered = {};
  let changed = 0;
  for (const [rel, allowances] of Object.entries(voiceBaseline)) {
    const now = voiceActual[rel] ? voiceCounts(voiceActual[rel]) : {};
    const kept = {};
    for (const [cat, allowed] of Object.entries(allowances)) {
      const next = Math.min(allowed, now[cat] ?? 0);
      if (next !== allowed) changed++;
      if (next > 0) kept[cat] = next;
    }
    if (Object.keys(kept).length) lowered[rel] = kept;
  }
  writeJson(VOICE_BASELINE_REL, sortKeys(lowered));
  console.log(
    `comment-voice-ratchet: lowered ${changed} voice allowance(s) in ${VOICE_BASELINE_REL}.`,
  );
  voiceBaseline = lowered;
}

const voiceOver = [];
const voiceUnder = [];
for (const rel of new Set([...Object.keys(voiceBaseline), ...Object.keys(voiceActual)])) {
  const allowances = voiceBaseline[rel] ?? {};
  const hits = voiceActual[rel] ?? {};
  for (const cat of new Set([...Object.keys(allowances), ...Object.keys(hits)])) {
    const allowed = allowances[cat] ?? 0;
    const found = hits[cat] ?? [];
    if (found.length > allowed)
      voiceOver.push({
        file: rel,
        category: cat,
        allowed,
        count: found.length,
        samples: found.slice(0, 4),
      });
    else if (found.length < allowed)
      voiceUnder.push({ file: rel, category: cat, allowed, count: found.length });
  }
}

const sum = (obj) => Object.values(obj).reduce((n, v) => n + v, 0);
const voiceTotal = Object.values(voiceActual).reduce((n, h) => n + sum(voiceCounts(h)), 0);
const voiceAllowedTotal = Object.values(voiceBaseline).reduce((n, a) => n + sum(a), 0);
const failed = voiceOver.length > 0;

if (JSON_MODE) {
  process.stdout.write(
    JSON.stringify({
      voice: {
        total: voiceTotal,
        allowedTotal: voiceAllowedTotal,
        over: voiceOver,
        under: voiceUnder,
      },
    }) + '\n',
  );
  process.exit(failed ? 1 : 0);
}

if (voiceOver.length > 0) {
  console.error(
    `comment-voice-ratchet: ${voiceOver.length} house-voice count(s) went up in code\n` +
      `comments.\n\n` +
      `Reword the new text; never raise the baseline. em-dash: use a period, comma,\n` +
      `colon or parentheses. filler: cut the word. caps-emphasis: restructure the\n` +
      `sentence instead of shouting. prose-arrow: say what happens, or bold the UI\n` +
      `path. latin-abbrev: write "for example" or "that is".\n` +
      `See docs/dev/writing-style.md.\n`,
  );
  for (const o of voiceOver) {
    const shown = [...new Set(o.samples)].map((x) => `"${x}"`).join(', ');
    console.error(
      `  ${o.file}: ${o.category} ${o.count} (allowed ${o.allowed}) in comments: ${shown}`,
    );
  }
  console.error('');
}

if (failed) process.exit(1);

if (voiceUnder.length > 0) {
  console.error(
    `comment-voice-ratchet: ${voiceUnder.length} house-voice count(s) under the baseline. ` +
      `Lock the gain in:\n  node scripts/lint/comment-voice-ratchet.js --lower-voice-baseline\n`,
  );
}

console.log(
  `comment-voice-ratchet: OK — ${voiceTotal} house-voice hit(s) in code comments, within the ` +
    `committed baseline.`,
);
process.exit(0);
