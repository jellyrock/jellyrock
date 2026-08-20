// Drift gate for the spellchecker configuration.
//
// Four surfaces invoke spellchecker-cli (repo-wide lint, pre-commit, the end-of-turn hook,
// and journal-sync's bullet check). They each used to carry their own copy of the dictionary
// path, plugin list and ignore regex, held together by a "keep in sync" comment — and they
// drifted: an ignore rule was added to two of them, so the hook went on reporting a word CI
// had already stopped flagging.
//
// `.spellcheckerrc.yaml` is now the single source, auto-discovered at the package root. This
// suite fails if any surface starts re-specifying a setting the config owns, which is the only
// way that class of divergence can come back.
//
// The suite has a second half that is NOT about drift: it spawns the real binary over a fixture
// and asserts what the configuration actually SPELLCHECKS. That exists because the first version
// of the sentence-final fix was a broad `ignore` regex matching any token ending in a period,
// and its unit test asserted the regex against hand-written tokens — which cannot catch a
// TOKENIZATION problem, because the test supplies the token the author assumed. The regex
// silently stopped reporting real typos at the end of any paragraph above a list, a numbered
// list, a blockquote or a lowercase heading. Only spawning the tool shows that.
//
// ⚠️ The scan is over the whole CALL EXPRESSION, not the matching line. A line-scoped version
// shipped first and had the very hole this gate exists to close: flags on a continuation line
// were invisible, so re-adding `-p` in the multi-line argv shape — the shape the migration
// deleted — left the suite green, and `journal-sync.js`'s args line matched no token at all so
// that surface was never scanned. The fixture suite at the bottom is what keeps that fixed:
// it drives the extractor with the broken shapes directly, so "confirmed red" is a standing
// property rather than an experiment someone has to remember to repeat.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// js-yaml, not `yaml` — it is the repo's declared YAML parser (scripts/lib/version-boundaries,
// scripts/lint/issue-templates-check, scripts/lib/endpoint-availability all use it).
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const parse = (source) => yaml.load(source);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CONFIG_PATH = '.spellcheckerrc.yaml';

// Every place that spawns the binary. `allowedFlags` are the ones that surface is still
// permitted to pass on the command line; everything else in OWNED_FLAGS is a failure.
const SURFACES = [
  { file: 'package.json', json: true, allowedFlags: ['--files'] },
  { file: '.lintstagedrc.cjs', allowedFlags: ['--files'] },
  { file: 'scripts/lint/check-touched-lint.cjs', allowedFlags: ['--files'] },
  // No exception for journal-sync. It used to pass an absolute `-d` because its CWD can
  // differ from its repo root — but that only rescued the dictionary, while the CONFIG was
  // still being looked for from the wrong CWD and silently not found. Spawning with
  // `cwd: repoRoot` fixes both, so this surface inherits like every other one.
  { file: 'scripts/journal-sync.js', allowedFlags: ['--files'] },
];

// Flags the shared config owns. Long forms included so `--ignore` can't sneak past `-i`.
const OWNED_FLAGS = ['-p', '--plugins', '-i', '--ignore', '-d', '--dictionaries'];

// Any mention of the tool. `SPELLCHECKER_BIN` is journal-sync's resolved-path constant, which
// is what appears at its spawn site — the literal string "spellchecker" does not.
const TOKEN = /spellchecker|SPELLCHECKER_BIN/gi;

// Bound on how far the paren walk will travel. Large enough for any real invocation, small
// enough that a mis-parse degrades to one line rather than swallowing the file.
const MAX_REGION = 4000;

// Strip whole-line `//` comments. Deliberately only line-leading ones, so a `//` inside a URL
// or a string literal survives — and every flag-mentioning comment in these files (they all
// explain which flags the config now owns) is a full line.
function stripLineComments(source) {
  return source.replace(/^[ \t]*\/\/.*$/gm, '');
}

// The innermost call expression enclosing `index`: walk back to the unclosed `(`, then forward
// to its match. Falls back to the matched LINE when there is no such call within MAX_REGION, or
// when the walk lands somewhere that no longer contains `index` — which is what an unbalanced
// paren inside a string literal would produce.
function enclosingCall(code, index) {
  const lineStart = code.lastIndexOf('\n', index) + 1;
  const lineBreak = code.indexOf('\n', index);
  const line = code.slice(lineStart, lineBreak === -1 ? code.length : lineBreak);

  let depth = 0;
  let open = -1;
  for (let i = index, floor = Math.max(0, index - MAX_REGION); i >= floor; i--) {
    if (code[i] === ')') depth++;
    else if (code[i] === '(') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    }
  }
  if (open === -1) return line;

  depth = 0;
  for (let i = open, ceiling = open + MAX_REGION; i < code.length && i <= ceiling; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') {
      depth--;
      if (depth === 0) return i > index ? code.slice(open, i + 1) : line;
    }
  }
  return line;
}

