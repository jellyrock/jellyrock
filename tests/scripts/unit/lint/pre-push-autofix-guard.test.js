// The pre-push hook skips its auto-fix steps when the working tree is dirty, so
// work in progress is not swept into the "chore: auto-fix via pre-push hook"
// commit by `git add -A`. "Dirty" must include untracked files that .gitignore
// does not cover: `git diff-index HEAD` sees tracked files only.
//
// The guard's condition is read out of the hook's text and run with `sh` in a
// temporary repo, so the test follows what the hook does.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gitSafeEnv } from '../_helpers/git-env.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

// The text between `if ` and `; then` on the line that runs `git diff-index`.
function guardCondition() {
  const line = readFileSync(resolve(ROOT, '.husky/pre-push'), 'utf8')
    .split('\n')
    .find((l) => /^\s*if\b.*git diff-index --quiet HEAD --.*; then\s*$/.test(l));
  const m = line && line.match(/^\s*if\s+(.*?);\s*then\s*$/);
  if (!m)
    throw new Error(
      'auto-fix guard (`if ... git diff-index --quiet HEAD -- ...; then`) not found in .husky/pre-push',
    );
  return m[1];
}

describe('pre-push auto-fix guard', () => {
  let repo;
  const env = gitSafeEnv();
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });

  // Runs the hook's condition in the temp repo; true means "dirty, skip auto-fix".
  const isDirty = () => {
    const out = execFileSync(
      'sh',
      ['-c', `if ${guardCondition()}; then echo dirty; else echo clean; fi`],
      {
        cwd: repo,
        env,
        encoding: 'utf8',
      },
    );
    return out.trim() === 'dirty';
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'pre-push-guard-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'tracked.txt'), 'one\n');
    writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('counts a clean tree as clean', () => {
    expect(isDirty()).toBe(false);
  });

  it('counts a modified tracked file as dirty', () => {
    writeFileSync(join(repo, 'tracked.txt'), 'two\n');
    expect(isDirty()).toBe(true);
  });

  it('counts an untracked, non-ignored file as dirty', () => {
    writeFileSync(join(repo, 'untracked-wip.txt'), 'wip\n');
    expect(isDirty()).toBe(true);
  });

  it('counts an untracked file that .gitignore covers as clean', () => {
    writeFileSync(join(repo, 'ignored.txt'), 'ignored\n');
    expect(isDirty()).toBe(false);
  });
});
