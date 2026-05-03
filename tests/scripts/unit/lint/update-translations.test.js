// Tests for scripts/lint/update-translations.cjs.
//
// Each scenario builds a synthetic locale + source-tree fixture in a tmpdir
// (via createLocaleFixture), invokes the script via spawnScript with cwd set
// to the fixture, and asserts on exit code, output streams, and (in --fix
// mode) the post-run state of mutated files.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import { createLocaleFixture } from '../_helpers/temp-locale-fixture.js';

const SCRIPT = 'scripts/lint/update-translations.cjs';

// Baseline source file referencing both Hello and World via the
// translationKeys.* form so the script counts them as used (and does not flag
// them as hardcoded).
const BASELINE_SOURCE = {
  'source/main.bs':
    'sub init()\n  translate(translationKeys.Hello)\n  translate(translationKeys.World)\nend sub\n',
};
const BASELINE_EN_US = { Hello: 'Hello', World: 'World' };

function readJson(dir, relPath) {
  return JSON.parse(readFileSync(join(dir, relPath), 'utf8'));
}

function readText(dir, relPath) {
  return readFileSync(join(dir, relPath), 'utf8');
}

describe('update-translations.cjs', () => {
  let fixture;

  afterEach(() => {
    if (fixture) fixture.cleanup();
    fixture = undefined;
  });

  // --------------------------------------------------------------------
  // Lint mode
  // --------------------------------------------------------------------

  describe('lint mode (default)', () => {
    it('exits 0 with clean en_US and matching code references', () => {
      fixture = createLocaleFixture({ en_US: BASELINE_EN_US, sources: BASELINE_SOURCE });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/0 errors/);
    });

    it('exits 1 when en_US.json keys are out of alphabetical order', () => {
      fixture = createLocaleFixture({
        // Object key order is preserved by JSON.stringify, so this is unsorted on disk.
        en_US: { World: 'World', Hello: 'Hello' },
        sources: BASELINE_SOURCE,
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/keys not sorted/);
    });

    it('exits 1 when en_US.json contains an orphan key', () => {
      fixture = createLocaleFixture({
        en_US: { Hello: 'Hello', Orphan: 'no one references me', World: 'World' },
        sources: BASELINE_SOURCE,
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/orphan key\(s\)/);
      expect(stdout).toMatch(/Orphan/);
    });

    it('exits 1 when code references a key not in en_US.json', () => {
      fixture = createLocaleFixture({
        en_US: BASELINE_EN_US,
        sources: {
          'source/main.bs':
            'sub init()\n  translate(translationKeys.Hello)\n  translate(translationKeys.World)\n  translate(translationKeys.Missing)\nend sub\n',
        },
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/missing key\(s\)/);
      expect(stdout).toMatch(/Missing/);
    });

    it('exits 1 when source contains a hardcoded translate("Literal") call', () => {
      fixture = createLocaleFixture({
        en_US: BASELINE_EN_US,
        sources: {
          'source/main.bs':
            'sub init()\n  translate(translationKeys.Hello)\n  translate(translationKeys.World)\n  translate("Hello")\nend sub\n',
        },
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/hardcoded translation key/);
    });

    it('exits 1 with malformed JSON in en_US.json', () => {
      fixture = createLocaleFixture({
        en_US: '{ "Hello": "Hello"  ', // malformed: missing closing brace
        sources: BASELINE_SOURCE,
      });
      const { exitCode, stderr } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/has invalid JSON/);
    });

    it('exits 1 on placeholder mismatch between en_US and another locale', () => {
      fixture = createLocaleFixture({
        en_US: { Greeting: 'Hello {0}' },
        locales: { de_DE: { Greeting: 'Hallo' } },
        sources: {
          'source/main.bs': 'sub init()\n  translate(translationKeys.Greeting)\nend sub\n',
        },
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/placeholder mismatch/);
      expect(stdout).toMatch(/Greeting/);
    });

    it('exits 1 on incomplete plural set in en_US.json', () => {
      // FooZero + FooOne are present, FooMany is missing.
      // Source references the concrete plural keys directly (avoiding
      // translatePlural() which would also pull all 3 into usedKeys and produce
      // a missing-key error in addition to the plural error we want to assert).
      fixture = createLocaleFixture({
        en_US: { FooOne: 'one foo', FooZero: 'no foos' },
        sources: {
          'source/main.bs':
            'sub init()\n  translate(translationKeys.FooZero)\n  translate(translationKeys.FooOne)\nend sub\n',
        },
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/Incomplete plural set/);
      expect(stdout).toMatch(/FooMany/);
    });

    it('exits 1 when languages.json is out of sync with locale files', () => {
      fixture = createLocaleFixture({
        en_US: BASELINE_EN_US,
        locales: { de_DE: { Hello: 'Hallo', World: 'Welt' } },
        languagesJson: [{ code: '', name: 'Automatic', nativeName: 'Automatic' }],
        sources: BASELINE_SOURCE,
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/locale file\(s\) not registered/);
      expect(stdout).toMatch(/de_DE/);
    });
  });

  // --------------------------------------------------------------------
  // Fix mode (--fix)
  // --------------------------------------------------------------------

  describe('fix mode (--fix)', () => {
    it('rewrites en_US.json in sorted order when keys are unsorted', () => {
      fixture = createLocaleFixture({
        en_US: { World: 'World', Hello: 'Hello' },
        sources: BASELINE_SOURCE,
      });
      const { exitCode } = spawnScript(SCRIPT, ['--fix'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      // Object.keys preserves insertion order, which after JSON.parse mirrors file order.
      expect(Object.keys(readJson(fixture.dir, 'locale/custom/en_US.json'))).toEqual([
        'Hello',
        'World',
      ]);
    });

    it('removes orphan keys from en_US.json', () => {
      fixture = createLocaleFixture({
        en_US: { Hello: 'Hello', Orphan: 'remove me', World: 'World' },
        sources: BASELINE_SOURCE,
      });
      const { exitCode } = spawnScript(SCRIPT, ['--fix'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      const enUs = readJson(fixture.dir, 'locale/custom/en_US.json');
      expect(enUs).not.toHaveProperty('Orphan');
      expect(Object.keys(enUs).sort()).toEqual(['Hello', 'World']);
    });

    it('adds missing locale entries to languages.json from LANGUAGE_METADATA', () => {
      fixture = createLocaleFixture({
        en_US: BASELINE_EN_US,
        locales: { de: { Hello: 'Hallo', World: 'Welt' } },
        languagesJson: [{ code: '', name: 'Automatic', nativeName: 'Automatic' }],
        sources: BASELINE_SOURCE,
      });
      const { exitCode } = spawnScript(SCRIPT, ['--fix'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      const langs = readJson(fixture.dir, 'locale/languages.json');
      const de = langs.find((l) => l.code === 'de');
      expect(de).toEqual({ code: 'de', name: 'German', nativeName: 'Deutsch' });
      // The Automatic ("") entry stays pinned first.
      expect(langs[0].code).toBe('');
    });

    it('is idempotent: a second --fix run on already-clean input does not mutate files', () => {
      fixture = createLocaleFixture({
        en_US: BASELINE_EN_US,
        locales: { de: { Hello: 'Hallo', World: 'Welt' } },
        languagesJson: [
          { code: '', name: 'Automatic', nativeName: 'Automatic' },
          { code: 'de', name: 'German', nativeName: 'Deutsch' },
        ],
        sources: BASELINE_SOURCE,
      });

      const first = spawnScript(SCRIPT, ['--fix'], { cwd: fixture.dir });
      expect(first.exitCode).toBe(0);
      const enUsAfterFirst = readText(fixture.dir, 'locale/custom/en_US.json');
      const langsAfterFirst = readText(fixture.dir, 'locale/languages.json');

      const second = spawnScript(SCRIPT, ['--fix'], { cwd: fixture.dir });
      expect(second.exitCode).toBe(0);
      expect(readText(fixture.dir, 'locale/custom/en_US.json')).toBe(enUsAfterFirst);
      expect(readText(fixture.dir, 'locale/languages.json')).toBe(langsAfterFirst);
    });
  });
});
