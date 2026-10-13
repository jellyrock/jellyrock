#!/usr/bin/env bash
#
# repo-key.sh prints the one name every script uses for a repo, `owner/name` from its origin URL, so
# every checkout of a repo gets the same key whatever its folder or URL form (scp-like, ssh://
# with a port, https). Every script that keys anything by repo asks this one place, so two parsers
# can never disagree. Shared code: maintained upstream and updated in place. A local edit is not
# overwritten silently: it is reviewed (kept, or taken upstream) at the next update.
#
# The host, port, user and a trailing `.git` are dropped, and the key is lowercased so a URL typed
# in another case names the same repo. A path deeper than owner/name (a nested group) keeps every
# segment, so two groups never collide; a fork is its own repo. The URL is read as stored, with no
# `insteadOf` rewrite applied: a rewrite is one machine's config (a local mirror, a test fixture),
# and the key must be the same on every machine.
#
# Usage: bash .claude/skills/start-project/repo-key.sh [<dir>]
#        bash .claude/skills/start-project/repo-key.sh --url <url>
#   dir:  any folder inside the repo (default: the current one)
# Prints the key. Exit 2, printing nothing on stdout, on a usage error, a folder with no repository
# or no origin, or a URL with no path to name: never a guess.

set -euo pipefail

die() { printf 'repo-key: %s\n' "$1" >&2; exit 2; }
usage="usage: repo-key.sh [<dir>] | repo-key.sh --url <url>"

# key_of <url> -> the key
key_of() {
  local u="$1" path seg key="" segs
  [ -n "$u" ] || die "the URL is empty"
  case "$u" in
    *://*) path="${u#*://}"; case "$path" in */*) path="${path#*/}" ;; *) path="" ;; esac ;;
    /* | ./* | ../*) path="$u" ;;
    *:*) path="${u#*:}" ;;
    *) path="$u" ;;
  esac
  while [ "${path%/}" != "$path" ]; do path="${path%/}"; done
  path="${path%.git}"
  IFS=/ read -ra segs <<<"$path"
  for seg in "${segs[@]}"; do
    case "$seg" in
      '') ;;
      . | ..) die "cannot name a repo from the relative path in '$u'" ;;
      *) key="${key:+$key/}$seg" ;;
    esac
  done
  [ -n "$key" ] || die "no repository path in '$u'"
  printf '%s\n' "$key" | tr '[:upper:]' '[:lower:]'
}

case "${1:-}" in
  --url)
    [ $# -eq 2 ] || die "$usage"
    key_of "$2" ;;
  -*) die "$usage" ;;
  *)
    [ $# -le 1 ] || die "$usage"
    dir="${1:-.}"
    [ -d "$dir" ] || die "$dir is not a folder"
    root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || die "$dir is not inside a git repository"
    url="$(git -C "$root" config --get remote.origin.url 2>/dev/null)" || die "$root has no origin"
    key_of "$url" ;;
esac
