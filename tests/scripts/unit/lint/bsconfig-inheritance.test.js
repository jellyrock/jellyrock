// Invariant gate: every committed bsconfig inherits its shared settings from
// `bsconfig-base.json`, and nothing silently opts out of them.
//
// WHY THIS EXISTS
// ---------------
// The configs used to be hand-copied, and shared settings drifted between them
// (the `bsconfig-files-duplicated` tech-debt entry records it happening twice).
// `extends` fixes the copying, but BrighterScript merges it SHALLOWLY: only
// `compilerOptions` is merged key-by-key. A child that sets `diagnosticFilters`,
// `files` or `plugins` replaces the parent's array outright — so a well-meant
// "add one filter here" in a child drops every filter the base defines, with no
// warning. Each check below closes one way that can happen unnoticed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deprecatedCompilerOptionKeys } from 'brighterscript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const BASE = 'bsconfig-base.json';

// Tracked or about-to-be-tracked files, never gitignored ones: a personal config
// (bsconfig-tdd.json) must not make this gate pass or fail differently from
// machine to machine.
const CONFIGS = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', 'bsconfig*.json'],
  { cwd: ROOT, encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

// JSON.parse, not a JSONC parser: crash-report reads bsconfig-prod.json with
// JSON.parse, so a comment in a config would break it.
const load = (name) => JSON.parse(readFileSync(join(ROOT, name), 'utf8'));

/** The config itself, then each ancestor it extends, nearest first. */
function extendsChain(name) {
  const chain = [name];
  let config = load(name);
  while (typeof config.extends === 'string') {
    const parent = basename(config.extends);
    if (chain.includes(parent)) throw new Error(`extends cycle: ${[...chain, parent].join(' → ')}`);
    chain.push(parent);
    config = load(parent);
  }
  return chain;
}

/** The `pattern:` the device unit-test workflow hands to changed-paths. */
function deviceTestPathFilter() {
  const wf = readFileSync(join(ROOT, '.github/workflows/device-unit-tests.yml'), 'utf8');
  const match = wf.match(/^\s*pattern:\s*'([^']+)'/m);
  if (!match) throw new Error('Could not find pattern: in device-unit-tests.yml');
  return new RegExp(match[1]);
}

describe('bsconfig inheritance', () => {
  it('finds the committed configs', () => {
    expect(CONFIGS).toContain(BASE);
    expect(CONFIGS.length).toBeGreaterThan(2);
  });

  it.each(CONFIGS.filter((c) => c !== BASE))('%s inherits from bsconfig-base.json', (name) => {
    expect(extendsChain(name)).toContain(BASE);
  });

  it.each(CONFIGS.filter((c) => c !== BASE))(
    '%s does not redefine diagnosticFilters (it would replace, not extend, the base list)',
    (name) => {
      expect(load(name)).not.toHaveProperty('diagnosticFilters');
    },
  );

  it.each(CONFIGS)('%s sets no deprecated top-level compiler option', (name) => {
    const config = load(name);
    expect(deprecatedCompilerOptionKeys.filter((key) => key in config)).toEqual([]);
  });

  // A prebuilt map copied by `files` lands on the same output path as the map BSC
  // generates for that file, and the two concurrent writes corrupt it. BSC reads a
  // co-located prebuilt map itself, so it never needs copying. Last entry, so no
  // later glob can copy one back in.
  it.each(CONFIGS.filter((c) => 'files' in load(c)))(
    '%s copies no prebuilt source maps (files ends with "!**/*.map")',
    (name) => {
      expect(load(name).files.at(-1)).toBe('!**/*.map');
    },
  );

  // A config the device-test path filter watches changes what the device builds,
  // and so does every file it inherits from — they must re-run the tests too.
  const deviceFilter = deviceTestPathFilter();
  it.each(CONFIGS.filter((c) => deviceFilter.test(c)))(
    'everything %s inherits from also triggers the device unit tests',
    (name) => {
      expect(extendsChain(name).filter((file) => !deviceFilter.test(file))).toEqual([]);
    },
  );
});
