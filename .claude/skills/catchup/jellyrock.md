# /catchup: JellyRock's own reader

Run `node scripts/catchup-state.js --pretty` once (the allowlisted call in `.claude/settings.json`). Read the JSON; never re-run it or re-fetch what it holds by hand. `--no-network` skips the signals fetch, so use it only offline. Top-level keys: `meta`, `prs`, `issues`, `ci`, `handoffs`, `signals`, `decisions`, `tech_debt`, `docs_stale`, `_errors`.

## Banners

A section the reader could not build is `null` with an `_errors[<section>]` entry: that is `ERROR: catchup-state: <section> failed: <error>`, first in this list. Then, each a compare against the JSON:

| Fires when | Banner | Suggested next |
|---|---|---|
| `_errors.signals` | name the file and the parser error | fix the file, then `npm run lint:docs` |
| `signals.stale_count > 0` | `signals-backlog: <n> row(s) need attention (<slugs where stale=true>)` | a row with `row.digest` (the `jellyfin-server-stable` row, when an open release digest exists): `/server-upgrade` for digest `#<row.digest.number>`. Any other stale row: review the upstream change, then `/done <slug>` (bumps `latest_acknowledged`) |
| `signals.action_pending_count > 0` | `<n> signal(s) in action_pending (<slugs>): these need a JellyRock change` | the change itself; `/focus` to pick it |
| a run in `ci.current_branch_runs` with `conclusion != 'success'` | `CI run "<name>" <conclusion> (<createdAt>)` | `/ci-triage <run-id>`; one that a later green run recovered is a one-line info entry |
| `prs.review_requested` not empty | `<n> PR(s) awaiting your review: #N title` | `/code-review <N>` |
| `docs_stale.architecture` not empty | `<n> architecture doc(s) stale: file (Nd)` (info only; the blocking gate is CI's) | re-read the doc before touching its territory, then update it or bump `last-reviewed` |

The journal (followups, the running cursor, its staleness) is the shared reader's alone: this reader does not parse `docs/progress.md`.

## Extra sections, after the shared ones, each rendered even when empty

- **Signals watchlist:** `<signals.rows.length> watching, <stale_count> needing attention, <action_pending_count> action_pending`, then one line per row: `<slug> [status]: latest=<latest_upstream>, ack=<latest_acknowledged>`, ` <- REVIEW NEEDED` when `row.stale`, and `(open digest #<n>)` when `row.digest` is set.
- **Recent decisions:** the last 3 of `decisions` (date, number, title, status).
- **Your open PRs / PRs awaiting your review:** `#N title (draft or review state)`; the second adds the author and when it was updated.
- **High-engagement bugs** (`label:bug`, not upstream or wontfix, active in 60 days), **Recent bug reports** (7 days), **Recent discussion** (comments in 30 days): `#N title (counts, labels, last touched)`.
- **CI on this branch:** the last 3 runs, `<name>: <conclusion> (<when>)`.
- **Tech debt focus:** `top <n> of <total>: <high> High / <medium> Medium / <low> Low`, then `[<severity>] <slug>: <issue_oneline>` per item of `tech_debt.top_3`.
- **Pending handoffs:** `<handoffs.pending.length> pending (<handoffs.pruned_count> pruned this run)`, the most recent by name and age. At 10 or more, add: many handoffs are piling up; remove the ones whose investigation is done.

## Routes, when no banner fired (Step 5 picks the first that applies)

- A pending handoff for a triage in flight: read `.claude/handoffs/<name>.md` and continue with that skill's `INVESTIGATION.md`.
- A high-engagement bug, or a recent bug report not yet read: `/issue-triage <N>`.
- Recent non-bug discussion heating up: read it; a decision in it is `/log decision`. Not `/issue-triage`: that flow is bug-shaped.
- A Roku log or crash in hand: `/runtime-triage` with the log pasted.
- A paused area or subsystem re-entry: `/ramp <area>`.
