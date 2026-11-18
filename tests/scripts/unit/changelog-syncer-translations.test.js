// The Translations section of scripts/changelog-syncer.js: one line counting the
// translations a release adds, read from the locale files rather than from commit
// subjects, so it reads the same on the release branch (Weblate's own commits) and on
// main (one squash commit carrying them).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import { createGitFixture } from './_helpers/temp-git-fixture.js';

const HEADER =
  '<!-- markdownlint-disable -->\n# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).\n\n';

const WEBLATE = 'https://translate.jellyrock.app/projects/jellyrock/roku/';

/** A fake `gh` crediting every commit to `tester`, as in changelog-syncer.test.js. */
function sync(dir) {
  const bin = join(dir, '.git', 'fake-gh-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'gh'),
    '#!/bin/sh\ncase "$*" in\n' +
      '  *compare/*|*"commits?sha="*) git log --all --format="%H%x09tester" ;;\n' +
      '  *search/issues*|*"commits?author="*) echo 0 ;;\n' +
      '  *) echo "unexpected gh call: $*" >&2; exit 1 ;;\n' +
      'esac\n',
    { mode: 0o755 },
  );
  return spawnScript('scripts/changelog-syncer.js', ['sync-unreleased'], {
    cwd: dir,
    env: { PATH: `${bin}:${process.env.PATH}` },
  });
}

const locale = (strings) => JSON.stringify(strings, null, 2) + '\n';

/** A repo tagged v1.0.0 with en_US, de and fr, and an empty CHANGELOG.md. */
function released() {
  const fixture = createGitFixture();
  mkdirSync(join(fixture.dir, 'locale', 'custom'), { recursive: true });
  writeFileSync(join(fixture.dir, 'CHANGELOG.md'), HEADER);
  fixture.commit('chore: initial', {
    'locale/custom/en_US.json': locale({ Hello: 'Hello', Bye: 'Bye', Old: 'Old' }),
    'locale/custom/de.json': locale({ Hello: 'Hallo', Old: 'Alt' }),
    'locale/custom/fr.json': locale({ Hello: 'Bonjour' }),
  });
  fixture.tag('v1.0.0');
  return fixture;
}

const unreleased = (dir) =>
  readFileSync(join(dir, 'CHANGELOG.md'), 'utf8').split('## [Unreleased]')[1] ?? '';

describe('changelog-syncer.js: Translations', () => {
  let fixture;

  afterEach(() => {
    fixture?.cleanup();
    fixture = undefined;
  });

  it('counts new and changed strings per release, not Weblate commit subjects', () => {
    fixture = released();
    fixture.commit(
      'Translated using Weblate (French)\n\n' +
        'Co-authored-by: Ana Lopes <ana@example.org>\n' +
        'Co-authored-by: Weblate <noreply@weblate.org>\n' +
        'Co-authored-by: jellyrock[bot] <admin@jellyrock.app>',
      {
        'locale/custom/de.json': locale({ Hello: 'Guten Tag', Bye: 'Tschüss', Old: 'Alt' }),
        'locale/custom/fr.json': locale({ Hello: 'Bonjour', Bye: 'Au revoir' }),
      },
    );
    fixture.commit('fix: something users see');

    expect(sync(fixture.dir).exitCode).toBe(0);
    const section = unreleased(fixture.dir);
    expect(section).not.toMatch(/Translated using Weblate/);
    // de: one changed and one new string; fr: one new.
    expect(section).toContain(
      `### Translations\n\n- 3 new or updated strings in 2 languages by Ana Lopes on [Weblate](${WEBLATE})\n`,
    );
    // Last of the change sections, above Dependencies.
    expect(section).toMatch(/### Fixed\n[\s\S]*\n### Translations\n/);
  });

  it('credits translators on Weblate when only Weblate and anonymous suggestions wrote them', () => {
    // An anonymous suggestion accepted in Weblate comes through as Weblate or the bot.
    fixture = released();
    fixture.commit(
      'chore: refresh translation files from weblate\n\n' +
        'Co-authored-by: Weblate <noreply@weblate.org>\n' +
        'Co-authored-by: jellyrock[bot] <admin@jellyrock.app>',
      { 'locale/custom/fr.json': locale({ Hello: 'Bonjour', Bye: 'Au revoir' }) },
    );

    expect(sync(fixture.dir).exitCode).toBe(0);
    expect(unreleased(fixture.dir)).toContain(
      `### Translations\n\n- 1 new or updated string in 1 language by translators on [Weblate](${WEBLATE})\n`,
    );
  });

  it('ignores en_US, removed keys, and keys renamed with their translation', () => {
    fixture = released();
    fixture.commit('feat: add a string', {
      'locale/custom/en_US.json': locale({ Hello: 'Hello', Bye: 'Bye', New: 'New' }),
      // Old renamed to New keeping its text, then nothing else.
      'locale/custom/de.json': locale({ Hello: 'Hallo', New: 'Alt' }),
      'locale/custom/fr.json': locale({}),
    });

    expect(sync(fixture.dir).exitCode).toBe(0);
    const section = unreleased(fixture.dir);
    expect(section).toMatch(/### Added/);
    expect(section).not.toMatch(/### Translations/);
  });
});
