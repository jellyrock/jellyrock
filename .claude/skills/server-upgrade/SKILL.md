---
name: server-upgrade
description: "Triage a Jellyfin server release against JellyRock's API usage. CI opens one digest issue per release; this skill reads the data report (`.api-watch/cache/findings-candidates-<from>..<to>.json` from `npm run api-watch:findings`, built here if missing), investigates each candidate by reading the app code it cites, resolves the edge cases the design doc lists (a spec break that is not a runtime break, a capability guard or dispatch branch that covers it, a spec-regeneration artifact, an enum change, graceful degradation, whether an opportunity is worth it, floor coverage, removal versus rename), and writes a verdict per finding. Then `scripts/server-upgrade.js` runs scaffold, plan and execute: it dedups against existing `[server-upgrade]` issues, files each `file` verdict as a sub-issue of the digest, notes the skip and monitor verdicts on the digest, rewrites its checklist and closes it once every finding has a verdict. Nothing files without one approval per release. Post-floor endpoints the endpoint-availability ledger covers (MediaSegments, Lyrics, QuickConnect) do not come back every release. Use when a new Jellyfin stable release lands and you want to know what, if anything, it breaks for us. Release candidates and unstable/master builds take a local path: the report is built in memory, findings go to a `.claude/handoffs/` note, and nothing is filed on GitHub until the stable release."
model: opus
effort: high
user-invocable: true
allowed-tools: Bash(node scripts/server-upgrade.js:*), Bash(node scripts/generate/spec-fingerprint.js:*), Bash(node scripts/generate/findings-candidates.js:*), Bash(npm run api-watch:findings:*), Bash(npm run docs:spec-fingerprints:*), Bash(gh issue create:*), Bash(gh issue comment:*), Bash(gh issue reopen:*), Bash(gh issue edit:*), Bash(gh issue close:*), Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh api:*), Bash(gh label create:*), Bash(gh label list:*), Bash(ls:*), Bash(date:*), Read, Grep, Glob, Write
---

# /server-upgrade: investigate a Jellyfin release and file the issues that matter

This skill is stage 4, "Investigate", of the pipeline in [`docs/architecture/server-upgrade-automation.md`](../../../docs/architecture/server-upgrade-automation.md), wrapped around stage 5, "File" ([`scripts/server-upgrade.js`](../../../scripts/server-upgrade.js)). The data report has already done the deterministic work: it lists every spec change that touches code JellyRock ships, with where each came from. You read each candidate's cited code, decide whether it is a real problem and what to do, and hand a verdict per finding to the filer, which dedups, labels and writes the issues behind one batch approval.

The split holds the pipeline together: **the script never decides whether a change is a real problem, and you never touch GitHub.** The script owns finding identity (so dedup stays stable across releases) and the issue mechanics; you own the call on each finding.

Like `/crash-report`, this skill has no sibling `INVESTIGATION.md`: each filed issue is the shared handoff, and a deep dive on one finding goes to `/issue-triage <N>`. The run summary in `.claude/handoffs/` is a local record and resume aid for the person running the triage.

## Inputs

The arguments are optional: the path to a data report (`.api-watch/cache/findings-candidates-<from>..<to>.json`), or a `<from> <to>` version pair. With none, Step 0 resolves the pair from the `jellyfin-server-stable` row in the signals backlog (`latest_acknowledged` is `<from>`, `latest_upstream` is `<to>`).

`<to>` picks the channel and the path through this skill:

- A **stable** version (`10.11.10`) takes the full pipeline below: investigate, then file GitHub issues against the release's digest.
- A **release candidate** (`10.12.0-rc1`), the literal `unstable` or `master`, or a **datestamp** (`20240402201942`) takes the pre-release path (Step 0a): investigate locally, write a handoff, file no GitHub issues. Use it to get ahead of an upcoming release, or of master, and diff again as it changes.

## Step 0: Preflight

