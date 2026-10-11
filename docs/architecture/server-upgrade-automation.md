---
topic: server-upgrade-automation
related-files:
  - scripts/generate/api-usage-manifest.js
  - scripts/generate/spec-fingerprint.js
  - scripts/generate/spec-diff.js
  - scripts/generate/findings-candidates.js
  - scripts/server-upgrade.js
  - scripts/server-upgrade-tracker.js
  - .github/workflows/server-upgrade-tracker.yml
  - .github/workflows/_lint-floor-system.yml
  - .claude/skills/server-upgrade/SKILL.md
  - .api-watch/suppressions.yml
  - docs/dev/jellyfin-endpoint-availability.yml
  - scripts/lib/endpoint-availability.cjs
  - scripts/lint/endpoint-availability-check.cjs
  - scripts/lint/floor-coverage-check.js
  - scripts/lint/apiversion-consistency-check.js
  - scripts/lib/spec-fetch.cjs
  - scripts/lib/signals-fetch.cjs
  - scripts/lib/signal-staleness.cjs
  - scripts/lib/version-boundaries.cjs
  - .claude/skills/new-api-version/SKILL.md
  - docs/architecture/api-usage-manifest.json
  - docs/architecture/api-usage-manifest.md
  - docs/architecture/spec-fingerprints/
  - docs/dev/jellyfin-version-boundaries.yml
  - docs/signals-backlog.md
  - docs/dev/jellyfin-server-versioning.md
  - source/api/ApiClient.bs
last-reviewed: 2026-10-10
---

# Jellyfin server-upgrade automation

When Jellyfin ships a new server version, this pipeline finds every API change that touches code JellyRock ships, and stays quiet about the rest. Scripts find the changes. An agent, run by a maintainer through `/server-upgrade`, decides which ones matter. CI opens one GitHub issue per release to say a triage is due.

## Why this exists

JellyRock's Jellyfin client is hand-written, with no code generated from the OpenAPI spec (see [`api.md`](api.md)). Before this pipeline, knowing that a release had shipped was automatic (the `jellyfin-server-stable` row in [`signals-backlog.md`](../signals-backlog.md)), but judging its impact was manual: download the spec, read the diff, guess whether anything we use changed. That is slow, it fails both ways (a missed break, or an afternoon lost on a hotfix that touches nothing we use), and it repeats every release.

## How it works: a script finds, an agent judges

The pipeline splits at one line. Scripts do the mechanical work and never decide whether a change is a real problem: they list every change that intersects code we ship, with where it came from. The agent reads the code each change touches and decides whether it breaks and what to do. A last script does the GitHub writes.

This split is what makes it trustworthy. The scripts are deterministic and fixture-tested, and the agent's reasoning is reviewable one finding at a time.

