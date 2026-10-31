#!/usr/bin/env bash
#
# voice-check.sh: holds each tracked Markdown file to a per-file baseline of "house voice" counts, a
# ratchet: a file may only go down, and a file absent from the baseline is allowed zero.
#
# The six categories, counted on the prose of a file (fenced blocks, inline code, link targets,
# reference definitions, URLs and dash-only table cells are removed first, except for line-citation):
#   em-dash        the long dash character
#   filler         the filler words and phrase listed in FILLER below (any case, whole words: a
#                  hyphenated compound counts its filler word once, a longer word containing one
#                  does not)
#   caps-emphasis  the stress words listed in CAPS below, in capitals, neither side touching a
#                  letter, digit, underscore or hyphen (so an identifier or a hyphenated
#                  compound holding one passes)
#   prose-arrow    the right-arrow character, outside **bold** spans (a bold UI path is allowed)
#   latin-abbrev   the two Latin abbreviations for "for example" and "that is" (any case)
#   line-citation  file.ext:123 or file.ext:12-14 (counted inside backticks too, fences removed
#                  only) and the shorthand :123 or :12-14 after whitespace, a backtick, [ or (
#
# Scope: tracked Markdown files (git ls-files '*.md') except any file named CHANGELOG.md and any
# file the optional <repo root>/.voice-ignore matches: gitignore patterns, matched by git itself,
# for Markdown that is not prose (test fixtures, vendored text). A pattern that matches no tracked
# Markdown file prints a NOTE, since a typo there would hide nothing and say nothing. --counts
# counts whatever files it is given.
# Fences come from md-skip.awk beside this script (CommonMark: backtick and tilde fences), the one
# rule for what is not prose that every script reading Markdown shares. It sits in the log skill
# for that reason only: the voice check is not part of the journal.
# The baseline is <repo root>/.voice-baseline.tsv: lines path<TAB>category<TAB>count, sorted.
#
# Usage: bash voice-check.sh [<file.md>...]      check; paths limit the run (non-.md and
#                                                untracked paths are skipped silently)
#        bash voice-check.sh --init              write the baseline from the current counts
#        bash voice-check.sh --lower             lower allowances to the current counts
#        bash voice-check.sh --counts <file>...  print each category's count per file
# Run from anywhere inside the repo. Exit: 0 ok · 1 refused or over the baseline · 2 usage or
# setup error.

set -uo pipefail
export LC_ALL=C

die()    { printf 'voice-check.sh: %s\n' "$*" >&2; exit 2; }
refuse() { printf 'voice-check.sh: %s\n' "$*" >&2; exit 1; }

BASELINE_NAME=.voice-baseline.tsv
IGNORE_NAME=.voice-ignore

mode=check; paths=()
while [ $# -gt 0 ]; do
  case "$1" in
    --init)   mode=init ;;
    --lower)  mode=lower ;;
    --counts) mode=counts ;;
    -h|--help) sed -n '2,/^# setup error\./p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; paths+=("$@"); break ;;
    -*) die "unknown option $1 (see the usage in the script header)" ;;
    *)  paths+=("$1") ;;
  esac
  shift
done
case "$mode" in
  counts) [ "${#paths[@]}" -gt 0 ] || die "--counts needs at least one file" ;;
  init|lower) [ "${#paths[@]}" -eq 0 ] || die "--$mode takes no paths: it works on the whole scope" ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MDSKIP="$here/md-skip.awk"
[ -r "$MDSKIP" ] || die "cannot read $MDSKIP: the log skill is incomplete"
MD_LIB="$(cat "$MDSKIP")"$'\n'
baseline="$root/$BASELINE_NAME"
ignorefile="$root/$IGNORE_NAME"

read -r -d '' COUNT_AWK <<'AWK'
# One pass over the files named on the command line. Prints path<TAB>category<TAB>count for the six
# categories of every file; with snip=1 also SNIP<TAB>path<TAB>category<TAB>text lines (3 per category).
function wsre() { return "[ \t\r\n\f\v]" }

function snippet(full, pos, len, cat,   s0, e, n, sn) {
  if (sc[cat] >= 3) return
  s0 = pos - 25; if (s0 < 1) s0 = 1
  e = pos + len - 1 + 25; n = length(full); if (e > n) e = n
  while (s0 < pos && substr(full, s0, 1) ~ /[\200-\277]/) s0++
  while (e < n && substr(full, e + 1, 1) ~ /[\200-\277]/) e++
  sn = substr(full, s0, e - s0 + 1)
  gsub(/[\r\n\t\f\v]+/, " ", sn)
  print "SNIP\t" label "\t" cat "\t" sn
  sc[cat]++
}

