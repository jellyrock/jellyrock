// Merge commits in scripts/changelog-syncer.js: a merge a person makes to bring a branch
// up to date is not a change, whatever its subject says, while a pull request's merge
// commit still becomes that PR's line.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import { createGitFixture } from './_helpers/temp-git-fixture.js';

const HEADER =
  '<!-- markdownlint-disable -->\n# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).\n\n';

/** A fake `gh` crediting every commit to `tester`; PR 7 is a feature. */
function sync(dir) {
  const bin = join(dir, '.git', 'fake-gh-bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'gh'),
    '#!/bin/sh\ncase "$*" in\n' +
      '  "pr view 7 "*) echo \'{"title":"feat: pull request seven","labels":[],"author":"tester"}\' ;;\n' +
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

/** Merge a one-commit side branch into main with `subject`, keeping a real merge commit. */
function merge(fixture, n, subject) {
  fixture.git('switch', '--quiet', '-c', `side-${n}`, 'main');
  fixture.commit(`chore: side work ${n}`);
  fixture.git('switch', '--quiet', 'main');
  fixture.git('merge', '--quiet', '--no-ff', '--no-gpg-sign', '-m', subject, `side-${n}`);
}

describe('changelog-syncer.js: merge commits', () => {
  let fixture;

  afterEach(() => {
    fixture?.cleanup();
    fixture = undefined;
  });

  it('drops local merges whatever their subject, and keeps PR merges and typed commits', () => {
    fixture = createGitFixture();
    writeFileSync(join(fixture.dir, 'CHANGELOG.md'), HEADER);
    fixture.commit('chore: initial');
    fixture.tag('v1.0.0');

    fixture.commit('fix: a typed commit');
    merge(fixture, 1, "Merge remote-tracking branch 'origin/main' into release-9.9.9");
    merge(fixture, 2, "Merge branch 'main' into release-9.9.9");
    merge(fixture, 3, 'sync with main');
    merge(fixture, 4, 'Merge pull request #7 from org/some-branch');

    const result = sync(fixture.dir);
    expect(result.exitCode).toBe(0);
    const section = readFileSync(join(fixture.dir, 'CHANGELOG.md'), 'utf8').split(
      '## [Unreleased]',
    )[1];
    expect(section).toContain('a typed commit');
    expect(section).toContain('pull request seven');
    expect(section).not.toMatch(/remote-tracking/);
    expect(section).not.toMatch(/Merge branch/);
    expect(section).not.toMatch(/sync with main/);
  });
});
