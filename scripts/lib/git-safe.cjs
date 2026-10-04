// scripts/lib/git-safe.cjs — run git in a chosen directory, never in an inherited one.
//
// git picks its repository from the ENVIRONMENT before the working directory:
// `GIT_DIR` wins over `cwd` / `-C`. Git sets it for hooks run in a linked worktree,
// so a script (or a test calling it) that runs git in a temp repo under the pre-push
// hook would otherwise write into the real repository. That happened once: it moved
// the pushed branch to a test commit and wrote `core.bare=true` into the shared
// config. tests/scripts/unit/_helpers/git-env.js has the full story and re-exports
// this list.
//
// `.cjs` per scripts/CLAUDE.md: everything in scripts/lib/ is.

'use strict';

const { execFileSync } = require('node:child_process');

const GIT_REPO_ENV_VARS = Object.freeze([
  'GIT_DIR',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
]);

/** A copy of `env` without the variables that point git at a repository. */
function gitSafeEnv(env = process.env) {
  const copy = { ...env };
  for (const name of GIT_REPO_ENV_VARS) delete copy[name];
  return copy;
}

/**
 * Run git with `args` in `cwd` and return its stdout. Throws on a non-zero exit,
 * with git's stderr in the message.
 */
function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: gitSafeEnv(),
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

module.exports = { GIT_REPO_ENV_VARS, git, gitSafeEnv };
