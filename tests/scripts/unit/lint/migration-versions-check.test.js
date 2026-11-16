/**
 * Unit tests for the migration version check.
 *
 * The case it exists for: a migration numbered while one release was the latest, then
 * left at that number after another release shipped. Every user of the newer release
 * would skip it.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkMigrationVersions,
  compareVersions,
  parseMigrationVersions,
  releaseFromBranch,
} from '../../../../scripts/lint/migration-versions-check.js';
import { spawnScript } from '../_helpers/spawn-script.js';
import { createGitFixture } from '../_helpers/temp-git-fixture.js';

const SCRIPT = 'scripts/lint/migration-versions-check.js';

const RELEASED = `
' client version when settings were renamed
const SETTINGS_MIGRATION_VERSION = "1.1.0"

' client version when homeSection settings were removed
const HOMESECTION_CLEANUP_VERSION = "2.13.0"
`;

/** The released file plus one new constant at `version`. */
function withNew(version) {
  return `${RELEASED}
' client version when a library's saved view became its default tab
const LIBRARY_TAB_MIGRATION_VERSION = "${version}"
`;
}

const versions = { previousVersion: '3.4.0', releaseVersion: '3.5.0' };

describe('parseMigrationVersions', () => {
  it('reads each version constant, and nothing else', () => {
    const { constants, malformed } = parseMigrationVersions(
      `${RELEASED}const NOT_A_MIGRATION = "x"\n`,
    );
    expect([...constants]).toEqual([
      ['SETTINGS_MIGRATION_VERSION', '1.1.0'],
      ['HOMESECTION_CLEANUP_VERSION', '2.13.0'],
    ]);
    expect(malformed).toEqual([]);
  });

  it('reads an indented, differently cased or commented constant', () => {
    const { constants } = parseMigrationVersions(
      `  Const LATE_MIGRATION_VERSION = "3.5.0" ' added late\n`,
    );
    expect([...constants]).toEqual([['LATE_MIGRATION_VERSION', '3.5.0']]);
  });

  it('reports a version constant whose value is not a quoted x.y.z', () => {
    const { constants, malformed } = parseMigrationVersions(
      `const SHORT_VERSION = "3.5"\nconst SINGLE_VERSION = '3.5.0'\nconst BARE_VERSION = 3\n`,
    );
    expect(constants.size).toBe(0);
    expect(malformed.map((m) => m.name)).toEqual([
      'SHORT_VERSION',
      'SINGLE_VERSION',
      'BARE_VERSION',
    ]);
  });

  it('answers nothing for no text', () => {
    expect(parseMigrationVersions(undefined).constants.size).toBe(0);
  });
});

describe('compareVersions', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('3.10.0', '3.9.0')).toBeGreaterThan(0);
    expect(compareVersions('3.4.0', '3.4.0')).toBe(0);
    expect(compareVersions('3.3.2', '3.4.0')).toBeLessThan(0);
  });
});

describe('releaseFromBranch', () => {
  it('reads the version from a release branch, and nothing from any other', () => {
    expect(releaseFromBranch('release-3.5.0')).toBe('3.5.0');
    expect(releaseFromBranch('feat/release-3.5.0')).toBeUndefined();
    expect(releaseFromBranch('release-3.5')).toBeUndefined();
    expect(releaseFromBranch('')).toBeUndefined();
    expect(releaseFromBranch(undefined)).toBeUndefined();
  });
});

