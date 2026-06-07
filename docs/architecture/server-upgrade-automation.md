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
  - .claude/skills/server-upgrade/SKILL.md
  - .api-watch/suppressions.yml
  - docs/dev/jellyfin-endpoint-availability.yml
  - scripts/lib/endpoint-availability.cjs
  - scripts/lint/endpoint-availability-check.cjs
  - scripts/lint/floor-coverage-check.js
  - scripts/lint/apiversion-consistency-check.js
  - scripts/lib/spec-fetch.cjs
  - scripts/lib/signals-fetch.cjs
  - scripts/lib/version-boundaries.cjs
  - .claude/skills/new-api-version/SKILL.md
  - docs/architecture/api-usage-manifest.json
  - docs/architecture/api-usage-manifest.md
  - docs/architecture/spec-fingerprints/
  - docs/dev/jellyfin-version-boundaries.yml
  - docs/signals-backlog.md
  - docs/dev/jellyfin-server-versioning.md
  - source/api/ApiClient.bs
last-reviewed: 2026-06-07
---

# Jellyfin Server-Upgrade Automation

The design of record for turning Jellyfin server upgrades from reactive manual
catchup into a proactive, mostly-automated pipeline: when a new server version
ships, mechanically detect every API change that intersects code JellyRock
actually ships, have an agent investigate the real impact, and file/triage GitHub
issues — while staying silent about the churn that doesn't affect us.

