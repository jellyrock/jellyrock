# md-skip.awk: the one rule for what cannot be a Markdown heading, shared by every shared script that
# reads headings or sections out of a Markdown file.
#
# md_skip(line, fmok) -> 1 when the line cannot be a heading: inside a leading `---` frontmatter
# block (only when fmok), or a fenced code block, its fence lines included (CommonMark: 3+
# backticks or tildes, indented 0-3 spaces; the info string of a backtick fence has no backtick; it
# closes on a run of the same character at least as long, then only spaces or tabs, else at the
# end of the input).
#
# State lives in the globals md_fm (inside frontmatter), md_fc (the open fence's character) and
# md_fn (the open fence's run length; 0 when none is open). The frontmatter test reads NR == 1, so
# a caller that reads several files in one awk run resets md_fm = md_fn = 0 on FNR == 1, and passes
# fmok = 0 wherever the lines do not come in file order (a loop over a saved array in END).
#
# The scripts load this file by path, as ../log/md-skip.awk beside their own skill folder:
# resume-state.sh, replace-section.sh, catchup-state.sh, plan-run.sh, scaffold-project.sh,
# review-run.sh and journal.sh. Each reads it into a shell variable and puts it in front of its
# awk program. Its cases are in tests/md-skip/run.sh.
function md_skip(line, fmok,   t, c, n) {
  if (NR == 1 && fmok && line == "---") { md_fm = 1; return 1 }
  if (md_fm) { if (line == "---") md_fm = 0; return 1 }
  t = line; match(t, /^ */)
  if (RLENGTH > 3) return (md_fn > 0)
  t = substr(t, RLENGTH + 1); c = substr(t, 1, 1)
  if (c != "`" && c != "~") return (md_fn > 0)
  n = 0; while (substr(t, n + 1, 1) == c) n++
  t = substr(t, n + 1)
  if (md_fn > 0) {
    if (c == md_fc "" && n >= md_fn && t ~ /^[ \t]*$/) md_fn = 0
    return 1
  }
  if (n < 3 || (c == "`" && index(t, "`") > 0)) return 0
  md_fc = c; md_fn = n
  return 1
}
