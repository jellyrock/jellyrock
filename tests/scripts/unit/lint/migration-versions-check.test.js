/**
 * Unit tests for the release-time migration version check.
 *
 * The case it exists for: a migration numbered while one release was the latest, then
 * left at that number after another release shipped. Every user of the newer release
 * would skip it.
 */
import { describe, it, expect } from 'vitest';
import {
  checkMigrationVersions,
  compareVersions,
  parseMigrationVersions,
} from '../../../../scripts/lint/migration-versions-check.js';
import { spawnScript } from '../_helpers/spawn-script.js';

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

describe('parseMigrationVersions', () => {
  it('reads each version constant, and nothing else', () => {
    const found = parseMigrationVersions(
      `${RELEASED}const NOT_A_MIGRATION = "x"\n  const INDENTED_VERSION = "9.9.9"\n`,
    );
    expect([...found]).toEqual([
      ['SETTINGS_MIGRATION_VERSION', '1.1.0'],
      ['HOMESECTION_CLEANUP_VERSION', '2.13.0'],
    ]);
  });

  it('answers an empty map for no text', () => {
    expect(parseMigrationVersions(undefined).size).toBe(0);
  });
});

describe('compareVersions', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('3.10.0', '3.9.0')).toBeGreaterThan(0);
    expect(compareVersions('3.4.0', '3.4.0')).toBe(0);
    expect(compareVersions('3.3.2', '3.4.0')).toBeLessThan(0);
  });
});

describe('checkMigrationVersions', () => {
  const versions = { previousVersion: '3.4.0', releaseVersion: '3.5.0' };

  it('fails a new migration numbered at or below the previous release', () => {
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

  it('fails a new migration numbered above this release', () => {
    const result = checkMigrationVersions({
      current: withNew('3.6.0'),
      previous: RELEASED,
      ...versions,
    });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toContain('would run again after the next release');
  });

  it('passes a new migration above the previous release and up to this one', () => {
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

  it('leaves released migrations alone, and checks one whose value changed', () => {
    expect(
      checkMigrationVersions({ current: RELEASED, previous: RELEASED, ...versions }).checked,
    ).toEqual([]);

    const changed = RELEASED.replace('"2.13.0"', '"2.14.0"');
    const result = checkMigrationVersions({ current: changed, previous: RELEASED, ...versions });
    expect(result.checked).toEqual(['HOMESECTION_CLEANUP_VERSION']);
    expect(result.problems).toHaveLength(1);
  });

  it('checks every constant when the previous release had no file', () => {
    const result = checkMigrationVersions({ current: withNew('3.5.0'), previous: '', ...versions });
    expect(result.checked).toHaveLength(3);
    expect(result.problems).toHaveLength(2);
  });
});

describe('the command line', () => {
  it('refuses to run without a release version', () => {
    const result = spawnScript('scripts/lint/migration-versions-check.js', []);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--release <x.y.z> is required');
  });
});
