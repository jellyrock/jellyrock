---
name: new-api-version
description: Guided workflow for standing up a new Jellyfin apiVersion tier (V3, V4, …) in JellyRock when an upstream release restructures the API enough to need a new `if m.getApiVersion() >= N` dispatch level. Wraps the "Add an API tier" recipe in docs/dev/jellyfin-server-versioning.md and walks every surface that must move together (the boundary map in YAML, its BrightScript twin `resolveApiVersion()`, the `sdkVN.bs` endpoints, the dispatch branches, the device profile, the manifest tier clamp, and the validators), stopping at each step so the tier split cannot land half-built. Use when proactive RC/master triage (via `/server-upgrade <rc-or-unstable>`) shows a breaking API shift that a per-method `>= N` branch must cover. Not for routine endpoint additions inside an existing tier (those use the existing `>= 2` shape directly).
model: sonnet
effort: low
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(npm run docs:api-manifest:*), Bash(npm run lint:apiversion-consistency:*), Bash(npm run lint:endpoint-availability:*), Bash(npm run lint:docs:*), Bash(npm run test:scripts:*), Bash(grep:*), Bash(rg:*), Bash(date:*)
---

# /new-api-version: stand up a new `apiVersion` tier (`V3`, `V4`, …)

JellyRock dispatches Jellyfin endpoints by an integer **`apiVersion` tier**, with `if m.getApiVersion() >= N` (`V1` is server 10.7 to 10.8, `V2` is 10.9 and later). When an upstream release restructures the API enough that a branch needs a *new* level, you stand up the next tier. This skill wraps the recipe in [`docs/dev/jellyfin-server-versioning.md`](../../../docs/dev/jellyfin-server-versioning.md#add-an-api-tier) ("Add an API tier") and walks each surface in order, so a contributor cannot land a half-built tier. Read that section first; the steps below put it in order and add the checks. Stop after each step, show the user its diff, and wait for their go-ahead.

The rule everything rests on: **three twins must agree.** [`docs/dev/jellyfin-version-boundaries.yml`](../../../docs/dev/jellyfin-version-boundaries.yml) (what the server-upgrade *tooling* reads), [`source/utils/misc.bs`](../../../source/utils/misc.bs) `resolveApiVersion()` (what the *app* runs to pick the tier), and the `sdkVN.bs` filename convention the manifest generator keys off. If they disagree, the dispatch is dead code or the tooling's tier analysis is wrong. Every step keeps them in step.

## Step 0: Confirm a new tier is warranted

A new tier is justified only when an endpoint JellyRock uses **changes shape** in a way a single new `>= N` branch must guard (a moved path, a restructured request or response, a moved parameter): the kind of shift V1 to V2 was, not a one-off field change. Additive fields are handled with `isValid()`/`??` in place; a routine new endpoint uses the existing top tier's `>= 2` shape directly (see [`source/api/CLAUDE.md`](../../../source/api/CLAUDE.md)). If that's all this is, **stop and use that**. Ask the user to name the concrete breaking change(s) and the server version `X` that introduces them (usually surfaced by `/server-upgrade <rc-or-unstable>`'s proactive triage). Do not proceed without `X`.

## Step 1: The boundary map and its BrightScript twin, together

These are the two halves of the same fact; they ship in one change set.

1. **Boundary map:** in [`docs/dev/jellyfin-version-boundaries.yml`](../../../docs/dev/jellyfin-version-boundaries.yml): the next tier `N` = (highest existing key) + 1. Flip the currently `active` tier to `frozen` with a concrete `maxServer`: the last release before `X`, as a full `MAJOR.MINOR.PATCH` version (a two-part `12.0` drops every `12.0.x` patch out of its tier, because the comparison counts `12.0.3` as above `12.0`); add tier `N` as `active`, `minServer: X`, `maxServer: null`. Propose the diff and **wait for confirmation** (two systems read this file). The loader enforces exactly one `active` tier and it must be the unbounded one, so flip-and-add is atomic. Example, tier 3 from `12.1.0`, with `12.0.4` standing in for the last 12.0 release:

   ```yaml
   tiers:
     2: { minServer: '10.9.0', maxServer: '12.0.4', status: frozen }   # was active, maxServer null
     3: { minServer: '12.1.0', maxServer: null, status: active }       # new
   ```

2. **`resolveApiVersion()` twin:** in [`source/utils/misc.bs`](../../../source/utils/misc.bs), add the new tier's check **above** the existing ones (highest version wins), mirroring the YAML `minServer`, and update the header comment:

   ```brightscript
   if versionChecker(serverVersion, "12.1.0")   ' V3 min, matches boundaries.yml tier 3
     return 3
   end if
   if versionChecker(serverVersion, "10.9.0")
     return 2
   end if
   return 1
   ```

## Step 2: Add the dispatch branches, and a `sdkVN.bs` shim only if one is needed

Most tiered endpoints are written directly in [`source/api/ApiClient.bs`](../../../source/api/ApiClient.bs), each branching on `m.getApiVersion()`. The version-named shim files ([`source/api/sdkV1.bs`](../../../source/api/sdkV1.bs), [`source/api/sdkV2.bs`](../../../source/api/sdkV2.bs)) hold only `users.GetImageURL()`. The manifest generator's tier clamp keys off their file names (Step 4).

1. Create `source/api/sdkV<N>.bs` (modeled on `sdkV2.bs`) only if a shim-backed call such as the user image URL changes. Otherwise add no shim.
2. Add the `if m.getApiVersion() >= N` dispatch branches in [`source/api/ApiClient.bs`](../../../source/api/ApiClient.bs): keep the existing `>= 2` shape, and put the new `>= N` branch **ahead** of it. `git grep -n getApiVersion -- source components` lists every dispatch site, so none is missed; existing `>= 2` branches keep serving the new tier until you add one. End each new branch in a `return`: the manifest extractor narrows the older branch's range only after a newer branch that returns, so a branch that falls through gives the older one the wrong range.
3. **You fill in each endpoint's request and response from the diff: this skill scaffolds the file and branches and points at the sites; it does not invent the new API shape.** Leave a clear `TODO(V<N>)` marker on any branch you stub before the spec finalizes (a release candidate can still change, which is why `/server-upgrade` compares again).

## Step 3: The device profile branch

If the new tier changes the device profile's shape, add a tier `N` branch to `getDeviceProfile()` in [`source/utils/deviceCapabilities.bs`](../../../source/utils/deviceCapabilities.bs), keyed on `getApiVersionFromGlobal()` like the V1 and V2 branches. Skip this step if the profile is unchanged.

## Step 4: The manifest tier clamp, then regenerate

The API-usage manifest ([`docs/architecture/api-usage-manifest.json`](../../../docs/architecture/api-usage-manifest.json)) is generated from the AST, and CI fails on drift. Its cross-function dispatch clamp, in [`scripts/generate/api-usage-manifest.js`](../../../scripts/generate/api-usage-manifest.js) beside the `sdkV1.bs` and `sdkV2.bs` clamps, pins endpoints by shim file name. Only if Step 2 added a `sdkV<N>.bs`, add the new tier there and clamp the now-frozen middle tier:

- `sdkV<N>.bs` gets `minApiVersion = Math.max(min, N)`
- the previously active shim (`sdkV2.bs`, for example) gains a `maxApiVersion = Math.min(max ?? N-1, N-1)` clamp, since it is now the frozen middle tier

Without a new shim, add no clamp: capping `sdkV2.bs` would mark its calls as not served on the new tier, though the `>= 2` branch still serves them. The `>= N` branches from Step 2 set the ranges on their own.

Then regenerate it and commit:

```bash
npm run docs:api-manifest    # re-extracts; the >= N branches from Step 2 are picked up automatically
```

## Step 5: The endpoint-availability ledger, if relevant

If the new tier introduces endpoints reached on older servers via a guard/sibling, register them in [`docs/dev/jellyfin-endpoint-availability.yml`](../../../docs/dev/jellyfin-endpoint-availability.yml) (see its header for the schema) so the floor-coverage check doesn't re-flag them every release, then validate:

```bash
npm run lint:endpoint-availability   # checks each entry's guard/sibling claim against current code
```

## Step 6: Verify statically, with no Roku

Standing up a tier is verified entirely by **static analysis of the `.bs` sources** (the same kind of AST scan CI already runs over the API files), so you never install on a device to confirm the wiring:

1. **The twin-consistency gate, the check everything rests on:** `npm run lint:apiversion-consistency` parses `resolveApiVersion()` from `misc.bs` with the BrighterScript AST and asserts that its `versionChecker(serverVersion, "X.Y.Z")` guards, each returning a tier, exactly match the boundary map (right `minServer` per tier, right fallback, highest-tier-first order). If Step 1's two halves drifted, this fails with the specific mismatch.
2. **Dispatch wiring:** `npm run docs:api-manifest` re-extracts the manifest from the AST; the `>= N` branches from Step 2 and the `sdkV<N>.bs` file name now show the new tier range on the affected endpoints. A missing branch shows up as drift in the committed manifest (CI-gated).
3. **Boundary validity:** `npm run test:scripts` runs `version-boundaries.test.js` (loads and validates the real committed map; a malformed Step 1 edit fails here), `apiversion-consistency.test.js`, and the manifest drift gate. `npm run lint:docs` checks the doc references.
4. **Optional, not required:** extend [`tests/source/unit/utils/resolveApiVersion.spec.bs`](../../../tests/source/unit/utils/resolveApiVersion.spec.bs) with a case for `X` returning `N` if you want runtime coverage too, but the static gate above already proves the twin is correct offline. Don't block the tier on a device being reachable.

## Step 7: Docs and fingerprint

1. **Prose twins:** add the new tier to [`docs/dev/jellyfin-server-versioning.md`](../../../docs/dev/jellyfin-server-versioning.md) ("The API tier" table) and to the V1 and V2 line in [`source/api/CLAUDE.md`](../../../source/api/CLAUDE.md). Also [`docs/user/jellyfin-server-feature-matrix.md`](../../../docs/user/jellyfin-server-feature-matrix.md) if user-facing support changed. Other docs and comments state the two-tier set too (`server-upgrade-automation.md`, `api-usage-manifest.md`, `api.md`, the comments in the boundary map and the endpoint ledger): find them with `git grep -n -E "V1 and V2|two tiers|2-tier" -- docs source scripts`. An architecture doc you change gets its `last-reviewed` bumped after you re-read it.
2. **The unset default:** `getApiVersionFromGlobal()` returns 2 when the tier is unset or 0. Ask the user whether that default should move to the new tier.
3. **Fingerprint:** no new fingerprint for the RC/master that prompted this; the next *acknowledged stable* release commits its fingerprint via the normal `/server-upgrade` flow. The floor (`10.7.0`) never moves, so the backward/symmetry checks need no change.

## Step 8: Record the decision and close out

Standing up a tier is decision-shaped (it closes off cramming the new shape into the existing tier). Offer to invoke `/log decision` with a slug like `apiversion-v<N>-split` capturing why `X` warranted a new tier. Summarize the surfaces touched and flag any `TODO(V<N>)` stubs left for when the spec finalizes. If this came from a `/server-upgrade <rc>` triage, remind the user to re-run that against the FINAL stable when it ships (the RC can still change).

## When NOT to use

- A routine new endpoint or an added field on a current-tier server: use the existing `if m.getApiVersion() >= 2` shape directly; no new tier.
- A registry-schema change for a user setting: use [`/new-migration`](../new-migration/SKILL.md).
- You want to know what a release candidate or master build changes: use [`/server-upgrade <rc-or-unstable>`](../server-upgrade/SKILL.md) (this skill is the *follow-up* when that triage says a new tier is warranted).

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/new-api-version/SKILL.md and follow Steps 0-8 to stand up apiVersion tier N for server version X=<version>, wrapping the jellyfin-server-versioning.md recipe; keep jellyfin-version-boundaries.yml, resolveApiVersion() and the sdkVN.bs manifest clamp in step; scaffold the shim and dispatch branches and stop at each validator` in the Agent prompt.