#!/usr/bin/env bash
#
# review-run.sh — the mechanical parts of a review. /second-opinion's steps call it instead of doing
# these by hand.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently — it is reviewed (kept, or taken upstream) at the next update.
#
# Usage:
#   bash .claude/skills/second-opinion/review-run.sh check <brief>
#       every field filled, and nothing the parent withholds leaked in: a withheld phrase (its
#       leaning, a verdict column, authorship) anywhere but the Standards, or an item's label outside
#       its own item. The brief is Markdown: `## Items` (each item a `### Item: <label>` with its
#       text below), then `## Audience`, `## Decision`, `## Constraints`, `## Evidence`, and last
#       `## Standards`, which runs to the end of the file (pasted rules keep their own headings).
#   … split <brief> <out folder>
#       a brief that passes check, into the reviewer's two turns and the parent's key:
#         criteria.md  turn 1: the context fields and the Standards, no item
#         items.md     turn 2: the items as `### P`, `### Q`, … in shuffled order
#         labels.txt   `<neutral label><TAB><the brief's label>`, one per item: for the parent only
#   … cost <agent id> [--note <what was reviewed>]
#       the finished review's token use, from its sub-agent transcript (one count per message, the
#       last output count; output is n/a when any message has no line with a final stop_reason, as
#       in a transcript that kept only stream-start usage), logged in
#       $XDG_STATE_HOME/second-opinion/costs.tsv (a review recorded again replaces its line)
# Exit: check  0 ok; 1 problems (each a PROBLEM line); 3 an unreadable brief
#       split  0 written; 1 the brief fails check (nothing written); 3 unreadable, or no folder
#       cost   0 recorded; 3 no id, or no transcript for it
# REVIEW_RUN_SEED fixes the shuffle, REVIEW_RUN_TODAY the log date, REVIEW_RUN_PROJECTS_DIR where
# transcripts are found (default ~/.claude/projects): for tests.

set -uo pipefail

die() { printf 'ERROR: %s\n' "$2"; exit "$1"; }

