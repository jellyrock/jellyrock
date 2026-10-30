#!/usr/bin/env bash
#
# projects-write.sh commits and pushes one session's change to a projects folder kept in a repo of
# its own: one clone that many sessions write into at once, and that other machines push to.
#
# A write takes only the named paths' change from the clone's HEAD (other sessions' edits, staged
# or not, are never touched), applies it three-way onto a freshly fetched upstream in a temporary
# worktree, commits there and pushes. A push that loses a race fetches and tries again until the
# time limit. Then the clone is fast-forwarded to the pushed commit, waiting out git's index lock.
# Two changes to the same lines are refused, never merged by guess, and nothing is lost: on any
# refusal the files stay as written in the clone, and nothing is committed there.
#
# Usage: bash .claude/skills/start-project/projects-write.sh --subject <subject> -- <path>...
#   Run from inside the clone; each path (a file or a folder, relative or absolute) is in it.
#   PROJECTS_WRITE_TIMEOUT: seconds to keep trying (default 120).
# Exit: 0 pushed, or nothing to write · 2 usage or setup · 3 refused (the change overlaps what is
#       on the remote, or a hook refused the commit): nothing pushed, files kept · 4 not pushed
#       (the remote cannot be reached, or the time limit passed): files kept

set -uo pipefail

die()      { printf 'projects-write: %s\n' "$*" >&2; exit 2; }
refuse()   { printf 'projects-write: refused: %s\n' "$*" >&2; exit 3; }
unpushed() { printf 'projects-write: not pushed: %s\n' "$*" >&2; exit 4; }
usage="usage: projects-write.sh --subject <subject> -- <path>..."

subject=""; paths=()
while [ $# -gt 0 ]; do
  case "$1" in
    --subject) [ $# -ge 2 ] || die "$usage"; subject="$2"; shift ;;
    --) shift; paths=("$@"); break ;;
    *) die "$usage" ;;
  esac
  shift
done
[ -n "$subject" ] && [ "${#paths[@]}" -gt 0 ] || die "$usage"

root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
root="$(realpath -- "$root")"
rel=()
for p in "${paths[@]}"; do
  a="$(realpath -m -- "$p")"
  case "$a/" in "$root"/?*) rel+=("${a#"$root"/}") ;; *) die "$p is not inside $root" ;; esac
done
up="$(git -C "$root" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" \
  || die "the branch in $root has no upstream to push to"
remote="${up%%/*}"; branch="${up#*/}"
end=$((SECONDS + ${PROJECTS_WRITE_TIMEOUT:-120}))

tmp="$(mktemp -d)"; wt=""
# shellcheck disable=SC2329  # run by the EXIT trap
cleanup() { [ -z "$wt" ] || git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1; rm -rf "$tmp"; }
trap cleanup EXIT
pause() { sleep "0.$((RANDOM % 9 + 1))"; }

# The change: the named paths in the working tree against HEAD, read through a private index so
# the clone's own index (another session's staged files) is never touched.
base="$(git -C "$root" rev-parse HEAD)" || die "$root has no commit yet"
export GIT_INDEX_FILE="$tmp/index"
git -C "$root" read-tree HEAD || die "could not read HEAD in $root"
git -C "$root" add -A -- "${rel[@]}" 2>"$tmp/err" || die "could not read the paths: $(cat "$tmp/err")"
git -C "$root" diff --cached --binary "$base" -- "${rel[@]}" >"$tmp/patch"
unset GIT_INDEX_FILE
if [ ! -s "$tmp/patch" ]; then echo "nothing to write: ${rel[*]} match the last commit"; exit 0; fi

