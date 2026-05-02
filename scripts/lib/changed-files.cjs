// Computes the set of files touched in the current branch / working tree.
//
// Used by the end-of-turn agent hooks (check-touched-related-files.cjs and
// check-touched-lint.cjs) to scope their checks to "what changed in this
// session" rather than scanning the whole repo every turn.
//
// Returns the union of:
//   - committed changes since the branch base (`git diff <base>...HEAD`)
//   - uncommitted working-tree changes (`git diff HEAD`)
//   - untracked files (`git ls-files --others --exclude-standard`)
//
// The base ref defaults to `origin/main` (then `main`) and can be overridden
// via the `baseRef` arg or the `BASE_REF` env var.
//
// Stdlib only — these scripts run before / outside of `npm ci`.

'use strict';

const { execSync } = require('child_process');

function safeDiff(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {string} [baseRef='main'] base ref to diff against
 * @returns {string[]} unique repo-relative paths
 */
function changedFiles(baseRef = 'main') {
  const candidates = [`origin/${baseRef}`, baseRef, 'origin/main', 'main'];
  let committed = [];
  for (const base of candidates) {
    try {
      execSync(`git rev-parse --verify ${base}`, { stdio: 'ignore' });
      committed = safeDiff(`git diff ${base}...HEAD --name-only`);
      break;
    } catch {
      // ref not resolvable — try next
    }
  }
  return Array.from(new Set([...committed, ...workingTreeFiles()]));
}

/**
 * Files that are uncommitted (modified, staged-but-not-committed) plus
 * untracked. Used by hooks that want to focus on work pre-commit hasn't
 * processed yet — committed files are pre-commit's job.
 *
 * @returns {string[]} unique repo-relative paths
 */
function workingTreeFiles() {
  const uncommitted = safeDiff('git diff HEAD --name-only');
  const untracked = safeDiff('git ls-files --others --exclude-standard');
  return Array.from(new Set([...uncommitted, ...untracked]));
}

module.exports = { changedFiles, workingTreeFiles };