> **Status (2026-05-30):** Phases 0 + 0.5 + 1 + 2 + 3 + 4 + 5 + 6 are built and
> verified (the API-usage manifest with `apiVersion` tiers; the supply+diff
> layer: version-boundary map, spec fetch/cache, fingerprint generator with
> committed floor/baseline anchors, and the structural diff engine; the
> join+classify layer: `findings-candidates.js` with the forward + backward +
> coverage-symmetry checks, tier-relevance filtering, `.api-watch` suppression,
> and the Phase-6 endpoint-availability ledger; the `/server-upgrade` skill +
> `scripts/server-upgrade.js` filer that investigate the report, edit the
> per-version digest, and file per-finding sub-issues, human-gated; and the
> proactive-CI tracker: `scripts/server-upgrade-tracker.js` +
> `.github/workflows/server-upgrade-tracker.yml` maintaining one PER-VERSION
> release-triage digest with the ephemeral-computed mechanical report). Phase 6
> replaced the per-finding issue burst + single rolling tracker with the
> per-version digest model (one auto-opened digest per release; CI opens-then-
> closes a clean release as a record; `/server-upgrade` edits the digest with
> verdicts + files sub-issues; never CI-closed once it bears a candidate) and
> added the endpoint-availability registry — a validated disposition ledger that
> resolves the recurring floor findings (`MediaSegments` 10.10, Lyrics 10.9,
> `QuickConnect` 10.8, …) at the source so they stop reappearing every release. See
> the [roadmap](#roadmap) and the Phase 5 + 6 build records below.

## Why this exists

JellyRock's Jellyfin client is **hand-written** — there is no codegen from the
Jellyfin OpenAPI spec (see [`api.md`](api.md)). Today, detecting that a new
server version dropped is automated (the `jellyfin-server-stable` row in
[`signals-backlog.md`](../signals-backlog.md), fetched by
[`scripts/lib/signals-fetch.cjs`](../../scripts/lib/signals-fetch.cjs)), but
**assessing impact is entirely manual**: download the spec, eyeball the diff,
guess whether anything we touch changed. That's slow, easy to get wrong in both
directions (miss a real break; waste time on an irrelevant hotfix), and it
repeats every release forever.

The goal is to save maintainer time and energy: never miss a breaking change,
never burn an afternoon on a security hotfix that touches nothing we use.

## Core principle: a deterministic *report*, then an investigative *agent*

The load-bearing architectural seam is the line between **mechanical** and
**judgment** work:

```text
┌─ SCRIPT (deterministic, tested, cacheable) ─────────────┐   ┌─ AGENT (judgment) ─┐   ┌─ SCRIPT ─┐
 manifest  →  spec fetch  →  diff  →  join+classify  ──────────►  investigate repo  ──►  gh issues
 (demand)     (supply)      (delta)   findings-candidates.json     per candidate         (plan/execute,
                                       = THE DATA REPORT           → verdict + draft       dedup, labels)
└─────────────────────────────────────────────────────────┘   └────────────────────┘   └──────────┘
```

- The **script** never decides "is this a real problem." It decides "here is
  every change that intersects code we ship, with full provenance." Fully
  unit-testable, deterministic, cacheable.
- The **agent** decides "given how we actually use it, does it break, and what
  should we do." Judgment-heavy, auditable per finding.
- A final **script** does the mechanical `gh` issue create/dedup/label.

This seam is what makes the system both trustworthy (the script is testable to
the byte; the agent's reasoning is reviewable per finding) and low-maintenance.

## The generalized version model (`V1` → `VN`)

JellyRock dispatches endpoints by server-API tier with `if m.getApiVersion() >= N`
(`V1` = server 10.7–10.8, `V2` = 10.9+; a future `V3` nests the same way). Two
facts shape everything:

1. **Old server lines are frozen.** 10.8.13 is the last 10.8 release that will
   ever exist. An endpoint that targets a frozen tier therefore *cannot* be
   broken by an upstream change — there will never be another upstream for it.
2. **JellyRock supports the oldest servers (10.7.0) indefinitely.** The floor
   never rises. So `V1` usage is permanent and intentional, and new features may
   legitimately *add* `V1` calls. "Legacy endpoint usage" is not debt here.

Consequences:

- Each endpoint in the manifest records the tier range it serves as
  `minApiVersion`/`maxApiVersion` (see
  [`api-usage-manifest.md`](api-usage-manifest.md)). A spec change at tier T is a
  breaking candidate **only** for endpoints whose range includes T.
- **Frozen-tier immunity falls out of range math** — no special-casing, no
  allowlist. Because the latest release is always the top (active) tier, frozen
  tiers never appear in a delta, and any `V1` calls added later self-exclude.
- A small committed **version-boundary map** ties tiers to server-version ranges
  and is the single source of truth that makes the model `V3`-ready:

  ```text
  tiers:  1: { server: "10.7.0–10.8.13", status: frozen }
          2: { server: "10.9.0–",         status: active }
          # 3: added here when V3 lands, alongside the >= 3 dispatch in code
  floor:  "10.7.0"   # minimum supported, indefinitely
  ```

## Two-directional validation

Because support is indefinite, the oldest spec is a permanent validation anchor,
which enables a check that has no anchor otherwise:

| Direction    | Question                                          | Spec compared                  | Catches                                              |
| ------------ | ------------------------------------------------- | ------------------------------ | --------------------------------------------------- |
| **Forward**  | Did something we use change in the new release?   | delta: acknowledged → latest   | Breakage on **modern** servers                      |
| **Backward** | Do we use something the floor server lacks?       | absolute: manifest → 10.7.0    | A new feature silently broken on the **oldest** servers (used a too-new endpoint with no dispatch/guard) |
| **Symmetry** | Is an op we gate modern-only also served on the floor? | absolute: manifest → 10.7.0 | An operation wired for one tier only that's plausibly missing a low-tier fallback — the mirror image of the backward check (see Phase 5) |

The **backward** and **symmetry** checks partition the manifest by the *same*
predicate (`does the endpoint's tier range include the floor tier?`): backward
owns the floor-included endpoints and flags the ones *absent* from the floor
spec; symmetry owns the modern-only endpoints and flags the ones *present* in
the floor spec. They can never double-report a given endpoint, and a genuinely
modern-only endpoint (absent from the floor — a real 10.9+ feature) is flagged
by neither. Both over-capture in a known way the agent dispositions (backward via
capability guards; symmetry via an unlinked V1 dispatch sibling).

## Data-flow pipeline

| Stage | What | Script/Agent | Output |
| --- | --- | --- | --- |
| **0. Demand** | API-usage manifest (endpoints + request/response fields + `apiVersion` tiers, with provenance) | script | `docs/architecture/api-usage-manifest.json` (committed) |
| **1. Supply** | Fetch acknowledged/latest/floor specs; build reduced fingerprints | script | raw specs (gitignored cache) + fingerprints (committed) |
| **2. Diff** | Structural diff between two specs/fingerprints | script | `spec-diff.json` (cache) |
| **3. Join + classify** | Intersect diff with manifest; tier-relevance filter; forward + backward; suppression | script | `findings-candidates.json` (cache) — **the data report** |
| **4. Investigate** | Per candidate: read cited code, determine real impact, draft issue | agent | verdicts + draft issues |
| **5. File** | `gh` issue create/comment/reopen with dedup + labels (plan/execute) | script | GitHub issues |

### The data report: `findings-candidates.json`

The deterministic contract between the two halves. Each candidate is
self-describing so the agent (and a human) can act without re-deriving anything:

```jsonc
{
  "type": "breaking | opportunity | coverage-gap | symmetry-advisory",
  "change": { "kind": "endpoint-removed | field-removed | field-retyped | enum-changed | param-changed | endpoint-added",
              "path": "/Items/{}", "detail": "RunTimeTicks: int64 → int32",
              // param-removed / field-removed also carry renameCandidates (always
              // present, possibly []): same-scope additions that could be the rename,
              // same-signature first. [] ⇒ likely-genuine removal. The diff surfaces
              // candidates; the agent confirms rename-vs-removal (see /server-upgrade).
              "renameCandidates": [{ "name": "newName", "sameSignature": true }],
              "fromVersion": "10.11.8", "toVersion": "10.11.10" },
  "appUsage": { "used": true, "apiVersionRange": [2, null],
                "sites": ["source/api/ApiClient.bs:59", "source/data/JellyfinDataTransformer.bs:96"] },
  "relevance": "active-tier | frozen-skip | floor-coverage | floor-symmetry",
  "severityGuess": "high",      // mechanical first guess; the agent overrides
  "needsInvestigation": true,
  "suppressed": false           // by .api-watch ignore rules
}
```

### What the agent investigates (why this can't be a script)

The agent turns each candidate into a verdict `{ real, severity, recommendedAction,
draftIssueBody, labels }` by reading the cited `appUsage.sites`. The edge cases
it resolves:

1. **A spec-contract break is not always a runtime break** — a retype
   (int→long) or nullable change is usually a no-op given the `?? default`
   pattern and dynamic typing; sometimes a silent break. Read the site to decide.
2. **Used-with-a-fallback** — endpoint "removed" but a dispatch branch / capability
   guard (e.g. `supportsMediaSegments()`) covers the affected range → not breaking.
3. **Spec regeneration artifacts** — cosmetic diffs (reordering, descriptions,
   schema refactors) that aren't real changes.
4. **Enum changes** — value added/removed on an enum the app switches on
   (`BaseItemKind`, stream `Type`).
5. **Graceful degradation** vs genuine break when a field disappears.
6. **Opportunity worth it?** — a new endpoint maps to a real feature gap, or not.
7. **Symmetry advisory** — an operation wired for only one tier may be missing on
   the rest of the supported range (accounting for intentionally-modern-only
   guarded features).

The **graduated trust ratchet** lives here: per finding-*class*, the verdict
either auto-files or waits for one batch approval (see decisions below).

## Artifact & caching strategy

| Artifact | Lives | Why |
| --- | --- | --- |
| `api-usage-manifest.json` (demand) | **committed** | diffable in review, drift-gated |
| version-boundary map | **committed** (small) | source of truth; changes only at tier boundaries |
| raw specs (~2 MB each) | **gitignored cache** (`.api-watch/cache/`) | the upstream archive is permanent — refetch is free |
| baseline + floor **spec fingerprints** | **committed** (small) | reduced structural surface (paths/params/schema-props/types/enums, descriptions stripped) — reproducible, offline, diffable diff anchors without 2 MB blobs |
| `spec-diff.json` + `findings-candidates.json` | **gitignored cache** | fully regenerable; transient per-run |
| **decisions** (what we reviewed, what we filed) | **GitHub issues + `signals-backlog.md`** | the persistent ledger already exists |

The Jellyfin OpenAPI archive (`api.jellyfin.org/openapi/stable/`) serves **every**
version back to 10.7.0 at permanent URLs, so there is no need to mirror specs into
a separate repo — refetch + cache is sufficient, and committed fingerprints give
reproducibility without repo bloat.

## Issue automation & proactivity

- **Plan/execute split** (mirrors the `crash-report` skill): plan mode produces
  the report with no GitHub writes; execute mode does `gh issue create / comment
  / reopen` with dedup and labels.
- **Human-gated initially**, per the trust-ratchet decision below. The cost is
  one batch approval per release (~monthly), not per finding.
- **CI tracker-issue** (proactive, autonomous, zero-judgment): a scheduled
  workflow maintains ONE issue — *"10.x available; N breaking candidates, M
  opportunities; run `/server-upgrade` to triage"* — mirroring
  `docs-stale-tracker.yml`. The stale-signal route in `signals-backlog.md` is
  rewired to point at `/server-upgrade`. **Built in Phase 4** — see the build
  record below.

## Decisions

- **No dedicated spec-mirror repo.** Jellyfin's own archive is a complete,
  permanent mirror (served from a CDN) back to 10.7.0; a second repo with its own
  CI and token plumbing would add complexity for zero availability gain. Use the
  archive plus a gitignored cache and committed fingerprints instead.
- **Committed fingerprints, not raw specs.** Reproducible, diffable baselines
  without committing 2 MB vendor JSON that grows on every bump.
- **Graduated trust ratchet, not full autonomy.** JellyRock has a small
  team/community tracker, so false-positive issues erode shared trust. Automate
  all investigation + drafting; gate per-finding creation initially; graduate
  specific finding-classes to auto-file once their false-positive rate is proven
  low. (The CI tracker-issue is the one fully-autonomous surface.)
- **Stable releases only** for GitHub issue-filing. RCs and master/unstable builds
  have a proactive **local** triage path (see "Pre-release channels" below) — they
  never file issues; the durable filing is the stable flow when the final ships.
- **`apiVersion` tiers inferred, not hand-listed.** Because old-version support is
  indefinite and new `V1` calls are legitimate, an inferred range annotation that
  self-suppresses frozen tiers is strictly better than a hand-maintained
  legacy-endpoint allowlist that would drift.
- **AST extraction, not grep**, for the manifest — durable against formatting and
  ~95% complete vs grep's ~80%.
- **Diff anchor vs. resolved-through are decoupled** (the `latest_acknowledged`
  baseline-gap fix; [issue #632](https://github.com/jellyrock/jellyrock/issues/632)).
  `latest_acknowledged` is two things that diverge once releases auto-resolve
  clean: (1) the **diff anchor** — the `from` version `computeReport` diffs
  against, which must have a committed fingerprint and is *safer* the wider it is
  (the diff is point-to-point, so a trailing anchor costs nothing); and (2) the
  **review cursor** that should drive the "needs attention" nag. A mechanically-
  clean release auto-closes its digest **without** bumping `latest_acknowledged`
  (CI never writes the journals — the only journal writer is the post-merge
  `journal-sync.yml`), so the anchor legitimately trails the newest release. We
  keep the anchor frozen at the last *deep* review (a real `/server-upgrade`
  triage, which commits a fresh fingerprint + bumps the row) and **derive**
  "resolved-through" from the digest issues rather than persisting it:
  - The CI tracker passes the digest list to the renderer (`--tracker-issues`),
    which computes `clearedThroughFrom()` and adds a **"Mechanically cleared
    through `<X>`"** header line — so a trailing anchor reads as progress, not
    staleness. The "Acknowledged baseline" header row was renamed **"Diff
    baseline (last full review)"** to match.
  - The `/catchup` aggregator's staleness for the `jellyfin-server-stable` row
    is now **"is there an OPEN tracker digest?"** (`signalStaleness()` in
    [`scripts/lib/signal-staleness.cjs`](../../scripts/lib/signal-staleness.cjs),
    fed by a one-shot `gh` query; offline → falls back to the string compare).
    Clean releases close their digest, so they no longer false-nag; only a
    candidate-bearing release leaves an open digest, and the `/catchup` + `/focus`
    banners route it to `/server-upgrade #N`. Rejected: having CI commit the
    machine-built fingerprint + bump the row (full auto-acknowledge) — it adds a
    *silent, self-perpetuating* baseline-corruption path (a transient partial
    spec fetch → false "clean" → bad fingerprint baked in as the trusted anchor),
    crosses the "CI never writes journals" + "committed fingerprint = a human
    reviewed it" invariants, and buys only a cosmetically-tidier file value.

## Pre-release channels (RC + unstable/master)

The mechanical pipeline is version-string-agnostic, so the same fetch→diff→join
machinery runs against pre-release builds — letting a maintainer react to an
upcoming release (or master) **before it ships**, and re-diff as it evolves. This
is a manual, maintainer-initiated surface; the daily CI tracker stays stable-only.

**Archive channels** (verified live):

| Channel | Dir | Filename | Mutability |
| --- | --- | --- | --- |
| stable + RC | `/openapi/stable/` | `jellyfin-openapi-<X.Y.Z>.json`, `…-rcN.json` | immutable per build |
| unstable/master | `/openapi/unstable/` | `jellyfin-openapi-<datestamp>.json` (e.g. `20240402201942`) | immutable per build |
| rolling pointers | `/openapi/` root | `jellyfin-openapi-unstable.json` | **mutable** — never pinned |

**Design choices** (locked):

- **Manual trigger, not CI.** The proactive RC/master triage is run by hand via
  `/server-upgrade <rc-or-unstable>`. The scheduled tracker keeps acting on stable
  only — proactive pre-release work is opt-in, not a daily nag.
- **Ephemeral baselines, nothing committed.** Pre-release fingerprints are built
  in-memory from the permanent archive (`findings-candidates.js --fetch`, the same
  path the Phase-4 tracker uses). Committing ~20,000-line fingerprints for throwaway
  RC/master builds would be pure churn, and it keeps the "committed fingerprint =
  reviewed **stable** anchor" invariant intact. Re-diff (`rc1 → rc2`, or
  `datestampA → datestampB`) just refetches — the archive is permanent per build.
- **Pin immutable builds, never the rolling pointer.** The `unstable`/`master`
  convenience token (`findings-candidates.js <from> unstable`) resolves via
  `signals-fetch.cjs`'s `fetchLatestUnstable()` to the latest **datestamped** build
  and records that concrete datestamp (reproducible + re-diffable). The mutable
  `jellyfin-openapi-unstable.json` root pointer is never pinned as a baseline.
- **Local output, not GitHub.** Pre-release runs write a `.claude/handoffs/` note
  with per-finding verdicts + a "fix proactively" list; they file no issues. The
  RC re-diff baseline is carried in the `jellyfin-server-rc` signal's
  `latest_acknowledged`; the master datestamp lives in the handoff (master moves
  too fast for a daily acknowledged cursor).

**Tier resolution.** `version-boundaries.cjs` `serverToTier` resolves an RC to its
base release's tier (suffix stripped) and a datestamp to the **active** tier (the
bleeding edge is, by definition, the top tier). This keeps forward tier-relevance
honest for pre-release `to` versions.

**When pre-release triage warrants a new tier.** If a breaking shift in an RC/master
build needs a new `if m.getApiVersion() >= N` dispatch level, the follow-up is the
[`/new-api-version`](../../.claude/skills/new-api-version/SKILL.md) skill, which
keeps [`jellyfin-version-boundaries.yml`](../dev/jellyfin-version-boundaries.yml)
and its BrightScript twin `resolveApiVersion()` in lockstep — and that lockstep is
machine-enforced **offline** by `npm run lint:apiversion-consistency`
([`apiversion-consistency-check.js`](../../scripts/lint/apiversion-consistency-check.js),
in the floor-system CI lint), which parses `resolveApiVersion()` with the same
BrighterScript AST the manifest generator uses and fails if its guards drift from the
boundary map. No Roku hardware is needed to verify a tier split. A **cross-major jump**
(e.g. `12.0.0` — Jellyfin dropping the `10.` prefix) needs no special-casing: version
comparison is numeric-per-segment and the active tier is unbounded above, so the new
major lands in the active tier and diffs against the prior stable normally. RCs can
still change, so re-run `/server-upgrade` against the FINAL stable when it ships.

## Roadmap

- **Phase 0 — Demand manifest** ✅ *done.* Endpoints + request/response fields +
  provenance, via the BrighterScript AST; drift-gated; cross-checked against the
  real 10.11.10 spec.
- **Phase 0.5 — `apiVersion` tiers** ✅ *done.* `minApiVersion`/`maxApiVersion`
  per endpoint, generalized to nested `V3`.
- **Phase 1 — Supply + diff.** ✅ *done.* Version-boundary map
  ([`jellyfin-version-boundaries.yml`](../dev/jellyfin-version-boundaries.yml) +
  [`version-boundaries.cjs`](../../scripts/lib/version-boundaries.cjs) loader),
  spec fetch/cache ([`spec-fetch.cjs`](../../scripts/lib/spec-fetch.cjs) →
  gitignored `.api-watch/cache/`), fingerprint generator
  ([`spec-fingerprint.js`](../../scripts/generate/spec-fingerprint.js); committed
  floor 10.7.0 + baseline 10.11.8 anchors under
  [`spec-fingerprints/`](spec-fingerprints/); drift-gated), and the structural
  diff engine ([`spec-diff.js`](../../scripts/generate/spec-diff.js)). Script;
  fixture-tested; fully offline.
- **Phase 2 — Join + classify.** ✅ *done.* Produce `findings-candidates.json`
  with forward and backward checks, tier-relevance filtering, and `.api-watch`
  suppression ([`findings-candidates.js`](../../scripts/generate/findings-candidates.js);
  fixture-tested; offline). *At the end of Phase 2 the full report runs by hand.*
- **Phase 3 — `/server-upgrade` skill.** ✅ *done.* Agent investigation over the
  report ([`SKILL.md`](../../.claude/skills/server-upgrade/SKILL.md)) +
  scaffold/plan/execute issue automation
  ([`server-upgrade.js`](../../scripts/server-upgrade.js); human-gated),
  dedup/reopen/labels. Fixture-tested; the GH writes live behind the human
  `execute` gate.
- **Phase 4 — Proactive CI.** ✅ *done.* Scheduled tracker-issue
  ([`server-upgrade-tracker.js`](../../scripts/server-upgrade-tracker.js) plus
  [`server-upgrade-tracker.yml`](../../.github/workflows/server-upgrade-tracker.yml)),
  with the `signals-backlog` route rewired to `/server-upgrade`. Counts are
  computed from an ephemeral in-CI fingerprint (no repo write); fixture-tested
  offline.
- **Phase 5 — Maturation.** ✅ *done.* Coverage-symmetry advisory
  (`symmetryFindings` in
  [`findings-candidates.js`](../../scripts/generate/findings-candidates.js), the
  mirror of the backward check; surfaced in the filer's title/labels +
  the CI tracker counts); auto-file graduation **policy + mechanism** locked (no
  class graduated — the ratchet stays human-gated until observed false-positive
  data justifies a config flip); plus a `--fetch`/`--manifest` dry-run on the join
  step (preview any release's full report without committing a fingerprint).
  Fixture-tested; offline. See the build record below.
- **Phase 6 — Release-triage digest model + endpoint-availability ledger.** ✅
  *done.* Replaced the per-finding issue burst + single rolling tracker with
  **one auto-opened digest per server version** carrying the rendered report as a
  checklist + discussion hub. CI opens-then-closes a **mechanically-clean**
  release as a persistent audit record (the only CI close — a judgment-free
  claim); a digest that bears a candidate is closed by a human/the skill, never by
  CI on a "caught-up" signal (Phase 4's caught-up-close is removed).
  `/server-upgrade` *edits* the digest with verdicts and files `file` verdicts as
  native GitHub **sub-issues** (`findingKey` dedup intact), inline-noting skip/
  monitor — so per-finding issues are opt-in promotions for work worth standalone
  tracking. The autonomous surface is the per-version *summary* (no judgment);
  *judgment* (real vs skip) stays human-gated. Also added the **endpoint-
  availability registry** (the committed [`jellyfin-endpoint-availability.yml`](../dev/jellyfin-endpoint-availability.yml),
  its [`endpoint-availability.cjs`](../../scripts/lib/endpoint-availability.cjs)
  loader, and the [`endpoint-availability-check.cjs`](../../scripts/lint/endpoint-availability-check.cjs)
  validation lint): a validated disposition ledger that resolves the recurring
  floor findings at the source (the `V1`/`V2` tier model can't express sub-tier
  introduction versions). Revised Phase 3 (filer output) + Phase 4 (tracker
  lifecycle). See the Phase 6 build record below + the `server-upgrade-phase6`
  decision in [`decisions.md`](../decisions.md) (supersedes the per-finding-default
  part of `server-upgrade-issue-filing`).

## Phase 1 — implementation notes (built; kept as the build record)

> **Built 2026-05-29.** This section is now a record of *how* Phase 1 was
> implemented rather than a to-do; the next session picks up at **Phase 2 —
> join + classify** (intersect [`spec-diff.js`](../../scripts/generate/spec-diff.js)
> output against the API-usage manifest, apply tier-relevance via
> [`version-boundaries.cjs`](../../scripts/lib/version-boundaries.cjs), emit
> `findings-candidates.json`). The notes below still describe the supply+diff
> layer's shape accurately.

Concrete guidance for Phase 1 (supply + diff). All of it is offline — no GitHub
writes — so it is safe to build and validate in isolation. Follow
`scripts/CLAUDE.md`: top-level CLI scripts are ESM `.js`, no new runtime deps
(`js-yaml` is already available if the version map is YAML).

1. **Version-boundary map** — a small committed file (the source of truth tying
   tiers to server versions). Shape: `{ tiers: { 1: {minServer, maxServer,
   status}, 2: {…} }, floor: "10.7.0" }`. Keep it next to
   [`jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md) and
   cross-check the boundaries against that guide.
2. **Spec fetch + cache** — reuse the HTTP helper in
   [`scripts/lib/signals-fetch.cjs`](../../scripts/lib/signals-fetch.cjs) (it
   already GETs `api.jellyfin.org/openapi/stable/`). Fetch
   `jellyfin-openapi-<version>.json`; cache to a gitignored `.api-watch/cache/`
   (add it to `.gitignore`). The archive is permanent, so historical versions
   need no TTL; only "latest" lookups do.
3. **Fingerprint generator** — reduce a 2 MB spec to its structural surface and
   nothing else: per path+method, the parameters (name + in + type + required,
   resolving `$ref` to `components.parameters` — the real spec uses refs
   heavily), request-body property names+types, response schema ref; per
   component schema, property names + types + enum values. **Strip descriptions,
   summaries, examples** — that is what neutralizes Jellyfin's cosmetic
   regeneration churn. Output a small deterministic JSON; commit the fingerprints
   for the acknowledged baseline + the 10.7.0 floor; drift-gate them with the
   same write/`--check` pattern as the manifest.
4. **Diff engine** — a pure function `(fingerprintA, fingerprintB) → diff`
   emitting the `change` objects defined in the `findings-candidates.json` schema
   above (paths/params/schema-props/enums added/removed/changed). Keep field
   names exactly as the spec spells them; case-folding for the join is **Phase
   2's** concern, not the diff's (both sides here are Jellyfin specs, same
   casing).
5. **Tests** — exercise every diff kind with **tiny hand-written fixture specs**,
   never the 2 MB real ones. Vitest under `tests/scripts/unit/`, mirroring the
   manifest test layout (direct import for pure fns, `spawnScript` for the CLI).

The diff output (`spec-diff.json`, gitignored cache) is the input to Phase 2's
join against the manifest. Carry forward the documented lesson: the **join must
be case-insensitive on field names** (the app sends PascalCase, the spec defines
camelCase) — see the manifest's `coverage.knownGaps`.

## Phase 2 — implementation notes (built; kept as the build record)

> **Built 2026-05-29.** A record of *how* Phase 2 was implemented. The next
> session picks up at **Phase 3 — the `/server-upgrade` skill** (agent
> investigation over `findings-candidates.json` + plan/execute issue automation).

[`findings-candidates.js`](../../scripts/generate/findings-candidates.js) is the
deterministic join+classify step. It is a pure, offline transform over committed
inputs — no network, no GitHub writes — so it is fully fixture-tested.

1. **Anchor strategy (Phase 1's open question, decided here): committed
   fingerprints.** The join reads the committed `from`/`to`/`floor` fingerprints
   and computes the forward diff in-process via the already-exported
   `diffFingerprints()`. "Fetch latest + commit its fingerprint" stays the
   existing separate step (`spec-fingerprint.js <version>`). Rejected
   fetch-latest-on-demand because it would make the join network-dependent and
   less reproducible — at odds with the pipeline's deterministic/cacheable/offline
   principle, and committing the latest fingerprint is a natural part of the
   release trigger anyway. CLI:
   `node scripts/generate/findings-candidates.js <from> <to> [--floor <v>] [--root <dir>] [--no-opportunities] [--stdout]`
   (npm: `api-watch:findings`); writes the gitignored
   `.api-watch/cache/findings-candidates-<from>..<to>.json`.
2. **Forward check** intersects the diff with the manifest. Endpoints join via
   the manifest's `normalized` form (the script mirrors the manifest's
   `normalizePath` exactly — `{x}`→`{}`, lowercased, trailing slash stripped,
   idempotent), keyed by **normalized-path + method** because the same path can
   appear under several entries with different methods *and* tier ranges (e.g.
   `/items/{}` has a `V1` `DELETE` and a `V2` `GET`). A method recorded as `UNKNOWN`
   (verb not statically resolvable) falls back to a path-level match. Fields join
   **case-insensitively by name** — the load-bearing carry-forward lesson.
   Tier-relevance: the change's tier is `serverToTier(diff.toVersion)`; an
   endpoint whose `[minApiVersion, maxApiVersion]` range includes it →
   `active-tier` (investigate), otherwise `frozen-skip` (`needsInvestigation:
   false`). Frozen-tier immunity falls out of this range math — no allowlist.
3. **Backward floor-coverage check** flags a `coverage-gap` for every manifest
   endpoint whose range includes the floor tier yet is absent from the floor
   fingerprint. Modern-only endpoints (`minApiVersion > 1`) are intentionally not
   flagged. NOTE: the manifest's known coarseness (an endpoint guarded by a
   capability check rather than a `getApiVersion()` branch tags `[1,∞)`, e.g.
   `/audio/{}/lyrics`) means some coverage-gaps are *expected* and the Phase 3
   agent (pipeline stage 4, "Investigate") dispositions them via the capability
   guard — that is the intended seam, not a bug.
4. **Classification.** Breaking = the removed/changed kinds on a used surface;
   `opportunity` = an `endpoint-added` the app does not already use (gate off with
   `--no-opportunities`); purely additive kinds (`param-added`, `field-added`) and
   unused changes are dropped (counted in the run summary, never silently). For
   `enum-changed` there is no field name, so the schema name of the enum joins
   against consumed field names (catches `MediaType`-style enums; misses
   `BaseItemKind`-style — acceptable over/under-capture, the agent resolves).
5. **Suppression.** [`.api-watch/suppressions.yml`](../../.api-watch/suppressions.yml)
   (committed; the cache subdir is the only gitignored part of `.api-watch/`)
   holds accepted-churn rules (kind/path/method/schema/name predicates, ALL must
   match, first-match-wins), mirroring `.crash-report/known-noise.yml`. A
   suppressed candidate stays in the report flagged `suppressed: true` +
   `suppressedBy`, forced `needsInvestigation: false` — nothing vanishes silently.
6. **Tests** ([`findings-candidates.test.js`](../../tests/scripts/unit/generate/findings-candidates.test.js))
   exercise every path with tiny hand-written manifests + fingerprints (direct
   import for the pure builders, `spawnScript` for the CLI), mirroring
   `spec-diff.test.js`.

## Phase 3 — implementation notes (built; kept as the build record)

> **Built 2026-05-29.** A record of *how* Phase 3 was implemented. The next
> session picks up at **Phase 4 — proactive CI** (scheduled tracker-issue +
> `signals-backlog` wiring).

Phase 3 is the two-halves seam in code: the judgment half is the
[`/server-upgrade`](../../.claude/skills/server-upgrade/SKILL.md) opus skill
(pipeline stage 4, "Investigate"); the mechanical half is
[`server-upgrade.js`](../../scripts/server-upgrade.js) (stage 5, "File"), which
mirrors `scripts/crash-report.js`'s plan/execute split. The filer never decides
"is this a real problem"; the skill never touches GitHub.

1. **Three filer commands bridge the agent seam.** `scaffold` is a pure read of
   the data report → a verdict-template JSON listing the candidates the report
   flagged `needsInvestigation` (so suppressed + frozen-skip self-exclude),
   keyed by a stable `findingKey` the *script* derives. The agent fills judgment
   fields in place (`real`, `severity`, `recommendedAction ∈ {file, skip,
   monitor}`, `labels`, `rationale`, `draftIssueBody`). `plan` joins the filled
   verdicts back by `findingKey`, runs the GitHub dedup search (reads only), and
   reconciles into `create | comment | reopen | skip | monitor | missing-verdict
   | invalid-verdict`. `execute` is the only path that writes to GitHub + writes
   a run-summary handoff to `.claude/handoffs/`. npm: `api-watch:file`.
2. **Decision (a) — version-independent dedup key.** `findingKey` =
   `kind + locator` (normalized path+method, or `Schema.field`, or enum schema),
   never the version. The same structural concern recurring in a later release
   maps to the same key → comment/reopen instead of a duplicate. This is
   load-bearing for the recompute-every-run classes (every `coverage-gap` and
   symmetry advisory is derived from manifest×floor, so a version-scoped key
   would re-file the identical issue every release). The title carries the
   readable locator; dedup confirms by the version-independent
   `<kindLabel>: <locator>` substring (mirrors crash-report's stable substring +
   `[server-upgrade]` title-prefix confirm). Base labels by type: breaking +
   coverage-gap → `server-upgrade`+`bug`; opportunity + symmetry →
   `server-upgrade`+`enhancement`; the agent may append. Only `server-upgrade`
   is created during preflight.
3. **Decision (b) — the script owns the verdict template.** The script derives
   `findingKey` so the agent can't drift keys, and `scaffold` enumerates *every*
   investigation candidate so `plan` surfaces any candidate left without a
   verdict as `missing-verdict` rather than dropping it silently. Both silent
   failure modes (a verdict whose key doesn't match, a missed candidate) are
   closed for the price of one small pure command.
4. **Decision (c) — all finding-classes human-gated (the trust ratchet).**
   Running `execute` IS the per-release batch approval (one approval ~monthly,
   not per finding). `AUTO_FILE_CLASSES` is empty and every action carries
   `autoFileEligible: false`, so Phase 5 graduates a low-false-positive class by
   config, not a rewrite. Coverage-gap is the *worst* auto-file candidate today
   — the manifest's capability-guard coarseness (`/audio/{}/lyrics` tagged
   `[1, ∞)`) is a known structural false-positive source the agent dispositions
   by reading the guard, so it stays gated.
5. **Tests** ([`server-upgrade.test.js`](../../tests/scripts/unit/server-upgrade.test.js))
   exercise every pure part — stable identity, title draft + dedup confirm
   (incl. kind disambiguation on a shared locator), scaffold, verdict
   validation, reconciliation across all action classes, plan counts, the
   `executePlan` write branches via an injected `gh` mock, and the run-summary
   render — plus the CLI scaffold/plan path with `--no-dedup` (no network).

## Phase 4 — implementation notes (built; kept as the build record)

> **Built 2026-05-30.** A record of *how* Phase 4 was implemented. The next
> session picks up at **Phase 5 — maturation** (coverage-symmetry advisory;
> graduate auto-file per finding-class once false-positive rates are proven
> low — the ratchet's `AUTO_FILE_CLASSES` is already wired, see Phase 3 note 4).

Phase 4 is the proactive, fully-autonomous, zero-judgment surface: a scheduled
workflow that maintains ONE tracker issue nudging a human to run
`/server-upgrade`. The judgment + filing halves (Phases 3) stay human-gated; the
tracker only *announces* and never files per-finding issues. Two artifacts plus
one journal rewire:
[`server-upgrade-tracker.js`](../../scripts/server-upgrade-tracker.js) (the
testable compute core) and
[`server-upgrade-tracker.yml`](../../.github/workflows/server-upgrade-tracker.yml)
(the `gh` plumbing, mirroring `docs-stale-tracker.yml`).

1. **Decision (a) — the fingerprint problem: ephemeral in-CI, never committed.**
   The tracker's counts need the `to` (latest) fingerprint, which is normally a
   human-committed, drift-gated, *reviewed* anchor. Rather than auto-commit it
   (an autonomous repo write that would decouple "committed" from "reviewed" —
   a bot would leave orphan anchors for versions nobody triaged) the tracker
   builds the `to` fingerprint **in memory** from the fetched spec
   (`buildFingerprint`) and runs the Phase-2 `buildReport` against the committed
   `from`/`floor` fingerprints. Nothing touches the working tree; the human
   commits the `to` fingerprint when they run `/server-upgrade`
   (`spec-fingerprint.js <latest>` is that skill's documented prerequisite).
   Counts are a transient nudge, not a durable artifact, so they need no stored
   reproducibility — anyone can rebuild them from the immutable archive spec.
   When the spec fetch fails or a baseline fingerprint is absent, the tracker
   **degrades to announce-only** (the rejected option c, kept as the
   fallback) so it still nudges rather than hard-failing. The tracker reuses
   `findings-candidates.js`'s exact committed-input readers
   (`readFingerprint`/`readManifest`/`readSuppressions`, exported for this) so
   CI counts can't drift from a local `api-watch:findings` run.
2. **Decision (b) — one persistent issue, found by a dedicated label.** The
   tracker issue carries `server-upgrade:tracker`, deliberately DISTINCT from
   the `server-upgrade` label the Phase-3 *filer* puts on per-finding issues —
   reusing that label would make the tracker's `gh issue list` collide with real
   findings. The workflow finds the one open tracker by label and edits it in
   place each run (the title carries the version, the body the counts), mirroring
   `docs-stale-tracker.yml`. **What closes it:** the scheduled run itself, when
   `latest_stable == latest_acknowledged` — i.e. after the human runs
   `/done jellyfin-server-stable` post-triage, the next run detects "caught up"
   and closes. If the human closes it manually while still behind, the next run
   reopens (no open issue → create), which is the intended "still needs triage"
   behavior.
3. **Decision (c) — schedule + guards.** Daily `cron: '0 12 * * *'` +
   `workflow_dispatch` with a `version` override for testing. Daily (not weekly):
   Jellyfin can ship more than one (hot)fix in a week, so weekly could miss a
   release for up to 7 days. Daily is cheap because a run short-circuits to a
   sub-second version-compare when caught up — the spec fetch + report compute
   only happen when a genuinely newer stable exists. Detection fetches the live latest **stable** via
   `fetchJellyfinVersions().stable` (RCs are excluded by that fetcher's own
   rule — RCs are tracked by the separate `jellyfin-server-rc` signal and never
   generate issues) and compares against `latest_acknowledged` read from the
   file — robust whether or not `/catchup` has refreshed `latest_upstream`. The
   workflow is read-only on the repo (`contents: read`, `issues: write`) and
   **never touches the journals** — `latest_upstream`/`last_checked` stay
   `/catchup`'s job; the tracker strictly comments/closes one issue.
4. **The script/workflow seam.** All judgment-free decisions (parse the signal
   row, decide announce vs caught-up, render the title + body) are pure named
   exports in the script; the workflow YAML only does `gh` plumbing and reads a
   one-line decision JSON the script prints to `stdout` (body written to a file).
   The title is single-sourced from that JSON so the YAML never re-derives it.
5. **Tests** ([`server-upgrade-tracker.test.js`](../../tests/scripts/unit/server-upgrade-tracker.test.js))
   exercise the pure parts (signal parse incl. fence/next-row skipping, the
   announce/caught-up/placeholder decision matrix, title + body render with and
   without counts) and the count-compute + CLI path **fully offline** via
   `--latest` + `--to-file` (an injected `to` spec) against tiny hand-written
   committed inputs — including the graceful-degradation branch (a missing
   baseline fingerprint → announce-only). No network, no GitHub writes.

## Phase 5 — implementation notes (built; kept as the build record)

> **Built 2026-05-30.** A record of *how* Phase 5 was implemented. Phase 5 is the
> pipeline's maturation: a new directional check (coverage-symmetry) and the
> locked policy for graduating the trust ratchet. Two independent sub-features.

### (1) Coverage-symmetry advisory

`symmetryFindings` in
[`findings-candidates.js`](../../scripts/generate/findings-candidates.js) is the
exact **complement** of the backward floor-coverage check, and the two are the
two branches of one predicate — `rangeIncludes(min, max, floorTier)`:

| Check | Tier filter | Floor-spec test | Meaning |
| --- | --- | --- | --- |
| backward `coverage-gap` | floor *in* range (`min == 1`) | op **ABSENT** from floor | we call it; the oldest server lacks it → break on old servers |
| `symmetry-advisory` (new) | floor *excluded* (`min > 1`) | op **PRESENT** in floor | the oldest server *serves* it, yet we wire it modern-only → plausibly a missing low-tier fallback |

1. **Mechanical signal (decision a).** Script-side, fixture-testable — not
   agent-only. A modern-only endpoint whose operation is *present* in the floor
   fingerprint (path+method, with the same UNKNOWN-verb→path-level fallback the
   backward check uses) emits a `symmetry-advisory` candidate with
   `change.kind: "coverage-symmetry"`, `relevance: "floor-symmetry"`,
   `severityGuess: "low"`, joining by path+method+tier exactly like
   `coverage-gap`. **Boundary vs coverage-gap:** the two partition the manifest
   by `min == 1` vs `min > 1`, so they can never double-report; a genuinely
   modern-only endpoint (absent from the floor — a real 10.9+ feature) is flagged
   by neither, which is what "accounting for intentionally-modern-only guarded
   features" means mechanically. On the real committed manifest this fires on
   exactly **one** candidate — `GET /items`, served on the floor but gated to V2+
   because the V1 dispatch branch uses the `/Users/{}/Items` sibling. That's the
   *expected* coarseness false-positive the agent dispositions (via the unlinked
   sibling), exactly mirroring how it dispositions capability-guarded
   coverage-gaps. A future feature that adds a call gated to `V2`+ *without* a
   `V1` dispatch branch is the new bug class this catches.
2. **Surfacing.** `KIND_LABEL['coverage-symmetry'] = 'coverage symmetry'` in the
   filer gives advisories a readable title + a stable, version-independent dedup
   identity; `BASE_LABELS_BY_TYPE['symmetry-advisory']` was already
   `[server-upgrade, enhancement]`. The Phase-4 tracker body gained a
   coverage-symmetry count line. The report `counts` block gained
   `symmetry-advisory`.
3. **Tests.** `findings-candidates.test.js` exercises fires/skips/partition/
   method-specificity/UNKNOWN-fallback; `server-upgrade.test.js` covers the
   symmetry `findingKey`/title/labels (still human-gated);
   `server-upgrade-tracker.test.js` covers the count line.

### (2) Auto-file graduation — policy + mechanism (no class graduated)

The mechanism was wired in Phase 3 (`AUTO_FILE_CLASSES`, `isAutoFileEligible`,
`autoFileEligible` on every action), so graduation is config, not a rewrite.
Phase 5 locks the *policy*; it graduates **nothing**.

1. **Decision (b) — graduate nothing yet; what graduation means.** No class has
   an *observed* false-positive rate — the pipeline has filed zero issues — so
   graduating any class would be on faith, which the ratchet decision forbids.
   When a class does graduate, it **relaxes the per-class batch-approval gate
   inside a human-run `/server-upgrade execute`** (that class's `create` actions
   skip the Step-4 confirmation). It does **not** add an autonomous auto-file path
   to the Phase-4 CI tracker: the tracker stays the *one* fully-autonomous
   surface and only announces. Auto-filing a mechanically-derived candidate in CI
   *without* the agent's per-finding disposition would file precisely the
   false-positives the disposition exists to catch (coverage-gap's
   capability-guard coarseness and symmetry's unlinked sibling coarseness are both
   structural FP sources the agent resolves by reading code).
2. **Decision (c) — ship (1) fully; (2) is policy/docs only.** No measurement
   command was built — it would query an issue corpus that doesn't exist yet and
   couldn't be validated. The graduation procedure below preserves its *design*
   at zero dead-code cost.

#### Graduation procedure (for a future maintainer, once real data exists)

A finding-class graduates when its false-positive rate — *issues filed for that
class that were later closed as not-a-real-problem* ÷ *total filed for that
class* — is proven low across enough releases. Suggested bar: **≥ ~8 filed in the
class across ≥ 3 releases, FP rate < ~10%.** Tune with judgment; the point is a
real track record, not a single clean release.

Measuring the rate (read-only; run when `[server-upgrade]` issues exist):

```bash
# All filed server-upgrade issues, by state. Closed-as-"not planned" is the
# false-positive signal (the /server-upgrade run that skipped should NOT have
# filed); closed-as-completed = a real finding we fixed.
gh issue list --label server-upgrade --state all --limit 200 \
  --json number,title,state,stateReason,labels,closedAt \
  | jq '
    map(select(.title | startswith("[server-upgrade]"))) as $all
    | ($all | length) as $total
    | ($all | map(select(.stateReason == "not_planned")) | length) as $fp
    | { total: $total, falsePositives: $fp,
        fpRate: (if $total == 0 then null else ($fp / $total) end) }'
```

To break the rate down per class, partition by the title's kind-label prefix
(`endpoint removed:`, `floor coverage gap:`, `coverage symmetry:`, `new
endpoint:`, …) before the ratio. Note the convention to establish *first*: when
a maintainer closes a `[server-upgrade]` issue because it was a false alarm, they
must close it **as "not planned"** (not "completed") — that state-reason is the
load-bearing signal this query keys on. (A `false-positive` label is a fine
belt-and-suspenders but the query above keys on `stateReason`.)

Once the bar is met for a class, graduation is one line:
`export const AUTO_FILE_CLASSES = new Set(['<class>']);` in
[`server-upgrade.js`](../../scripts/server-upgrade.js) — plus a `/log decision`
recording the observed rate that justified it. `opportunity` is the most natural
*first* candidate (an over-filed enhancement is low-harm vs a wrong `bug`);
`coverage-gap` is the *worst* (the `/audio/{}/lyrics` capability-guard coarseness
is a structural FP source), and `symmetry-advisory` is brand-new with no track
record. None graduate today.

### (3) Dry-run / preview (`--fetch`, `--manifest`)

[`findings-candidates.js`](../../scripts/generate/findings-candidates.js) gained two
CLI flags so a maintainer (or a validation pass) can run the full report against
*any* inputs without mutating the committed tree:

- `--fetch` — for any version lacking a committed fingerprint, build one
  IN-MEMORY from the fetched spec (`resolveFingerprint` prefers the committed
  anchor, falls back to `fetchSpec` + `buildFingerprint` — the same ephemeral path
  the Phase-4 tracker uses). Lets you preview a brand-new release's *full* report
  (not just the tracker's counts) before committing its fingerprint. Only the
  gitignored raw-spec cache is touched.
- `--manifest <path>` — read the demand manifest from an explicit path instead of
  the committed one. For what-if / historical simulation (e.g. reconstructing the
  manifest as it was before the V2 split — the `/Users/{userId}/*` family
  unbounded as `V1` code would have had it — to confirm the system would have
  flagged those removals at the 10.9.0 release: it does, as 18 active-tier
  `endpoint-removed` candidates). Production always uses the committed manifest
  (current code).

These are the same primitives Phase 6's CI reuses to render the per-version
report ephemerally.

## Phase 6 — implementation notes (built; kept as the build record)

> **Built 2026-05-30.** A record of *how* Phase 6 was implemented. Phase 6 is the
> issue-model maturation: the per-finding issue burst + single rolling tracker
> become ONE per-version release-triage *digest* with per-finding *sub-issues*,
> and the recurring floor findings self-resolve via a validated availability
> ledger. Two independent sub-features.

### (1) The endpoint-availability registry (the recurring-floor-findings fix)

The backward + symmetry checks fire on **5 standing floor findings every run** on
the real manifest — `GET /audio/{}/lyrics`, `GET /mediasegments/{}`,
`GET /quickconnect/enabled`, `GET,POST /quickconnect/initiate`, and the
`GET /items` symmetry advisory. An audit confirmed **none are bugs** (all degrade
gracefully or are version-guarded), yet they recur forever because the `V1`/`V2`
two-tier model is too coarse to express sub-tier introduction versions
(`MediaSegments` lands at 10.10, Lyrics at 10.9, `QuickConnect` at 10.8 — all *inside*
the `V2` tier), and the AST manifest tags each `[1, ∞)` because there is no literal
`getApiVersion() >= N` branch around it. The decisive proof: **`MediaSegments` has a
real `supportsMediaSegments()` guard and still flagged** — because the guard lives
in Layer 2, not an `ApiClient` version branch.

1. **A validated disposition ledger, not a catalog.** The committed
   [`jellyfin-endpoint-availability.yml`](../dev/jellyfin-endpoint-availability.yml)
   records, per post-floor endpoint, its `minServer` (documentary) + the old-server
   `handling` (`version-guard` | `dispatch-sibling` | `sdk-dispatch` |
   `graceful-degradation`). The floor check (`applyFloorAvailability` in
   [`findings-candidates.js`](../../scripts/generate/findings-candidates.js))
   marks a registered coverage-gap/symmetry `relevance: floor-known`,
   `needsInvestigation: false` — it stays in the report as an audit trail but drops
   out of the actionable set (mirrors suppression, but distinct: `suppressed`
   stays false). The 5 are floor-known now; steady-state floor noise is **zero**.
2. **Completeness without relying on docs.** The docs are NOT the source of
   completeness (they're not comprehensive — versioning §4 listed only
   `MediaSegments`). The **spec-derived floor check is the enumerator** (a
   coverage-gap *is* "an endpoint we use absent from the floor spec"); the registry
   is the disposition ledger. An UNREGISTERED post-floor endpoint keeps flagging
   `needsInvestigation`, so a new one can't hide — and it surfaces in the next
   per-version digest as a normal candidate, blocking its clean auto-close.
   Handling/`minServer` are sourced from the **code audit** (authoritative), docs
   only as cross-reference.
3. **Regression-safe via a lint, not a blunt mute.** Suppressing these via
   `suppressions.yml` was rejected — a permanent mute would *hide a regression*
   (e.g. someone deletes the `supportsMediaSegments()` guard → the endpoint really
   would 404 on old servers). Instead
   [`endpoint-availability-check.cjs`](../../scripts/lint/endpoint-availability-check.cjs)
   (npm `lint:endpoint-availability`, in the main lint chain) validates each
   entry's CODE claim: `version-guard` → the symbol must exist in `source/*.bs`;
   `dispatch-sibling` → the sibling path must be a floor-tier manifest endpoint;
   plus every entry's endpoint must still be in the manifest (no dead entries). If
   a guard is removed, the lint FAILS in CI → restore it or drop the entry, and the
   floor finding correctly resurfaces. (Reconciles with the `apiVersion tiers
   inferred, not hand-listed` decision: the manifest stays purely inferred from the
   AST; the ledger is a *separate*, hand-maintained-but-CI-validated input to the
   floor check, never written into the manifest.)
4. **Why not finer manifest tiers / app-code guards.** The two-tier model can't
   express "10.10+", and adding explicit guards to the 3 unguarded-but-graceful
   endpoints (Lyrics, `QuickConnect` ×2) would either change *deliberate* fail-open
   behavior (`QuickConnect`) or need on-hardware testing — out of scope for a
   tooling-only PR. The ledger clears all 5 with no app/behavior change.
   **Shipped (post-Phase-6):** the proactive PR-time floor lint
   ([`floor-coverage-check.js`](../../scripts/lint/floor-coverage-check.js), npm
   `lint:floor-coverage`) now catches a *new* floor gap from our own commits without
   waiting for a Jellyfin release. It reuses the same `backwardFindings` /
   `symmetryFindings` / `applySuppressions` / `applyFloorAvailability` functions as the
   digest, so its residual == the digest's floor actionable set: an unregistered
   `coverage-gap` FAILs the PR (exit 1), a `symmetry-advisory` only warns. It runs in
   CI via the combined [`_lint-floor-system.yml`](../../.github/workflows/_lint-floor-system.yml)
   reusable, which ALSO gives `lint:endpoint-availability` its first CI home (it had
   previously run only in the local `npm run lint` aggregate).
   **Update (post-Phase-6):** Lyrics was subsequently given a real
   `supportsLyrics()` version-guard (`source/api/items.bs`), so its ledger entry is
   now `version-guard` (CI-validated), not `graceful-degradation` — leaving
   `QuickConnect` ×2 as the remaining deliberate graceful/fail-open cases (their
   handling is correct as-is; see the Quick Connect analysis in
   [`jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md)).

### (2) The per-version release-triage digest model

Replaces Phase 3's per-finding issue burst + Phase 4's single rolling tracker.
Digest renderers + sub-issue mechanics live in
[`server-upgrade.js`](../../scripts/server-upgrade.js) (the filer, the natural home
for issue-body rendering); the Phase-4 tracker imports them.

1. **Two issue kinds, one trust seam.** The **per-version digest** (label
   `server-upgrade:tracker`, found by its version-stamped title) is CI's
   autonomous, judgment-free summary surface. The **per-finding promotion** (label
   `server-upgrade`, the existing version-independent `findingKey` dedup) is the
   opt-in durable work item, filed by the human-gated skill as a native GitHub
   **sub-issue** of the digest (`gh api .../sub_issues`, resolving the child's db
   id first; best-effort — a link failure is recorded, never aborts). Skip/monitor
   verdicts become inline checked-off notes on the digest.
2. **Lifecycle (decided + confirmed this session).** `none` (caught up) → do
   nothing; **Phase 4's close-on-caught-up is removed** (acknowledging ≠ work
   done). `clean` (0 candidates) → CI opens-then-closes the digest as a persistent
   audit record (the ONLY CI close — a judgment-free claim). `triage` (≥1
   candidate, or degraded) → CI opens/refreshes the digest body until first triage,
   detected by the `server-upgrade:triaging` label the skill adds, then HANDS OFF
   (never overwrites or closes). A candidate-bearing digest is closed only by a
   human/the skill (and the filer's `--close-digest` refuses to close while any
   `missing-verdict`/`invalid-verdict` remains). Digests STACK per version as a
   per-release audit trail; in steady state the close-plus-`/done` ritual prevents
   pile-up, and a backlog shows each newer digest as a forward superset of the prior.
3. **Open-then-close clean (decided this session): persistent audit records.**
   Clean releases get a closed digest rather than staying silent — these issues are
   the durable audit trail of what the mechanical pass found for each release,
   surviving GitHub Actions' 90-day log retention.
4. **The script/workflow seam.** The tracker
   ([`server-upgrade-tracker.js`](../../scripts/server-upgrade-tracker.js)) computes
   the full report ephemerally (now passing the availability ledger so CI counts
   match a local run) and emits a decision JSON (`action ∈ none|clean|triage` +
   title + body-file); the workflow
   ([`server-upgrade-tracker.yml`](../../.github/workflows/server-upgrade-tracker.yml))
   does the open/refresh/close + triaged-hands-off `gh` plumbing, matching the digest
   by exact title (not `--search`, which would mangle the bracketed/em-dash title).
5. **Tests.** `endpoint-availability.test.js` (loader schema + the lint's
   guard/sibling/stale checks, offline via `spawnScript`); `floor-coverage-check.test.js`
   (the proactive PR-time lint, offline via `spawnScript`: registered-clean,
   unregistered-gap-fails, symmetry-warns-not-fails, suppression clears, `--json` shape,
   missing-floor-fingerprint → exit 2); `findings-candidates.test.js`
   (`applyFloorAvailability` floor-known + unregistered-still-flags + `floorKnown`
   counts); `server-upgrade.test.js` (digest identity + both body renders +
   `attachSubIssue` + `executePlan` with a digest: sub-issue attach, the
   `server-upgrade:triaging` label edit, close-guard); `server-upgrade-tracker.test.js` (the none/clean/triage
   decision matrix + the CLI emitting each, fully offline). No network, no GitHub.

### Migration note (single rolling tracker → per-version digests)

Code-only — there was **no live issue to migrate**. The Phase-4 tracker workflow
only ever existed on the `feat/server-upgrade-automation` branch, never on `main`,
so scheduled CI never ran it and no rolling tracker issue exists in the repo.

## Related

- [`api-usage-manifest.md`](api-usage-manifest.md) — the demand-side manifest
  (Phase 0/0.5), built.
- [`api.md`](api.md) — the API client + task pool the manifest is extracted from.
- [`docs/dev/jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md)
  — the version-policy guide; the version-boundary map lives alongside it.
- [`signals-backlog.md`](../signals-backlog.md) — upstream version watching; the
  trigger and acknowledgment ledger for this pipeline.
