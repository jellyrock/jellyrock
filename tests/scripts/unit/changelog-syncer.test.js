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
//
// The syncer also asks GitHub who wrote each commit and whether they contributed
// before. Every run gets a fake `gh` on PATH (fakeGh) that answers from the
// fixture's own history, so nothing reaches live GitHub;
// changelog-syncer-credits.test.js covers those answers case by case.

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnScript } from './_helpers/spawn-script.js';
import { createGitFixture } from './_helpers/temp-git-fixture.js';

// The feature catalog dates each release from the headings this script writes.
const { releaseDates } = createRequire(import.meta.url)('../../../scripts/lib/feature-facts.cjs');

const SCRIPT = 'scripts/changelog-syncer.js';

const VALID_HEADER =
  '<!-- markdownlint-disable -->\n# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).\n\n';

function readChangelog(dir) {
  return readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
}

function writeChangelog(dir, contents) {
  writeFileSync(join(dir, 'CHANGELOG.md'), contents);
}

/**
 * A fake `gh` in the fixture's .git folder (never part of its history), as an env for
 * spawnScript. It credits every commit to `tester`, who has no earlier PR or commit.
 * With `fail`, every call fails, as gh does when GitHub cannot answer.
 */
function fakeGh(dir, { fail = false } = {}) {
  const bin = join(dir, '.git', 'fake-gh-bin');
  mkdirSync(bin, { recursive: true });
  const body = fail
    ? 'echo "gh: HTTP 502" >&2\nexit 1\n'
    : 'case "$*" in\n' +
      '  *compare/*|*"commits?sha="*) git log --all --format="%H%x09tester" ;;\n' +
      '  *search/issues*|*"commits?author="*) echo 0 ;;\n' +
      '  *) echo "unexpected gh call: $*" >&2; exit 1 ;;\n' +
      'esac\n';
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\n${body}`, { mode: 0o755 });
  return { PATH: `${bin}:${process.env.PATH}` };
}

/** Run the syncer in a fixture with the fake `gh`. */
function sync(dir, args, ghOptions) {
  return spawnScript(SCRIPT, args, { cwd: dir, env: fakeGh(dir, ghOptions) });
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

      const { exitCode, stdout } = sync(fixture.dir, ['status']);
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

      const { exitCode, stdout } = sync(fixture.dir, ['status']);
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
      const { exitCode, stdout } = sync(fixture.dir, ['validate']);
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
      const { exitCode, stdout } = sync(fixture.dir, ['validate']);
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/Missing changelog header/);
    });

    it('exits 1 when CHANGELOG.md is missing the Keep a Changelog reference', () => {
      fixture = createGitFixture();
      writeChangelog(fixture.dir, '# Changelog\n\nNo reference here.\n');
      const { exitCode, stdout } = sync(fixture.dir, ['validate']);
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/Missing Keep a Changelog reference/);
    });

    it('exits 1 when there are unreleased commits but no [Unreleased] section', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: a');
      writeChangelog(fixture.dir, VALID_HEADER);

      const { exitCode, stdout } = sync(fixture.dir, ['validate']);
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/unreleased commits but no \[Unreleased\] section/);
    });

    it('exits 0 on a valid CHANGELOG.md', () => {
      fixture = createGitFixture();
      // No commits, so no unreleased-commit consistency error.
      writeChangelog(fixture.dir, VALID_HEADER);
      const { exitCode, stdout } = sync(fixture.dir, ['validate']);
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

      const { exitCode } = sync(fixture.dir, ['sync-unreleased']);
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
      const { exitCode, stdout } = sync(fixture.dir, ['sync-unreleased']);
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
      const { exitCode } = sync(fixture.dir, ['sync-unreleased']);
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

      const { exitCode } = sync(fixture.dir, ['sync-unreleased']);
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

      const first = sync(fixture.dir, ['sync-unreleased']);
      expect(first.exitCode).toBe(0);
      const afterFirst = readChangelog(fixture.dir);

      const second = sync(fixture.dir, ['sync-unreleased']);
      expect(second.exitCode).toBe(0);
      expect(readChangelog(fixture.dir)).toBe(afterFirst);
    });

    it('categorizes commits: feat → Added, fix → Fixed, security wording stays Fixed, chore → filtered', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: add login');
      fixture.commit('fix: broken auth');
      fixture.commit('chore: bump unrelated tooling');
      fixture.commit('fix: patch security vulnerability in cookies');
      writeChangelog(fixture.dir, VALID_HEADER);

      const { exitCode } = sync(fixture.dir, ['sync-unreleased']);
      expect(exitCode).toBe(0);
      const changelog = readChangelog(fixture.dir);

      expect(changelog).toMatch(/### Added[\s\S]*add login/);
      expect(changelog).toMatch(/### Fixed[\s\S]*broken auth/);
      // A word in the subject no longer moves a typed title; there is no Security section.
      expect(changelog).toMatch(/### Fixed[\s\S]*security vulnerability/);
      expect(changelog).not.toMatch(/### Security/);
      // Chore commits are filtered out entirely.
      expect(changelog).not.toMatch(/bump unrelated tooling/);
    });
  });

  describe('credits', () => {
    it('credits each line and lists New Contributors after the sections', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: add login screen');
      writeChangelog(fixture.dir, VALID_HEADER);

      expect(sync(fixture.dir, ['sync-unreleased']).exitCode).toBe(0);
      const changelog = readChangelog(fixture.dir);
      expect(changelog).toMatch(
        /- add login screen \(\[[0-9a-f]{7}\]\(.*\)\) by \[@tester\]\(https:\/\/github\.com\/tester\)/,
      );
      expect(changelog).toMatch(
        /### Added[\s\S]*### New Contributors\n\n- \[@tester\]\(https:\/\/github\.com\/tester\) made their first contribution in \[[0-9a-f]{7}\]/,
      );
    });

    it('exits 1 and leaves CHANGELOG.md as it was when GitHub cannot answer', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.0.0');
      fixture.commit('feat: add login screen');
      writeChangelog(fixture.dir, VALID_HEADER);

      const { exitCode, stderr } = sync(fixture.dir, ['sync-unreleased'], { fail: true });
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/HTTP 502/);
      expect(readChangelog(fixture.dir)).toBe(VALID_HEADER);
    });

    it('exits 1, writing nothing, when the checkout lacks the tags its released sections need', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.commit('feat: add login screen');
      const released = VALID_HEADER + '## [1.0.0] - 2025-01-01\n\n### Added\n\n- something\n';
      writeChangelog(fixture.dir, released);

      const { exitCode, stderr } = sync(fixture.dir, ['sync-unreleased']);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/\[1\.0\.0\].*fetch the tags/);
      expect(readChangelog(fixture.dir)).toBe(released);
    });

    it('syncs from the start of history before the first release', () => {
      fixture = createGitFixture();
      fixture.commit('feat: add login screen');
      writeChangelog(fixture.dir, VALID_HEADER);

      expect(sync(fixture.dir, ['sync-unreleased']).exitCode).toBe(0);
      expect(readChangelog(fixture.dir)).toMatch(/add login screen/);
    });

    it('renames [Unreleased] at release without asking GitHub', () => {
      fixture = createGitFixture();
      fixture.commit('chore: initial');
      fixture.tag('v1.2.2');
      // A PR subject: reading this commit would ask GitHub, which fails here.
      fixture.commit('feat: thing (#5)');
      fixture.tag('v1.2.3');
      writeChangelog(fixture.dir, VALID_HEADER + '## [Unreleased]\n\n### Added\n\n- thing\n');

      expect(sync(fixture.dir, ['sync-release', '1.2.3'], { fail: true }).exitCode).toBe(0);
      expect(readChangelog(fixture.dir)).toMatch(/## \[1\.2\.3\]/);
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

      const { exitCode } = sync(fixture.dir, ['sync-release', '1.2.3']);
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

      const { exitCode } = sync(fixture.dir, ['sync-release', '1.0.0']);
      expect(exitCode).toBe(0);

      const changelog = readChangelog(fixture.dir);
      expect(changelog).toContain(
        '## [1.0.0](https://github.com/jellyrock/jellyrock/releases/tag/v1.0.0)',
      );
      expect(changelog).not.toMatch(/\/compare\//);
    });

    it('writes a heading the feature catalog reads the release date from, with or without [Unreleased]', () => {
      const today = new Date().toISOString().slice(0, 10);
      for (const body of ['## [Unreleased]\n\n### Added\n\n- thing\n', '']) {
        fixture = createGitFixture();
        fixture.commit('chore: initial');
        fixture.tag('v1.2.2');
        fixture.commit('feat: thing');
        fixture.tag('v1.2.3');
        writeChangelog(fixture.dir, VALID_HEADER + body);
        expect(sync(fixture.dir, ['sync-release', '1.2.3']).exitCode).toBe(0);
        expect(releaseDates(fixture.dir).get('1.2.3')).toBe(today);
        fixture.cleanup();
        fixture = null;
      }
    });

    it('exits 1 with a format error on an invalid version string', () => {
      fixture = createGitFixture();
      const { exitCode, stderr } = sync(fixture.dir, ['sync-release', '1.2']);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/Invalid version format/);
    });
  });
});
