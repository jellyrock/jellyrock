#!/usr/bin/env bash
#
# start-project scaffolder — the CANONICAL REFERENCE for /start-project's
# deterministic mechanics. A consumer adapts this rather than hand-writing one
# (CONVERSION.md step 4); it is co-located per-consumer `## Implementation`, not
# audited for Contract drift, but the audit-workflow-drift.sh completeness lint
# checks it EXISTS (a SKILL.md that names a co-located script absent from its
# dir ships broken).
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
# PORTABLE AS-IS — derives all paths from `git rev-parse`, no consumer-fill
# slots. It assumes only the two project-lifecycle conventions every consumer
# already adopts via /onboard-repo:
#   1. a project template at  docs/projects/_TEMPLATE.md  (from canonical templates/PLAN.md)
#   2. a projects index at    docs/projects/README.md     with an `## Active projects` table
# If a consumer parks those elsewhere, adjust PROJECTS/TEMPLATE/README below —
# that is the only adaptation a consumer ever needs.
#
# Usage: bash .claude/skills/start-project/scaffold-project.sh <slug> <goal-oneliner>
#   slug:  kebab-case project slug (no date prefix — the script adds YYYY-MM-)
#   goal:  one-line goal for the README row (the full Charter is filled by the skill)
#
# Exit 1 (no mutation) on: missing args or a slug collision (an existing
# *-<slug>/ dir, active OR archived) — so the skill can never scaffold over a
# real project's history. A missing template/README is NOT fatal: the script
# self-bootstraps minimal defaults (for a public consumer whose project tree is
# gitignored — see below).

set -euo pipefail

die() { printf 'scaffold-project: %s\n' "$1" >&2; exit 1; }

[ $# -eq 2 ] || die "usage: scaffold-project.sh <slug> <goal-oneliner>"
SLUG="$1"
GOAL="$2"

[[ "$SLUG" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "slug must be kebab-case (got: '$SLUG')"

ROOT="$(git rev-parse --show-toplevel)" || die "not inside a git repo"
PROJECTS="$ROOT/docs/projects"
TEMPLATE="$PROJECTS/_TEMPLATE.md"
README="$PROJECTS/README.md"

# Self-bootstrap the lifecycle infra if absent. On a public consumer the project
# tree is gitignored (PLANs are local agent-continuity, like .claude/handoffs),
# so a fresh clone won't carry these — create minimal defaults instead of
# failing. On a private consumer they're committed + present, so this never fires
# and the committed template/README are used unchanged.
mkdir -p "$PROJECTS"
if [ ! -f "$TEMPLATE" ]; then
  cat > "$TEMPLATE" <<'TEMPLATE_EOF'
---
project: <slug>
status: draft   # draft | active | completed | abandoned
created: <YYYY-MM-DD>
last-updated: <YYYY-MM-DD>
---

# <Project title>

## ⛰ Charter

- **Goal**:
- **Success criteria**:
- **Out of scope**:
- **Phases**:

## 📊 Status

## 🚀 Next-session kickoff (rewritten by /end-session each time)

## 📜 Session log (append-only)
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

# Collision check — active and archived, any month prefix. Atomic guard against
# the "scaffold over an existing slug" failure mode.
shopt -s nullglob
collisions=( "$PROJECTS"/*-"$SLUG" "$PROJECTS"/_archive/*-"$SLUG" )
shopt -u nullglob
[ ${#collisions[@]} -eq 0 ] || die "slug '$SLUG' already exists: ${collisions[*]} — use /resume-project instead"

# Scaffold.
mkdir -p "$TARGET"
cp "$TEMPLATE" "$TARGET/PLAN.md"

# Fill frontmatter (only the four scalar fields; leave the status-value comment intact).
PLAN="$TARGET/PLAN.md"
sed -i \
  -e "s|^project: .*|project: ${SLUG}|" \
  -e "s|^status: .*|status: active|" \
  -e "s|^created: .*|created: ${TODAY}|" \
  -e "s|^last-updated: .*|last-updated: ${TODAY}|" \
  "$PLAN"

# Append the README active-projects row, right after the last existing table row.
ROW="| [${DIRNAME}](${DIRNAME}/PLAN.md) | active | ${GOAL} |"
tmp="$(mktemp)"
awk -v row="$ROW" '
  /^## Active projects/ { active=1; print; next }
  active && /^\|/        { seen=1; print; next }
  active && seen && !/^\|/ { print row; active=0; seen=0; print; next }
  { print }
  END { if (active && seen) print row }
' "$README" > "$tmp"
mv "$tmp" "$README"

printf 'Scaffolded %s\n' "$TARGET/PLAN.md"
printf 'Indexed in %s\n' "$README"
printf 'Next (skill, judgment): co-design the Charter body into PLAN.md, write the kickoff + first log line.\n'