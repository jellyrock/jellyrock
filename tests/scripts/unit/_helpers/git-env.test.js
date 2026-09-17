// Tests for the git env scrubber, and for the fixture that depends on it.
//
// The bug this guards: git resolves its repo from GIT_DIR before cwd, and git
// exports GIT_DIR to hooks run in a linked worktree. Without scrubbing, running
// these tests under the pre-push hook from a worktree rewrote the real
// repository — branch ref, shared config and tags. See git-env.js.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitSafeEnv, GIT_REPO_ENV_VARS } from './git-env.js';
import { createGitFixture } from './temp-git-fixture.js';

describe('gitSafeEnv', () => {
  it('removes every variable that points git at a repository', () => {
    const dirty = { PATH: '/usr/bin', GIT_DIR: '/x/.git', GIT_INDEX_FILE: '/x/.git/index' };
    const clean = gitSafeEnv(dirty);
    expect(clean.PATH).toBe('/usr/bin');
    for (const name of GIT_REPO_ENV_VARS) expect(clean).not.toHaveProperty(name);
  });

  it('does not mutate the env it was given', () => {
    const dirty = { GIT_DIR: '/x/.git' };
    gitSafeEnv(dirty);
    expect(dirty.GIT_DIR).toBe('/x/.git');
  });
});

describe('temp git fixture under an inherited GIT_DIR', () => {
  let decoy;
  let fixture;
  afterEach(() => {
    fixture?.cleanup();
    if (decoy) rmSync(decoy, { recursive: true, force: true });
    decoy = undefined;
    fixture = undefined;
    delete process.env.GIT_DIR;
  });

  it('commits into its own repo, leaving the one GIT_DIR names untouched', () => {
    // A stand-in for the real repository, exactly as the pre-push hook presents it.
    decoy = mkdtempSync(join(tmpdir(), 'jellyrock-decoy-'));
    const inDecoy = (...args) =>
      execFileSync('git', args, { cwd: decoy, encoding: 'utf8', env: gitSafeEnv() }).trim();
    inDecoy('init', '--quiet', '--initial-branch=main');
    inDecoy('config', 'user.email', 'real@example.com');
    inDecoy('config', 'user.name', 'Real');
    inDecoy('commit', '--quiet', '--allow-empty', '--no-gpg-sign', '-m', 'real commit');
    const before = inDecoy('rev-parse', 'HEAD');

    process.env.GIT_DIR = join(decoy, '.git');
    fixture = createGitFixture();
    fixture.commit('feat: fixture commit');
    fixture.tag('v9.9.9');

    expect(inDecoy('rev-parse', 'HEAD')).toBe(before);
    expect(inDecoy('log', '--format=%s', '-1')).toBe('real commit');
    expect(inDecoy('config', '--local', '--get', 'user.name')).toBe('Real');
    expect(inDecoy('tag', '--list')).toBe('');
    // The fixture's own commit landed where it belongs.
    expect(
      execFileSync('git', ['log', '--format=%s', '-1'], {
        cwd: fixture.dir,
        encoding: 'utf8',
        env: gitSafeEnv(),
      }).trim(),
    ).toBe('feat: fixture commit');
  });
});