# Count matches of re in m (the string to match on), leftmost and non-overlapping like a global
# JavaScript regex. full is the text snippets come from (same byte offsets as m). With keep=1 the
# last character of a match stays available as the first character of the next one (the boundary
# character of a whole-word pattern).
function scan(full, m, re, cat, keep,   n, off, rest, c) {
  n = 0; off = 0; rest = m
  while (match(rest, re)) {
    n++
    if (snip) snippet(full, off + RSTART, RLENGTH, cat)
    c = RSTART - 1 + RLENGTH - keep
    off += c; rest = substr(rest, c + 1)
  }
  return n
}

# A reference definition line: optional space, [label]: target and the rest of the line.
function refdefs(s,   out, re, w) {
  w = wsre()
  re = "\n" w "*\\[[^]]+\\]:" w "*[^ \t\r\n\f\v]+[^\n]*"
  s = "\n" s; out = ""
  while (match(s, re)) {
    out = out substr(s, 1, RSTART - 1) "\n"
    s = substr(s, RSTART + RLENGTH)
  }
  return substr(out s, 2)
}

# A table cell holding only a dash becomes a space; the pipes stay so adjacent cells all count.
function dashcells(s,   out) {
  out = ""
  while (match(s, /\|[ \t]*—[ \t]*\|/)) {
    out = out substr(s, 1, RSTART) " "
    s = substr(s, RSTART + RLENGTH - 1)
  }
  return out s
}

function voiceprose(t) {
  gsub(/``[^`]*``/, "", t)
  gsub(/`[^`\n]*`/, "", t)
  gsub(/\]\([^)]*\)/, "]", t)
  t = refdefs(t)
  gsub(/<https?:\/\/[^>]*>/, "", t)
  gsub("https?://[^ \t\r\n\f\v]+", "", t)
  return dashcells(t)
}

