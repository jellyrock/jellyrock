#!/usr/bin/env bash
#
# start-project scaffolder — the deterministic mechanics behind /start-project.
# Shared code: maintained upstream and updated in place. A local edit is not
# overwritten silently — it is reviewed (kept, or taken upstream) at the next
# update. Keep it present in this directory — a SKILL.md that names a co-located script
# missing from its own dir is broken on arrival.
#
# Does ONLY the parts with exactly one correct output given (slug, goal):
# collision-check, mkdir, copy the PLAN template, fill dated frontmatter (real
# dates from `date`, not a model guess), and append the README active-projects
# row. The *judgment* half of /start-project — co-designing the Charter
# (Goal/Success/Out-of-scope/Phases) with the user — stays in the skill prose
# and is NOT here; this script runs once the slug + a one-line goal are agreed,
# then the skill fills the Charter body into the scaffolded PLAN.md.
#
# Zero token cost, deterministic, regression-testable, runs for humans + bots.
# Cost-rule dogfood: see .claude/rules/cost-efficiency.md.
#
# PORTABLE AS-IS — no slots to fill. It also reads ../log/md-skip.awk (the log skill's), the one rule
# for what is not a heading. The projects folder comes from projects-dir.sh
# beside this script (the one place every lifecycle script asks), and it assumes only
# the two project-lifecycle conventions inside that folder:
#   1. a project template at  _TEMPLATE.md
#   2. a projects index at    README.md  with an `## Active projects` table
#
# Usage: bash .claude/skills/start-project/scaffold-project.sh <slug> <goal-oneliner>
#        bash .claude/skills/start-project/scaffold-project.sh --check <slug>
#        bash .claude/skills/start-project/scaffold-project.sh --commit <slug> --subject <text> [--with <path>]...
#   slug:  kebab-case project slug (no date prefix — the script adds YYYY-MM-)
#   goal:  one-line goal for the README row (the full Charter is filled by the skill)
#   --check: only say whether the slug is free, by the same rule the scaffold uses; writes nothing
#   --commit: commit the scaffolded stub (the PLAN, the README, each --with file) path-restricted, so
#     other staged or modified files are left as they were; in-repo it never pushes. The subject is the repo's
#     own commit style, so the skill passes it. --with: a file a repo hook regenerates from the
#     projects folder. Where the projects folder is gitignored it says so and does nothing (exit 0).
#     Where it sits in another repo (a projects home), projects-write.sh commits the same paths there
#     and pushes; each --with path must be inside that home. On a refusal or a failed push nothing is
#     committed and the stub stays in the home, uncommitted (exit 1).
#
# Exit 1 (no mutation) on: missing args or a slug collision (an existing
# *-<slug>/ dir, active OR archived) — so the skill can never scaffold over a
# real project's history. A missing template/README is NOT fatal: the script
# self-bootstraps minimal defaults (for a repo whose project tree is gitignored
# — see below). --commit exits 1 with nothing staged on: a missing --subject, no
# or several PLANs for the slug, a --with path that does not exist, or other
# uncommitted edits in the README; and with nothing committed when a hook refuses.

set -euo pipefail

die() { printf 'scaffold-project: %s\n' "$1" >&2; exit 1; }

# MD_LIB: the awk function md_skip, the one rule for what is not a heading (CommonMark fenced code),
# read from the log skill's md-skip.awk, which every script that reads headings shares.
MD_SKIP="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../log/md-skip.awk"
[ -r "$MD_SKIP" ] || die "cannot read $MD_SKIP: the log skill is incomplete"
MD_LIB="$(cat "$MD_SKIP")"$'\n'

