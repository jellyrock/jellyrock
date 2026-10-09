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
// Occurrences, in tracked markdown, of two forms:
//   - the full form `<path>.<code-ext>:<digits>` (optionally a `-<digits>` range);
//   - the SHORTHAND `:<digits>` standing alone, after a space, a backtick, `[` or
//     `(` — "the comment at `:25-28`", `RokuDevice.js:63-70 / :71-76`, a link
//     whose text is `[:60]`. It leans on a file named nearby and rots the same way.
// Deliberate choices:
//   - Fenced code blocks are STRIPPED before matching. A block showing what a
//     compiler or a lint prints is tool output, not a citation, and rewriting
//     it would falsify the example.
//   - Inline code IS matched. `` `ItemDetails.bs:623` `` is the citation form
//     these docs actually use, so exempting backticks would exempt the problem.
//   - The full form needs a code extension (bs/brs/xml/js/cjs/mjs), and the
//     shorthand needs nothing glued to its left, so `localhost:8096`,
//     `http://<server>:8098`, `10.11:8101` and `15:45` do not trip the gate.
//   - A LONE clock minute (`:46`) or port (`:8102`) does. Nothing in the text
//     tells it from a shorthand citation (`:20` is both a minute and a line), so
//     a guess would either miss citations or cry wolf. The docs write those in
//     words instead ("46 minutes past the hour", "port 8102"), and the failure
//     message says so.
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
// `promise-ratchet.cjs`'s single integer — deliberately. It started with ~55
// refs over 13 files, where one global total would let a PR add three fresh refs
// to a new doc while an unrelated cleanup removed three elsewhere, and the gate
// would sit green. That is the "silently refill the slack" failure
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
// Issue #959 drained the grandfathered 55 to an empty baseline, so every file is
// now held at zero.
//
// THE HOUSE VOICE (second ratchet, same walk)
// -------------------------------------------
// The same per-file ratchet holds the mechanical rules of docs/dev/writing-style.md:
// em dashes, filler words, capitals used for emphasis, `→` outside a bold UI path,
// and "e.g." / "i.e.". Each file has a count per category in
// `.doc-voice-baseline.json`; a file absent from it is allowed zero, so a new doc
// starts clean while the old ones are rewritten phase by phase.
//
// Its scope is wider than the citation gate's: every markdown file, including the
// README, CONTRIBUTING, `.github/` and append-only records (a ratchet never forces
// a rewrite, it only stops new hits). Out of scope: CHANGELOG.md (CI writes it from
// PR titles), `locale/` (translations) and `components/vendor/` (third-party).
// Inline code, link targets, URLs and a table cell holding only `—` (the "none"
// marker) are stripped as well as fenced blocks: none of them is prose.
//
// Two flags keep the baseline honest. `--init-voice-baseline` writes the current
// counts, and refuses when a baseline exists. `--lower-voice-baseline` lowers each
// allowance to the current count and never raises one, so a rewrite locks its gain
// in without hand-editing the file.
//
// THE HOUSE VOICE IN CODE COMMENTS (third scope, same baseline file)
// ------------------------------------------------------------------
// The same five categories are counted in the comments of tracked code, per file, in
// `.doc-voice-baseline.json` beside the docs. A file absent from it is allowed zero.
// Only the comment text is read, never the code: an apostrophe or `//` inside a string
// is not a comment, so each language goes through a real parser.
//   - `.bs` / `.brs`: the BrighterScript lexer. It files comments (`'` and `REM`) as
//     leading trivia of the next token, not as tokens of their own.
//   - `.js` / `.mjs` / `.cjs`: espree with `comment: true`. A hashbang is skipped.
//     A file that does not parse stops the run, naming the file.
//   - `.yml` / `.yaml`: the `yaml` package's lexer, so a `#` inside a quoted value or
//     a URL fragment is not a comment. A document with a parse error stops the run.
//   - `.xml`: `<!-- -->` blocks, matched by regex (XML comments cannot nest).
//   - `.sh` and the extensionless hooks directly under `.husky/`: whole-line `#`
//     comments only. See `shellComments()` for why.
// Inline code and URLs are stripped, as in docs. Vendored and generated code is out
// of scope: `components/vendor/`, `roku_modules/`, `node_modules/`, `build/` and `out/`.
//
// `--init-comment-baseline` seeds the code-file entries once, into the existing file.
// It refuses when the file already has any, because the allowances are then a
// decision. `--lower-voice-baseline` covers code files as it does docs.