| Stage | What happens | Done by | Output |
| --- | --- | --- | --- |
| 0. Demand | Lists the endpoints and fields the app uses, each with its `apiVersion` tier range ([`api-usage-manifest.md`](api-usage-manifest.md)) | [`api-usage-manifest.js`](../../scripts/generate/api-usage-manifest.js) | `api-usage-manifest.json` (committed) |
| 1. Supply | Fetches a version's spec and reduces it to a fingerprint | [`spec-fetch.cjs`](../../scripts/lib/spec-fetch.cjs), [`spec-fingerprint.js`](../../scripts/generate/spec-fingerprint.js) | Raw specs (gitignored cache), fingerprints (committed) |
| 2. Diff | Compares two fingerprints structurally | [`spec-diff.js`](../../scripts/generate/spec-diff.js) | A list of changes |
| 3. Join and classify | Matches the changes against the manifest and runs [the three checks](#the-three-checks) | [`findings-candidates.js`](../../scripts/generate/findings-candidates.js) (`npm run api-watch:findings`) | `findings-candidates-<from>..<to>.json` (gitignored cache): [the data report](#the-data-report) |
| 4. Investigate | Reads the code each candidate cites and writes a verdict | The [`/server-upgrade`](../../.claude/skills/server-upgrade/SKILL.md) skill | Filled verdicts |
| 5. File | Creates, comments on or reopens issues, deduplicated | [`server-upgrade.js`](../../scripts/server-upgrade.js) (`npm run api-watch:file`) | Sub-issues of [the release digest](#the-release-digest) |

The join is offline by default: it reads the committed fingerprints of the `from`, `to` and floor versions ([ADR 0007](../adr/0007-server-upgrade-anchor-strategy.md)). Two options reach the network. `--fetch` builds a missing fingerprint in memory from the fetched spec, to preview a release before committing its fingerprint. The `unstable` (or `master`) token in place of a version resolves the newest master build. `--manifest <path>` reads a different manifest, for a what-if run.

```bash
node scripts/generate/findings-candidates.js <from> <to> [--floor <v>] [--root <dir>] [--manifest <path>] [--fetch] [--no-opportunities] [--stdout]
```

## Version tiers and the floor

JellyRock picks endpoints by server API tier with `if m.getApiVersion() >= N`. [`jellyfin-version-boundaries.yml`](../dev/jellyfin-version-boundaries.yml) maps each tier to server versions, and [`version-boundaries.cjs`](../../scripts/lib/version-boundaries.cjs) reads it:

| Tier | Servers | Status |
| --- | --- | --- |
| 1 | 10.7.0 to 10.8.13 | Frozen |
| 2 | 10.9.0 and later | Active |

Two facts shape the design:

- **Old server lines are frozen.** 10.8.13 is the last 10.8 release, so no upstream change can break an endpoint used only on tier 1.
- **The floor never rises.** JellyRock supports 10.7.0 for good, so tier 1 calls are intended, and a new feature may add one. Old-endpoint usage is not debt here.

Each manifest endpoint records the tiers it serves as `minApiVersion` and `maxApiVersion`, inferred from the code's dispatch branches. A change in a release counts only for endpoints whose range includes that release's tier. Because every new release lands in the active tier, a frozen tier never appears in a diff, and no allowlist is needed.

`serverToTier()` resolves a release candidate to its base release's tier and a master datestamp to the active tier. Every check on a version string goes through one predicate, `isReleaseVersionBase()` in [`signals-fetch.cjs`](../../scripts/lib/signals-fetch.cjs), which accepts two segments (`12.0`) and three (`10.11.8`). A private three-segment regex once made `serverToTier('12.0')` return `null`, and every breaking change on a `[1, ∞)` endpoint was hidden as `frozen-skip` (fixed in #924). A Jellyfin major-version jump needs no special case beyond that: the active tier has no upper bound.

Adding a tier is the [`/new-api-version`](../../.claude/skills/new-api-version/SKILL.md) skill's job. It keeps the boundary map and its BrightScript twin `resolveApiVersion()` (in `source/utils/misc.bs`) in step, and `npm run lint:apiversion-consistency` fails when they disagree. That lint parses the `.bs` with the BrighterScript AST, so no Roku is needed.

## The three checks

| Check | Question | Compares | Catches |
| --- | --- | --- | --- |
| Forward | Did something we use change in this release? | The diff from the last reviewed version to the new one | A break on current servers |
| Backward (`coverage-gap`) | Do we call something the floor server lacks? | The manifest against the 10.7.0 fingerprint | A new feature that fails on the oldest servers because it has no guard or dispatch branch |
| Symmetry (`symmetry-advisory`) | Do we gate an operation to newer tiers that the floor also serves? | The manifest against the 10.7.0 fingerprint | An operation wired for one tier only, which may be missing its old-server fallback |

The backward and symmetry checks split the manifest on one test (`rangeIncludes()` for the floor tier). Backward takes the endpoints whose range includes the floor and flags those absent from the floor spec. Symmetry takes the newer-tier endpoints and flags those present in it. So they never report the same endpoint, and an endpoint that is newer-tier and absent from the floor (a real 10.9+ feature) is flagged by neither.

Both over-report in known ways, which the agent resolves by reading code. A capability guard such as `supportsMediaSegments()` is not a version branch, so the manifest tags its endpoint `[1, ∞)` and the backward check flags it. A tier 2 endpoint whose tier 1 twin is a different path (`GET /items` against `/Users/{}/Items`) trips the symmetry check. The recurring cases of both are recorded in [the endpoint-availability ledger](#the-endpoint-availability-ledger) so they stop reappearing.

How the forward check matches:

- Endpoints match on normalized path plus method, because one path can appear with different methods and tier ranges (`/items/{}` has a tier 1 `DELETE` and a tier 2 `GET`). A method the manifest records as `UNKNOWN` matches on path alone. Normalization is `normalizeSpecPath()` in `scripts/lib/spec-path.cjs`, shared with the filer.
- Fields match by name without regard to case: the app sends PascalCase and the spec defines camelCase.
- An enum change has no field name, so the schema name of the enum is matched against the field names we read. That catches `MediaType`-style enums and misses `BaseItemKind`-style ones; the agent covers the gap.
- Breaking kinds are `endpoint-removed`, `param-removed`, `param-changed`, `requestbody-changed`, `response-changed`, `field-removed`, `field-retyped` and `enum-changed`. An `endpoint-added` the app does not use is an `opportunity` (off with `--no-opportunities`). Purely additive kinds (`param-added`, `field-added`) and changes to things we don't use are dropped and counted in the run summary.

[`.api-watch/suppressions.yml`](../../.api-watch/suppressions.yml) holds accepted-churn rules. Every predicate in a rule must match, and the first matching rule wins. A suppressed candidate stays in the report with `suppressed: true` and `suppressedBy`, and `needsInvestigation: false`, so nothing disappears without a trace.

## The data report

`findings-candidates.json` is the contract between the scripts and the agent. Each candidate carries enough to act on without re-deriving anything:

| Field | Values and meaning |
| --- | --- |
| `type` | `breaking`, `opportunity`, `coverage-gap` or `symmetry-advisory` |
| `change.kind` | One of the diff kinds above, or `coverage-gap` or `coverage-symmetry` for the floor checks |
| `change` locator | `path` and `method` for an endpoint change; `schema` and `name` for a field; `name` and `in` for a parameter |
| `change.detail` | A readable summary; a field retype reads `<Schema>.<field>: <old type> → <new type>` |
| `change.renameCandidates` | On `param-removed` and `field-removed` only, always an array: additions in the same scope that could be the rename, same-signature ones first. An empty array suggests a real removal; the agent decides. |
| `appUsage` | `used`, `apiVersionRange` and `sites`, the source files that use it |
| `relevance` | `active-tier`, `frozen-skip`, `floor-coverage`, `floor-symmetry`, or `floor-known` for a finding the ledger resolves (with `floorHandling`) |
| `severityGuess` | The script's first guess; the agent overrides it |
| `needsInvestigation` | Whether the agent must look at it |
| `suppressed`, `suppressedBy` | Set by a suppression rule |

## What the agent judges

The agent reads each candidate's `appUsage.sites` and resolves the cases a script cannot:

1. **A contract break is not always a runtime break.** A retype or a nullable change is usually harmless given the `?? default` pattern and dynamic typing, but sometimes it breaks silently.
2. **A fallback may cover it.** An endpoint "removed" can be covered by a dispatch branch or a capability guard for the affected servers.
3. **Spec regeneration artifacts.** Reordering and schema refactors that change nothing.
4. **Enum changes** on an enum the app switches on (`BaseItemKind`, stream `Type`).
5. **Graceful degradation or a real break** when a field disappears.
6. **Whether an opportunity is worth it:** a new endpoint that fills a real feature gap, or not.
7. **Symmetry advisories:** whether a one-tier operation is missing its fallback, or is a newer-server feature on purpose.
8. **A removal can expose an older behavior change.** Before calling a removal cleanup, the skill reads the server's controller at the `from` version: a parameter can stop working releases before it leaves the spec (see [Known limitations](#known-limitations-what-this-pipeline-cannot-catch)).

## Filing: scaffold, plan, execute

[`server-upgrade.js`](../../scripts/server-upgrade.js) bridges the agent and GitHub in three commands, so the agent never touches GitHub and the script never judges:

```bash
node scripts/server-upgrade.js scaffold --report <findings-candidates.json> [--out <verdict-template.json>]
node scripts/server-upgrade.js plan --report <findings-candidates.json> --verdicts <filled.json> [--plan-out <plan.json>] [--no-dedup]
node scripts/server-upgrade.js execute --plan <plan.json> [--digest <issue#>] [--close-digest] [--handoff-dir <dir>]
```

| Command | What it does | Writes to GitHub |
| --- | --- | --- |
| `scaffold` | Lists every candidate with `needsInvestigation` in a verdict template, each keyed by a `findingKey` the script derives. The agent fills `real`, `severity`, `recommendedAction` (`file`, `skip` or `monitor`), `labels`, `rationale` and `draftIssueBody`. | No |
| `plan` | Joins the verdicts back by `findingKey`, searches GitHub for existing issues (read-only) and sorts each finding into `create`, `comment`, `reopen`, `skip`, `monitor`, `missing-verdict` or `invalid-verdict` | No |
| `execute` | Creates, comments on or reopens the issues, links each as a sub-issue of the digest, rewrites the digest with the verdict checklist and adds `server-upgrade:triaging`. With `--close-digest` it closes the digest, but only when no `missing-verdict` or `invalid-verdict` is left. It writes a run summary to `.claude/handoffs/`. | Yes |

Why it is shaped this way ([ADR 0008](../adr/0008-server-upgrade-issue-filing.md)):

- **The dedup key never includes the version.** `findingKey` is the kind plus the locator (normalized path and method, `Schema.field`, or the enum schema). A concern that comes back in a later release comments on or reopens its issue. Every `coverage-gap` and symmetry advisory is recomputed on every run, so a version-scoped key would refile the same issue each release. The issue title reads `[server-upgrade] <kind label>: <locator>`, and dedup confirms a match on that part.
- **The script owns the verdict template**, so the agent cannot invent a key that doesn't match, and a candidate left without a verdict shows up as `missing-verdict` in place of vanishing.
- **Labels by type:** `breaking` and `coverage-gap` get `server-upgrade` and `bug`; `opportunity` and `symmetry-advisory` get `server-upgrade` and `enhancement`. The agent can add more. The skill's first step creates the three `server-upgrade` labels if they are missing.

### The trust ratchet

Every finding class is human-gated: running `execute` is the batch approval, once per release. `AUTO_FILE_CLASSES` in `server-upgrade.js` is empty, and every action carries `autoFileEligible: false`. A false-positive issue costs a small project's tracker trust, so a class graduates only on a measured track record ([ADR 0010](../adr/0010-server-upgrade-phase5-maturation.md)).

Graduating a class lets its `create` actions skip the confirmation inside a human-run `execute`. It never adds auto-filing to CI: a candidate filed without the agent's reading would be exactly the false positive the reading exists to catch.

The suggested bar is at least 8 issues filed in the class across at least 3 releases, with a false-positive rate under 10%. As of 2026-10-10 two finding issues have been filed (#925, #926), both closed as completed, so no class is near the bar. For the rate to mean anything, close a false alarm as **Close as not planned**, never as completed. This query measures it:

```bash
gh issue list --label server-upgrade --state all --limit 200 \
  --json number,title,stateReason \
  | jq '
    map(select(.title | startswith("[server-upgrade]")) | select(.title | test("release triage") | not)) as $all
    | ($all | length) as $total
    | ($all | map(select((.stateReason // "") | ascii_downcase == "not_planned")) | length) as $fp
    | { total: $total, falsePositives: $fp,
        fpRate: (if $total == 0 then null else ($fp / $total) end) }'
```

To split it by class, group on the kind label that follows `[server-upgrade]` in the title (`endpoint removed:`, `floor coverage gap:`, `coverage symmetry:`, `new endpoint:` and the rest of `KIND_LABEL`). Graduating a class is one line, `export const AUTO_FILE_CLASSES = new Set(['<class>']);`, plus a `/log decision` with the measured rate. `opportunity` is the safest first candidate, since a wrong enhancement does little harm. `coverage-gap` is the worst, because capability guards make it over-report.

## The release digest

The [tracker workflow](../../.github/workflows/server-upgrade-tracker.yml) runs daily at noon UTC, or by hand with a `version` input. It runs [`server-upgrade-tracker.js`](../../scripts/server-upgrade-tracker.js) and keeps one digest issue per server version, titled `[server-upgrade] Jellyfin <version> — release triage` and labeled `server-upgrade:tracker`. Daily, because Jellyfin can ship more than one hotfix in a week, and a caught-up run stops after a version compare.

The script compares the latest stable release (`fetchJellyfinVersions().stable`, which excludes release candidates) with `latest_acknowledged` in the `jellyfin-server-stable` signal row. When a newer stable exists, it builds that version's fingerprint in memory and runs the same report the join does, reading the same committed fingerprints, manifest, suppression rules and ledger, so CI's counts match a local run. It writes nothing to the repo.

| Action | When | What the workflow does |
| --- | --- | --- |
| `none` | No stable release newer than `latest_acknowledged` | Nothing |
| `clean` | Newer release, and no candidate needs investigation | Opens the digest, comments that it is clean, and closes it, as a record. This is the only digest CI closes. |
| `triage` | Newer release with at least one candidate to investigate, or the report could not be built | Opens the digest, or refreshes its body while it is open and not yet triaged |

A `clean` release can still carry `floor-known`, `frozen-skip` or suppressed candidates: only `needsInvestigation` counts. When the spec fetch fails or a committed fingerprint is missing, the digest says so and announces the release without counts, because it cannot claim the release is clean.

The workflow finds this version's digest by its exact title among all `server-upgrade:tracker` issues, open or closed, since `gh --search` would mangle the brackets and dash in the title. Once `/server-upgrade` adds `server-upgrade:triaging`, CI leaves the digest alone. A candidate-bearing digest is closed only by a person or by `execute --close-digest`. If someone closes it before triage, CI leaves it closed. Clean digests outlive the 90-day retention of GitHub Actions logs, so each release keeps a record of what the mechanical pass found ([ADR 0011](../adr/0011-server-upgrade-phase6.md)).

The workflow authenticates as the JellyRock GitHub App, so the installation's permissions apply. The workflow's `permissions:` block (`contents: read`, `issues: write`) records the intent. The workflow never writes the journals; `/catchup` updates `latest_upstream` and `last_checked`.

### The diff anchor trails clean releases

`latest_acknowledged` is the diff anchor: the last version a maintainer triaged with `/server-upgrade`, which commits that version's fingerprint and moves the signal row. A clean release closes its digest without moving it, so the anchor can sit several releases behind. That costs nothing, because the diff is point to point. Two things keep the gap from reading as neglect ([ADR 0015](../adr/0015-server-upgrade-anchor-vs-resolved-decoupling.md)):

- The tracker passes the digest list to the renderer (`--tracker-issues`). `clearedThroughFrom()` finds the newest closed digest below this release, and the body shows a "Mechanically cleared through `<X>`" line under the "Diff baseline (last full review)" row.
- `/catchup` calls the `jellyfin-server-stable` row stale only while an open digest exists (`signalStaleness()` in [`signal-staleness.cjs`](../../scripts/lib/signal-staleness.cjs)), so clean releases never nag. Offline, it falls back to comparing the version strings.

## The endpoint-availability ledger

The two-tier model cannot say "10.10 and later", so the floor checks would flag the same handled endpoints on every run. [`jellyfin-endpoint-availability.yml`](../dev/jellyfin-endpoint-availability.yml) records, for each endpoint newer than the floor, how the app handles old servers. `applyFloorAvailability()` marks a listed finding `floor-known` with `needsInvestigation: false`: it stays in the report for the record and leaves the to-do list. An endpoint that is not listed keeps flagging, so the spec-derived floor check, not the ledger, decides what is found.

| Endpoint | `minServer` | `handling` |
| --- | --- | --- |
| `GET /mediasegments/{}` | 10.10.0 | `version-guard` (`supportsMediaSegments`) |
| `GET /audio/{}/lyrics` | 10.9.0 | `version-guard` (`supportsLyrics`) |
| `GET /items/{}/collections` | 12.0.0 | `version-guard` (`supportsItemCollections`) |
| `GET /quickconnect/enabled` | 10.8.0 | `graceful-degradation`: a 404 on 10.7 leaves the Quick Connect button visible, on purpose |
| `GET,POST /quickconnect/initiate` | 10.8.0 | `sdk-dispatch`: `ApiClient.BuildInitiateQuickConnectRequest()` picks the method by tier |
| `GET /items` | 10.9.0 | `dispatch-sibling`: tier 1 uses `/Users/{}/Items` |

The file itself is authoritative; this table is a summary of it on 2026-10-10. `minServer` is context, not something the lint checks.

`npm run lint:endpoint-availability` ([`endpoint-availability-check.cjs`](../../scripts/lint/endpoint-availability-check.cjs)) checks each entry's claim about the code: a `version-guard` symbol must exist in `source/` code (comments do not count), a `dispatch-sibling` must be a floor-tier manifest endpoint, and every entry's endpoint must still be in the manifest. If someone removes a guard, the lint fails, and the floor finding comes back. That is why the ledger is not a suppression rule: a mute would hide the regression. The manifest stays purely inferred from the code; the ledger is a separate input to the floor check.

### Parameters whose meaning changed

A spec diff sees a parameter only when it is added or removed, not when a server stops acting on it. 10.11 ignored Next Up's `DisableFirstEpisode` for a whole release while the spec still listed it, and the pipeline noticed only when 12.0 deleted it (#925). The ledger's `parameters:` section records such a parameter, the servers that honor it and its `version-guard` symbol.

The lint holds a parameter to a stronger rule than an endpoint. Every `.bs` file under `source/` or `components/` whose code names the parameter must also call the guard, and an entry nothing sends any more fails as stale. Request parameters are built outside the API layer, where the manifest does not look. The floor check does not read this section. `npm run jellyfin:matrix` checks the live half against real servers, and [`jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md#parameters-whose-meaning-changed) has the rule for adding one.

A name-based lint works only while the name is specific to the behavior. 12.0 started honoring `parentId` for `IncludeItemTypes=BoxSet` queries, and listing either name would fail nearly every file in the app, which sends both for unrelated reasons. A gate on a combination like that is listed in the guide's [endpoint table](../dev/jellyfin-server-versioning.md#endpoints-newer-than-107) with its guard, and kept out of the ledger.

### The floor check on every PR

`npm run lint:floor-coverage` ([`floor-coverage-check.js`](../../scripts/lint/floor-coverage-check.js)) runs the backward and symmetry checks against our own commits, without waiting for a Jellyfin release. It reuses `backwardFindings()`, `symmetryFindings()`, `applySuppressions()` and `applyFloorAvailability()`, so what it reports is exactly the floor part of a digest. An unlisted `coverage-gap` fails the PR (exit 1), a symmetry advisory only warns, and a missing floor fingerprint exits 2.

CI runs it, with `lint:endpoint-availability`, `lint:apiversion-consistency` and the manifest drift check, in [`_lint-floor-system.yml`](../../.github/workflows/_lint-floor-system.yml), when a PR touches code or the pipeline's inputs.

## Artifacts and caching

| Artifact | Where | Why |
| --- | --- | --- |
| `api-usage-manifest.json` | Committed | A reviewer sees each change as a diff; `docs:api-manifest:check` fails on drift |
| Version-boundary map | Committed | The source of truth for tiers; changes only when a tier is added |
| Raw specs (about a megabyte each) | `.api-watch/cache/`, ignored by git | Jellyfin's archive keeps every version, so a refetch is always possible |
| Spec fingerprints | Committed under [`spec-fingerprints/`](spec-fingerprints/): the 10.7.0 floor, 10.11.8 and 12.0 | The diff anchors, reproducible offline |
| Diff and data report | The same cache | Rebuilt on every run |
| What was reviewed and filed | GitHub issues and `signals-backlog.md` | The ledger that already exists |

A fingerprint keeps a spec's structure and drops the rest: for each operation, its parameters (name, location, type, required, with `$ref`s resolved), the type signatures of its request body and of its success response; for each component schema, its property names, types and enum values. Descriptions, summaries and examples are stripped, which removes Jellyfin's cosmetic churn between releases. `npm run docs:spec-fingerprints:check` rebuilds each committed fingerprint from its spec (fetching it if it isn't cached) and fails on drift.

A committed fingerprint means a person reviewed that version. Only a `/server-upgrade` triage of a stable release commits one (`spec-fingerprint.js <version>`); CI and pre-release runs build theirs in memory.

Jellyfin's archive serves every version back to 10.7.0 at a permanent URL, so there is no mirror repo: the cache and the committed fingerprints are enough.

## Pre-release channels (RC + unstable/master)

The pipeline does not care what a version string means, so a maintainer can run it against a release candidate or a master build before the release ships, and diff again as it changes. This is manual (`/server-upgrade <rc-or-unstable>`); the daily tracker stays on stable releases.

| Channel | Archive folder | File name | Changes? |
| --- | --- | --- | --- |
| Stable and RC | `/openapi/stable/` | `jellyfin-openapi-<version>.json`, with `-rcN` for a candidate (`10.11.8`, `12.0`, `12.0-rc4`) | Never, per build |
| Unstable (master) | `/openapi/unstable/` | `jellyfin-openapi-<datestamp>.json` | Never, per build |
| Rolling pointer | `/openapi/` | `jellyfin-openapi-unstable.json` | Yes: never used as a baseline |

- **Nothing is committed.** Pre-release fingerprints are built in memory (`findings-candidates.js --fetch`), which keeps a committed fingerprint meaning "a reviewed stable release".
- **Builds are pinned, never the pointer.** The `unstable` or `master` token resolves through `fetchLatestUnstable()` to the newest datestamped build and records that datestamp, so a run can be repeated and diffed again.
- **No GitHub issues.** A pre-release run writes a handoff note in `.claude/handoffs/` with its verdicts and a "fix proactively" list. The RC baseline for the next diff is `latest_acknowledged` in the `jellyfin-server-rc` signal row; a master datestamp lives in the handoff note, since master moves too fast for a signal row.
- **Run it again on the final release.** A release candidate can still change, and the stable run is the one that files issues.

If a pre-release shows a break that needs a new tier, see [Version tiers and the floor](#version-tiers-and-the-floor).

## Known limitations: what this pipeline cannot catch

The pipeline compares signatures: which endpoints exist, which parameters and fields they declare, and their types. Two kinds of break fall outside that, by its nature. A clean report means no signature changed, nothing more.

**1. A behavior change behind an unchanged signature.** A release can keep an endpoint's parameters identical and change what it returns. The diff shows nothing and CI calls the release clean.

The worked example is [#784](https://github.com/jellyrock/jellyrock/issues/784). `GET /UserItems/Resume` declares the same 15 parameters in 10.11.8 and 12.0. In 12.0 the server's `IsResumable` test widened from "this item has a playback position" to "or this folder has an in-progress item inside it". Continue Watching went from 4 items to 253, and the series **Resume** button started pointing at a season in place of an episode. (The floor does differ: 10.7.0 serves the endpoint at `/Users/{userId}/Items/Resume` with 14 parameters, and the pipeline does see that. The 12.0 change is the one it can't.)

Two more cases from the 10.11.8 to 12.0 triage:

- **A changed default policy.** 12.0 sets `EnableLegacyAuthorization=false` on upgrade (jellyfin/jellyfin#15559), so `?api_key=`, `X-Emby-Token` and the `Emby` scheme stop authenticating. The spec's `components.securitySchemes` is identical in 10.11.8 and 12.0: the change is server configuration, not a declared contract. It broke our remote-control socket's header-less fallback, fixed in [#920](https://github.com/jellyrock/jellyrock/pull/920).
- **A parameter that stops working long before it disappears.** 10.11.0 marked Next Up's `disableFirstEpisode` obsolete and stopped reading it, but kept it in the spec. The break surfaced only when 12.0 deleted it ([#925](https://github.com/jellyrock/jellyrock/issues/925)): every 10.11 and later server had shown a **Resume** button on series nobody had started. This is why the skill reads the `from` version's controller before calling a removal cleanup, and why the ledger has a [parameters section](#parameters-whose-meaning-changed).

**2. How we call an endpoint, as opposed to which ones we call.** The manifest's `requestFields` list is flat and repo-wide (`{name, sourceFiles}`, no endpoint), and it scans only `source/api/**/*.bs` (`REQUEST_FIELD_GLOBS`). So nothing can compare the parameters we send with the parameters an endpoint declares. All four of #784's call sites live under `components/`. Two consequences:

- **Parameters we send that don't exist.** Each of #784's call sites sent `recursive`, `SortBy`, `SortOrder` and `Filters` to an endpoint that has never accepted them (the server sets all four itself, the same from 10.7.0 through master). Harmless, but for years they sent readers looking in the wrong place.
- **Narrowing parameters we leave out.** That endpoint's `mediaTypes` is the only filter a client controls. The web client asks for videos only; we sent nothing, which is what exposed us when the server's default widened.

Closing this needs request fields bound to their endpoint and a scan wider than `source/api/`. It is recorded as tech-debt [`api-usage-manifest-no-per-endpoint-binding`](tech-debt.md#api-usage-manifest-no-per-endpoint-binding), not built, because #784 is one case so far.

**What catches these:** running the app against a pre-release server. #784 was found by pointing a client at a real 12.0 release candidate, not by reading its spec. Keep a pre-release server in the loop for what the report cannot see.

## Decisions

Each decision's alternatives and reasons are in its ADR.

| Decision | Why | Record |
| --- | --- | --- |
| The join diffs committed fingerprints, not a live fetch | Reproducible and offline; committing the newest fingerprint is part of acknowledging a release anyway | [ADR 0007](../adr/0007-server-upgrade-anchor-strategy.md) |
| Committed fingerprints, not raw specs | Anchors a reviewer can diff, without committing a megabyte of vendor JSON per version | This doc |
| No spec-mirror repo | Jellyfin's archive is already a permanent, complete mirror; a second repo adds CI and token plumbing for no gain | This doc |
| `apiVersion` tiers inferred from the code, not listed by hand | Old-server support is permanent and new tier 1 calls are legitimate, so a hand-kept legacy list would drift | This doc |
| The manifest is built with the BrighterScript parser, not grep | Formatting does not change the result | [`api-usage-manifest.md`](api-usage-manifest.md) |
| Version-independent dedup, a script-owned verdict template, every class human-gated | No duplicate issues across releases, no silently dropped candidate, no false positives filed on faith | [ADR 0008](../adr/0008-server-upgrade-issue-filing.md) |
| Issues are filed for stable releases only | A release candidate still changes; the stable run files | This doc |
| Graduating a class relaxes the human gate, never adds CI filing | CI cannot read code, and reading code is what removes false positives | [ADR 0010](../adr/0010-server-upgrade-phase5-maturation.md) |
| One digest per release with sub-issues, and the ledger for floor findings | A record per release, opt-in issues for real work, and floor findings resolved at the source without hiding a regression | [ADR 0011](../adr/0011-server-upgrade-phase6.md), replacing parts of ADRs 0008 and 0009 |
| The diff anchor and the "cleared through" line are separate | CI never writes the journals or commits a fingerprint, so the anchor trails clean releases and progress is derived from the digests | [ADR 0015](../adr/0015-server-upgrade-anchor-vs-resolved-decoupling.md) |

## History

Phases 0 to 6 shipped together in #597; later additions have their own PRs.

| Phase | Added | Record |
| --- | --- | --- |
| 0 and 0.5 | The API-usage manifest and its `apiVersion` tiers | [`api-usage-manifest.md`](api-usage-manifest.md) |
| 1 | The boundary map, spec fetch and cache, fingerprints and the diff engine | This doc |
| 2 | The join: forward and backward checks, tier filtering, suppression rules | [ADR 0007](../adr/0007-server-upgrade-anchor-strategy.md) |
| 3 | The `/server-upgrade` skill and the filer | [ADR 0008](../adr/0008-server-upgrade-issue-filing.md) |
| 4 | The CI tracker, first as one rolling issue | [ADR 0009](../adr/0009-server-upgrade-proactive-ci.md) |
| 5 | The symmetry check, the graduation policy, `--fetch` and `--manifest` | [ADR 0010](../adr/0010-server-upgrade-phase5-maturation.md) |
| 6 | Per-release digests with sub-issues, and the endpoint-availability ledger | [ADR 0011](../adr/0011-server-upgrade-phase6.md) |
| Later | The PR-time floor lint (#607); pre-release channels and the tier consistency lint (#610); the anchor split; the ledger's `parameters:` section (#955); two-segment versions (#924) | [ADR 0015](../adr/0015-server-upgrade-anchor-vs-resolved-decoupling.md) for the anchor split |

The rolling tracker of Phase 4 never ran: its workflow reached `main` together with Phase 6, so every `server-upgrade:tracker` issue is a per-release digest.

## Related

- [`api-usage-manifest.md`](api-usage-manifest.md): the demand side, what the app calls.
- [`api.md`](api.md): the API client and task pool the manifest is read from.
- [`jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md): the version policy, the tiers and the guards.
- [`signals-backlog.md`](../signals-backlog.md): upstream version watching, and the acknowledged baselines this pipeline diffs from.