// Every region of `source` that could be passing arguments to spellchecker-cli.
export function invocationRegions(source, { json = false } = {}) {
  if (json) {
    // package.json is parsed rather than pattern-matched: the invocation is a script VALUE,
    // and the surrounding JSON has no call syntax for the paren walk to hold on to.
    const scripts = JSON.parse(source).scripts ?? {};
    return Object.values(scripts).filter((command) => /spellchecker/i.test(command));
  }
  const code = stripLineComments(source);
  return [...code.matchAll(TOKEN)].map((match) => enclosingCall(code, match.index));
}

// The owned flags a set of regions passes despite the config owning them.
export function ownedFlagsPassed(regions, allowedFlags = []) {
  const joined = regions.join('\n');
  return OWNED_FLAGS.filter((flag) => {
    if (allowedFlags.includes(flag)) return false;
    // Match the flag as a whole argument — quoted, bare, or in an argv array.
    return new RegExp(`(^|[\\s'"\`\\[,])${flag}($|[\\s'"\`\\],=])`, 'm').test(joined);
  });
}

describe('spellchecker config / .spellcheckerrc.yaml', () => {
  it('exists and is parseable', () => {
    expect(() => parse(read(CONFIG_PATH))).not.toThrow();
  });

  it('owns both dictionaries and the plugin set', () => {
    const config = parse(read(CONFIG_PATH));
    expect(config.dictionaries).toEqual(['dictionary.txt', 'dictionary-sentence-final.txt']);
    expect(config.plugins).toEqual([
      'spell',
      'indefinite-article',
      'repeated-words',
      'syntax-mentions',
      'syntax-urls',
      'frontmatter',
    ]);
  });

  it('carries no `ignore` rules at all', () => {
    // Deliberate, and the reason is the whole point of the generated companion dictionary:
    // an `ignore` regex broad enough to cover a glued sentence-final period also swallows a
    // genuine typo in the same position. The behavioral suite below is what proves the
    // replacement does not. If an `ignore` key comes back, that proof has to come back too.
    expect(parse(read(CONFIG_PATH)).ignore).toBeUndefined();
  });

  it('does not let the excludes acquire a second owner here', () => {
    // scripts/lib/lint-excludes.cjs + package.json's globs own which files get checked.
    // A `files` key in the config would be a third copy of that list.
    expect(parse(read(CONFIG_PATH)).files).toBeUndefined();
  });
});

describe('spellchecker config / call sites inherit rather than restate', () => {
  it.each(SURFACES)('$file passes no setting the config owns', ({ file, json, allowedFlags }) => {
    const regions = invocationRegions(read(file), { json });

    // A surface whose invocation stopped being found would pass this suite vacuously, which
    // is the failure mode the whole gate is guarding against one level down.
    expect(regions.length, `no spellchecker invocation found in ${file}`).toBeGreaterThan(0);

    const passed = ownedFlagsPassed(regions, allowedFlags);
    expect(passed, `${file} re-specifies ${passed.join(', ')}; ${CONFIG_PATH} owns them`).toEqual(
      [],
    );
  });

  it('reaches the argv of a spawn whose args sit on their own line', () => {
    // journal-sync's spawnSync passes its argv on a line that mentions neither the tool nor
    // SPELLCHECKER_BIN. The line-scoped predecessor never scanned that surface at all.
    const regions = invocationRegions(read('scripts/journal-sync.js'));
    expect(regions.some((r) => r.includes('--files') && r.includes('tmpFile'))).toBe(true);
  });
});

// The extractor's own red/green. These drive it with the broken shapes directly, so the gate's
// ability to fail is checked by the suite instead of by hand at review time.
describe('spellchecker config / the gate can actually fail', () => {
  const flagsIn = (source) => ownedFlagsPassed(invocationRegions(source), ['--files']);

  it('catches a flag re-added on a continuation line', () => {
    expect(
      flagsIn(`
        const { code } = runBin('spellchecker', [
          '-p',
          'spell',
          '--files',
          ...targets,
        ]);
      `),
    ).toContain('-p');
  });

  it('catches a flag in an argv array whose line names neither the tool nor the binary', () => {
    expect(
      flagsIn(`
        const res = spawnSync(
          SPELLCHECKER_BIN,
          ['-d', join(repoRoot, 'dictionary.txt'), '--files', tmpFile],
          { encoding: 'utf8' },
        );
      `),
    ).toContain('-d');
  });

  it('catches a flag inlined into a command string', () => {
    expect(flagsIn(`cmdWithFiles('npx spellchecker -i "x" --files', files)`)).toContain('-i');
  });

  it('passes the inherit-only shape', () => {
    expect(flagsIn(`const { code } = runBin('spellchecker', ['--files', ...targets]);`)).toEqual(
      [],
    );
  });

  it('is not fooled by a comment that names the flags the config owns', () => {
    // Every real call site carries exactly this comment, so a naive whole-file scan would
    // fail the gate on the documentation telling you not to pass them.
    expect(
      flagsIn(`
        // Dictionary, plugins and ignore rules (-d / -p / -i) come from .spellcheckerrc.yaml.
        const { code } = runBin('spellchecker', ['--files', ...targets]);
      `),
    ).toEqual([]);
  });
});