# The shorthand :123 or :12-14: preceded by line start, whitespace, a backtick, [ or (; not
# followed by a digit, colon or letter (when -14 is followed by one, :12 alone still counts).
function shorthand(line,   i, q, c, j, k, nx, n, endp) {
  n = 0; i = 1
  while ((q = index(substr(line, i), ":")) > 0) {
    c = i + q - 1; i = c + 1
    if (c > 1 && substr(line, c - 1, 1) !~ /[[ \t\r\f\v`(]/) continue
    j = c + 1; while (substr(line, j, 1) ~ /[0-9]/) j++
    if (j == (c + 1)) continue
    endp = 0
    if (substr(line, j, 1) == "-" && substr(line, j + 1, 1) ~ /[0-9]/) {
      k = j + 1; while (substr(line, k, 1) ~ /[0-9]/) k++
      if (substr(line, k, 1) !~ /[0-9:A-Za-z]/) endp = k
      else endp = j
    } else if (substr(line, j, 1) !~ /[0-9:A-Za-z]/) endp = j
    if (endp) {
      n++
      if (snip) snippet(line, c, endp - c, "line-citation")
      i = endp
    }
  }
  return n
}

function finish(   t, p, pl, b, L, i, nl, ncit) {
  seen[file] = 1
  split("", sc)
  label = file; if (index(label, strip) == 1) label = substr(label, length(strip) + 1)
  ncit = scan(txt, txt, CITRE, "line-citation", 0)
  nl = split(txt, L, "\n")
  for (i = 1; i <= nl; i++) ncit += shorthand(L[i])
  t = voiceprose(txt)
  p = " " t " "; pl = tolower(p)
  b = t; gsub(/\*\*[^*\n]+\*\*/, "", b)
  emit("em-dash", scan(t, t, "—", "em-dash", 0))
  emit("filler", scan(p, pl, FILLER, "filler", 1))
  emit("caps-emphasis", scan(p, p, CAPS, "caps-emphasis", 1))
  emit("prose-arrow", scan(b, b, "→", "prose-arrow", 0))
  emit("latin-abbrev", scan(p, pl, LATIN, "latin-abbrev", 1))
  emit("line-citation", ncit)
}
function emit(cat, n) { print label "\t" cat "\t" n }

BEGIN {
  CITRE = "[A-Za-z0-9_][A-Za-z0-9_/.-]*\\.(bs|brs|xml|js|cjs|mjs|ts|sh|bash|awk|py|rb|go|md|yml|yaml|json|jsonc|toml|sql|j2|cfg|conf|ini|tf|lua):[0-9]+(-[0-9]+)?"
  FILLER = "[^a-z0-9_](load-bearing|deliberately|genuinely|crucially|simply|just|note that)[^a-z0-9_]"
  CAPS = "[^A-Za-z0-9_-](NOT|ONLY|NEVER|MUST|ALWAYS|EVERY)[^A-Za-z0-9_-]"
  LATIN = "[^A-Za-z0-9_](e\\.g\\.|i\\.e\\.)"
}
FNR == 1 {
  if (started) finish()
  started = 1; file = FILENAME; txt = ""; md_fm = 0; md_fn = 0
}
{ if (!md_skip($0, 0)) txt = txt $0 "\n" }
END {
  if (started) finish()
  for (i = 1; i < ARGC; i++) if (!(ARGV[i] in seen)) {
    label = ARGV[i]; if (index(label, strip) == 1) label = substr(label, length(strip) + 1)
    split("em-dash filler caps-emphasis prose-arrow latin-abbrev line-citation", cs, " ")
    for (j = 1; j <= 6; j++) emit(cs[j], 0)
  }
}
AWK

# count_files <snip 0|1> <strip prefix> <file>... : the counting pass, in chunks
count_files() {
  local snip="$1" strip="$2"; shift 2
  [ "$#" -gt 0 ] || return 0
  printf '%s\0' "$@" | xargs -0 awk -v snip="$snip" -v strip="$strip" "$MD_LIB$COUNT_AWK" || return 1
}

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# scope: tracked Markdown files minus CHANGELOG.md and .voice-ignore's matches, one root-relative
# path per line
git -C "$root" ls-files -z -- '*.md' | tr '\0' '\n' | grep -v -e '^CHANGELOG\.md$' -e '/CHANGELOG\.md$' \
  | LC_ALL=C sort >"$tmp/scope" || true
if [ -f "$ignorefile" ]; then
  git -C "$root" ls-files -z -c -i --exclude-from="$ignorefile" -- '*.md' | tr '\0' '\n' \
    | LC_ALL=C sort >"$tmp/ignored" || die "git could not read $IGNORE_NAME"
  LC_ALL=C comm -23 "$tmp/scope" "$tmp/ignored" >"$tmp/kept" && mv "$tmp/kept" "$tmp/scope"
fi

ignore_notes() { # a NOTE on stderr for each .voice-ignore pattern that matches no tracked Markdown file
  local pat
  [ -f "$ignorefile" ] || return 0
  while IFS= read -r pat || [ -n "$pat" ]; do
    pat="${pat%$'\r'}"
    case "$pat" in '#'*|'!'*) continue ;; esac
    [[ "$pat" =~ ^[[:space:]]*$ ]] && continue
    [ -n "$(git -C "$root" ls-files -c -i --exclude="$pat" -- '*.md' | sed -n 1p)" ] && continue
    printf "voice-check: NOTE: %s pattern '%s' matches no tracked Markdown file: fix it or remove it\n" \
      "$IGNORE_NAME" "$pat" >&2
  done <"$ignorefile"
}

abs_scope() { # <list file> : the existing files of a root-relative list, as absolute paths
  local p
  while IFS= read -r p; do [ -f "$root/$p" ] && printf '%s\n' "$root/$p"; done <"$1"
}

header() {
  printf '%s\n' \
    '# voice-check baseline: the most house-voice hits each Markdown file may have, per category.' \
    '# Lines are path<TAB>category<TAB>count, sorted. A file may only go down (a ratchet); a file or' \
    '# category absent here is allowed zero. Flags: --init writes this file once; --lower lowers it.'
}

case "$mode" in
counts)
  files=()
  for p in "${paths[@]}"; do
    [ -f "$p" ] || die "no such file: $p"
    files+=("$p")
  done
  count_files 0 "" "${files[@]}"
  exit 0 ;;
esac
ignore_notes

# the files this run looks at
if [ "$mode" = check ] && [ "${#paths[@]}" -gt 0 ]; then
  : >"$tmp/want"
  for p in "${paths[@]}"; do
    case "$p" in *.md) ;; *) continue ;; esac
    r="$(realpath -m --relative-to="$root" -- "$p" 2>/dev/null)" || continue
    printf '%s\n' "$r" >>"$tmp/want"
  done
  LC_ALL=C sort -u "$tmp/want" | LC_ALL=C comm -12 - "$tmp/scope" >"$tmp/run"
else
  cp "$tmp/scope" "$tmp/run"
fi
mapfile -t absfiles < <(abs_scope "$tmp/run")
count_files 0 "$root/" "${absfiles[@]}" | LC_ALL=C sort >"$tmp/counts" || die "the counting pass failed"
nfiles="${#absfiles[@]}"

case "$mode" in
init)
  [ ! -e "$baseline" ] || refuse "$BASELINE_NAME already exists: use --lower to lower it, or delete it to start over"
  { header; awk -F'\t' '$3 > 0' "$tmp/counts"; } >"$baseline.new" && mv "$baseline.new" "$baseline"
  printf 'voice-check: wrote %s with %s entries for %s file(s)\n' "$BASELINE_NAME" "$(grep -vc '^#' "$baseline")" "$nfiles"
  exit 0 ;;
lower)
  [ -f "$baseline" ] || refuse "no $BASELINE_NAME to lower: run --init first"
  awk -F'\t' -v OFS='\t' '
    FILENAME == cf { cur[$1 SUBSEP $2] = $3 + 0; tracked[$1] = 1; next }
    /^#/ || $0 == "" { next }
    {
      if (!($1 in tracked)) { print "dropped\t" $1 "\t" $2 "\t" "file is out of scope (untracked, or matched by .voice-ignore)" >"/dev/stderr"; next }
      c = cur[$1 SUBSEP $2] + 0; a = $3 + 0
      n = (c < a) ? c : a
      if (n == 0) { print "dropped\t" $1 "\t" $2 "\t" "count is now zero" >"/dev/stderr"; next }
      if (n < a) print "lowered\t" $1 "\t" $2 "\t" "from " a " to " n >"/dev/stderr"
      print $1, $2, n
    }' cf="$tmp/counts" "$tmp/counts" "$baseline" 2>"$tmp/report" | LC_ALL=C sort >"$tmp/new"
  { header; cat "$tmp/new"; } >"$tmp/baseline.new"
  if [ -s "$tmp/report" ]; then
    awk -F'\t' '{ printf "voice-check: %s %s: %s %s\n", $1, $2, $3, $4 }' "$tmp/report"
    mv "$tmp/baseline.new" "$baseline"
  else
    echo "voice-check: nothing to lower"
  fi
  exit 0 ;;
esac

# check
bfile="$baseline"; [ -f "$bfile" ] || bfile=/dev/null
awk -F'\t' -v OFS='\t' -v bf="$bfile" '
  FILENAME == bf { if ($0 !~ /^#/ && $0 != "") base[$1 SUBSEP $2] = $3 + 0; next }
  { a = ($1 SUBSEP $2 in base) ? base[$1 SUBSEP $2] : 0; c = $3 + 0
    if (c > a) print "OVER", $1, $2, c, a
    else if (c < a) print "UNDER", $1, $2, c, a }' "$bfile" "$tmp/counts" >"$tmp/diff"

grep '^OVER' "$tmp/diff" | cut -f2 | LC_ALL=C sort -u >"$tmp/overfiles" || true
over=0
if [ -s "$tmp/overfiles" ]; then
  mapfile -t ofs < <(abs_scope "$tmp/overfiles")
  count_files 1 "$root/" "${ofs[@]}" | grep '^SNIP' >"$tmp/snips" || true
  while IFS=$'\t' read -r _ f cat c a; do
    over=$((over+1))
    printf '%s: %s %s (allowed %s)\n' "$f" "$cat" "$c" "$a"
    awk -F'\t' -v f="$f" -v c="$cat" '$2 == f "" && $3 == c "" { print "    " $4 }' "$tmp/snips"
  done < <(grep '^OVER' "$tmp/diff")
fi
grep '^UNDER' "$tmp/diff" | awk -F'\t' '{ n[$2] = n[$2] (n[$2] == "" ? "" : ", ") $3 }
  END { for (f in n) print f ": below its baseline in " n[f] "; run voice-check.sh --lower to ratchet it down" }' \
  | LC_ALL=C sort || true
if [ "$over" -gt 0 ]; then
  printf 'voice-check: %s category count(s) over the baseline in %s file(s)\n' "$over" "$(wc -l <"$tmp/overfiles" | tr -d ' ')"
  exit 1
fi
printf 'voice-check: ok, %s file(s) within the baseline\n' "$nfiles"
exit 0
