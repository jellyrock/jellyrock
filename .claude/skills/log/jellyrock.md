# /log — jellyrock's own types and decision routing

Read by [SKILL.md](SKILL.md)'s `## This repo`. Pure local edits; commit nothing.

## `decision` routing

Two tiers, both from the shared Step 3 flow (draft, significance gate, diff-and-confirm):

- **ADR-grade** (architectural, hard-to-reverse, cross-component) → `docs/adr/NNNN-<slug>.md` in the newest ADR's shape (`# ADR NNNN: <title>`, `**Status:** Accepted`, `**Date:** <today>`, optional `**related-files**:`, one or two tight paragraphs) plus its row in the `docs/adr/README.md` index table. ADR supersede chains are prose in the `**Status:**` line and are not machine-checked: get them right by hand.
- **Sub-architectural** (clears the bar, local blast radius) → a note in [`docs/decisions.md`](../../../docs/decisions.md), appended after the last `## decision-id:` note and before the trailing `## Migrated to ADRs` table. The bar is that file's "When to add a note": a non-obvious rationale, closes off alternatives, or a trade-off worth re-evaluating. A routine fix, an obvious choice or time-bound state is declined.

Note schema:

    ## decision-id: <stable-kebab-slug, at most 5 words>

    **date**: YYYY-MM-DD
    **status**: accepted | superseded | withdrawn
    (optional, in this order: **supersedes**, **superseded-by**, **partially-supersedes**, **partially-superseded-by** `(<what moved>)`, **related-files**)

    <one or two short paragraphs: why, what was considered, what was ruled out>

- Fields sit in one contiguous block directly under the heading: the linter stops at the first prose line.
- **Slug unique** before writing: `grep -n '^## decision-id: <slug>$' docs/decisions.md` (an ADR: `ls docs/adr/`). On a collision show the existing record and ask: other slug, supersede, or abort. A free-form description gets a proposed slug, confirmed first.
- **Full supersede of a note:** flip the old note to `**status**: superseded` and add `**superseded-by**: <new>` under it. Ask first whether it is really partial: then use the `partially-` pair with the `(<what moved>)` scope and leave both `accepted`.
- `withdrawn` is terminal: never supersede one, never let one declare `**supersedes**`. A note that grew ADR-grade is promoted (a new ADR), not pointed at; pointers resolve only to slugs inside `docs/decisions.md`, cross-tier references are prose links.

### `--revise=<slug>`

`/log decision --revise=<slug>` edits an existing `docs/decisions.md` note in place: the one exception to append-only. Use it only when the record misdescribes what was decided or shipped (a function that no longer exists, a mechanism a later commit reverted, a measurement quoted wrong). A decision that changed is a supersede; wording polish is neither. Same gate as an append: draft the corrected text, show it as a diff, confirm, edit in place. Leave `**status**` alone and add no supersede pointer. The common case is a note written earlier on the same unmerged branch.

## `signal`

A row in [`docs/signals-backlog.md`](../../../docs/signals-backlog.md) for an upstream the app depends on (Renovate covers npm dependencies, so not those). New row: an `H3` block at the bottom of `## Watching`, then bump the frontmatter `last-updated:` to today (`date +%Y-%m-%d`).

    ### <slug>: <one-line label>

    - **watching**: <what is watched upstream>
    - **current**: <this repo's posture toward it>
    - **latest_upstream**: <last known upstream version>
    - **latest_acknowledged**: <last version reviewed via /done; seed = latest_upstream>
    - **last_checked**: YYYY-MM-DD
    - **action_when_moves**: <what triggers a change here>
    - **status**: watching | action_pending | completed

Ask for the slug, label and fields not given. Defaults: `last_checked` today, `latest_acknowledged` = `latest_upstream`, `status` `watching`. The slug is unique (`grep -n '^### <slug>:' docs/signals-backlog.md`); on a hit ask: other slug, update the row, or abort. Never hand-edit `latest_upstream` or `last_checked` on `jellyfin-server-stable`, `jellyfin-server-rc` or `roku-os`: `scripts/catchup-state.js` owns them. `npm run lint:docs` validates the schema (required bullets, status enum, ISO date, a positive-integer `staleness_days` when present).

## `running`

Replaces the one paragraph under `## Currently running` in `docs/progress.md`: what is in flight right now (not a followup, not shipped work). The post-merge journal-sync reads that paragraph and moves it to `## Recently shipped`, so keep the shape: heading, blank line, paragraph, blank line.

- `/log running "<text>"`: replace the paragraph with `<text>` (one or two sentences). No text and no `--clear`: ask "What's currently in flight?".
- `/log running --clear`: empty the paragraph and keep the heading (two blank lines before the next `## `).
- Then bump the frontmatter `last-updated:` to today and run `npm run lint:docs`. Closing the cursor when the work ships is `/done running`.
