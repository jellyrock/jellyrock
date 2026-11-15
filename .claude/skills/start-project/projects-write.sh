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
#   projects-write.sh --realign: bring a clone that lags the remote level with it, with no paths
#   and no subject. It fetches, then refuses (exit 3, nothing changed) at the first failed guard:
#   a commit of its own that is not upstream (those are unpushed work: push them through a write,
#   never drop them), or a file the remote changed that is edited or staged here (merge it by
#   hand). Else each file the remote changed since HEAD takes the remote's copy when it is
#   unedited here, and keeps its text when this clone holds an untracked copy of it. Only those
#   files' index entries move, so another session's staged or edited files stay as they were.
#   Run from inside the clone; each path (a file or a folder, relative or absolute) is in it.
#   PROJECTS_WRITE_TIMEOUT: seconds to keep trying (default 120).
# Exit: 0 pushed, or nothing to write (--realign: realigned, or already level) · 2 usage or
#       setup · 3 refused (the change overlaps what is on the remote, the clone lags the remote
#       so its HEAD lacks a file pushed since, or a hook refused the commit): nothing pushed,
#       files kept, and running it again repeats the refusal until the cause is dealt with ·
#       4 not pushed (the remote cannot be reached, or the time limit passed): files kept

set -uo pipefail

die()      { printf 'projects-write: %s\n' "$*" >&2; exit 2; }
refuse()   { printf 'projects-write: refused: %s\n' "$*" >&2; exit 3; }
unpushed() { printf 'projects-write: not pushed: %s\n' "$*" >&2; exit 4; }
usage="usage: projects-write.sh --subject <subject> -- <path>...   or   projects-write.sh --realign"

subject=""; paths=(); realign=0
while [ $# -gt 0 ]; do
  case "$1" in
    --subject) [ $# -ge 2 ] || die "$usage"; subject="$2"; shift ;;
    --realign) realign=1 ;;
    --) shift; paths=("$@"); break ;;
    *) die "$usage" ;;
  esac
  shift
done
if [ "$realign" = 1 ]; then
  [ -z "$subject" ] && [ "${#paths[@]}" -eq 0 ] || die "$usage"
else
  [ -n "$subject" ] && [ "${#paths[@]}" -gt 0 ] || die "$usage"
fi

root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
root="$(realpath -- "$root")"
rel=()
for p in ${paths[@]+"${paths[@]}"}; do
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

if [ "$realign" = 1 ]; then
  while ! git -C "$root" fetch -q "$remote" "$branch" 2>"$tmp/err"; do
    grep -qi 'lock' "$tmp/err" && [ "$SECONDS" -lt "$end" ] && { pause; continue; }
    unpushed "cannot fetch from $remote: $(head -1 "$tmp/err"). Nothing was changed; run this again once it is reachable."
  done
  tip="$(git -C "$root" rev-parse "refs/remotes/$remote/$branch")" || die "no $remote/$branch after fetching"
  head="$(git -C "$root" rev-parse HEAD)" || die "$root has no commit yet"
  if [ "$head" = "$tip" ]; then echo "level with $remote/$branch: nothing to realign"; exit 0; fi
  unpushed_own="$(git -C "$root" cherry "$tip" HEAD | sed -n 's/^+ //p')"
  if [ -n "$unpushed_own" ]; then
    list="$(while read -r c; do git -C "$root" log -1 --format='%h %s' "$c"; done <<<"$unpushed_own" | paste -sd';' - | sed 's/;/; /g')"
    refuse "this clone has commits that are not on $remote/$branch: $list. They are unpushed work, so nothing was changed. Push them through a write, then run this again."
  fi
  # decide every path first, so a refusal leaves the clone untouched
  take=(); keep=(); clash=(); info="$tmp/info"; undo="$tmp/undo"; : >"$info"; : >"$undo"
  while IFS= read -r -d '' f; do
    h="$(git -C "$root" rev-parse -q --verify "HEAD:$f" 2>/dev/null)"; t="$(git -C "$root" rev-parse -q --verify "$tip:$f" 2>/dev/null)"
    if [ -e "$root/$f" ] || [ -L "$root/$f" ]; then w="$(git -C "$root" hash-object -- "$f")"; else w=""; fi
    x="$(git -C "$root" ls-files -s -- "$f" | awk 'NR == 1 { print $2 }')"
    if [ "$x" != "$h" ]; then clash+=("$f")   # staged here by another session
    elif [ "$w" = "$h" ]; then take+=("$f")
    elif [ "$w" = "$t" ]; then :
    elif [ -z "$h" ]; then keep+=("$f")
    else clash+=("$f"); fi
    zero=0000000000000000000000000000000000000000
    if [ -n "$t" ]; then
      printf '%s\t%s\n' "$(git -C "$root" ls-tree "$tip" -- "$f" | awk '{ print $1 " " $3 }')" "$f" >>"$info"
    else printf '0 %s\t%s\n' "$zero" "$f" >>"$info"; fi
    if [ -n "$h" ]; then printf '%s\t%s\n' "$(git -C "$root" ls-tree HEAD -- "$f" | awk '{ print $1 " " $3 }')" "$f" >>"$undo"
    else printf '0 %s\t%s\n' "$zero" "$f" >>"$undo"; fi
  done < <(git -C "$root" diff -z --name-only --no-renames HEAD "$tip")
  if [ "${#clash[@]}" -gt 0 ]; then
    refuse "edited or staged here and changed on $remote/$branch: ${clash[*]}. Nothing was changed. Merge by hand: save your edit elsewhere, restore the file, run this again, then put the edit back."
  fi
  git -C "$root" update-index --index-info <"$info" 2>"$tmp/err" || refuse "could not update this clone's index ($(head -1 "$tmp/err")); nothing was changed"
  if ! git -C "$root" update-ref HEAD "$tip" "$head" 2>"$tmp/err"; then
    git -C "$root" update-index --index-info <"$undo" 2>/dev/null
    refuse "another session moved this clone's branch meanwhile ($(head -1 "$tmp/err")); nothing was changed. Run this again."
  fi
  for f in ${take[@]+"${take[@]}"}; do
    if git -C "$root" cat-file -e "$tip:$f" 2>/dev/null; then git -C "$root" checkout-index -f -- "$f"
    else rm -f -- "$root/$f"; rmdir -p --ignore-fail-on-non-empty -- "$root/$(dirname "$f")" 2>/dev/null; fi
  done
  echo "realigned to $(git -C "$root" rev-parse --short "$tip"): took the remote's copy of ${#take[@]} file(s), kept ${#keep[@]} edited file(s)"
  for f in ${keep[@]+"${keep[@]}"}; do echo "  kept: $f"; done
  exit 0