import fs from 'node:fs';
import path from 'node:path';
import { Lexer, TokenKind } from 'brighterscript';
import * as espree from 'espree';
import YAML from 'yaml';

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const BASELINE_REL = '.doc-citation-baseline.json';
const JSON_MODE = process.argv.includes('--json');
const VOICE_BASELINE_REL = '.doc-voice-baseline.json';
const INIT_VOICE = process.argv.includes('--init-voice-baseline');
const LOWER_VOICE = process.argv.includes('--lower-voice-baseline');
const INIT_COMMENT = process.argv.includes('--init-comment-baseline');

// The house-voice categories (docs/dev/writing-style.md). Each regex runs over prose
// with code, link targets and URLs already removed; `prose-arrow` also has bold
// removed first, because a bold UI path (**Settings → Playback**) is the allowed use.
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

// Out of the voice gate's scope (see the header): generated, translated or vendored.
const VOICE_EXCLUDED_RELS = ['CHANGELOG.md', 'locale', 'components/vendor'];

// A path-looking token ending in a code extension, then `:digits`, optionally a
// `-digits` range. Leading char class avoids matching mid-word.
const CITATION_RE = /[A-Za-z0-9_][A-Za-z0-9_/.-]*\.(?:bs|brs|xml|js|cjs|mjs):\d+(?:-\d+)?/g;
// The shorthand: `:<digits>` with nothing glued to its left, so the `:623` inside
// a full-form match is never counted twice, and `host:port` never matches.
const SHORTHAND_RE = /(?<=^|[\s`[(]):\d+(?:-\d+)?(?![\d:A-Za-z])/gm;

const SKIP_DIRS = new Set([
  'node_modules',
  'build',
  'build-analysis',
  'out',
  'tasks',
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

/**
 * Every tracked markdown or code file a gate governs, as `{ rel, citation, voice, code }`:
 * whether the line-citation ratchet and the voice ratchet each apply to it, and whether
 * it is a code file (whose comments are read) rather than a doc.
 */
function collectDocs(rootDir) {
  const found = [];
  const voiceExcluded = (rel) =>
    VOICE_EXCLUDED_RELS.some((x) => rel === x || rel.startsWith(`${x}/`));
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
        // `.claude` and `.github` are the dot-dirs that hold prose; skip the rest.
        if (e.name.startsWith('.') && !DOT_DIRS_WALKED.has(e.name)) continue;
        const rel = path.relative(rootDir, full).split(path.sep).join('/');
        if (EPHEMERAL_RELS.includes(rel)) continue;
        if (rel === '.husky/_') continue;
        // A directory with its own `.git` (a file for a worktree, a directory for a
        // clone) is a separate checkout — `.claude/worktrees/<name>` holds a whole copy
        // of the repo — so its docs belong to its own branch's run, not this one.
        if (fs.existsSync(path.join(full, '.git'))) continue;
        walk(full, insideClaude || e.name === '.claude');
        continue;
      }
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (codeLang(rel)) {
        if (!voiceExcluded(rel)) found.push({ rel, citation: false, voice: true, code: true });
        continue;
      }
      if (!e.name.endsWith('.md')) continue;
      const citation =
        !SKIP_FILES.has(e.name) &&
        (rel.startsWith('docs/') ||
          insideClaude ||
          e.name === 'CLAUDE.md' ||
          e.name === 'AGENTS.md');
      const voice = !voiceExcluded(rel);
      if (citation || voice) found.push({ rel, citation, voice, code: false });
    }
  }
  walk(rootDir, false);
  return found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function countCitations(relPath) {
  const text = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
  const prose = stripFencedBlocks(text);
  return [...(prose.match(CITATION_RE) ?? []), ...(prose.match(SHORTHAND_RE) ?? [])];
}

/** Prose only: fenced blocks, inline code, link targets and URLs removed. */
function voiceProse(text) {
  return (
    stripFencedBlocks(text)
      .replace(/``[^`]*``/g, '')
      .replace(/`[^`\n]*`/g, '')
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
      .replace(/<https?:\/\/[^>]*>/g, '')
      .replace(/https?:\/\/\S+/g, '')
      // A table cell holding only a dash is the table's "none" marker, not prose.
      .replace(/(?<=\|)[ \t]*—[ \t]*(?=\|)/g, ' ')
  );
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
  console.error(`doc-citation-ratchet: cannot read the comments of ${rel}: ${e.message}`);
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
function countVoice(relPath, isCode = false) {
  const text = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
  const prose = isCode ? commentProse(extractComments(relPath, text).join('\n')) : voiceProse(text);
  const withoutBold = prose.replace(/\*\*[^*\n]+\*\*/g, '');
  const hits = {};
  for (const rule of VOICE_RULES) {
    const found = (rule.withoutBold ? withoutBold : prose).match(rule.re);
    if (found) hits[rule.id] = found;
  }
  return hits;
}

/** Read a JSON baseline, or exit 1 with a clear message. */
function readBaseline(rel, missingHint) {
  const abs = path.join(ROOT_DIR, rel);
  if (!fs.existsSync(abs)) {
    console.error(`doc-citation-ratchet: missing baseline file ${rel}${missingHint}`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    console.error(`doc-citation-ratchet: ${rel} is not valid JSON — ${e.message}`);
    process.exit(1);
  }
}

const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
const writeJson = (rel, obj) =>
  fs.writeFileSync(path.join(ROOT_DIR, rel), JSON.stringify(obj, null, 2) + '\n');

const docs = collectDocs(ROOT_DIR);

const voiceActual = {};
for (const d of docs) {
  if (!d.voice) continue;
  const hits = countVoice(d.rel, d.code);
  if (Object.keys(hits).length) voiceActual[d.rel] = hits;
}
const isCodeFile = (rel) => codeLang(rel) !== null;
const voiceCounts = (hits) =>
  Object.fromEntries(Object.entries(hits).map(([cat, h]) => [cat, h.length]));

if (INIT_VOICE) {
  if (fs.existsSync(path.join(ROOT_DIR, VOICE_BASELINE_REL))) {
    console.error(
      `doc-citation-ratchet: ${VOICE_BASELINE_REL} already exists. --init-voice-baseline only ` +
        `creates it; use --lower-voice-baseline to lock in a gain.`,
    );
    process.exit(1);
  }
  const init = {};
  for (const [rel, hits] of Object.entries(voiceActual)) init[rel] = sortKeys(voiceCounts(hits));
  writeJson(VOICE_BASELINE_REL, sortKeys(init));
  console.log(
    `doc-citation-ratchet: wrote ${VOICE_BASELINE_REL} for ${Object.keys(init).length} file(s).`,
  );
  process.exit(0);
}

if (INIT_COMMENT) {
  const existing = readBaseline(VOICE_BASELINE_REL, '');
  if (Object.keys(existing).some(isCodeFile)) {
    console.error(
      `doc-citation-ratchet: ${VOICE_BASELINE_REL} already has code-file entries. ` +
        `--init-comment-baseline seeds them once; use --lower-voice-baseline to lock in a gain.`,
    );
    process.exit(1);
  }
  const seeded = { ...existing };
  for (const [rel, hits] of Object.entries(voiceActual))
    if (isCodeFile(rel)) seeded[rel] = sortKeys(voiceCounts(hits));
  writeJson(VOICE_BASELINE_REL, sortKeys(seeded));
  console.log(
    `doc-citation-ratchet: seeded ${Object.keys(seeded).length - Object.keys(existing).length} ` +
      `code file(s) in ${VOICE_BASELINE_REL}.`,
  );
  process.exit(0);
}

const baseline = readBaseline(BASELINE_REL, '');
let voiceBaseline = readBaseline(
  VOICE_BASELINE_REL,
  '. Create it once with `node scripts/lint/doc-citation-ratchet.js --init-voice-baseline`.',
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
    `doc-citation-ratchet: lowered ${changed} voice allowance(s) in ${VOICE_BASELINE_REL}.`,
  );
  voiceBaseline = lowered;
}

const actual = {};
for (const d of docs) {
  if (!d.citation) continue;
  const hits = countCitations(d.rel);
  if (hits.length) actual[d.rel] = hits;
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
const total = Object.values(actual).reduce((n, h) => n + h.length, 0);
const allowedTotal = sum(baseline);
const voiceTotal = Object.values(voiceActual).reduce((n, h) => n + sum(voiceCounts(h)), 0);
const voiceAllowedTotal = Object.values(voiceBaseline).reduce((n, a) => n + sum(a), 0);
const failed = over.length > 0 || voiceOver.length > 0;

if (JSON_MODE) {
  process.stdout.write(
    JSON.stringify({
      total,
      allowedTotal,
      over,
      under,
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

if (over.length > 0) {
  console.error(
    `doc-citation-ratchet: ${over.length} file(s) gained line-number citations.\n\n` +
      `A line number rots on any edit above it. Cite the SYMBOL instead —\n` +
      `\`ItemDetails.launchQueueItemToPlay()\`, not \`ItemDetails.bs:623\` — which a\n` +
      `reader or an agent can grep. A lone \`:46\` or \`:8102\` reads as a line\n` +
      `citation too, so write a clock minute or a port in words:\n` +
      `"46 minutes past the hour", "port 8102".\n` +
      `See .claude/rules/derive-dont-duplicate.md.\n`,
  );
  for (const o of over) {
    console.error(`  ${o.file}: ${o.count} (allowed ${o.allowed}) — e.g. ${o.samples.join(', ')}`);
  }
  console.error('');
}

