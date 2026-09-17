// Environment scrubber for tests that run `git` against a temp repo.
//
// WHY THIS EXISTS
// ---------------
// `git` resolves its repository from the ENVIRONMENT before it looks at the
// working directory: `GIT_DIR` wins over `cwd`. A test that builds a fixture with
// `execFileSync('git', […], { cwd: tempDir })` therefore writes into whatever
// `GIT_DIR` names, and `cwd` decides nothing.
//
// Normally nothing sets `GIT_DIR`, so this never shows. Git sets it for hooks run
// in a LINKED WORKTREE — measured 2026-09-17: `git hook run pre-push` exports
// `GIT_DIR=<repo>/.git/worktrees/<name>` from a worktree and exports nothing from
// the main checkout. So `npm run test:scripts` under the pre-push hook, from a
// worktree, ran every fixture's `git init` / `config` / `commit` / `tag` against
// the real repository: it moved the branch being pushed to a test commit, wrote
// `user.name=Test` and `core.bare=true` into the shared config (which made the
// main checkout unusable), and left junk tags behind. 38 tests failed, which is
// how it was noticed; the repo damage was silent.
//
// Every spawn of `git`, and of any script that shells out to `git`, therefore
// passes the env through `gitSafeEnv()`.

const REPO_VARS = [
  'GIT_DIR',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
];

/**
 * A copy of `env` with every variable that points git at a repository removed,
 * so `cwd` decides which repo a spawned git touches.
 *
 * @param {Record<string, string|undefined>} [env] defaults to `process.env`
 * @returns {Record<string, string|undefined>}
 */
export function gitSafeEnv(env = process.env) {
  const copy = { ...env };
  for (const name of REPO_VARS) delete copy[name];
  return copy;
}

export const GIT_REPO_ENV_VARS = REPO_VARS;
