// Tests for scripts/generate/sentence-final-dictionary.js.
//
// The generated dictionary is a real spellchecker input, so two properties matter and they
// fail differently: the TRANSFORM has to produce a pattern that matches only the sentence-final
// form, and the COMMITTED file has to stay in step with dictionary.txt. A stale committed file
// is the dangerous one — it produces no error anywhere, it just quietly stops covering whatever
// was added to dictionary.txt since.
//
// What this suite does NOT cover, because it cannot: whether the patterns behave correctly
// inside the real tool. That is the behavioral suite in ../lint/spellchecker-config.test.js,
// which spawns the binary over a fixture.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnScript } from '../_helpers/spawn-script.js';
import {
  parseEntries,
  sentenceFinalForm,
  buildDictionary,
} from '../../../../scripts/generate/sentence-final-dictionary.js';

const SCRIPT = 'scripts/generate/sentence-final-dictionary.js';
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const withFixture = (dictionary, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'sentence-final-'));
  try {
    writeFileSync(join(dir, 'dictionary.txt'), dictionary);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('sentence-final dictionary / the transform', () => {
  it('keeps entries and drops comments and blanks', () => {
    expect(parseEntries('# a comment line\n\nhandoff\n  Jellyfin  \n\n# another\n')).toEqual([
      'handoff',
      'Jellyfin',
    ]);
  });

  it('produces a pattern that matches the sentence-final form and nothing else', () => {
    // The tool anchors each entry as ^entry$, so that is how the test has to read it.
    const re = new RegExp(`^${sentenceFinalForm('handoff')}$`);
    expect(re.test('handoff.')).toBe(true);
    expect(re.test('handoff')).toBe(false);
    // The bare form is dictionary.txt's job. Matching it here too would be harmless but would
    // hide a regression in which the period stopped being required.
    expect(re.test('handoffs.')).toBe(false);
  });

  it('escapes the period rather than leaving it as a wildcard', () => {
    // The four hand-written workarounds this generator replaced (`codebase.`, `globals.`,
    // `lifecycle.`, `lookups.` in dictionary.txt) each had an UNESCAPED period, so they also
    // accepted `codebaseX`. That is a coverage hole, not a typo — assert it cannot return.
    const re = new RegExp(`^${sentenceFinalForm('codebase')}$`);
    expect(re.test('codebase.')).toBe(true);
    expect(re.test('codebaseX')).toBe(false);
  });

  it('groups the entry so an alternation cannot escape the trailing period', () => {
    // No entry uses alternation today. The group is what keeps that from silently mattering:
    // ungrouped, `^foo|bar\.$` binds as (^foo)|(bar\.$) and accepts a bare `foo`.
    const re = new RegExp(`^${sentenceFinalForm('foo|bar')}$`);
    expect(re.test('foo.')).toBe(true);
    expect(re.test('foo')).toBe(false);
  });

  it('emits a header whose lines can never match a word token', () => {
    // Dictionary files have no comment syntax — a `#` line is just an entry, anchored as
    // ^line$ like every other. It is inert only because a word token is letters, digits,
    // apostrophes and hyphens, and no header line is made solely of those. That is the
    // property to assert; "contains a space" is a proxy that a bare `#` separator breaks.
    // dictionary.txt's own header relies on exactly the same thing.
    const isWordToken = (line) => /^[A-Za-z0-9'-]+$/.test(line);
    const header = buildDictionary('handoff\n')
      .split('\n')
      .filter((l) => l.startsWith('#'));
    expect(header.length).toBeGreaterThan(0);
    for (const line of header) expect(isWordToken(line), `${line} could match a word`).toBe(false);
  });
});

describe('sentence-final dictionary / the drift gate', () => {
  it('the committed file is in step with the committed dictionary.txt', () => {
    // The property that actually protects the lint. Asserted here as well as in CI so a
    // contributor sees it in `npm run test:scripts` rather than only at push time.
    expect(readFileSync(join(REPO_ROOT, 'dictionary-sentence-final.txt'), 'utf8')).toEqual(
      buildDictionary(readFileSync(join(REPO_ROOT, 'dictionary.txt'), 'utf8')),
    );
  });

  it('--check passes when the generated file matches', () => {
    withFixture('handoff\nJellyfin\n', (dir) => {
      expect(spawnScript(SCRIPT, [dir]).exitCode).toBe(0);
      expect(spawnScript(SCRIPT, ['--check', dir]).exitCode).toBe(0);
    });
  });

  it('--check FAILS when dictionary.txt gained an entry', () => {
    // The gate's own red. Without this, a --check that could never fail would still pass CI.
    withFixture('handoff\n', (dir) => {
      expect(spawnScript(SCRIPT, [dir]).exitCode).toBe(0);
      writeFileSync(join(dir, 'dictionary.txt'), 'handoff\nJellyfin\n');
      const res = spawnScript(SCRIPT, ['--check', dir]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('out of date');
      expect(res.stderr).toContain('npm run dictionary:sentence-final');
    });
  });

  it('--check FAILS when the generated file is missing entirely', () => {
    withFixture('handoff\n', (dir) => {
      const res = spawnScript(SCRIPT, ['--check', dir]);
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('missing');
    });
  });

  it('--check does not write the file it is checking', () => {
    // A check mode that repaired the drift would make the CI gate permanently green.
    withFixture('handoff\n', (dir) => {
      spawnScript(SCRIPT, ['--check', dir]);
      expect(existsSync(join(dir, 'dictionary-sentence-final.txt'))).toBe(false);
    });
  });
});