# brief_awk <mode> <brief>: one parser for every reading of a brief. The file is read twice: the
# first pass collects the item labels, the second checks or prints.
#   check     PROBLEM lines, then "ok: N items" or "N problems"
#   labels    the brief's item labels, in order
#   criteria  the context fields and the Standards, as written
#   items     the items in the order given (-v order="2 1"), headed by the neutral labels (-v neutral)
brief_awk() {
  awk -v mode="$1" -v order="${ORDER:-}" -v neutral="${NEUTRAL:-}" '
    function trim(s) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s }
    function blank(s) { return s ~ /^[[:space:]]*$/ || s ~ /^[[:space:]]*<[^>]*>[[:space:]]*$/ }
    function problem(s) { if (mode == "check") print "PROBLEM: " s; nprob++ }
    function where() { return sec == "Items" ? "Item: " label[cur] : sec }
    # the first withheld phrase in a line, lowercased; "" when there is none
    function withheld(s,   n, i) {
      s = tolower(s)
      n = split("recommended|i recommend|we recommend|my recommendation|i prefer|we prefer|my preference|i'"'"'d pick|i would pick|my pick|i'"'"'d go with|i would go with|i lean|i'"'"'m leaning|leaning toward|gets it right?|same result every time?|my time?|future upkeep?|could it break something?|choices:|my draft|i drafted|i wrote|my version", W, "|")
      for (i = 1; i <= n; i++) if (index(s, W[i])) return W[i]
      return ""
    }
    # does the lowercased label occur in s as a whole word (letters, digits, _ and - are word characters)?
    function hasword(s, w,   p, q, b, a) {
      s = tolower(s); q = 0
      while ((p = index(substr(s, q + 1), w)) > 0) {
        p += q; b = substr(s, p - 1, 1); a = substr(s, p + length(w), 1)
        if ((p == 1 || b !~ /[a-z0-9_-]/) && a !~ /[a-z0-9_-]/) return 1
        q = p
      }
      return 0
    }
    BEGIN {
      nf = split("Items Audience Decision Constraints Evidence Standards", F, " ")
      for (i = 1; i <= nf; i++) field[F[i]] = 1
    }
    # pass 1: the item labels
    NR == FNR {
      if ($0 ~ /^## /) { h = trim(substr($0, 4)); if (h in field) in1 = (h == "Items") }
      if (in1 && $0 ~ /^### Item:/) { n1++; lab1[n1] = tolower(trim(substr($0, 10))) }
      next
    }
    # pass 2
    {
      if (sec != "Standards" && $0 ~ /^## /) {
        h = trim(substr($0, 4))
        if (h in field) {
          if (h in seen) problem("duplicate field: " h)
          seen[h] = 1; sec = h
          if (mode == "criteria" && h != "Items") print
          next
        }
        if (sec != "Items") { problem("not a brief field: " h); sec = "?"; next }
      }
      if (sec == "Standards") {
        if ($0 ~ /^## /) { h = trim(substr($0, 4)); if (h in field && h != "Standards") late[h] = 1 }
        if (!blank($0)) filled[sec] = 1
        if (mode == "criteria") print
        next
      }
      if (sec == "Items" && $0 ~ /^### Item:/) {
        cur = ++ni; label[cur] = trim(substr($0, 10))
        if (label[cur] == "") problem("an item with no label (line " FNR ")")
        if (tolower(label[cur]) in lab) problem("duplicate item: " label[cur])
        lab[tolower(label[cur])] = 1
        if (mode == "labels") print label[cur]
        next
      }
      if (sec == "" || sec == "?") next
      if (sec == "Items" && !cur) { if (!blank($0)) problem("text in Items outside any item (line " FNR ")"); next }
      if (!blank($0)) filled[sec == "Items" ? "item " cur : sec] = 1
      if (sec == "Items") body[cur] = body[cur] $0 "\n"
      else if (mode == "criteria") print
      if (mode != "check") next
      w = withheld($0)
      if (w != "") problem("withheld in " where() " (line " FNR "): " w)
      for (i = 1; i <= n1; i++)
        if (!(sec == "Items" && lab1[i] == tolower(label[cur])) && hasword($0, lab1[i]))
          problem("label " lab1[i] " appears in " where() " (line " FNR ")")
    }
    END {
      if (mode == "items") {
        k = split(order, O, " "); split(neutral, N, " ")
        for (i = 1; i <= k; i++) {
          b = body[O[i]]; sub(/^[[:space:]]*\n/, "", b); sub(/[[:space:]]+$/, "", b)
          if (i > 1) print ""
          print "### " N[i]; print b
        }
        exit
      }
      if (mode != "check") exit
      for (i = 1; i <= nf; i++) {
        f = F[i]
        if (!(f in seen)) { problem("missing field: " f); if (f in late) print "NOTE: " f " comes after ## Standards, so it is read as part of them: Standards must be the last field" }
        else if (f != "Items" && !(f in filled)) problem("empty field: " f)
      }
      if (seen["Items"] && ni == 0) problem("no items")
      for (i = 1; i <= ni; i++) if (!(("item " i) in filled)) problem("empty item: " label[i])
      if (ni > 11) problem(ni " items: at most 11 (the neutral labels P to Z)")
      if (nprob) { print nprob " problem(s)"; exit 1 }
      print "ok: " ni " items"
    }
  ' "$2" "$2"
}

cmd_check() {
  [ -r "${1:-}" ] && [ -f "$1" ] || die 3 "cannot read the brief: ${1:-(none named)}"
  brief_awk check "$1"
}

cmd_split() {
  local brief="${1:-}" out="${2:-}" rc
  [ -r "$brief" ] && [ -f "$brief" ] || die 3 "cannot read the brief: ${brief:-(none named)}"
  [ -n "$out" ] || die 3 "no out folder named"
  brief_awk check "$brief"; rc=$?
  [ "$rc" -eq 0 ] || exit 1
  local -a labels=() idx=(); local i j t
  while IFS= read -r t; do labels+=("$t"); done < <(brief_awk labels "$brief")
  for i in "${!labels[@]}"; do idx+=("$((i + 1))"); done
  [ -n "${REVIEW_RUN_SEED:-}" ] && RANDOM="$REVIEW_RUN_SEED"
  for ((i = ${#idx[@]} - 1; i > 0; i--)); do # Fisher-Yates
    j=$((RANDOM % (i + 1))); t="${idx[i]}"; idx[i]="${idx[j]}"; idx[j]="$t"
  done
  local -a neutral=(P Q R S T U V W X Y Z)
  mkdir -p "$out" || die 3 "cannot make $out"
  brief_awk criteria "$brief" > "$out/criteria.md"
  ORDER="${idx[*]}" NEUTRAL="${neutral[*]:0:${#idx[@]}}" brief_awk items "$brief" > "$out/items.md"
  : > "$out/labels.txt"
  for i in "${!idx[@]}"; do printf '%s\t%s\n' "${neutral[i]}" "${labels[idx[i] - 1]}" >> "$out/labels.txt"; done
  printf 'written: %s/criteria.md (turn 1), %s/items.md (turn 2), %s/labels.txt (the key: never send it)\n' "$out" "$out" "$out"
}

cmd_cost() {
  local id="${1:-}" note="" f repo log line
  [ -n "$id" ] || die 3 "no agent id named"
  shift
  while [ $# -gt 0 ]; do case "$1" in --note) note="${2:-}"; shift 2 ;; *) die 3 "unknown option: $1" ;; esac; done
  case "$id" in *[!A-Za-z0-9]*) die 3 "not an agent id: $id" ;; esac
  f=""
  for line in "${REVIEW_RUN_PROJECTS_DIR:-$HOME/.claude/projects}"/*/*/subagents/"agent-$id.jsonl"; do
    [ -f "$line" ] && { [ -z "$f" ] || [ "$line" -nt "$f" ]; } && f="$line"
  done
  [ -n "$f" ] || die 3 "no transcript for agent $id"
  line="$(awk '
    function num(u, k,   m) { if (match(u, "\"" k "\":[0-9]+")) return substr(u, RSTART + length(k) + 3, RLENGTH - length(k) - 3) + 0; return 0 }
    index($0, "\"role\":\"assistant\"") {
      m = index($0, "\"message\":{"); if (!m) next
      r = substr($0, m)
      if (!match(r, /"id":"msg_[^"]*"/)) next
      id = substr(r, RSTART + 6, RLENGTH - 7)
      if (match(r, /"model":"[^"]*"/)) { md = substr(r, RSTART + 9, RLENGTH - 10); if (!(md in models)) { models[md] = 1; ml = ml (ml == "" ? "" : ",") md } }
      # a line with a stop_reason other than null (it comes before usage) holds the final count of its message
      sr = ""; if (match(r, /"stop_reason":(null|"[^"]*")/)) sr = substr(r, RSTART + 14, RLENGTH - 14)
      # each count is the first after "usage":{ — the top-level four come before the nested
      # iterations, which repeat them
      u = index(r, "\"usage\":{"); if (!u) next
      r = substr(r, u + 8)
      if (!(id in seen)) { seen[id] = 1; n++ }
      inp[id] = num(r, "input_tokens"); cw[id] = num(r, "cache_creation_input_tokens"); cr[id] = num(r, "cache_read_input_tokens")
      o = num(r, "output_tokens"); if (o > out[id] + 0) out[id] = o
      if (sr != "" && sr != "null") fin[id] = 1
    }
    END {
      for (k in seen) { ti += inp[k]; tw += cw[k]; tr += cr[k]; to += out[k]; if (!(k in fin)) nf++ }
      printf "%s\t%d\t%d\t%d\t%d\t%s\t%d\n", (ml == "" ? "unknown" : ml), n, ti, tw, tr, (nf ? "n/a" : to), nf
    }
  ' "$f")"
  repo="$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo -)")"
  note="$(printf '%s' "$note" | tr '\t\n' '  ')"
  log="${XDG_STATE_HOME:-$HOME/.local/state}/second-opinion/costs.tsv"
  mkdir -p "$(dirname "$log")" || die 3 "cannot make $(dirname "$log")"
  [ -s "$log" ] || printf 'date\trepo\tagent\tmodel\tmessages\tinput\tcache_write\tcache_read\toutput\tnote\n' > "$log"
  awk -F'\t' -v id="$id" '$3 != id ""' "$log" > "$log.tmp" && mv "$log.tmp" "$log"
  IFS=$'\t' read -r m n i w r o k <<<"$line"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${REVIEW_RUN_TODAY:-$(date +%F)}" "$repo" "$id" "$m" "$n" "$i" "$w" "$r" "$o" "$note" >> "$log"
  [ "$k" -gt 0 ] && o="n/a (no final count in $k of $n messages)"
  printf 'recorded: %s model=%s messages=%s input=%s cache_write=%s cache_read=%s output=%s\nlog: %s\n' "$id" "$m" "$n" "$i" "$w" "$r" "$o" "$log"
}

case "${1:-}" in
  check) shift; cmd_check "$@" ;;
  split) shift; cmd_split "$@" ;;
  cost)  shift; cmd_cost "$@" ;;
  *) die 3 "usage: review-run.sh check <brief> | split <brief> <out folder> | cost <agent id> [--note <text>]" ;;
esac