# readme_with_row <row>: a README on stdin, printed with the project's row added to the "## Active
# projects" section: after its last table row, dropping a placeholder that says there are none (a
# `_None active._` line, or a row whose first cell is `—`/`-`), and creating the table when the section
# has none. The section ends at the next `## ` heading, so the row can never land in a later table
# (e.g. Archived). Lines inside a fenced code block are copied through untouched: a heading-like line
# there ends no section and starts none. The scaffold writes its README with this, and --commit
# rebuilds the committed README with it to find edits that are not this project's row: one rule.
readme_with_row() {
  awk -v row="$1" "$MD_LIB"'
    function add() { if (!seen) { print "| Project | Status | Goal |"; print "|---|---|---|" } print row; done=1 }
    md_skip($0, 0)                                   { print; next }
    /^## Active projects/                            { active=1; print; next }
    active && /^## /                                 { if (!done) { add(); print "" } active=0; print; next }
    active && /^_[^_].*_[[:space:]]*$/ && !seen      { skipblank=1; next }
    skipblank && /^[[:space:]]*$/                    { skipblank=0; next }
                                                     { skipblank=0 }
    active && /^\|[[:space:]]*(—|–|-)[[:space:]]*\|/ { next }
    active && /^\|/                                  { seen=1; print; next }
    active && seen && !done                          { add(); active=0; print; next }
    { print }
    END { if (active && !done) add() }
  '
}