// What the configuration actually spellchecks, taken from the real binary rather than from a
// regex the test wrote itself. ONE spawn (~0.5 s) covers every case: the tool reports each
// unknown word once, so a single fixture is both cheaper and a stricter assertion than a file
// per case — anything unexpected shows up as a surplus entry.
describe('spellchecker config / behaviour against the real binary', () => {
  // retext stops treating a paragraph's final period as sentence-final when the next block is
  // a lowercase heading, a list or a blockquote, and looks the word up with the period glued
  // on. Each hostile position appears twice below: once ending on a dictionary.txt word (must
  // stay silent) and once ending on a nonsense word (must still be reported).
  const FIXTURE = [
    '# Fixture',
    '',
    'A dictionary word above a lowercase heading is the handoff.',
    '',
    '## decision-id: some-slug',
    '',
    "A dictionary word above a bullet list is the orchestrator's.",
    '',
    '- a list item',
    '',
    'A dictionary word above a blockquote names Jellyfin.',
    '',
    '> a quoted line',
    '',
    'A misspelling above a lowercase heading is zzqqxaa.',
    '',
    '## decision-id: another-slug',
    '',
    'A misspelling above a bullet list is wibblesnark.',
    '',
    '- another list item',
    '',
    'A misspelling at a normal sentence end is frotzbarple. More text follows here.',
    '',
  ].join('\n');

  // Resolved from the repo's own node_modules, and spawned with `cwd: REPO_ROOT` — the same
  // two requirements every production call site has, for the same reason: spellchecker-cli
  // discovers .spellcheckerrc.yaml by walking up from process.cwd().
  const BIN = join(REPO_ROOT, 'node_modules', '.bin', 'spellchecker');

  const run = (() => {
    const dir = mkdtempSync(join(tmpdir(), 'spellchecker-behaviour-'));
    const file = join(dir, 'fixture.md');
    try {
      writeFileSync(file, FIXTURE);
      const res = spawnSync(BIN, ['--files', file], { encoding: 'utf8', cwd: REPO_ROOT });
      const output = (res.stdout || '') + (res.stderr || '');
      return {
        status: res.status,
        error: res.error,
        output,
        // Trailing period included when present — the mis-tokenized form is the evidence.
        reported: [...output.matchAll(/unknown word `([^`]+)`/g)].map((m) => m[1]),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
  const reported = run.reported;

  it('actually spawned the binary', () => {
    // Non-vacuity guard, and it is not paranoia: if the spawn failed — binary absent, config
    // not discovered from this cwd — `reported` would be empty and the "does not report"
    // case below would pass by checking nothing. spellchecker-cli exits 1 when it reports a
    // warning, so a successful run over this fixture is exit 1 with output, not exit 0.
    expect(run.error, `spawn failed: ${run.error?.message}`).toBeUndefined();
    expect(run.output).toContain('Spellchecking 1 file');
    expect(run.status).toBe(1);
  });

  it('does not report a dictionary word that ends a paragraph in any hostile position', () => {
    // The trap this configuration exists to close. `## decision-id: <slug>` is the schema
    // every docs/decisions.md note uses, so this sat directly in the `/log decision` path.
    for (const word of ['handoff.', "orchestrator's.", 'Jellyfin.']) {
      expect(reported, `${word} must not be reported`).not.toContain(word);
    }
  });

  it('still reports a real typo in those same positions', () => {
    // The regression the broad `ignore` regex introduced and this fixture now gates. Note the
    // glued period: these are reported in the mis-tokenized form, which is exactly the shape
    // an `ignore: "[A-Za-z][A-Za-z0-9\'-]*\\."` rule would swallow.
    expect(reported).toContain('zzqqxaa.');
    expect(reported).toContain('wibblesnark.');
  });

  it('still reports a real typo at an ordinary sentence end', () => {
    expect(reported).toContain('frotzbarple');
  });

  it('reports nothing else, so the fixture cannot pass by reporting everything', () => {
    // Non-vacuity in the other direction: a configuration that flagged every word would
    // satisfy the two "still reports" cases above.
    expect(reported.sort()).toEqual(['frotzbarple', 'wibblesnark.', 'zzqqxaa.']);
  });
});
