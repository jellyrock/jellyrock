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
#   slug:  kebab-case project slug (no date prefix — the script adds YYYY-MM-)
#   goal:  one-line goal for the README row (the full Charter is filled by the skill)
#   --check: only say whether the slug is free, by the same rule the scaffold uses; writes nothing
#
# Exit 1 (no mutation) on: missing args or a slug collision (an existing
# *-<slug>/ dir, active OR archived) — so the skill can never scaffold over a
# real project's history. A missing template/README is NOT fatal: the script
# self-bootstraps minimal defaults (for a repo whose project tree is gitignored
# — see below).

set -euo pipefail

die() { printf 'scaffold-project: %s\n' "$1" >&2; exit 1; }

# MD_LIB: the awk function md_skip, the one rule for what is not a heading (CommonMark fenced code),
# read from the log skill's md-skip.awk, which every script that reads headings shares.
MD_SKIP="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../log/md-skip.awk"
[ -r "$MD_SKIP" ] || die "cannot read $MD_SKIP: the log skill is incomplete"
MD_LIB="$(cat "$MD_SKIP")"$'\n'

CHECK=0
if [ "${1:-}" = --check ]; then
  [ $# -eq 2 ] || die "usage: scaffold-project.sh --check <slug>"
  CHECK=1; SLUG="$2"; GOAL=""
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
waits-on:                 # what must finish first, comma-separated: <slug>, <slug>:<phase>, fid:<id>, <repo>/<slug>
created: YYYY-MM-DD
last-updated: YYYY-MM-DD
---

# <Project name>

## ⛰ Charter

> Lightweight stub that grows. Intent stays mutable — record scope changes as dated decisions in the Status section (a big shift gets an explicit scope-cut decision) rather than rewriting the Charter in place (that keeps the original intent as an anchor). No mandatory immutability flip.

- **Goal**: <one sentence>
- **Success criteria**:
  - <bulleted, verifiable>
- **Out of scope**:
  - <bulleted>

## 🗺 Phases (rarely changes)

- Phase A — <name>
- Phase B — <name>
- ...

## 📍 Status (updated every session via /end-session)

**Current phase:** A — <name>

**Phase progress:**
- A 🚧 in progress
- B ⬜ pending
- ...

**Last 5 decisions (newest first, dated):**
- YYYY-MM-DD: <decision + why>

**Open questions / blockers:** <list, or "none". A blocker only a person or an outside event can clear is tagged `[external-gate: <reason>]`.>

## 🚀 Next-session kickoff (rewritten by /end-session each time)

**Starts at:** A — <the step to start with>

**Last session stopped:** <where it stopped and why, in a sentence or two>

**Unanswered:** <questions put to the operator that got no reply, or "none">

### Verify first

- `<command>` → `<the one line it printed at the close>` <what its numbers mean, when the line does not say>

### Next, in order

1. <step>

### Required reading

- <file or section, and why>

### Landmines

- <a trap that bites inside this project, and how to avoid it>

## 📚 Reference (never printed at resume: read a part by its heading when the work needs it)

<Findings, measurements, how-tos, and each finished phase's detail.>

## 📜 Session log (append-only)

- YYYY-MM-DD — <session summary>
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

# Append the README active-projects row to the "## Active projects" section: after
# its last table row, dropping a placeholder that says there are none (a
# `_None active._` line, or a row whose first cell is `—`/`-`), and creating the
# table when the section has none. The section ends at the next `## ` heading, so
# the row can never land in a later table (e.g. Archived). Lines inside a fenced code block are
# copied through untouched: a heading-like line there ends no section and starts none.
ROW="| [${DIRNAME}](${DIRNAME}/PLAN.md) | active | ${GOAL} |"
tmp="$(mktemp)"
awk -v row="$ROW" "$MD_LIB"'
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
' "$README" > "$tmp"
mv "$tmp" "$README"

printf 'Scaffolded %s\n' "$TARGET/PLAN.md"
printf 'Indexed in %s\n' "$README"
printf 'Next (the skill): commit this stub where the projects folder is committed, then write the Charter, Status, kickoff and first log line into PLAN.md.\n'