1. **Find or build the data report.** If the arguments name a report file, use it. Otherwise read the `jellyfin-server-stable` row in [`docs/signals-backlog.md`](../../../docs/signals-backlog.md) for `latest_acknowledged` (`<from>`) and `latest_upstream` (`<to>`), and look for `.api-watch/cache/findings-candidates-<from>..<to>.json`. If it is missing, build it, committing the `<to>` fingerprint first when there is none (committed fingerprints are the diff's forward anchor):

   ```bash
   ls docs/architecture/spec-fingerprints/jellyfin-<to>.json 2>/dev/null \
     || node scripts/generate/spec-fingerprint.js <to>        # fetches and writes the fingerprint
   npm run api-watch:findings <from> <to>                     # writes the gitignored report
   ```

   `spec-fingerprint.js <to>` fetches from Jellyfin's OpenAPI archive: tell the user before running it. **Commit a fingerprint only for a stable version.** If `<to>` is a release candidate, `unstable`, `master` or a datestamp, go to Step 0a, which builds the report in memory and writes no committed anchor.

   To preview a release without committing its fingerprint (a quick "what would this flag?" before a full triage), `node scripts/generate/findings-candidates.js <from> <to> --fetch --stdout` builds the `<to>` fingerprint in memory and prints the report. The real triage still commits the `<to>` fingerprint as above, since it is the reviewed anchor.

2. **Check the labels exist.** `gh label list --search server-upgrade` should show `server-upgrade` (per-finding sub-issues), `server-upgrade:tracker` (the digest; CI's tracker workflow creates it) and `server-upgrade:triaging` (a digest this skill has triaged, so CI stops rewriting its body). `bug` and `enhancement` are GitHub defaults. Create only a missing one, with the description its role above gives it.

3. **Find the release's digest.** CI opens one digest issue per server version, titled `[server-upgrade] Jellyfin <to> — release triage` and labeled `server-upgrade:tracker`. Find it with `gh issue list --label server-upgrade:tracker --state all --json number,title,state --limit 100` and match `<to>` in the title. Keep its number as the digest number for Step 5: `execute --digest` rewrites it with the verdicts, files sub-issues under it and closes it when every finding has a verdict. If there is no digest yet (you are ahead of CI), open one with `gh issue create --title "[server-upgrade] Jellyfin <to> — release triage" --label server-upgrade:tracker --body "Triaged manually ahead of CI."`, or run without `--digest` so the issues file on their own. The digest is the better hub. **A digest that is closed, or already labeled `server-upgrade:triaging`, was triaged before:** `execute --digest` rewrites its body with this run's verdicts and nothing else, which erases the earlier record (its filed sub-issue lines included). Tell the user, and run Step 5 without `--digest` unless they ask for the rewrite.

4. **Read the report's `counts` block** so you can tell the user up front: how many candidates need investigation (`needsInvestigation`), the count of each type (`breaking`, `coverage-gap`, `symmetry-advisory`, `opportunity`), and how many were `floorKnown` (post-floor endpoints the endpoint-availability ledger resolves; not investigated), `suppressed` or `frozenSkip`. Respect `suppressed: true` and `needsInvestigation: false`. A coverage-gap or symmetry candidate you would expect to be floor-known but that shows `needsInvestigation: true` is a post-floor endpoint the ledger lacks. Investigate it, and if the app already handles it, tell the user the fix is an entry in [`docs/dev/jellyfin-endpoint-availability.yml`](../../../docs/dev/jellyfin-endpoint-availability.yml); `lint:endpoint-availability` checks the entry's guard or sibling claim.

## Step 0a: Pre-release path (release candidate, unstable or master)

You take this path when `<to>` has an `-rcN`, `-betaN` or `-alphaN` suffix, is the literal `unstable` or `master`, or is a datestamp. **It investigates locally and files no GitHub issues;** the issues come from the normal stable run once the release ships. The design doc's [pre-release section](../../../docs/architecture/server-upgrade-automation.md#pre-release-channels-rc--unstablemaster) has the background.

Skip the rest of Step 0: label checks, the digest and its counts all exist for GitHub, and a pre-release has no digest. Run this sequence instead:

1. **Resolve `<from>` and `<to>`.** Explicit arguments always win.
   - **Release candidate:** read the `jellyfin-server-rc` row in [`docs/signals-backlog.md`](../../../docs/signals-backlog.md): `latest_acknowledged` is `<from>` and `latest_upstream` is `<to>`. Once you triage `rc1`, step 5 below sets that row's `latest_acknowledged` to `rc1`, so when `rc2` lands the next run diffs `rc1` to `rc2` and shows only what changed since.
   - **Unstable or master:** pass `unstable` (or `master`) as `<to>`. `findings-candidates.js` resolves it to the newest immutable datestamped build and prints `resolved unstable → <datestamp>` to stderr; the datestamp also lands in the report's `toVersion`. **Tell the user the datestamp:** it makes the run reproducible and is the next `<from>` for a master-to-master diff. `<from>` defaults to the latest acknowledged stable, or a prior datestamp you pass. The mutable `jellyfin-openapi-unstable.json` pointer is never pinned.

2. **Build the report in memory**, with no committed fingerprint: the archive is permanent, so `--fetch` can rebuild these throwaway anchors any time.

   ```bash
   node scripts/generate/findings-candidates.js <from> <to> --fetch
   # <to> may be a version, a release candidate, or the literal unstable or master.
   ```

   The script names the cache file itself, `.api-watch/cache/findings-candidates-<from>..<datestamp>.json` for unstable, and prints that path. Use the printed path as the report path in Step 1. Leave out `--stdout`: it writes no file, so you would have to name one by hand, and for unstable you would name it after the token, not the build. Tell the user this fetches any spec not already in `.api-watch/cache/`.

3. **Investigate:** run Steps 1 and 2 as written, with the printed path as the report path. They don't depend on the channel.

4. **Then skip Steps 3 to 5.** In their place, write a handoff to `.claude/handoffs/server-upgrade-prerelease-<resolved-to>-<timestamp>.md`. Name it with the report's `toVersion` (the datestamp for unstable), not the word `unstable`, so the handoff is reproducible and sorts by build. Record the `<from>` to `<resolved-to>` window, each verdict with its rationale, and a **"to fix proactively"** list: the findings you would `file`, as fix targets, not issues. For an unstable or master run, lead that list with the breaking findings that need investigation: they are the work a new `>= N` API tier would absorb. If any warrants a new tier, point the user at `/new-api-version`. Make no `gh` calls on this path.

   Here a `file` verdict doesn't need a full `draftIssueBody`: the verdicts file is a temporary you delete at the end. Put the fix direction in the handoff's list (what changed, the cited sites, how removal versus rename resolved, the suggested fix). Each verdict still needs a short `rationale`, as the record of why.

5. **Close the loop** (Step 6 applies). For a release candidate, offer `/log signal jellyfin-server-rc` to set `latest_acknowledged` to `<to>`, so the next diff starts from it. For unstable, the pinned datestamp lives in the handoff, since master moves too fast for a daily cursor. The pre-release path ends here.

## Step 1: Build the verdict template

```bash
SCAFFOLD=$(mktemp --suffix=.json /tmp/server-upgrade-scaffold.XXXXXX)
VERDICTS="${SCAFFOLD%.json}.verdicts.json"   # a new path you write the filled verdicts to (Step 2)
node scripts/server-upgrade.js scaffold --report <report-path> --out "$SCAFFOLD"
```

> `mktemp --suffix=.json <template>` needs the template to end in `X`: put `.json` in `--suffix`. A `...XXXXXX.json` template fails and leaves `$SCAFFOLD` empty.
>
> Each shell call starts fresh, so `$SCAFFOLD`, `$VERDICTS` and later `$PLAN` don't carry over: echo the paths here and write them out in full in later steps.

`scaffold` only reads. It picks the candidates the report marked `needsInvestigation`, derives each one's stable `findingKey` (never change these), and lists the `appUsage.sites` you will read, with the mechanical `severityGuess` and the base labels. It writes nothing to GitHub. If the template has no verdicts, tell the user nothing JellyRock uses changed from `<from>` to `<to>` and stop. That is the common, good outcome: the pipeline stays silent about churn that doesn't touch us.

## Step 2: Investigate each candidate

Load `$SCAFFOLD` with the Read tool, not `cat`. For every verdict entry, open each path in `appUsage.sites`, grep nearby for dispatch branches and capability guards, and decide. This is the part no script can do.

**Cite the exact line, not only the file.** Every claim in a `rationale` that the app does or doesn't use something names the precise call site: the line that sends the changed surface, or, for a "we never send X" skip, the line that builds the request and leaves it out. A rationale that says "JellyRock never sends X" or "the read is guarded" without its `file:line` is unfinished, like a `draftIssueBody` that still says "confirm whether renamed or dropped" (case 8). The rule exists because depth otherwise varies by run: two runs on identical input can reach the same verdicts with different evidence, and a rerun can slip to citing `source/api/items.bs` in general instead of the line that proves the audio direct-stream call leaves out the removed parameter. Linking the upstream PR behind a change is welcome but optional; don't turn it into a rate-limited `gh search` hunt.

Resolve the cases the design doc lists:

1. **A spec break is not always a runtime break.** A retype (`int64` to `int32`) or a nullable change is usually harmless given the app's `?? default` pattern and BrightScript's dynamic typing, but sometimes it breaks silently: a value that overflows an `Integer`, or a field the app indexes as an array. Read the site and decide which.
2. **A fallback covers it.** An endpoint removed upstream but covered for the affected tier by a dispatch branch (`if m.getApiVersion() >= N`) or a capability guard (`supportsMediaSegments()`) is not breaking: `skip` it and cite the branch or guard. This is also how you settle the expected `coverage-gap` candidates: an endpoint tagged `[1, ∞)` only because a capability check guards it rather than a version branch (`/audio/{}/lyrics`) is fine on the floor, so `skip` it with the guard cited.
3. **Spec-regeneration artifacts.** A change that looks cosmetic (a schema refactor, a `$ref` reshuffle) with no real contract change: `skip` it, and consider whether it belongs in [`.api-watch/suppressions.yml`](../../../.api-watch/suppressions.yml) so later runs drop it mechanically. Tell the user; don't edit the file yourself.
4. **Enum changes.** A value added to or removed from an enum the app switches on (`BaseItemKind`, stream `Type`, `MediaType`). Read the switch sites: an added value the app falls through on safely is low or `skip`; a removed value the app still sends, or expects to receive, is real.
5. **Graceful degradation or a real break** when a field disappears: does the feature still work in a reduced form, or does a screen break?
6. **Is the opportunity worth it?** For an `opportunity` (a new endpoint), decide whether it fills a real JellyRock feature gap worth an `enhancement` issue (`file`), is noise for us (`skip`), or is worth tracking but not now (`monitor`).
7. **Floor coverage.** A `symmetry-advisory` flags an endpoint only the newer tier uses (wired at tier N or above) whose operation the floor server also serves, so floor users might be going without it. Settle it as in case 2, but look for a lower-tier dispatch sibling: grep the cited site and nearby for an `if m.getApiVersion() >= N` branch that calls a different endpoint for the floor (`/Items/{}` on V2 against `/Users/{}/Items/{}` on V1). If a sibling covers the floor, `skip` it with that rationale; `GET /items` is the expected case, since the V1 branch uses `/Users/{userId}/Items`. If no floor path exists for the operation, floor users lack it: `file` it as a real coverage gap (`enhancement`). If it is cosmetic or not worth it, `monitor`.
8. **Removal or rename: resolve it, don't hedge.** A `param-removed` or `field-removed` finding is the spec diff's view, and the diff can't tell a real removal from a rename or a move. The report does the same-scope half for you: each such finding carries `renameCandidates` (in the template too), the additions in the same operation or schema that could be the rename, same signature first.
   - **Empty `renameCandidates: []`:** nothing in the same scope could be the rename, so it is a real removal. But a real removal is not always a behavior change: the diff compares the spec's shape, not whether the `<from>` version honored the parameter or field at runtime. A parameter can sit in the spec as a dead no-op (C# `[ParameterObsolete]`, or never wired into the query object or handler), and deleting it changes nothing. **Don't go from "empty `renameCandidates`" to "replicate it client-side" without checking the baseline.** Read the `<from>` tag's controller or model first (`gh api repos/jellyfin/jellyfin/contents/<path>?ref=v<from>`) and confirm the parameter or field was wired in or read. If it was a no-op in `<from>`, the removal is cleanup: `skip`, no client fix. If it worked in `<from>` and is gone in `<to>`, the behavior changed: replicate it client-side or degrade gracefully. The trap, as an example: `disableFirstEpisode` on `/Shows/NextUp` looks like a plain removal, but in `v10.11.10` it was already `[ParameterObsolete]` and not wired into `NextUpQuery`, so master only deletes a dead parameter: `skip`.
   - **Populated `renameCandidates`:** most likely a rename or move. Confirm which candidate it is and that its meaning matches, then map the new name behind version dispatch (upstream keeps the old behavior). For a high-severity `file`, confirm against the upstream source. The spec gives you the hook: `operationId` is the C# controller method's name, and a schema name is its model class.

     ```bash
     # endpoint parameter: find the controller method and its current parameters
     gh api "search/code?q=<operationId>+repo:jellyfin/jellyfin" --jq '.items[].path'
     gh api "repos/jellyfin/jellyfin/contents/<path>?ref=master" --jq '.content' | base64 -d | grep -ni "<oldParam>\|<candidateParam>"
     # schema field: find the model class
     gh api "search/code?q=class+<SchemaName>+repo:jellyfin/jellyfin" --jq '.items[].path'
     ```

     GitHub code search needs authentication, is rate-limited (about 10 a minute) and can return several hits: pick by path (`Jellyfin.Api/Controllers/…`, `MediaBrowser.Model/…`), and pin `?ref=master`, the build the diff used. A rename across scopes (a parameter moved to a different endpoint) never shows in `renameCandidates`, and that is when this upstream read pays off.

   A verdict whose `draftIssueBody` still says "confirm whether renamed or dropped" is unfinished: `renameCandidates` and at most one `gh api` read settle it.
9. **A site whose method the manifest could not resolve.** `api-usage-manifest.json` records some call sites with method `UNKNOWN`, and the join lets `UNKNOWN` match every verb, so one site can raise a finding per verb (a `HEAD` row beside the `GET`). Read the site for the verb it really sends, and `skip` the rows for verbs it never sends.

For each entry, fill in place (never change `findingKey`):

- `real` (bool), `severity` (`high`, `medium` or `low`), and `recommendedAction`:
  - **`file`:** a real problem, or an opportunity worth having, that deserves an issue. Needs `severity` and a `draftIssueBody` in GitHub markdown: what changed, why it affects us, the cited sites, the suggested fix. The filer wraps it in a provenance header and footer, so write only the substance.
  - **`skip`:** investigated and not a real problem (a false positive, no runtime effect, a covering fallback, a regeneration artifact). No body, but a one-paragraph `rationale` is required: it records why we looked and passed.
  - **`monitor`:** real but deferred (an opportunity for later, a floor-coverage advisory not worth filing yet). `rationale` required; it is offered for a `/log signal` in Step 6.
- Add any `labels` beyond the prefilled base set (`regression`, for example).

Write the filled verdicts to the new `$VERDICTS` path with the Write tool, not back over `$SCAFFOLD`: the Write tool refuses to overwrite a file you haven't read with the Read tool, and a fresh path avoids that. Copy every entry from the template into `$VERDICTS`, filled in. Every entry needs a `recommendedAction`: the filer reports one left blank as `missing-verdict` instead of dropping it.

## Step 3: Plan (no GitHub writes)

> **Stable path only.** If you came through the pre-release path (Step 0a), stop here: Steps 3 to 5 file GitHub issues, which a pre-release run never does. You have already written the handoff (Step 0a.4) and closed the loop (Step 0a.5).

```bash
PLAN=$(mktemp --suffix=.json /tmp/server-upgrade-plan.XXXXXX)
node scripts/server-upgrade.js plan --report <report-path> --verdicts "$VERDICTS" --plan-out "$PLAN"
```

The filer joins your verdicts back to the report by `findingKey`, searches GitHub (read-only) for an existing `[server-upgrade]` issue carrying each finding's version-independent identity, and sorts each finding into an action: `create` (no issue yet), `comment` (the same finding in a new release, on an open issue), `reopen` (a regression on a closed issue), or the non-writing `skip`, `monitor`, `missing-verdict` and `invalid-verdict`. The `create`, `comment` and `reopen` actions become sub-issues of the release's digest; `skip` and `monitor` become checked-off notes on the digest.

## Step 4: Show the plan and confirm

Read `$PLAN` and show it as:

1. **Header:** the digest issue being triaged; `<from>` to `<to>` (floor `<floor>`); how many candidates were investigated; and the `floorKnown`, suppressed and frozen-skip counts from `reportCounts`, which were left uninvestigated on purpose.
2. **Sub-issue table**, one row per write action:

   | # | Action | Existing | Severity | Finding | Labels |
   |---|---|---|---|---|---|
   | 1 | create | (none) | high | endpoint removed: GET /Items/{itemId} | server-upgrade, bug |
   | 2 | comment | #812 (OPEN) | medium | field retyped: BaseItemDto.runTimeTicks | server-upgrade, bug |
   | 3 | reopen | #790 (CLOSED) | high | floor coverage gap: GET /UserViews | server-upgrade, bug |

3. **Investigated, not filing** (notes on the digest): the `skip` rows with their rationale, then the `monitor` rows.
4. **Needs attention:** any `missing-verdict` (a candidate you didn't investigate: go back to Step 2) or `invalid-verdict` (a malformed verdict; its `problems` say why). Resolve these before executing, or those findings won't be filed.

Then ask in chat: `execute` runs the plan as shown, `revise` goes back to Step 2 and plans again, `abort` stops with nothing filed. Recommend one with its reason, and wait for the reply. **This reply is the trust ratchet's gate:** one approval per release, not per finding, and nothing files without it. A finding class that has graduated (its `type` is in `AUTO_FILE_CLASSES`, so its actions carry `autoFileEligible: true`) has its `create` actions approved within this batch without a separate yes. `AUTO_FILE_CLASSES` is empty today, so every class is still gated. Graduation only relaxes this approval inside a session; CI never files issues. The design doc's [trust ratchet](../../../docs/architecture/server-upgrade-automation.md#the-trust-ratchet) has the policy.

## Step 5: Execute

```bash
node scripts/server-upgrade.js execute --plan "$PLAN" --digest <digest-number> --close-digest
```

For each write action it creates, comments on or reopens the issue with its labels, then links it as a sub-issue of the digest (`gh api .../sub_issues`). It carries on past a single failure and records it in the summary. It then rewrites the digest body with the verdict checklist and adds `server-upgrade:triaging`, so CI stops rewriting the body. With `--close-digest` it closes the digest only when every candidate has a verdict (no `missing-verdict` or `invalid-verdict` left); CI never closes a digest with candidates in it. Leave out `--close-digest` to keep the digest open for discussion, and leave out `--digest` only when no digest exists (the issues then file on their own). Last, it writes a run summary to `.claude/handoffs/server-upgrade-<timestamp>.md`.

## Step 6: Report the summary and capture what was deferred

Read the run summary and recap it briefly, for example:

> Triaged the Jellyfin 10.11.10 digest (#840): filed 2 sub-issues (#842, #843), commented on 1 recurrence (#812), reopened 1 regression (#790). Skipped 4 after investigation (covering fallbacks, cosmetic changes). 1 to monitor. Digest closed (fully triaged). Summary: `.claude/handoffs/server-upgrade-<ts>.md`. **Next:** deep-dive any sub-issue with `/issue-triage <N>`.

Then close the loops the capture-discipline rule expects:

- For each `monitor` finding worth tracking upstream, offer to run `/log signal <slug>`. Don't write the journal directly.
- If Step 2 case 3 found a recurring cosmetic artifact, remind the user it can go in `.api-watch/suppressions.yml` so the next run drops it.
- This run acknowledged `<to>`: offer to move the `jellyfin-server-stable` row's `latest_acknowledged` with `/log signal`, or `/done` if the watch is over.

Delete the temporary files: `rm -f "$SCAFFOLD" "$VERDICTS" "$PLAN"`.

## When not to use

- A new Jellyfin release candidate or master build: this skill does handle it, through the pre-release path (Step 0a), which triages locally, writes a handoff and files no issues. The `jellyfin-server-rc` signal also tracks it. Don't use the stable Steps 3 to 5 for a pre-release.
- You want to investigate one `[server-upgrade]` issue that is already filed: use `/issue-triage <N>`.
- The report has no candidates to investigate: there is nothing to do, and that is the system working.
- You need to rebuild the manifest, the fingerprints or the report itself: those are the generators (`docs:api-manifest`, `docs:spec-fingerprints`, `api-watch:findings`), not this skill.

## Sub-agent invocation

A parent starts this skill from a sub-agent by passing this in the Task prompt, with the report path in place of `<report-path>`: `Read .claude/skills/server-upgrade/SKILL.md and follow Steps 0-5 with the report at <report-path> as the arguments; investigate each candidate against its cited sites, write verdicts, plan and execute; surface the summary path`.
