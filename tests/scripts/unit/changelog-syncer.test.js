// Tests for scripts/changelog-syncer.js.
//
// Each scenario builds a synthetic git-repo fixture in a tmpdir, optionally
// seeds a CHANGELOG.md, invokes the script via spawnScript with cwd set to
// the fixture, and asserts on exit code, stdout/stderr, and post-run
// CHANGELOG.md contents.
//
// Fixture rule: no merge commits and no `(#N)` PR-suffix subjects, because
// changelog-syncer shells out to `gh pr view` for both. createGitFixture
// rejects merge subjects; we keep regular commit subjects PR-number-free here.

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import { createGitFixture } from './_helpers/temp-git-fixture.js';

const SCRIPT = 'scripts/changelog-syncer.js';

const VALID_HEADER =
  '<!-- markdownlint-disable -->\n# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).\n\n';

function readChangelog(dir) {
  return readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
}

function writeChangelog(dir, contents) {
  writeFileSync(join(dir, 'CHANGELOG.md'), contents);
}

describe('changelog-syncer.js', () => {
  let fixture;

  afterEach(() => {
    if (fixture) fixture.cleanup();
    fixture = undefined;
  });

  // --------------------------------------------------------------------
  // status
  // --------------------------------------------------------------------

  describe('status', () => {
    it('reports zeros on a fresh repo with a minimal CHANGELOG.md', () => {
      fixture = createGitFixture();
      writeChangelog(fixture.dir, VALID_HEADER);

      const { exitCode, stdout } = spawnScript(SCRIPT, ['status'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/Latest tag: none/);
      expect(stdout).toMatch(/Unreleased commits: 0/);
      expect(stdout).toMatch(/Has unreleased section: false/);
      expect(stdout).toMatch(/Version entries: 0/);
    });

    it('reports tag and commits-since count', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: a');
      fixture.commit('fix: b');
      fixture.commit('feat: c');
      writeChangelog(fixture.dir, VALID_HEADER);

      const { exitCode, stdout } = spawnScript(SCRIPT, ['status'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/Latest tag: v1\.0\.0/);
      expect(stdout).toMatch(/Unreleased commits: 3/);
    });
  });

  // --------------------------------------------------------------------
  // validate
  // --------------------------------------------------------------------

  describe('validate', () => {
    it('exits 1 when CHANGELOG.md is missing', () => {
      fixture = createGitFixture();
      const { exitCode, stdout } = spawnScript(SCRIPT, ['validate'], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/CHANGELOG\.md file missing/);
    });

    it('exits 1 when CHANGELOG.md is missing the # Changelog header', () => {
      fixture = createGitFixture();
      // Has the Keep a Changelog reference but no `# Changelog` heading.
      writeChangelog(
        fixture.dir,
        'Some other heading\n\n[Keep a Changelog](https://keepachangelog.com/en/1.0.0/)\n',
      );
      const { exitCode, stdout } = spawnScript(SCRIPT, ['validate'], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/Missing changelog header/);
    });

    it('exits 1 when CHANGELOG.md is missing the Keep a Changelog reference', () => {
      fixture = createGitFixture();
      writeChangelog(fixture.dir, '# Changelog\n\nNo reference here.\n');
      const { exitCode, stdout } = spawnScript(SCRIPT, ['validate'], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/Missing Keep a Changelog reference/);
    });

    it('exits 1 when there are unreleased commits but no [Unreleased] section', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: a');
      writeChangelog(fixture.dir, VALID_HEADER);

      const { exitCode, stdout } = spawnScript(SCRIPT, ['validate'], { cwd: fixture.dir });
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/unreleased commits but no \[Unreleased\] section/);
    });

    it('exits 0 on a valid CHANGELOG.md', () => {
      fixture = createGitFixture();
      // No commits → no unreleased-commit consistency error.
      writeChangelog(fixture.dir, VALID_HEADER);
      const { exitCode, stdout } = spawnScript(SCRIPT, ['validate'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/Changelog validation passed/);
    });
  });

  // --------------------------------------------------------------------
  // sync-unreleased
  // --------------------------------------------------------------------

  describe('sync-unreleased', () => {
    it('inserts an [Unreleased] section with feat → Added and fix → Fixed', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: add login screen');
      fixture.commit('fix: broken thumbnail loader');
      writeChangelog(fixture.dir, VALID_HEADER);

      const { exitCode } = spawnScript(SCRIPT, ['sync-unreleased'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);

      const changelog = readChangelog(fixture.dir);
      expect(changelog).toMatch(/## \[Unreleased\]/);
      expect(changelog).toMatch(/### Added/);
      expect(changelog).toMatch(/add login screen/);
      expect(changelog).toMatch(/### Fixed/);
      expect(changelog).toMatch(/broken thumbnail loader/);
    });

    it('is a no-op with "No unreleased changes" when there are no commits since the latest tag', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      writeChangelog(fixture.dir, VALID_HEADER);

      const before = readChangelog(fixture.dir);
      const { exitCode, stdout } = spawnScript(SCRIPT, ['sync-unreleased'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/No unreleased changes/);
      expect(readChangelog(fixture.dir)).toBe(before);
    });

    it('creates CHANGELOG.md when none exists', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: bootstrap');

      expect(existsSync(join(fixture.dir, 'CHANGELOG.md'))).toBe(false);
      const { exitCode } = spawnScript(SCRIPT, ['sync-unreleased'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);

      const changelog = readChangelog(fixture.dir);
      expect(changelog).toMatch(/# Changelog/);
      expect(changelog).toMatch(/Keep a Changelog/);
      expect(changelog).toMatch(/## \[Unreleased\]/);
    });

    it('inserts [Unreleased] before an existing version section', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: bar');

      writeChangelog(
        fixture.dir,
        VALID_HEADER + '## [1.0.0] - 2025-01-01\n\n### Added\n\n- something\n',
      );

      const { exitCode } = spawnScript(SCRIPT, ['sync-unreleased'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);

      const changelog = readChangelog(fixture.dir);
      const unreleasedIdx = changelog.indexOf('## [Unreleased]');
      const v100Idx = changelog.indexOf('## [1.0.0]');
      expect(unreleasedIdx).toBeGreaterThan(-1);
      expect(v100Idx).toBeGreaterThan(-1);
      expect(unreleasedIdx).toBeLessThan(v100Idx);
    });

    it('is idempotent: running twice produces byte-identical CHANGELOG.md', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: a');
      fixture.commit('fix: b');
      writeChangelog(fixture.dir, VALID_HEADER);

      const first = spawnScript(SCRIPT, ['sync-unreleased'], { cwd: fixture.dir });
      expect(first.exitCode).toBe(0);
      const afterFirst = readChangelog(fixture.dir);

      const second = spawnScript(SCRIPT, ['sync-unreleased'], { cwd: fixture.dir });
      expect(second.exitCode).toBe(0);
      expect(readChangelog(fixture.dir)).toBe(afterFirst);
    });

    it('categorizes commits: feat → Added, fix → Fixed, security → Security, chore → filtered', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: add login');
      fixture.commit('fix: broken auth');
      fixture.commit('chore: bump unrelated tooling');
      fixture.commit('fix: patch security vulnerability in cookies');
      writeChangelog(fixture.dir, VALID_HEADER);

      const { exitCode } = spawnScript(SCRIPT, ['sync-unreleased'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);
      const changelog = readChangelog(fixture.dir);

      expect(changelog).toMatch(/### Added[\s\S]*add login/);
      expect(changelog).toMatch(/### Fixed[\s\S]*broken auth/);
      expect(changelog).toMatch(/### Security[\s\S]*security vulnerability/);
      // Chore commits are filtered out entirely.
      expect(changelog).not.toMatch(/bump unrelated tooling/);
    });
  });

  // --------------------------------------------------------------------
  // sync-release <version>
  // --------------------------------------------------------------------

  describe('sync-release', () => {
    it('converts [Unreleased] to a versioned section with a compare URL when a previous tag exists', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.2.2');
      fixture.commit('feat: thing');
      fixture.tag('v1.2.3');
      writeChangelog(fixture.dir, VALID_HEADER + '## [Unreleased]\n\n### Added\n\n- thing\n');

      const { exitCode } = spawnScript(SCRIPT, ['sync-release', '1.2.3'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);

      const changelog = readChangelog(fixture.dir);
      expect(changelog).not.toMatch(/## \[Unreleased\]/);
      const today = new Date().toISOString().slice(0, 10);
      expect(changelog).toContain(
        `## [1.2.3](https://github.com/jellyrock/jellyrock/compare/v1.2.2...v1.2.3) - ${today}`,
      );
    });

    it('uses the release-tag URL fallback for the first release (no previous tag)', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.commit('feat: bootstrap');
      fixture.tag('v1.0.0');
      writeChangelog(fixture.dir, VALID_HEADER + '## [Unreleased]\n\n### Added\n\n- bootstrap\n');

      const { exitCode } = spawnScript(SCRIPT, ['sync-release', '1.0.0'], { cwd: fixture.dir });
      expect(exitCode).toBe(0);

      const changelog = readChangelog(fixture.dir);
      expect(changelog).toContain(
        '## [1.0.0](https://github.com/jellyrock/jellyrock/releases/tag/v1.0.0)',
      );
      expect(changelog).not.toMatch(/\/compare\//);
    });

    it('exits 1 with a format error on an invalid version string', () => {
      fixture = createGitFixture();
      const { exitCode, stderr } = spawnScript(SCRIPT, ['sync-release', '1.2'], {
        cwd: fixture.dir,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/Invalid version format/);
    });
  });
});
