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
// ⚠️ The scan is over the whole CALL EXPRESSION, not the matching line. A line-scoped version
// shipped first and had the very hole this gate exists to close: flags on a continuation line
// were invisible, so re-adding `-p` in the multi-line argv shape — the shape the migration
// deleted — left the suite green, and `journal-sync.js`'s args line matched no token at all so
// that surface was never scanned. The fixture suite at the bottom is what keeps that fixed:
// it drives the extractor with the broken shapes directly, so "confirmed red" is a standing
// property rather than an experiment someone has to remember to repeat.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  // journal-sync keeps `-d`: config `dictionaries` entries resolve against the CWD rather
  // than against the config file, and this runner can be spawned from outside the repo root.
  { file: 'scripts/journal-sync.js', allowedFlags: ['--files', '-d'] },
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

  it('owns the dictionary, the plugin set and the ignore rules', () => {
    const config = parse(read(CONFIG_PATH));
    expect(config.dictionaries).toEqual(['dictionary.txt']);
    expect(config.plugins).toEqual([
      'spell',
      'indefinite-article',
      'repeated-words',
      'syntax-mentions',
      'syntax-urls',
      'frontmatter',
    ]);
    expect(config.ignore).toHaveLength(1);
  });

  it('ignores a word carrying a glued sentence-final period, apostrophes included', () => {
    // The regexes are anchored with ^ and $ by the tool, so match the whole token.
    const [pattern] = parse(read(CONFIG_PATH)).ignore;
    const re = new RegExp(`^${pattern}$`);

    // The mis-tokenized shape this exists for. The possessive is the case that could not be
    // covered while the regex lived in a lint-staged command string.
    expect(re.test('handoff.')).toBe(true);
    expect(re.test("orchestrator's.")).toBe(true);
    expect(re.test('pre-commit.')).toBe(true);

    // A typo reported without a trailing period still fails the lint.
    expect(re.test('mispeled')).toBe(false);
    expect(re.test('zzzqqq')).toBe(false);
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