describe('checkMigrationVersions: a new constant', () => {
  it('fails one at or below the previous release', () => {
    for (const version of ['3.3.2', '3.4.0']) {
      const result = checkMigrationVersions({
        current: withNew(version),
        previous: RELEASED,
        ...versions,
      });
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0].message).toContain('would skip it. Set it to 3.5.0.');
    }
  });

  it('fails one above this release', () => {
    const result = checkMigrationVersions({
      current: withNew('3.6.0'),
      previous: RELEASED,
      ...versions,
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toContain('would run on every launch until a later release');
  });

  it('passes one above the previous release and up to this one', () => {
    for (const version of ['3.4.1', '3.5.0']) {
      const result = checkMigrationVersions({
        current: withNew(version),
        previous: RELEASED,
        ...versions,
      });
      expect(result.problems).toEqual([]);
      expect(result.checked).toEqual(['LIBRARY_TAB_MIGRATION_VERSION']);
    }
  });

  it('checks only the floor when no release is given', () => {
    const floorOnly = { previousVersion: '3.4.0' };
    const high = checkMigrationVersions({
      current: withNew('9.0.0'),
      previous: RELEASED,
      ...floorOnly,
    });
    expect(high.problems).toEqual([]);

    const low = checkMigrationVersions({
      current: withNew('3.4.0'),
      previous: RELEASED,
      ...floorOnly,
    });
    expect(low.problems).toHaveLength(1);
    expect(low.problems[0].message).toContain('Set it to the release it ships in, above 3.4.0.');
  });

  it('checks every constant when the previous release had no file', () => {
    const result = checkMigrationVersions({ current: withNew('3.5.0'), previous: '', ...versions });
    expect(result.checked).toHaveLength(3);
    expect(result.problems).toHaveLength(2);
  });

  it('fails a malformed version constant', () => {
    const result = checkMigrationVersions({
      current: `${RELEASED}const SHORT_MIGRATION_VERSION = "3.5"\n`,
      previous: RELEASED,
      ...versions,
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toContain(
      'SHORT_MIGRATION_VERSION is "3.5", not a quoted x.y.z version',
    );
  });
});

describe('checkMigrationVersions: a released constant', () => {
  it('leaves an unchanged one alone', () => {
    const result = checkMigrationVersions({ current: RELEASED, previous: RELEASED, ...versions });
    expect(result.checked).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it('fails a changed value, and says to put it back rather than raise it', () => {
    const changed = RELEASED.replace('"2.13.0"', '"3.5.0"');
    const result = checkMigrationVersions({ current: changed, previous: RELEASED, ...versions });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toContain(
      'HOMESECTION_CLEANUP_VERSION was released as 2.13.0 and is now 3.5.0',
    );
    expect(result.problems[0].message).toContain('Put it back to 2.13.0');
    expect(result.problems[0].message).not.toContain('Set it to');
  });

  it('passes a rename that keeps the value', () => {
    const renamed = RELEASED.replace('HOMESECTION_CLEANUP_VERSION', 'HOME_SECTION_CLEANUP_VERSION');
    const result = checkMigrationVersions({ current: renamed, previous: RELEASED, ...versions });
    expect(result.problems).toEqual([]);
    expect(result.renamed).toEqual([
      { from: 'HOMESECTION_CLEANUP_VERSION', to: 'HOME_SECTION_CLEANUP_VERSION' },
    ]);
  });

  it('passes a removal', () => {
    const removed = RELEASED.replace(/^const HOMESECTION.*$/m, '');
    const result = checkMigrationVersions({ current: removed, previous: RELEASED, ...versions });
    expect(result.problems).toEqual([]);
    expect(result.removed).toEqual(['HOMESECTION_CLEANUP_VERSION']);
  });

  it('pairs a rename by value only once, so a second new constant at that value is still checked', () => {
    const current = `${RELEASED.replace('HOMESECTION_CLEANUP_VERSION', 'HOME_SECTION_CLEANUP_VERSION')}const ALSO_OLD_VERSION = "2.13.0"\n`;
    const result = checkMigrationVersions({ current, previous: RELEASED, ...versions });
    expect(result.renamed).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toContain('would skip it');
  });
});

describe('the command line', () => {
  /** @type {ReturnType<typeof createGitFixture>[]} */
  const fixtures = [];
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
  });

  /** A repo with `released` tagged v3.4.0, then `current` in the working tree. */
  function repo(released, current = released) {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    mkdirSync(join(fixture.dir, 'source'), { recursive: true });
    fixture.commit('release', { 'source/migrations.bs': released });
    fixture.tag('v3.4.0');
    writeFileSync(join(fixture.dir, 'source/migrations.bs'), current);
    return fixture;
  }

  const run = (fixture, args) => spawnScript(SCRIPT, [...args, '--root', fixture.dir]);

  it('passes a new migration numbered for the release, finding the previous tag itself', () => {
    const result = run(repo(RELEASED, withNew('3.5.0')), ['--release', '3.5.0']);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'OK for 3.5.0 (previous 3.4.0). New since then: LIBRARY_TAB_MIGRATION_VERSION.',
    );
  });

  it('fails one numbered for the previous release, with an annotation', () => {
    const result = run(repo(RELEASED, withNew('3.4.0')), ['--previous', 'v3.4.0']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('::error::LIBRARY_TAB_MIGRATION_VERSION is 3.4.0');
  });

  it('takes the release from a release branch name, and checks only the floor on any other', () => {
    const fixture = repo(RELEASED, withNew('3.6.0'));
    expect(run(fixture, ['--branch', 'release-3.5.0']).exitCode).toBe(1);
    expect(run(fixture, ['--branch', 'feat/library-tabs']).exitCode).toBe(0);
  });

  it('stops on a tag that does not exist, instead of treating every constant as new', () => {
    const result = run(repo(RELEASED), ['--release', '3.5.0', '--previous', 'v9.9.9']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('::error::');
    expect(result.stderr).toContain('v9.9.9 is not a tag in this repository');
  });

  it('treats every constant as new when the file did not exist at the tag', () => {
    const fixture = createGitFixture();
    fixtures.push(fixture);
    fixture.commit('before migrations');
    fixture.tag('v3.4.0');
    mkdirSync(join(fixture.dir, 'source'), { recursive: true });
    writeFileSync(join(fixture.dir, 'source/migrations.bs'), RELEASED);
    const result = run(fixture, ['--release', '3.5.0']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SETTINGS_MIGRATION_VERSION is 1.1.0');
  });

  it('stops on a file with no version constants', () => {
    const result = run(repo(RELEASED, "' nothing here\n"), ['--release', '3.5.0']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('::error::');
    expect(result.stderr).toContain('no migration version constants found');
  });

  it('refuses a release that is not above the previous one', () => {
    const result = run(repo(RELEASED), ['--release', '3.4.0']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('release 3.4.0 is not above the previous release 3.4.0');
  });

  it('refuses a flag with no value', () => {
    for (const args of [['--previous'], ['--release'], ['--previous', '--release', '3.5.0']]) {
      const result = run(repo(RELEASED), args);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/needs a value/);
    }
  });

  it('refuses both --release and --branch', () => {
    const result = run(repo(RELEASED), ['--release', '3.5.0', '--branch', 'release-3.5.0']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--release or --branch, not both');
  });
});
