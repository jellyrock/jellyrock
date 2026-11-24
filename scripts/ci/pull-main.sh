#!/usr/bin/env bash
# scripts/ci/pull-main.sh: catch up with origin/main, then reinstall if the pull
# left node_modules stale. For a CI job that ran `npm ci`, then pushes: the
# pre-push hook refuses a stale install, and a dependency bump merged during the
# run brings a new lockfile with the pull.
#
# Staleness comes from `check:install`, not from a diff of the pull, because a
# `git checkout` before the pull can change the lockfile too.
#
# Usage: bash scripts/ci/pull-main.sh   (from the repo root)

set -euo pipefail

# One function, so bash has read the whole script before the pull rewrites it.
main() {
  git pull --rebase --autostash origin main
  if ! npm run -s check:install; then
    echo "The pull brought a new lockfile or patches: running npm ci."
    npm ci
  fi
}

main
