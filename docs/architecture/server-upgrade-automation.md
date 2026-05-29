---
topic: server-upgrade-automation
related-files:
  - scripts/generate/api-usage-manifest.js
  - scripts/generate/spec-fingerprint.js
  - scripts/generate/spec-diff.js
  - scripts/generate/findings-candidates.js
  - .api-watch/suppressions.yml
  - scripts/lib/spec-fetch.cjs
  - scripts/lib/version-boundaries.cjs
  - docs/architecture/api-usage-manifest.json
  - docs/architecture/api-usage-manifest.md
  - docs/architecture/spec-fingerprints/
  - docs/dev/jellyfin-version-boundaries.yml
  - docs/signals-backlog.md
  - docs/dev/jellyfin-server-versioning.md
  - source/api/ApiClient.bs
last-reviewed: 2026-05-29
---

# Jellyfin Server-Upgrade Automation

The design of record for turning Jellyfin server upgrades from reactive manual
catchup into a proactive, mostly-automated pipeline: when a new server version
ships, mechanically detect every API change that intersects code JellyRock
actually ships, have an agent investigate the real impact, and file/triage GitHub
issues — while staying silent about the churn that doesn't affect us.

> **Status (2026-05-29):** Phases 0 + 0.5 + 1 + 2 are built and verified (the
> API-usage manifest with `apiVersion` tiers; the supply+diff layer:
> version-boundary map, spec fetch/cache, fingerprint generator with committed
> floor/baseline anchors, and the structural diff engine; and the join+classify
> layer: `findings-candidates.js` with the forward + backward checks,
> tier-relevance filtering, and `.api-watch` suppression). Phases 3–5 are
> designed here but not yet built. At the end of Phase 2 the full report runs by
> hand (`npm run api-watch:findings <from> <to>`); the `/server-upgrade` agent
> skill that consumes it is Phase 3. See the [roadmap](#roadmap) below.

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
              "fromVersion": "10.11.8", "toVersion": "10.11.10" },
  "appUsage": { "used": true, "apiVersionRange": [2, null],
                "sites": ["source/api/ApiClient.bs:59", "source/data/JellyfinDataTransformer.bs:96"] },
  "relevance": "active-tier | frozen-skip | floor-coverage",
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
  rewired to point at `/server-upgrade`.

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
- **Stable releases only** for issue-filing; RCs are tracked separately by the
  `jellyfin-server-rc` signal but don't generate issues.
- **`apiVersion` tiers inferred, not hand-listed.** Because old-version support is
  indefinite and new `V1` calls are legitimate, an inferred range annotation that
  self-suppresses frozen tiers is strictly better than a hand-maintained
  legacy-endpoint allowlist that would drift.
- **AST extraction, not grep**, for the manifest — durable against formatting and
  ~95% complete vs grep's ~80%.

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
- **Phase 3 — `/server-upgrade` skill.** Agent investigation over the report +
  plan/execute issue automation (human-gated), dedup/reopen/labels.
- **Phase 4 — Proactive CI.** Scheduled tracker-issue + `signals-backlog` wiring.
- **Phase 5 — Maturation.** Coverage-symmetry advisory; graduate auto-file per
  finding-class once false-positive rates are proven low.

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
   `/audio/{}/lyrics`) means some coverage-gaps are *expected* and the Phase 4
   agent dispositions them via the capability guard — that is the intended seam,
   not a bug.
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

## Related

- [`api-usage-manifest.md`](api-usage-manifest.md) — the demand-side manifest
  (Phase 0/0.5), built.
- [`api.md`](api.md) — the API client + task pool the manifest is extracted from.
- [`docs/dev/jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md)
  — the version-policy guide; the version-boundary map lives alongside it.
- [`signals-backlog.md`](../signals-backlog.md) — upstream version watching; the
  trigger and acknowledgment ledger for this pipeline.