# Apply it onto the fresh upstream in a temporary worktree, commit, push; a lost race tries again.
n=0
while :; do
  n=$((n + 1))
  if ! git -C "$root" fetch -q "$remote" "$branch" 2>"$tmp/err"; then
    grep -qi 'lock' "$tmp/err" && [ "$SECONDS" -lt "$end" ] && { pause; continue; }
    unpushed "cannot fetch from $remote: $(head -1 "$tmp/err"). The files stay as written; run this again once it is reachable."
  fi
  tip="$(git -C "$root" rev-parse "refs/remotes/$remote/$branch")" || die "no $remote/$branch after fetching"
  wt="$tmp/write-$$-$n"
  git -C "$root" worktree add -q --detach "$wt" "$tip" 2>"$tmp/err" || die "could not make a worktree: $(cat "$tmp/err")"
  if ! git -C "$wt" apply --3way --index "$tmp/patch" >"$tmp/err" 2>&1; then
    refuse "the change to $(git -C "$wt" diff --name-only --diff-filter=U | tr '\n' ' ')overlaps what is already on $remote/$branch; nothing was pushed, and the files stay as written. Pull, merge the two by hand, and write again."
  fi
  if git -C "$wt" diff --cached --quiet; then
    new="$tip"   # the remote already holds this change (another writer took it along)
  else
    git -C "$wt" commit -q -m "$subject" >"$tmp/err" 2>&1 || { cat "$tmp/err" >&2; refuse "the commit was refused (a hook, most likely); nothing was pushed, and the files stay as written"; }
    new="$(git -C "$wt" rev-parse HEAD)"
    if ! git -C "$wt" push -q "$remote" "HEAD:refs/heads/$branch" 2>"$tmp/err"; then
      if grep -qiE 'rejected|fetch first|non-fast-forward|cannot lock' "$tmp/err" && [ "$SECONDS" -lt "$end" ]; then
        git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1; wt=""; pause; continue
      fi
      if grep -qiE 'rejected|fetch first|non-fast-forward' "$tmp/err"; then
        unpushed "other writers kept winning the push for ${PROJECTS_WRITE_TIMEOUT:-120}s; the files stay as written, run this again"
      fi
      unpushed "the push to $remote failed: $(head -1 "$tmp/err"). The files stay as written; run this again once it is reachable."
    fi
  fi
  git -C "$root" worktree remove --force "$wt" >/dev/null 2>&1; wt=""
  break
done

# Fast-forward the clone. Its copies of the paths already hold the pushed text: staging them lets
# the merge move HEAD without rewriting them. Another writer may have moved it past this commit.
note=""
while :; do
  cur="$(git -C "$root" rev-parse HEAD)"
  git -C "$root" merge-base --is-ancestor "$new" "$cur" && break
  if ! git -C "$root" merge-base --is-ancestor "$cur" "$new"; then
    note="this clone has commits of its own, so it was not fast-forwarded"; break
  fi
  if git -C "$root" add -A -- "${rel[@]}" 2>"$tmp/err" && git -C "$root" merge -q --ff-only "$new" >"$tmp/err" 2>&1; then
    break
  fi
  if grep -q 'index.lock' "$tmp/err" && [ "$SECONDS" -lt "$end" ]; then sleep 1; continue; fi
  git -C "$root" reset -q -- "${rel[@]}" 2>/dev/null
  if grep -q 'would be overwritten' "$tmp/err"; then
    # The pushed text differs from the clone's: another writer's lines were merged in. Replacing a
    # file here could drop an edit a session is making to it right now, so the person does it.
    differ="$(git -C "$root" diff --name-only "$new" -- "${rel[@]}" | tr '\n' ' ')"
    note="this clone was not fast-forwarded: the pushed commit merged in another writer's lines, so ${differ}differs from it in this clone. Nothing is lost. Once no session here is editing it, run in this clone: git checkout $(git -C "$root" rev-parse --short "$new") -- ${differ}&& git pull --ff-only"
  else
    note="this clone was not fast-forwarded ($(head -1 "$tmp/err")); pull once its other edits are saved"
  fi
  break
done
echo "pushed $(git -C "$root" rev-parse --short "$new") to $remote/$branch: ${rel[*]}"
[ -z "$note" ] || echo "NOTE: $note"
exit 0
