# /catchup: JellyRock's own reader

The shared reader runs `node scripts/catchup-state.js --typed --pretty` from `catchup.conf`: its banners and errors come back ranked in the CANDIDATES block (the rules are `scripts/lib/catchup-typed.cjs`), and its JSON follows the `=== STATE ===` line. Never re-run it or re-fetch what it holds by hand. Top-level keys: `meta`, `prs`, `issues`, `ci`, `handoffs`, `signals`, `decisions`, `tech_debt`, `docs_stale`, `_errors`. The journal (followups, the running cursor, its staleness) is the shared reader's alone: this reader does not parse `docs/progress.md`.

## Extra sections, after the shared ones, each rendered even when empty

- **Signals watchlist:** `<signals.rows.length> watching, <stale_count> needing attention, <action_pending_count> action_pending`, then one line per row: `<slug> [status]: latest=<latest_upstream>, ack=<latest_acknowledged>`, ` <- REVIEW NEEDED` when `row.stale`, and `(open digest #<n>)` when `row.digest` is set.
- **Recent decisions:** the last 3 of `decisions` (date, number, title, status).
- **Your open PRs / PRs awaiting your review:** `#N title (draft or review state)`; the second adds the author and when it was updated.
- **High-engagement bugs** (`label:bug`, not upstream or wontfix, active in 60 days), **Recent bug reports** (7 days), **Recent discussion** (comments in 30 days): `#N title (counts, labels, last touched)`.
- **CI on this branch:** its last 3 runs among the 100 newest, `<name>: <conclusion> (<when>)`; with none, `ci.note` says so.
- **Tech debt focus:** `top <n> of <total>: <high> High / <medium> Medium / <low> Low`, then `[<severity>] <slug>: <issue_oneline>` per item of `tech_debt.top_3`.
- **Pending handoffs:** `<handoffs.pending.length> pending (<handoffs.pruned_count> pruned this run)`, the most recent by name and age. At 10 or more, add: many handoffs are piling up; remove the ones whose investigation is done.
