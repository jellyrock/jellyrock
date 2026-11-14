// Tests for scripts/lint/update-translations.cjs.
//
// Each scenario builds a synthetic locale + source-tree fixture in a tmpdir
// (via createLocaleFixture), invokes the script via spawnScript with cwd set
// to the fixture, and asserts on exit code, output streams, and (in --fix
// mode) the post-run state of mutated files.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitSafeEnv } from '../_helpers/git-env.js';
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

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: gitSafeEnv() }).trim();

const tempDirs = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'jellyrock-weblate-'));
  tempDirs.push(d);
  return d;
}

function identify(dir, name) {
  git(dir, 'config', 'user.name', name);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

/**
 * Make the fixture a checkout whose origin's weblate branch holds release v1.0.0 of
 * its files, as release prep's push-back leaves it. `weblateEdits` ({ locale: { key:
 * value } }) are then committed to weblate, as translators working since the release.
 */
function releaseToWeblate(dir, weblateEdits = {}) {
  const origin = tempDir();
  git(origin, 'init', '--quiet', '--bare');
  git(dir, 'init', '--quiet', '--initial-branch=main');
  identify(dir, 'Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'release', '-m', 'Translations-Release: 1.0.0');
  git(dir, 'tag', 'v1.0.0');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '--quiet', 'origin', 'HEAD:refs/heads/weblate');
  if (Object.keys(weblateEdits).length === 0) return;
  const w = tempDir();
  git(w, 'clone', '--quiet', '--branch', 'weblate', origin, '.');
  identify(w, 'Weblate');
  for (const [locale, edits] of Object.entries(weblateEdits)) {
    const file = join(w, `locale/custom/${locale}.json`);
    let current = {};
    try {
      current = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // a locale Weblate starts translating after the release
    }
    writeFileSync(file, JSON.stringify({ ...current, ...edits }, null, 2) + '\n');
  }
  git(w, 'add', '-A');
  git(w, 'commit', '--quiet', '-m', 'Translated using Weblate');
  git(w, 'push', '--quiet', 'origin', 'weblate');
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

    it('counts a pluralKey(translationKeys.Base, …) call as a use of the whole plural set', () => {
      fixture = createLocaleFixture({
        en_US: { FooMany: '{0} foos', FooOne: '1 foo', FooZero: 'No foos', ...BASELINE_EN_US },
        sources: {
          ...BASELINE_SOURCE,
          'source/plural.bs':
            'function key(n as integer) as string\n  return pluralKey(translationKeys.Foo, n)\nend function\n',
        },
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, [], { cwd: fixture.dir });
      expect(stdout).not.toMatch(/orphan key\(s\)/);
      expect(stdout).not.toMatch(/missing key\(s\)/);
      expect(exitCode).toBe(0);
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

  // --------------------------------------------------------------------
  // --rename
  // --------------------------------------------------------------------

  describe('--rename', () => {
    const RENAME_SOURCE = {
      'source/main.bs':
        'sub init()\n  translate(translationKeys.Hello)\n  translate(translationKeys.World)\n  translate(translationKeys.World2)\nend sub\n',
      'tests/source/unit/main.spec.bs': 'm.assertEqual(x, translate(translationKeys.World))\n',
      'docs/note.md': 'The World key is shown on the home screen.\n',
      'locale/seed/keymap.yml':
        'World:\n  en: World\n  from:\n    web: { key: World, en: World }\n',
      'locale/seed/seeded.json': { fr: { World: 'web@abc' } },
      'settings/settings.json': [{ titleKey: 'World', descriptionKey: 'World2' }],
    };
    const RENAME_EN_US = { Hello: 'Hello', World: 'World', World2: 'Second world' };

    function renameFixture(overrides = {}) {
      return createLocaleFixture({
        en_US: RENAME_EN_US,
        locales: { fr: { Hello: 'Bonjour', World: 'Monde' }, de: { Hello: 'Hallo' } },
        languagesJson: [
          { code: '', name: 'Automatic', nativeName: 'Automatic' },
          { code: 'de', name: 'German', nativeName: 'Deutsch' },
          { code: 'fr', name: 'French', nativeName: 'Français' },
        ],
        sources: RENAME_SOURCE,
        ...overrides,
      });
    }

    it('renames a key everywhere it lives and keeps its translations', () => {
      fixture = renameFixture();
      // Weblate work on a key that is not renamed does not block.
      releaseToWeblate(fixture.dir, { fr: { Hello: 'Salut' } });
      const { exitCode, stdout } = spawnScript(SCRIPT, ['--fix', '--rename', 'World=LabelWorld'], {
        cwd: fixture.dir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/no unreleased work on these keys since v1\.0\.0/);
      expect(stdout).toMatch(/Renamed.* World → LabelWorld \(1 translation\(s\) kept\)/);

      // en_US stays sorted, and the translation moved in fr.
      expect(readText(fixture.dir, 'locale/custom/en_US.json')).toBe(
        JSON.stringify({ Hello: 'Hello', LabelWorld: 'World', World2: 'Second world' }, null, 2) +
          '\n',
      );
      expect(readJson(fixture.dir, 'locale/custom/fr.json')).toEqual({
        Hello: 'Bonjour',
        LabelWorld: 'Monde',
      });
      expect(readJson(fixture.dir, 'locale/seed/seeded.json')).toEqual({
        fr: { LabelWorld: 'web@abc' },
      });
      expect(readText(fixture.dir, 'locale/seed/keymap.yml')).toMatch(/^LabelWorld:\n/);
      // The source key inside the entry is another project's name: left alone.
      expect(readText(fixture.dir, 'locale/seed/keymap.yml')).toMatch(/key: World,/);
      expect(readJson(fixture.dir, 'settings/settings.json')).toEqual([
        { titleKey: 'LabelWorld', descriptionKey: 'World2' },
      ]);
      expect(readText(fixture.dir, 'source/main.bs')).toMatch(/translationKeys\.LabelWorld\)/);
      expect(readText(fixture.dir, 'tests/source/unit/main.spec.bs')).toMatch(
        /translationKeys\.LabelWorld\)/,
      );
      // A longer key that starts with the old name is a different key.
      expect(readText(fixture.dir, 'source/main.bs')).toMatch(/translationKeys\.World2\)/);
      // Prose is reported for a person, never rewritten.
      expect(stdout).toMatch(/Still mentioned[\s\S]*docs\/note\.md:1 World/);
      expect(readText(fixture.dir, 'docs/note.md')).toMatch(/The World key/);
    });

    it('refuses the whole batch when one pair is invalid, and writes nothing', () => {
      fixture = renameFixture();
      const before = readText(fixture.dir, 'locale/custom/fr.json');
      const { exitCode, stdout } = spawnScript(
        SCRIPT,
        ['--fix', '--rename', 'World=LabelWorld', '--rename', 'Hello=World2'],
        { cwd: fixture.dir },
      );
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/World2 is already in en_US\.json/);
      expect(stdout).toMatch(/Nothing was renamed/);
      expect(readText(fixture.dir, 'locale/custom/fr.json')).toBe(before);
      expect(readText(fixture.dir, 'source/main.bs')).toMatch(/translationKeys\.World\)/);
    });

    it('refuses a new name a locale file already holds as an orphan', () => {
      fixture = renameFixture({
        locales: { fr: { Hello: 'Bonjour', LabelWorld: 'stale' } },
      });
      const { exitCode, stdout } = spawnScript(SCRIPT, ['--fix', '--rename', 'World=LabelWorld'], {
        cwd: fixture.dir,
      });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/fr\.json already has LabelWorld/);
    });

    it('refuses an unknown key, a malformed pair and a plural key', () => {
      fixture = renameFixture();
      const { exitCode, stdout } = spawnScript(
        SCRIPT,
        ['--fix', '--rename', 'Nope=LabelNope', '--rename', 'World', '--rename', 'Hello=HelloOne'],
        { cwd: fixture.dir },
      );
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/Nope is not in en_US\.json/);
      expect(stdout).toMatch(/"World": expected OldKey=NewKey/);
      expect(stdout).toMatch(/plural keys are not supported/);
    });

    it('refuses when Weblate changed or added a translation of an old key since the release', () => {
      fixture = renameFixture();
      releaseToWeblate(fixture.dir, { fr: { World: 'Monde (Weblate)' }, de: { World: 'Welt' } });
      const before = readText(fixture.dir, 'locale/custom/fr.json');
      const { exitCode, stdout } = spawnScript(SCRIPT, ['--fix', '--rename', 'World=LabelWorld'], {
        cwd: fixture.dir,
      });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/Weblate changed these since release v1\.0\.0/);
      expect(stdout).toMatch(/de World: undefined → "Welt"/);
      expect(stdout).toMatch(/fr World: "Monde" → "Monde \(Weblate\)"/);
      expect(stdout).toMatch(/Nothing was renamed/);
      expect(readText(fixture.dir, 'locale/custom/fr.json')).toBe(before);
      expect(readText(fixture.dir, 'source/main.bs')).toMatch(/translationKeys\.World\)/);
    });

    it('refuses when Weblate cannot be read, unless told to skip the check', () => {
      fixture = renameFixture(); // not a git checkout: no weblate branch to read
      const refused = spawnScript(SCRIPT, ['--fix', '--rename', 'World=LabelWorld'], {
        cwd: fixture.dir,
      });
      expect(refused.exitCode).toBe(1);
      expect(refused.stdout).toMatch(/could not fetch origin\/weblate/);
      expect(readJson(fixture.dir, 'locale/custom/fr.json')).toHaveProperty('World');

      const skipped = spawnScript(
        SCRIPT,
        ['--fix', '--rename', 'World=LabelWorld', '--skip-weblate-check'],
        { cwd: fixture.dir },
      );
      expect(skipped.exitCode).toBe(0);
      expect(skipped.stdout).toMatch(/Weblate was not checked/);
      expect(readJson(fixture.dir, 'locale/custom/fr.json')).toHaveProperty('LabelWorld');
    });

    it('refuses a new name the seed keymap or ledger already holds', () => {
      fixture = renameFixture({
        sources: {
          ...RENAME_SOURCE,
          'locale/seed/keymap.yml': 'LabelWorld:\n  en: World\n',
          'locale/seed/seeded.json': { de: { LabelHello: 'web@abc' } },
        },
      });
      const { exitCode, stdout } = spawnScript(
        SCRIPT,
        ['--fix', '--rename', 'World=LabelWorld', '--rename', 'Hello=LabelHello'],
        { cwd: fixture.dir },
      );
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/keymap\.yml already has an entry for LabelWorld/);
      expect(stdout).toMatch(/seeded\.json already records LabelHello \(de\)/);
    });

    it('refuses to rename in check mode, and writes nothing', () => {
      fixture = renameFixture();
      const before = readText(fixture.dir, 'locale/custom/en_US.json');
      const { exitCode, stdout } = spawnScript(SCRIPT, ['--rename', 'World=LabelWorld'], {
        cwd: fixture.dir,
      });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/--rename writes files/);
      expect(readText(fixture.dir, 'locale/custom/en_US.json')).toBe(before);
    });

    it('accepts --rename=Old=New and reports mentions under dot-folders', () => {
      fixture = renameFixture({
        sources: { ...RENAME_SOURCE, '.claude/skills/x/SKILL.md': 'Use World here.\n' },
      });
      releaseToWeblate(fixture.dir);
      const { exitCode, stdout } = spawnScript(SCRIPT, ['--fix', '--rename=World=LabelWorld'], {
        cwd: fixture.dir,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/Renamed.* World → LabelWorld/);
      expect(stdout).toMatch(/\.claude\/skills\/x\/SKILL\.md:1 World/);
    });
  });
});
