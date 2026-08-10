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

// Every place that spawns the binary. `owns` lists the settings the shared config provides;
// `allowedFlags` are the ones that surface is still permitted to pass on the command line.
const SURFACES = [
  { file: 'package.json', allowedFlags: ['--files'] },
  { file: '.lintstagedrc.cjs', allowedFlags: ['--files'] },
  { file: 'scripts/lint/check-touched-lint.cjs', allowedFlags: ['--files'] },
  // journal-sync keeps `-d`: config `dictionaries` entries resolve against the CWD rather
  // than against the config file, and this runner can be spawned from outside the repo root.
  { file: 'scripts/journal-sync.js', allowedFlags: ['--files', '-d'] },
];

// Flags the shared config owns. Long forms included so `--ignore` can't sneak past `-i`.
const OWNED_FLAGS = ['-p', '--plugins', '-i', '--ignore', '-d', '--dictionaries'];

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
  it.each(SURFACES)('$file passes no setting the config owns', ({ file, allowedFlags }) => {
    const source = read(file);

    // Isolate the spellchecker invocations so an unrelated `-p` elsewhere in the file
    // (a prettier call, an argv parser) can't fail this.
    const invocations = source
      .split('\n')
      .filter((line) => /spellchecker/i.test(line) || /SPELLCHECKER_BIN/.test(line));
    expect(invocations.length).toBeGreaterThan(0);

    const joined = invocations.join('\n');
    for (const flag of OWNED_FLAGS) {
      if (allowedFlags.includes(flag)) continue;
      // Match the flag as a whole argument — quoted, bare, or in an argv array.
      const asArgument = new RegExp(`(^|[\\s'"\`\\[,])${flag}($|[\\s'"\`\\],=])`, 'm');
      expect(asArgument.test(joined), `${file} re-specifies ${flag}; ${CONFIG_PATH} owns it`).toBe(
        false,
      );
    }
  });
});
