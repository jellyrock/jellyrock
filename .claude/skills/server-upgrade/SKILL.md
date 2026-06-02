---
name: server-upgrade
description: Triage a Jellyfin server release against JellyRock's API usage by editing the ONE per-version release-triage digest issue (auto-opened by CI) with verdicts and filing per-finding sub-issues for the changes worth standalone tracking. Consumes the Phase-2 data report (`.api-watch/cache/findings-candidates-<from>..<to>.json` from `npm run api-watch:findings`), investigates each candidate that needs investigation by reading the cited app-usage sites, resolves the edge cases the design doc lists (spec-contract break vs runtime break, capability-guarded fallbacks, spec-regeneration artifacts, enum switches, graceful degradation, opportunity-worth-it, coverage symmetry), and emits a verdict per finding. The mechanical filer (`scripts/server-upgrade.js`, plan/execute split mirroring `/crash-report`) then dedups against existing `[server-upgrade]` issues, files `file` verdicts as native GitHub SUB-ISSUES of the digest (`gh issue create / comment / reopen` with findingKey dedup), inline-notes the skip/monitor ones, rewrites the digest with the verdict checklist, and closes it when fully triaged. Human-gated: running execute is one batch approval per release (the graduated trust ratchet) — nothing auto-files. The recurring floor findings (post-floor endpoints like MediaSegments/Lyrics/QuickConnect) self-resolve via the committed endpoint-availability registry, so they don't reappear every release. Use when a new Jellyfin stable release lands and you want to know what (if anything) it breaks for us. Prerequisite: the report exists (run `api-watch:findings <acknowledged> <latest>` first, committing the latest version's fingerprint via `spec-fingerprint.js <latest>` if needed). RCs and unstable/master builds have a proactive LOCAL triage path (ephemeral fetch, findings written to a `.claude/handoffs/` note, re-diffable as the pre-release evolves) but still never file GitHub issues — durable filing happens via this same skill on the eventual stable release.
model: opus
user-invocable: true
allowed-tools: Bash(node scripts/server-upgrade.js:*), Bash(node scripts/generate/spec-fingerprint.js:*), Bash(node scripts/generate/findings-candidates.js:*), Bash(npm run api-watch:findings:*), Bash(npm run docs:spec-fingerprints:*), Bash(gh issue create:*), Bash(gh issue comment:*), Bash(gh issue reopen:*), Bash(gh issue edit:*), Bash(gh issue close:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh api:*), Bash(gh label create:*), Bash(gh label list:*), Bash(ls:*), Bash(date:*), Read, Grep, Glob, Write
---

# /server-upgrade — investigate a Jellyfin release + file the issues that matter

Phase 3 of the server-upgrade-automation pipeline ([`docs/architecture/server-upgrade-automation.md`](../../../docs/architecture/server-upgrade-automation.md)). This skill is the **judgment half** (pipeline stage 4, "Investigate") wrapped around the **mechanical half** (stage 5, "File" — [`scripts/server-upgrade.js`](../../../scripts/server-upgrade.js)). The Phase-2 report already did the deterministic work: it lists every spec change that intersects code JellyRock ships, with full provenance. This skill reads each candidate's cited code, decides whether it's a *real* problem and what to do, then hands a per-finding verdict to the filer, which dedups + labels + writes the issues behind one batch approval.

The load-bearing seam: **the script never decides "is this a real problem"; the agent never touches GitHub.** The script owns finding identity (so dedup is stable across releases) and issue mechanics; the agent owns the per-finding call. That's what makes the pipeline both trustworthy and low-maintenance.

Like `/crash-report`, this skill has **no sibling `INVESTIGATION.md`** — each filed issue IS the team-shared handoff, and per-finding deep-dive is offloaded to `/issue-triage <N>`. The run-summary in `.claude/handoffs/` is a local audit log / resume aid for the person running the triage.

## Inputs

`$ARGUMENTS`: optionally the path to a Phase-2 report (`.api-watch/cache/findings-candidates-<from>..<to>.json`), OR an explicit `<from> <to>` version pair. If omitted, resolve it in Step 0 from the signals-backlog `jellyfin-server-stable` row (`latest_acknowledged` → `latest_upstream`).

`<to>` selects the **channel** and the path through this skill:

- A **stable** version (`10.11.10`) → the full pipeline below (investigate → file GitHub issues against the per-version digest).
- An **RC** (`10.12.0-rc1`), the literal **`unstable`** / **`master`**, or an explicit **datestamp** (`20240402201942`) → the **pre-release path** (Step 0a): investigate locally, write a handoff, file **no** GitHub issues. This is the proactive surface — react to an upcoming release (or master) before it ships, and re-diff as it changes.

## Step 0 — Preflight

1. **Locate (or produce) the data report.** If `$ARGUMENTS` names a report file, use it. Otherwise read [`docs/signals-backlog.md`](../../../docs/signals-backlog.md)'s `jellyfin-server-stable` row for `latest_acknowledged` (the `<from>`) and `latest_upstream` (the `<to>`), and check for `.api-watch/cache/findings-candidates-<from>..<to>.json`. If it's missing, generate it — committing the `<to>` fingerprint first if needed (the forward anchor is committed fingerprints, per the Phase-2 decision):

   ```bash
   ls docs/architecture/spec-fingerprints/jellyfin-<to>.json 2>/dev/null \
     || node scripts/generate/spec-fingerprint.js <to>        # fetches + writes the fingerprint
   npm run api-watch:findings <from> <to>                     # writes the gitignored report
   ```

   `spec-fingerprint.js <to>` hits the network (Jellyfin's permanent OpenAPI archive) — surface that to the user before running it. **This committed-fingerprint flow is stable-only**: if `<to>` is an RC, `unstable`/`master`, or a datestamp, do NOT commit a fingerprint — jump to **Step 0a** (the pre-release path), which fetches ephemerally and never writes a committed anchor.

   To just **preview** a release without committing its fingerprint (e.g. a quick "what would this flag?" before a full triage), `node scripts/generate/findings-candidates.js <from> <to> --fetch --stdout` builds the `<to>` fingerprint in-memory and prints the full report. The real triage still commits the `<to>` fingerprint (the reviewed anchor) per the step above.

2. **The labels exist.** Check `gh label list --search server-upgrade`. Ensure all three (one-time per repo; `bug` / `enhancement` are GitHub defaults — don't create them):
   - `gh label create server-upgrade --color 1d76db --description "Filed automatically by /server-upgrade from a Jellyfin release API diff"` (per-finding sub-issues)
   - `gh label create server-upgrade:tracker --color 1D76DB --description "Per-version Jellyfin release-triage digest"` (the digest)
   - `gh label create server-upgrade:triaging --color FBCA04 --description "A server-upgrade digest /server-upgrade has triaged — CI hands off the body"`

3. **Locate the per-version digest** (Phase 6). CI auto-opens ONE digest issue per server version (`[server-upgrade] Jellyfin <to> — release triage`, label `server-upgrade:tracker`). Find it: `gh issue list --label server-upgrade:tracker --state all --json number,title,state --limit 100` and match the `<to>` version in the title. Capture its number (`$DIGEST`) for Step 5 — `execute --digest $DIGEST` rewrites it with verdicts, files sub-issues under it, and (when fully triaged) closes it. If no digest exists (you're triaging ahead of CI), either open one first (`gh issue create --title "[server-upgrade] Jellyfin <to> — release triage" --label server-upgrade:tracker --body "Triaged manually ahead of CI."`) or run without `--digest` (promotions file standalone — acceptable, but the digest is the preferred hub).

4. **Read the report's counts** (`counts` block) so you can tell the user up front: N candidates needing investigation (broken down as `breaking` / `coverage-gap` / `symmetry-advisory` / `opportunity`), plus how many were `floorKnown` (post-floor endpoints resolved by the endpoint-availability registry — *not* investigated), suppressed, or frozen-skipped (respect `suppressed: true` and `needsInvestigation: false`). If a coverage-gap or symmetry candidate that you'd expect to be floor-known instead shows `needsInvestigation: true`, it's an UNREGISTERED post-floor endpoint — investigate it, and if it's a known-handled case, the fix is to add an entry to [`docs/dev/jellyfin-endpoint-availability.yml`](../../../docs/dev/jellyfin-endpoint-availability.yml) (mention this to the user; the `lint:endpoint-availability` check validates the entry's guard/sibling claim).

## Step 0a — Pre-release path (RC / unstable / master)

Fires when `<to>` is an RC (`-rcN`/`-betaN`/`-alphaN` suffix), the literal `unstable`/`master`, or a datestamp (`20240402201942`). This is the proactive surface: triage an upcoming release (or master) before it ships, then re-diff as it changes. **It investigates locally and files NO GitHub issues** — the durable filing is the normal stable flow when the final lands. (Background + rationale: [`docs/architecture/server-upgrade-automation.md`](../../../docs/architecture/server-upgrade-automation.md) → "Pre-release channels".)

1. **Resolve `<from>` / `<to>`** (explicit `<from> <to>` args always override):
   - **RC:** read the [`docs/signals-backlog.md`](../../../docs/signals-backlog.md) `jellyfin-server-rc` row — `latest_acknowledged` is the `<from>`, `latest_upstream` is the `<to>`. The re-diff story: after triaging `rc1` you set that row's `latest_acknowledged = <base>-rc1` (Step 6); when `rc2` lands, this diffs `rc1 → rc2`, surfacing only the delta since your proactive work.
   - **Unstable / master:** pass the literal `unstable` (or `master`) as `<to>` — `findings-candidates.js` resolves it to the latest **immutable datestamped** build and prints `resolved unstable → <datestamp>` to stderr (and into the report's `toVersion`). **Relay that pinned datestamp to the user** — it makes the run reproducible and becomes the next `<from>` for a master-over-master re-diff. `<from>` defaults to the latest acknowledged stable, or an explicit prior datestamp. The mutable `jellyfin-openapi-unstable.json` root pointer is never pinned.

2. **Generate the report ephemerally** — no committed fingerprint (these are throwaway anchors; the archive is permanent, so `--fetch` rebuilds them in-memory). For unstable, capture the resolved datestamp from stderr and use it in the cache filename:

   ```bash
   node scripts/generate/findings-candidates.js <from> <to> --fetch --stdout \
     > .api-watch/cache/findings-candidates-<from>..<to>.json
   # <to> may be a version, an RC, or the literal `unstable` / `master`.
   ```

   Surface that this hits the network for any spec not already in `.api-watch/cache/`.

3. **Investigate** — run Steps 1–2 below exactly as written (scaffold + per-candidate judgment); they're version-agnostic.

4. **Then SKIP Steps 3–5.** Instead of the GitHub plan/execute, write a local handoff to `.claude/handoffs/server-upgrade-prerelease-<to>-<timestamp>.md` capturing: the `<from> → <to>` window (and the pinned datestamp if unstable), the per-finding verdicts + rationale, and a **"to fix proactively"** list (the `file`-worthy findings, as fix targets — not GitHub issues). If a finding implies a new API tier is warranted, point the user at `/new-api-version`. Make **zero** `gh` calls.

5. **Close the loop (Step 6 applies):** for RC, offer to `/log signal jellyfin-server-rc` to set `latest_acknowledged = <to>` so the next re-diff baselines correctly. For unstable, the pinned datestamp lives in the handoff (master moves too fast for a daily acknowledged cursor). Then stop — the pre-release path ends here.

## Step 1 — Scaffold the verdict template

```bash
SCAFFOLD=$(mktemp --suffix=.json /tmp/server-upgrade-scaffold.XXXXXX.json)
node scripts/server-upgrade.js scaffold --report <report-path> --out "$SCAFFOLD"
```

This is a pure read: it selects the candidates the report flagged `needsInvestigation`, derives each one's stable `findingKey` (you must NOT change these), and pre-lists the `appUsage.sites` you'll read plus the mechanical `severityGuess` and base labels. No GitHub, no writes. If the scaffold has zero verdicts, report "nothing JellyRock uses changed in `<from>` → `<to>`" and stop (this is the common, good outcome — the pipeline's whole point is staying silent about churn that doesn't touch us).

## Step 2 — Investigate each candidate (the judgment core)

Read `$SCAFFOLD`. For **every** verdict entry, open each path in `appUsage.sites` (and grep nearby for dispatch branches / capability guards) and decide. This is the part that can't be a script. Resolve the design doc's edge cases:

1. **Spec-contract break ≠ runtime break.** A retype (`int64 → int32`) or a nullable change is usually a no-op given JellyRock's `?? default` pattern + BrightScript's dynamic typing — but sometimes a silent break (e.g. a value that overflows an `Integer`, or a field the app indexes into assuming an array). Read the site and decide which.
2. **Used-with-a-fallback.** An endpoint "removed" upstream but covered for the affected tier by a dispatch branch (`if m.getApiVersion() >= N`) or a capability guard (e.g. `supportsMediaSegments()`) is **not** breaking — `skip` it with that rationale. This is also how you disposition the *expected* `coverage-gap` candidates the doc warns about: an endpoint tagged `[1, ∞)` only because it's guarded by a capability check rather than a version branch (e.g. `/audio/{}/lyrics`) is fine on the floor — `skip` with the guard cited.
3. **Spec-regeneration artifacts.** If the change looks cosmetic (a schema refactor, a `$ref` reshuffle) with no real contract delta, `skip` it — and consider whether it belongs in [`.api-watch/suppressions.yml`](../../../.api-watch/suppressions.yml) so future runs drop it mechanically (mention this to the user; don't edit the YAML silently).
4. **Enum changes.** A value added/removed on an enum the app switches on (`BaseItemKind`, stream `Type`, `MediaType`). Read the switch sites — an added value the app falls through on gracefully is low/skip; a removed value the app still sends, or relies on receiving, is real.
5. **Graceful degradation vs genuine break** when a field disappears: does the feature still work degraded, or does a screen break?
6. **Opportunity worth it?** For `opportunity` (new endpoint) candidates, decide whether it maps to a real JellyRock feature gap worth an `enhancement` issue (`file`) or is noise for us (`skip`), or worth tracking but not now (`monitor`).
7. **Coverage symmetry.** A `symmetry-advisory` flags a modern-only endpoint (wired tier ≥N) whose operation the **floor** server *also* serves — so the app might be leaving floor users without it. Disposition the same way as #2, but looking for a **lower-tier dispatch sibling**: grep the cited site (and nearby) for an `if m.getApiVersion() >= N` branch that calls a *different* endpoint for the floor (e.g. `/Items/{}` on V2 vs `/Users/{}/Items/{}` on V1). If a sibling covers the floor → **`skip`** with that rationale — this is the *expected* `GET /items` case (the V1 branch uses `/Users/{userId}/Items`), the symmetry analogue of #2's guarded-fallback. If **no** floor path exists for the operation → floor users genuinely lack it → **`file`** (a real coverage gap, `enhancement`). Cosmetic / not worth it → **`monitor`**.

For each, set in place (do **not** change `findingKey`):

- `real` (bool), `severity` (`high` | `medium` | `low`), `recommendedAction`:
  - **`file`** — a real problem (or worthwhile opportunity) worth an issue. Requires `severity` + a `draftIssueBody` (GitHub markdown: what changed, why it affects us, the cited sites, suggested fix direction). The filer wraps it with a provenance header + footer, so write only the substance.
  - **`skip`** — investigated, not a real problem (false positive, no runtime impact, guarded fallback, regeneration artifact). No body needed. A one-paragraph `rationale` is **required** — it's the audit trail for why we looked and passed.
  - **`monitor`** — real but deferred (opportunity for later, symmetry advisory not worth filing yet). `rationale` required; surfaced for a possible `/log signal`.
- Append any extra `labels` (e.g. `regression`) beyond the prefilled base set.

Write the filled file back with `Write` (overwrite `$SCAFFOLD`, or a sibling `$VERDICTS` path). Every entry must end with a non-null `recommendedAction` — the filer flags any you leave blank as `missing-verdict` rather than dropping it.

## Step 3 — Plan (mechanical; no GitHub writes)

> **Stable path only.** If you arrived here via the pre-release path (Step 0a), stop — Steps 3–5 file GitHub issues, which pre-release runs never do. You should already have written the local handoff (Step 0a.4) and closed the loop (Step 0a.5).

```bash
PLAN=$(mktemp --suffix=.json /tmp/server-upgrade-plan.XXXXXX.json)
node scripts/server-upgrade.js plan --report <report-path> --verdicts "$SCAFFOLD" --plan-out "$PLAN"
```

The filer joins your verdicts back to the report by `findingKey`, **dedup-searches GitHub** (reads only) for an existing `[server-upgrade]` issue carrying each finding's version-independent identity, and reconciles into concrete actions: `create` (no existing issue), `comment` (recurrence on an open issue — same finding, new release), `reopen` (regression on a closed issue), plus the non-writing `skip` / `monitor` / `missing-verdict` / `invalid-verdict`. In Phase 6 the `file` actions (`create`/`comment`/`reopen`) become per-finding **promotions** filed as native GitHub **sub-issues** of the per-version digest; `skip` / `monitor` become inline checked-off notes on the digest.

## Step 4 — Render the plan + confirm

Read `$PLAN`. Render it as:

1. **Header**: the digest issue (`#$DIGEST`) being triaged; `<from>` → `<to>` (floor `<floor>`); investigation-candidate count; `floorKnown` + suppressed/frozen-skip counts from `reportCounts` (deliberately not investigated).
2. **Promotion table** — one row per write action (each becomes a sub-issue of the digest):

   | # | Action | Existing | Severity | Finding | Labels |
   |---|---|---|---|---|---|
   | 1 | create | — | high | endpoint removed: GET /Items/{itemId} | server-upgrade, bug |
   | 2 | comment | #812 (OPEN) | medium | field retyped: BaseItemDto.runTimeTicks | server-upgrade, bug |
   | 3 | reopen | #790 (CLOSED) | high | floor coverage gap: GET /UserViews | server-upgrade, bug |

3. **Investigated, not filing (inline notes on the digest)** — the `skip` rows with their rationale (the audit trail), and `monitor` rows.
4. **⚠️ Needs attention** — any `missing-verdict` (you skipped investigating a candidate — go back to Step 2) or `invalid-verdict` (malformed verdict; the `problems` say why). Resolve these before executing, or the findings won't be filed.

Then ask via AskUserQuestion: (a) execute the plan as-is, (b) revise verdicts and re-plan (loop to Step 2/3), or (c) abort. **This confirmation IS the graduated-trust-ratchet gate** — one batch approval per release, not per finding. Nothing files without it. (If a finding-class has *graduated* — its `type` is in `AUTO_FILE_CLASSES`, so its actions carry `autoFileEligible: true` — that class's `create` actions are pre-approved within this batch and don't need separate confirmation. Today `AUTO_FILE_CLASSES` is empty: every class is still gated. Graduation only ever relaxes *this in-session* approval; the CI tracker never auto-files. See the design doc's "Graduation procedure".)

## Step 5 — Execute

```bash
node scripts/server-upgrade.js execute --plan "$PLAN" --digest "$DIGEST" --close-digest
```

Performs the GH writes for each write action — `gh issue create` / `comment` / `reopen` + labels for the per-finding promotions, then `gh api .../sub_issues` to link each as a sub-issue of `$DIGEST` — continuing past individual failures (recorded in the summary). It then rewrites the digest body with the verdict checklist and adds `server-upgrade:triaging` (so CI hands off the body). With `--close-digest` it closes the digest **only if every candidate is dispositioned** (no `missing-verdict` / `invalid-verdict` left) — the human-gated close (CI never closes a candidate-bearing digest). Drop `--close-digest` if you want to leave the digest open for more discussion. Omit `--digest` only if no digest exists (promotions then file standalone). Finally writes a run-summary handoff to `.claude/handoffs/server-upgrade-<timestamp>.md`.

## Step 6 — Surface the summary + capture deferrals

Read the run-summary. Recap briefly, e.g.:

> Triaged the Jellyfin 10.11.10 digest (#840): filed 2 sub-issues (#842, #843), commented on 1 recurrence (#812), reopened 1 regression (#790). Skipped 4 after investigation (guarded fallbacks / cosmetic). 1 to monitor. Digest closed (fully triaged). Summary: `.claude/handoffs/server-upgrade-<ts>.md`. **Next**: deep-dive any sub-issue with `/issue-triage <N>`.

Then close the loops the design's capture-discipline rule expects:

- For each `monitor` finding worth tracking upstream, offer to run `/log signal <slug>` (don't write the journal directly).
- If you flagged any change as a recurring cosmetic artifact in Step 2.3, remind the user it can be added to `.api-watch/suppressions.yml` to drop it mechanically next time.
- This run acknowledged `<to>`: offer to update the `jellyfin-server-stable` row's `latest_acknowledged` via `/log signal` (or `/done` if the watch resolves).

Clean up the temp files: `rm -f "$SCAFFOLD" "$PLAN"`.

## When NOT to use

- A new Jellyfin **RC** or **master** build → this skill *does* handle it, via the **pre-release path** (Step 0a): it triages locally and writes a handoff, but files **no** GitHub issues. (It's still also tracked by the `jellyfin-server-rc` signal.) Don't reach for the stable Steps 3–5 for a pre-release.
- You want to investigate one **already-filed** `[server-upgrade]` issue → use `/issue-triage <N>`.
- The report shows zero investigation candidates → there's nothing to do; that's the system working (silent on churn that doesn't touch us).
- You need to (re)generate the manifest, fingerprints, or the report itself → those are the Phase 0–2 generators (`docs:api-manifest`, `docs:spec-fingerprints`, `api-watch:findings`), not this skill.

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/server-upgrade/SKILL.md and follow Steps 0-5 for $ARGUMENTS=<report-path>; investigate each candidate against its cited sites, write verdicts, plan + execute; surface the summary path` in the Task prompt.