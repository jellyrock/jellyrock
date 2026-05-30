---
name: server-upgrade
description: Triage a Jellyfin server release against JellyRock's API usage and file/dedup GitHub issues for the changes that actually affect us. Consumes the Phase-2 data report (`.api-watch/cache/findings-candidates-<from>..<to>.json` from `npm run api-watch:findings`), investigates each candidate that needs investigation by reading the cited app-usage sites, resolves the edge cases the design doc lists (spec-contract break vs runtime break, capability-guarded fallbacks, spec-regeneration artifacts, enum switches, graceful degradation, opportunity-worth-it, coverage symmetry), and emits a verdict per finding. The mechanical filer (`scripts/server-upgrade.js`, plan/execute split mirroring `/crash-report`) then dedups against existing `[server-upgrade]` issues and does `gh issue create / comment / reopen` with labels. Human-gated: running execute is one batch approval per release (the graduated trust ratchet) — nothing auto-files. Use when a new Jellyfin stable release lands and you want to know what (if anything) it breaks for us, and file the issues. Prerequisite: the report exists (run `api-watch:findings <acknowledged> <latest>` first, committing the latest version's fingerprint via `spec-fingerprint.js <latest>` if needed). RCs are tracked separately and do NOT generate issues.
model: opus
user-invocable: true
allowed-tools: Bash(node scripts/server-upgrade.js:*), Bash(node scripts/generate/spec-fingerprint.js:*), Bash(node scripts/generate/findings-candidates.js:*), Bash(npm run api-watch:findings:*), Bash(npm run docs:spec-fingerprints:*), Bash(gh issue create:*), Bash(gh issue comment:*), Bash(gh issue reopen:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh label create:*), Bash(gh label list:*), Bash(ls:*), Bash(date:*), Read, Grep, Glob, Write
---

# /server-upgrade — investigate a Jellyfin release + file the issues that matter

Phase 3 of the server-upgrade-automation pipeline ([`docs/architecture/server-upgrade-automation.md`](../../../docs/architecture/server-upgrade-automation.md)). This skill is the **judgment half** (pipeline stage 4, "Investigate") wrapped around the **mechanical half** (stage 5, "File" — [`scripts/server-upgrade.js`](../../../scripts/server-upgrade.js)). The Phase-2 report already did the deterministic work: it lists every spec change that intersects code JellyRock ships, with full provenance. This skill reads each candidate's cited code, decides whether it's a *real* problem and what to do, then hands a per-finding verdict to the filer, which dedups + labels + writes the issues behind one batch approval.

The load-bearing seam: **the script never decides "is this a real problem"; the agent never touches GitHub.** The script owns finding identity (so dedup is stable across releases) and issue mechanics; the agent owns the per-finding call. That's what makes the pipeline both trustworthy and low-maintenance.

Like `/crash-report`, this skill has **no sibling `INVESTIGATION.md`** — each filed issue IS the team-shared handoff, and per-finding deep-dive is offloaded to `/issue-triage <N>`. The run-summary in `.claude/handoffs/` is a local audit log / resume aid for the person running the triage.

## Inputs

`$ARGUMENTS`: optionally the path to a Phase-2 report (`.api-watch/cache/findings-candidates-<from>..<to>.json`). If omitted, resolve it in Step 0 from the signals-backlog `jellyfin-server-stable` row (`latest_acknowledged` → `latest_upstream`).

## Step 0 — Preflight

