// Fixture helper for tests that drive scripts/changelog-syncer.js (or any
// other script that needs a synthetic git repo).
//
// Builds a temp dir, runs `git init`, configures user, and exposes
// commit/tag/branch helpers that operate on it. The script-under-test is
// invoked via spawnScript() with cwd set to the fixture dir.
//
// Merge commits are intentionally rejected: changelog-syncer.js shells out to
// `gh pr view` for any commit whose subject begins with "Merge pull request",
// which would either fail (no auth) or hit live GitHub. Non-merge commits keep
// tests offline and hermetic.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

/**
 * Build a temp git-repo fixture.
 *
 * @returns {{
 *   dir: string,
 *   commit: (msg: string, files?: Object<string, string>) => void,
 *   tag: (name: string) => void,
 *   branch: (name: string) => void,
 *   git: (...args: string[]) => string,
 *   cleanup: () => void,
 * }}
 */
export function createGitFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-changelog-syncer-'));

  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  // Disable signing so tests run on contributor machines that have commit.gpgsign=true.
  git(dir, 'config', 'commit.gpgsign', 'false');

  return {
    dir,
    commit(msg, files) {
      if (msg.startsWith('Merge ')) {
        throw new Error(
          `temp-git-fixture refuses merge commits — changelog-syncer shells to gh pr view for them. msg="${msg}"`,
        );
      }
      if (files) {
        for (const [relPath, contents] of Object.entries(files)) {
          writeFileSync(join(dir, relPath), contents);
        }
      } else {
        // Touch a placeholder so there's always a real diff.
        writeFileSync(join(dir, `_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`), msg);
      }
      git(dir, 'add', '.');
      git(dir, 'commit', '--quiet', '--no-gpg-sign', '-m', msg);
    },
    tag(name) {
      git(dir, 'tag', name);
    },
    branch(name) {
      git(dir, 'branch', name);
    },
    git: (...args) => git(dir, ...args),
    cleanup() {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