CHECK=0; COMMIT=0; SUBJECT=""; WITH=()
COMMIT_USAGE="usage: scaffold-project.sh --commit <slug> --subject <text> [--with <path>]..."
if [ "${1:-}" = --check ]; then
  [ $# -eq 2 ] || die "usage: scaffold-project.sh --check <slug>"
  CHECK=1; SLUG="$2"; GOAL=""
elif [ "${1:-}" = --commit ]; then
  shift; COMMIT=1; GOAL=""
  [ $# -ge 1 ] && [[ "$1" != -* ]] || die "$COMMIT_USAGE"
  SLUG="$1"; shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --subject) [ $# -ge 2 ] || die "$COMMIT_USAGE"; SUBJECT="$2"; shift 2 ;;
      --with) [ $# -ge 2 ] || die "$COMMIT_USAGE"; WITH+=("$2"); shift 2 ;;
      *) die "--commit: unknown argument '$1'" ;;
    esac
  done
  [[ "$SUBJECT" =~ [^[:space:]] ]] || die "$COMMIT_USAGE (--subject is required: this repo's own commit style)"
else
  [ $# -eq 2 ] || die "usage: scaffold-project.sh <slug> <goal-oneliner>  (or --check <slug>)"
  SLUG="$1"; GOAL="$2"
fi

[[ "$SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "slug must be kebab-case (got: '$SLUG')"

git rev-parse --show-toplevel >/dev/null 2>&1 || die "not inside a git repo"
RESOLVER="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/projects-dir.sh"
[ -f "$RESOLVER" ] || die "projects-dir.sh is missing beside this script ($RESOLVER)"
PROJECTS="$(bash "$RESOLVER")" || die "projects-dir.sh could not say where projects live"
TEMPLATE="$PROJECTS/_TEMPLATE.md"
README="$PROJECTS/README.md"

# --commit: the scaffold stub's commit, every git command run against the repo that holds the projects
# folder. Reads first, stages only once every check has passed, then commits only the named paths
# (-m before --), so another session's staged or modified files are left exactly as they were.
if [ "$COMMIT" -eq 1 ]; then
  shopt -s nullglob
  plans=( "$PROJECTS"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-"$SLUG"/PLAN.md )
  shopt -u nullglob
  [ ${#plans[@]} -ge 1 ] || die "no active project '$SLUG' in $PROJECTS (looked for YYYY-MM-$SLUG/PLAN.md, not under _archive/): scaffold it first"
  [ ${#plans[@]} -eq 1 ] || die "several active projects match '$SLUG', cannot tell which to commit: ${plans[*]}"
  PLAN="${plans[0]}"; DIRNAME="$(basename "$(dirname "$PLAN")")"
  paths=("$PLAN" "$README")
  for p in ${WITH[@]+"${WITH[@]}"}; do
    [ -e "$p" ] || die "--with: $p does not exist: nothing staged"
    paths+=("$(cd "$(dirname -- "$p")" && pwd -P)/$(basename -- "$p")")
  done
  if git -C "$PROJECTS" check-ignore -q .; then
    echo "not committed: the projects folder is gitignored here, so the PLAN stays local"; exit 0
  fi
  # The README may hold only this project's row as an uncommitted edit: the committed README with the
  # row added must equal the working file, byte for byte. An untracked README (written by the bootstrap) is
  # new in full, so there is nothing to compare.
  if git -C "$PROJECTS" cat-file -e HEAD:./README.md 2>/dev/null; then
    row="$(grep -F -m1 -- "| [${DIRNAME}](${DIRNAME}/PLAN.md) | active | " "$README" || true)"
    [ -n "$row" ] || die "$README has no row for $DIRNAME: re-run the scaffold's README step before committing. Nothing was staged or committed."
    # awk -v reads backslash escapes, as it did when the scaffold wrote the row: undo that for the copy
    if ! cmp -s "$README" <(git -C "$PROJECTS" show HEAD:./README.md | readme_with_row "${row//\\/\\\\}"); then
      die "$README holds uncommitted changes other than the row for $DIRNAME: commit or stash the other edits first, then run --commit again. Nothing was staged or committed."
    fi
  fi
  # A projects folder in another repo (a projects home that many sessions and machines write into)
  # is committed and pushed there by projects-write.sh, which takes only these paths' change.
  home="$(cd "$(git -C "$PROJECTS" rev-parse --show-toplevel)" && pwd -P)"
  if [ "$home" != "$(cd "$(git rev-parse --show-toplevel)" && pwd -P)" ]; then
    for p in "${paths[@]}"; do
      case "$p/" in "$home"/?*) ;; *) die "--with: $p is outside the projects home ($home): nothing was written" ;; esac
    done
    rc=0; out="$(cd "$PROJECTS" && bash "$(dirname "$RESOLVER")/projects-write.sh" --subject "$SUBJECT" -- "${paths[@]}" 2>&1)" || rc=$?
    case $rc in
      0) printf '%s\n' "$out" | grep '^NOTE:' || true
         echo "committed and pushed as $(git -C "$PROJECTS" rev-parse --short HEAD) to the projects home" ;;
      3) printf '%s\n' "$out"; die "refused: nothing was committed; the stub is kept in the projects home, uncommitted" ;;
      4) printf '%s\n' "$out"; die "not pushed: nothing was committed; the stub is kept in the projects home, uncommitted: run --commit again once its remote is reachable" ;;
      *) printf '%s\n' "$out"; die "projects-write.sh failed (exit $rc): nothing was committed" ;;
    esac
    exit 0
  fi
  git -C "$PROJECTS" add -- "${paths[@]}" || die "could not stage the stub's files: nothing was committed"
  if ! out="$(git -C "$PROJECTS" commit -m "$SUBJECT" -- "${paths[@]}" 2>&1)"; then
    printf '%s\n' "$out"; die "the commit was refused (a hook, most likely): nothing was committed"
  fi
  echo "committed as $(git -C "$PROJECTS" rev-parse --short HEAD) on $(git -C "$PROJECTS" rev-parse --abbrev-ref HEAD)"
  exit 0
fi

# Collision check — active and archived, any month prefix. Atomic guard against
# the "scaffold over an existing slug" failure mode, run before anything is
# written. The prefix is matched as YYYY-MM-, so a slug that only ends another
# project's name (cache vs redis-cache) is not a collision.
shopt -s nullglob
collisions=( "$PROJECTS"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-"$SLUG" "$PROJECTS"/_archive/[0-9][0-9][0-9][0-9]-[0-9][0-9]-"$SLUG" )
shopt -u nullglob
[ ${#collisions[@]} -eq 0 ] || die "slug '$SLUG' already exists: ${collisions[*]} — use /resume-project instead"
if [ "$CHECK" -eq 1 ]; then printf "slug '%s' is free in %s\n" "$SLUG" "$PROJECTS"; exit 0; fi

# Self-bootstrap the lifecycle infra if absent. Where the project tree is
# gitignored (PLANs are local agent-continuity, like .claude/handoffs), a fresh
# clone won't carry these — create defaults instead of failing. The default
# template is the shared PLAN template word for word (a test holds them equal),
# so a PLAN scaffolded here has the same sections as one scaffolded anywhere.
# Where they're committed they're already present, so this never fires and the
# committed template/README are used unchanged.
mkdir -p "$PROJECTS"
if [ ! -f "$TEMPLATE" ]; then
  cat > "$TEMPLATE" <<'TEMPLATE_EOF'
---
project: <slug>
status: active            # draft | active | paused | completed | abandoned
waits-on:                 # what must finish first, comma-separated: <slug>, <slug>:<phase>, fid:<id>, after:<date or time>, <owner>/<name>/<slug> (.claude/skills/log/waits.md)
created: YYYY-MM-DD
last-updated: YYYY-MM-DD
---

# <Project name>

## ⛰ Charter

> A lightweight stub that grows. Intent stays mutable: record a scope change as a dated decision in the Status section (a big shift gets an explicit scope-cut decision) instead of rewriting the Charter in place, so the original intent stays as an anchor. No mandatory immutability flip.

- **Goal**: <one sentence>
- **Success criteria**:
  - <bulleted, verifiable>
- **Out of scope**:
  - <bulleted>

## 🗺 Phases (rarely changes)

- Phase A: <name>
- Phase B: <name>
- ...

## 📍 Status (updated every session via /end-session)

**Current phase:** A: <name>

**Phase progress:**
- A 🚧 in progress
- B ⬜ pending
- ...

**Last 5 decisions (newest first, dated):**
- YYYY-MM-DD: <decision + why>

**Open questions / blockers:** <list, or "none". A blocker only a person or an outside event can clear is tagged `[external-gate: <reason>]`, with an `after:<date>` re-check date in `waits-on:`.>

## 🚀 Next-session kickoff (rewritten by /end-session each time)

**Starts at:** A: <the step to start with>

**Last session stopped:** <where it stopped and why, in a sentence or two>

**Unanswered:** <questions put to the operator that got no reply, or "none">

### Verify first

- `<command>` prints `<the one line it printed at the close>` <what its numbers mean, when the line does not say>

### Next, in order

1. <step>

### Required reading

- <file or section, and why>

### Landmines

- <a trap that bites inside this project, and how to avoid it>

## 📚 Reference (never printed at resume: read a part by its heading when the work needs it)

<Findings, measurements, how-tos, and each finished phase's detail.>

## 📜 Session log (append-only)

- YYYY-MM-DD: <session summary>
TEMPLATE_EOF
fi
if [ ! -f "$README" ]; then
  cat > "$README" <<'README_EOF'
# Projects

Multi-session tracked work. Each project is a `YYYY-MM-<slug>/PLAN.md`.

## Active projects

| Project | Status | Goal |
|---|---|---|
README_EOF
fi

MONTH="$(date +%Y-%m)"
TODAY="$(date +%Y-%m-%d)"
DIRNAME="${MONTH}-${SLUG}"
TARGET="$PROJECTS/$DIRNAME"

# Scaffold.
mkdir -p "$TARGET"
cp "$TEMPLATE" "$TARGET/PLAN.md"

# Fill frontmatter (only the four scalar fields; leave the status-value comment intact).
PLAN="$TARGET/PLAN.md"
sed -i \
  -e "s|^project: .*|project: ${SLUG}|" \
  -e "s|^status:[[:space:]]*[A-Za-z]*|status: active|" \
  -e "s|^created: .*|created: ${TODAY}|" \
  -e "s|^last-updated: .*|last-updated: ${TODAY}|" \
  "$PLAN"

# Append the README active-projects row (readme_with_row above holds the rule).
ROW="| [${DIRNAME}](${DIRNAME}/PLAN.md) | active | ${GOAL} |"
tmp="$(mktemp)"
readme_with_row "$ROW" < "$README" > "$tmp"
mv "$tmp" "$README"

printf 'Scaffolded %s\n' "$TARGET/PLAN.md"
printf 'Indexed in %s\n' "$README"
printf 'Next (the skill): commit this stub with --commit %s --subject "<subject>" where the projects folder is committed, then write the Charter, Status, kickoff and first log line into PLAN.md.\n' "$SLUG"