1. **Locate (or produce) the data report.** If `$ARGUMENTS` names a report file, use it. Otherwise read [`docs/signals-backlog.md`](../../../docs/signals-backlog.md)'s `jellyfin-server-stable` row for `latest_acknowledged` (the `<from>`) and `latest_upstream` (the `<to>`), and check for `.api-watch/cache/findings-candidates-<from>..<to>.json`. If it's missing, generate it — committing the `<to>` fingerprint first if needed (the forward anchor is committed fingerprints, per the Phase-2 decision):

   ```bash
   ls docs/architecture/spec-fingerprints/jellyfin-<to>.json 2>/dev/null \
     || node scripts/generate/spec-fingerprint.js <to>        # fetches + writes the fingerprint
   npm run api-watch:findings <from> <to>                     # writes the gitignored report
   ```

   `spec-fingerprint.js <to>` hits the network (Jellyfin's permanent OpenAPI archive) — surface that to the user before running it. **Stable releases only**: if `<to>` is an RC, stop — RCs are tracked by the `jellyfin-server-rc` signal and do NOT generate issues.

2. **The `server-upgrade` label exists.** Check `gh label list --search server-upgrade`. If missing, surface: `gh label create server-upgrade --color 1d76db --description "Filed automatically by /server-upgrade from a Jellyfin release API diff"`. (`bug` / `enhancement` are GitHub defaults — don't create them.) One-time setup per repo.

3. **Read the report's counts** (`counts` block) so you can tell the user up front: N candidates needing investigation (broken down as `breaking` / `coverage-gap` / `symmetry-advisory` / `opportunity`), plus how many were suppressed / frozen-skipped (those are *not* re-filed — respect `suppressed: true` and `needsInvestigation: false`).

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
7. **Coverage symmetry.** For symmetry-advisory candidates, an operation wired for only one tier that's likely missing on the rest of the supported range — accounting for intentionally-modern-only guarded features.

For each, set in place (do **not** change `findingKey`):

- `real` (bool), `severity` (`high` | `medium` | `low`), `recommendedAction`:
  - **`file`** — a real problem (or worthwhile opportunity) worth an issue. Requires `severity` + a `draftIssueBody` (GitHub markdown: what changed, why it affects us, the cited sites, suggested fix direction). The filer wraps it with a provenance header + footer, so write only the substance.
  - **`skip`** — investigated, not a real problem (false positive, no runtime impact, guarded fallback, regeneration artifact). No body needed. A one-paragraph `rationale` is **required** — it's the audit trail for why we looked and passed.
  - **`monitor`** — real but deferred (opportunity for later, symmetry advisory not worth filing yet). `rationale` required; surfaced for a possible `/log signal`.
- Append any extra `labels` (e.g. `regression`) beyond the prefilled base set.

Write the filled file back with `Write` (overwrite `$SCAFFOLD`, or a sibling `$VERDICTS` path). Every entry must end with a non-null `recommendedAction` — the filer flags any you leave blank as `missing-verdict` rather than dropping it.

## Step 3 — Plan (mechanical; no GitHub writes)

```bash
PLAN=$(mktemp --suffix=.json /tmp/server-upgrade-plan.XXXXXX.json)
node scripts/server-upgrade.js plan --report <report-path> --verdicts "$SCAFFOLD" --plan-out "$PLAN"
```

The filer joins your verdicts back to the report by `findingKey`, **dedup-searches GitHub** (reads only) for an existing `[server-upgrade]` issue carrying each finding's version-independent identity, and reconciles into concrete actions: `create` (no existing issue), `comment` (recurrence on an open issue — same finding, new release), `reopen` (regression on a closed issue), plus the non-writing `skip` / `monitor` / `missing-verdict` / `invalid-verdict`.

## Step 4 — Render the plan + confirm

Read `$PLAN`. Render it as:

1. **Header**: `<from>` → `<to>` (floor `<floor>`); investigation-candidate count; suppressed/frozen-skip count from `reportCounts` (deliberately not investigated).
2. **Action table** — one row per write action:

   | # | Action | Existing | Severity | Finding | Labels |
   |---|---|---|---|---|---|
   | 1 | create | — | high | endpoint removed: GET /Items/{itemId} | server-upgrade, bug |
   | 2 | comment | #812 (OPEN) | medium | field retyped: BaseItemDto.runTimeTicks | server-upgrade, bug |
   | 3 | reopen | #790 (CLOSED) | high | floor coverage gap: GET /UserViews | server-upgrade, bug |

3. **Investigated, not filing** — the `skip` rows with their rationale (the audit trail), and `monitor` rows.
4. **⚠️ Needs attention** — any `missing-verdict` (you skipped investigating a candidate — go back to Step 2) or `invalid-verdict` (malformed verdict; the `problems` say why). Resolve these before executing, or the findings won't be filed.

Then ask via AskUserQuestion: (a) execute the plan as-is, (b) revise verdicts and re-plan (loop to Step 2/3), or (c) abort. **This confirmation IS the graduated-trust-ratchet gate** — one batch approval per release, not per finding. Nothing files without it. (If a finding-class has *graduated* — its `type` is in `AUTO_FILE_CLASSES`, so its actions carry `autoFileEligible: true` — that class's `create` actions are pre-approved within this batch and don't need separate confirmation. Today `AUTO_FILE_CLASSES` is empty: every class is still gated. Graduation only ever relaxes *this in-session* approval; the CI tracker never auto-files. See the design doc's "Graduation procedure".)

## Step 5 — Execute

```bash
node scripts/server-upgrade.js execute --plan "$PLAN"
```

Performs the GH writes (`gh issue create` / `gh issue comment` / `gh issue reopen`) + labels for each write action, continuing past individual failures (recorded in the summary), then writes a run-summary handoff to `.claude/handoffs/server-upgrade-<timestamp>.md`.

## Step 6 — Surface the summary + capture deferrals

Read the run-summary. Recap briefly, e.g.:

> Filed 2 new issues (#842, #843), commented on 1 recurrence (#812), reopened 1 regression (#790). Skipped 4 after investigation (guarded fallbacks / cosmetic). 1 to monitor. Summary: `.claude/handoffs/server-upgrade-<ts>.md`. **Next**: deep-dive any issue with `/issue-triage <N>`.

Then close the loops the design's capture-discipline rule expects:

- For each `monitor` finding worth tracking upstream, offer to run `/log signal <slug>` (don't write the journal directly).
- If you flagged any change as a recurring cosmetic artifact in Step 2.3, remind the user it can be added to `.api-watch/suppressions.yml` to drop it mechanically next time.
- This run acknowledged `<to>`: offer to update the `jellyfin-server-stable` row's `latest_acknowledged` via `/log signal` (or `/done` if the watch resolves).

Clean up the temp files: `rm -f "$SCAFFOLD" "$PLAN"`.

## When NOT to use

- A new Jellyfin **RC** (not stable) dropped → it's tracked by the `jellyfin-server-rc` signal; do not file issues. (Spin it up manually against a test library if you want early signal.)
- You want to investigate one **already-filed** `[server-upgrade]` issue → use `/issue-triage <N>`.
- The report shows zero investigation candidates → there's nothing to do; that's the system working (silent on churn that doesn't touch us).
- You need to (re)generate the manifest, fingerprints, or the report itself → those are the Phase 0–2 generators (`docs:api-manifest`, `docs:spec-fingerprints`, `api-watch:findings`), not this skill.

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/server-upgrade/SKILL.md and follow Steps 0-5 for $ARGUMENTS=<report-path>; investigate each candidate against its cited sites, write verdicts, plan + execute; surface the summary path` in the Task prompt.