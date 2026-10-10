#!/usr/bin/env bash
#
# end-session section replacer: the deterministic mechanics behind rewriting one whole `## `
# section of a PLAN.md (the kickoff, or Status when it is rewritten whole). Shared code:
# maintained upstream and updated in place. A local edit is not overwritten silently; it is
# reviewed (kept, or taken upstream) at the next update. Keep it present in this directory: a
# SKILL.md that names a co-located script missing from its own dir is broken on arrival.
# It also reads ../log/md-skip.awk (the log skill's), the one rule for what is not a heading.
#
# It replaces the body of exactly one section with the text you give it, keeps the heading line as
# it is, and leaves every other byte of the PLAN alone.
#
#   - The section is the one `## ` heading whose words, after its leading non-letters (an emoji),
#     start with the name you give, case ignored. It runs to the next `## ` or `# ` heading, or to
#     the end of the file; `###` and deeper headings are part of it.
#   - Heading-like lines inside a fenced code block (CommonMark: ``` or ~~~, at least 3, closed by
#     a run of the same character at least as long) and inside a leading `---` frontmatter block
#     are not headings, as in Markdown.
#   - Layout: the heading, one blank line, the body with its leading and trailing blank lines
#     trimmed, one blank line, the next heading (none after the last section). A PLAN with no final
#     newline keeps none.
#   - Refused, with nothing written: a name that matches no section, or more than one; an empty
#     body; a body with a `## ` or `# ` line outside a fenced block (it would split the section).
#   - The PLAN is replaced by a rename from its own directory, so it is never half-written, and not
#     rewritten at all when the result equals the file.
#
# PORTABLE AS-IS: plain bash + POSIX awk (tested under gawk and mawk); no slots to fill.
#
# Usage: bash .claude/skills/end-session/replace-section.sh <path/to/PLAN.md> "<section name>" <body file | ->
# (a body file of `-` reads the body from stdin).
# Exit 0: done (or already as given). Exit 1, nothing written: bad usage, or a refusal above.

set -euo pipefail

die() { printf 'replace-section: %s\n' "$1" >&2; exit 1; }

[ $# -eq 3 ] || die 'usage: replace-section.sh <path/to/PLAN.md> "<section name>" <body file | ->'
PLAN="$1"; NAME="$2"; BODY="$3"
[ -f "$PLAN" ] || die "no such file: $PLAN"
[ -n "$NAME" ] || die "the section name is empty"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
if [ "$BODY" = - ]; then cat >"$work/body.raw"
else
  [ -f "$BODY" ] || die "no such body file: $BODY"
  cp "$BODY" "$work/body.raw"
fi

# Trim the body's leading and trailing blank lines; an empty result is refused.
awk '
  { line[NR] = $0 }
  $0 !~ /^[ \t]*$/ { if (!first) first = NR; last = NR }
  END { if (!first) exit 4; for (i = first; i <= last; i++) print line[i] }
' "$work/body.raw" >"$work/body" || die "the body is empty; nothing written"

# Shared by both scans: step(line) sets kind to 1 for a `## ` heading, 2 for a `# ` heading, 0 for
# anything else, skipping frontmatter (when allowed) and fenced code blocks. The rule for what to
# skip, md_skip, is the log skill's md-skip.awk, shared by every script that reads headings.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -r "$here/../log/md-skip.awk" ] || die "cannot read $here/../log/md-skip.awk: the log skill is incomplete"
LIB="$(cat "$here/../log/md-skip.awk")"$'\n'
# Literal backticks in awk source, not a command substitution.
# shellcheck disable=SC2016
LIB+='
  function step(line, fmok) {
    kind = 0
    if (md_skip(line, fmok)) return
    if (line ~ /^## /) kind = 1
    else if (line ~ /^# /) kind = 2
  }
'

# A heading line outside a fence would split the section: refuse.
awk "$LIB"'
  { step($0, 0); if (kind) { printf "line %d: %s\n", NR, $0 > "/dev/stderr"; bad = 1 } }
  END { exit bad ? 3 : 0 }
' "$work/body" || die "the body has a # or ## heading outside a code block (above); it would split the section. Nothing written"

# Find the section: its heading line, the line where the next section starts, its body size.
awk -v want="$NAME" "$LIB"'
  { step($0, 1)
    if (kind) {
      if (insec) { el = NR; insec = 0 }
      if (kind == 1) {
        heads[++nh] = $0
        h = $0; sub(/^## /, "", h); sub(/^[^A-Za-z]*/, "", h)
        if (index(tolower(h), tolower(want)) == 1) {
          matches[++nm] = $0
          if (nm == 1) { hl = NR; insec = 1; el = 0 }
        }
      }
      next
    }
    if (insec && $0 !~ /^[ \t]*$/) { if (!first) first = NR; last = NR }
  }
  END {
    if (nm == 0) {
      printf "no section starting \"%s\"; the file'"'"'s ## headings:\n", want > "/dev/stderr"
      for (i = 1; i <= nh; i++) print "  " heads[i] > "/dev/stderr"
      exit 4
    }
    if (nm > 1) {
      printf "\"%s\" matches %d sections; give more of the name:\n", want, nm > "/dev/stderr"
      for (i = 1; i <= nm; i++) print "  " matches[i] > "/dev/stderr"
      exit 3
    }
    if (!el) el = NR + 1
    printf "%d %d %d\n", hl, el, (first ? last - first + 1 : 0)
    print matches[1] > "'"$work"'/heading"
  }
' "$PLAN" >"$work/where" || die "nothing written"
read -r hl el oldn <"$work/where"
newn="$(wc -l <"$work/body" | tr -d ' ')"

# Assemble: lines up to the heading, a blank, the body, a blank, then the rest from the next section.
awk -v hl="$hl" -v el="$el" -v bodyfile="$work/body" '
  NR < hl { print; next }
  NR == hl {
    print; print ""
    while ((getline l < bodyfile) > 0) print l
    next
  }
  NR < el { next }
  NR == el { print ""; print; next }
  { print }
' "$PLAN" >"$work/plan.new"
# A PLAN without a final newline keeps it that way (awk ends every line with one).
if [ -n "$(tail -c1 "$PLAN")" ]; then printf "%s" "$(cat "$work/plan.new")" >"$work/plan.nonl"; mv "$work/plan.nonl" "$work/plan.new"; fi

heading="$(cat "$work/heading")"
if cmp -s "$work/plan.new" "$PLAN"; then
  printf 'Unchanged: "%s" in %s\n' "$heading" "$PLAN"
else
  # Replaced by a rename from the PLAN's own directory, so it is never half-written.
  cp "$work/plan.new" "$PLAN.tmp.$$" && mv "$PLAN.tmp.$$" "$PLAN"
  printf 'Replaced "%s" in %s (%s -> %s lines)\n' "$heading" "$PLAN" "$oldn" "$newn"
fi
exit 0