fi

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
    # A clone that lags the remote (commits of its own, or behind) lacks files pushed since: the
    # patch re-adds such a file whole and meets the pushed copy. That is not an overlap of lines.
    conflicted="$(git -C "$wt" diff --name-only --diff-filter=U | tr '\n' ' ')"
    own="$(git -C "$root" rev-list --count "$tip..$base")"; behind="$(git -C "$root" rev-list --count "$base..$tip")"
    lacking=""
    for f in $conflicted; do git -C "$root" cat-file -e "$base:$f" 2>/dev/null || lacking="$lacking$f "; done
    if [ -n "$lacking" ] && { [ "$own" -gt 0 ] || [ "$behind" -gt 0 ]; }; then
      refuse "the change to ${lacking}cannot be read against this clone: it has $own commit(s) of its own and is $behind behind $remote/$branch, so its HEAD lacks what was pushed since; nothing was pushed, and the files stay as written. In this clone, run projects-write.sh --realign (it checks that the commits of its own are upstream and keeps edited files), then write again."
    fi
    refuse "the change to ${conflicted}overlaps what is already on $remote/$branch; nothing was pushed, and the files stay as written. Pull, merge the two by hand, and write again."
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
# Only the paths still on disk are staged: a path a git mv or git rm took away matches nothing for
# git add, and the merge takes its deletion by itself. An empty list stages and resets nothing,
# since a bare pathspec would touch the whole clone.
note=""
stage=()
for p in "${rel[@]}"; do [ -e "$root/$p" ] && stage+=("$p"); done
while :; do
  cur="$(git -C "$root" rev-parse HEAD)"
  git -C "$root" merge-base --is-ancestor "$new" "$cur" && break
  if ! git -C "$root" merge-base --is-ancestor "$cur" "$new"; then
    note="this clone has $(git -C "$root" rev-list --count "$new..$cur") commit(s) of its own that are not on $remote/$branch, so it was not fast-forwarded; list them in this clone: git log --oneline $remote/$branch..HEAD"; break
  fi
  if { [ "${#stage[@]}" -eq 0 ] || git -C "$root" add -A -- "${stage[@]}" 2>"$tmp/err"; } && git -C "$root" merge -q --ff-only "$new" >"$tmp/err" 2>&1; then
    break
  fi
  if grep -q 'index.lock' "$tmp/err" && [ "$SECONDS" -lt "$end" ]; then sleep 1; continue; fi
  [ "${#stage[@]}" -eq 0 ] || git -C "$root" reset -q -- "${stage[@]}" 2>/dev/null
  fallback="this clone was not fast-forwarded ($(head -1 "$tmp/err")); pull once its other edits are saved"
  note="$fallback"
  if grep -q 'would be overwritten' "$tmp/err"; then
    # A fast-forward refuses for any file the incoming commits change that is edited or untracked
    # here, so find those from git state. A named file holds text the pushed commit merged lines
    # into: the person replaces it. Any other is another session's edit, which a checkout would
    # discard, so it is only named.
    mine=""; theirs=""; note=""
    while IFS= read -r -d '' f; do
      [ -n "$(git -C "$root" status --porcelain -- "$f")" ] || continue
      # the session's own file already holds the pushed text: staging it let the merge pass
      if [ -f "$root/$f" ]; then [ "$(git -C "$root" hash-object -- "$f")" != "$(git -C "$root" rev-parse -q --verify "$new:$f")" ] || continue; fi
      own=0; for r in "${rel[@]}"; do [ "$f" = "$r" ] || [[ "$f" == "$r"/* ]] && own=1; done
      if [ "$own" = 1 ]; then mine="$mine$f "; else theirs="$theirs$f "; fi
    done < <(git -C "$root" diff -z --name-only "$cur" "$new")
    if [ -n "$mine" ]; then
      note="this clone was not fast-forwarded: the pushed commit merged in another writer's lines, so ${mine}differs from it in this clone. Nothing is lost. Once no session here is editing it, run in this clone: git checkout $(git -C "$root" rev-parse --short "$new") -- ${mine}&& git pull --ff-only"
    fi
    if [ -n "$theirs" ]; then
      note="${note:+$note. Also, }${theirs}is edited here by another session and changed on $remote/$branch, so this clone was not fast-forwarded. Nothing is lost. Once that session has written or saved its edit, run in this clone: git pull --ff-only"
    fi
    [ -n "$note" ] || note="$fallback"
  fi
  break
done
echo "pushed $(git -C "$root" rev-parse --short "$new") to $remote/$branch: ${rel[*]}"
[ -z "$note" ] || echo "NOTE: $note"
exit 0