if (voiceOver.length > 0) {
  console.error(
    `doc-citation-ratchet: ${voiceOver.length} house-voice count(s) went up (docs, or the\n` +
      `comments of a code file).\n\n` +
      `Reword the new text; never raise the baseline. em-dash: use a period, comma,\n` +
      `colon or parentheses. filler: cut the word. caps-emphasis: restructure the\n` +
      `sentence instead of shouting. prose-arrow: say what happens, or bold the UI\n` +
      `path. latin-abbrev: write "for example" or "that is".\n` +
      `See docs/dev/writing-style.md.\n`,
  );
  for (const o of voiceOver) {
    const shown = [...new Set(o.samples)].map((x) => `"${x}"`).join(', ');
    const where = isCodeFile(o.file) ? ' in comments' : '';
    console.error(`  ${o.file}: ${o.category} ${o.count} (allowed ${o.allowed})${where}: ${shown}`);
  }
  console.error('');
}

if (failed) process.exit(1);

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
}

if (voiceUnder.length > 0) {
  console.error(
    `doc-citation-ratchet: ${voiceUnder.length} house-voice count(s) under the baseline. ` +
      `Lock the gain in:\n  node scripts/lint/doc-citation-ratchet.js --lower-voice-baseline\n`,
  );
}

console.log(
  `doc-citation-ratchet: OK — ${total} line-number citation(s), ${voiceTotal} house-voice ` +
    `hit(s) in tracked docs and code comments, within the committed baselines.`,
);
process.exit(0);
