---
name: new-api-version
description: Guided workflow for standing up a NEW Jellyfin apiVersion tier (V3, V4, …) in JellyRock when an upstream release restructures the API enough to need a new `if m.getApiVersion() >= N` dispatch level. Wraps the "Adding Support for New Server Versions" recipe in docs/dev/jellyfin-server-versioning.md and walks every surface that must move together — the boundary map (YAML), its BrightScript twin `resolveApiVersion()`, the `sdkVN.bs` endpoints, the dispatch branches, the device profile, the manifest tier-clamp, and the validators — stopping at each step so the tier split can't land half-built. Use when proactive RC/master triage (via `/server-upgrade <rc-or-unstable>`) shows a breaking API shift that a per-method `>= N` branch must cover. NOT for routine endpoint additions inside an existing tier (those use the existing `>= 2` shape directly).
model: sonnet
effort: low
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash(npm run docs:api-manifest:*), Bash(npm run lint:apiversion-consistency:*), Bash(npm run lint:endpoint-availability:*), Bash(npm run lint:docs:*), Bash(npm run test:scripts:*), Bash(grep:*), Bash(rg:*), Bash(date:*)
---

# /new-api-version — stand up a new apiVersion tier (V3, V4, …)

JellyRock dispatches Jellyfin endpoints by integer **apiVersion tier** with `if m.getApiVersion() >= N` (`V1` = server 10.7–10.8, `V2` = 10.9+). When an upstream release restructures the API enough that a per-method branch needs a *new* level, you stand up the next tier. This skill **wraps the canonical recipe** — [`docs/dev/jellyfin-server-versioning.md`](../../../docs/dev/jellyfin-server-versioning.md) → "Adding Support for New Server Versions" — and walks each surface in order so a contributor can't land a half-built tier. Read that section first; the steps below sequence it and add the verify gates.

The load-bearing invariant: **three twins must agree.** [`docs/dev/jellyfin-version-boundaries.yml`](../../../docs/dev/jellyfin-version-boundaries.yml) (what the server-upgrade *tooling* reads), [`source/utils/misc.bs`](../../../source/utils/misc.bs) `resolveApiVersion()` (what the *app* runs to pick the tier), and the `sdkVN.bs` filename convention the manifest generator keys off. If they disagree, the dispatch is dead code or the tooling's tier-relevance analysis lies. Every step keeps them in lockstep.

## Step 0 — Confirm a new tier is actually warranted

A new tier is justified only when an endpoint JellyRock uses **changes shape** in a way a single new `>= N` branch must guard (moved path, restructured request/response, a param that moved) — the V1→V2 kind of shift, not a one-off field tweak. Additive fields are handled with `isValid()`/`??` in place; a routine new endpoint uses the existing top tier's `>= 2` shape directly (see [`source/api/CLAUDE.md`](../../../source/api/CLAUDE.md)) — **stop and use that** if that's all this is. Ask the user to name the concrete breaking change(s) and the server version `X` that introduces them (usually surfaced by `/server-upgrade <rc-or-unstable>`'s proactive triage). Do not proceed without `X`.

## Step 1 — Boundary map + its BrightScript twin (do these together)

These are the two halves of the same fact; they ship in one change set.

1. **Boundary map** — in [`docs/dev/jellyfin-version-boundaries.yml`](../../../docs/dev/jellyfin-version-boundaries.yml): the next tier `N` = (highest existing key) + 1. Flip the currently-`active` tier to `frozen` with a concrete `maxServer` (last release before `X`); add tier `N` as `active`, `minServer: X`, `maxServer: null`. Propose the diff and **wait for confirmation** (two systems read this file). The loader enforces exactly one `active` tier and it must be the unbounded one, so flip-and-add is atomic. Example V3 at `10.12.0`:

   ```yaml
   tiers:
     2: { minServer: '10.9.0', maxServer: '10.11.10', status: frozen }   # ← was active/null
     3: { minServer: '10.12.0', maxServer: null, status: active }        # ← new
   ```

2. **`resolveApiVersion()` twin** — in [`source/utils/misc.bs`](../../../source/utils/misc.bs), add the new tier's check **above** the existing ones (highest version wins), mirroring the YAML `minServer`, and update the header comment:

   ```brightscript
   if versionChecker(serverVersion, "10.12.0")   ' ← V3 min, matches boundaries.yml tier 3
     return 3
   end if
   if versionChecker(serverVersion, "10.9.0")
     return 2
   end if
   return 1
   ```

## Step 2 — Add the `sdkVN.bs` user-endpoint shim + dispatch branches

The user-scoped endpoints that moved are implemented in version-named shim files ([`source/api/sdkV1.bs`](../../../source/api/sdkV1.bs), [`source/api/sdkV2.bs`](../../../source/api/sdkV2.bs)) — the manifest generator's tier-clamp keys off these filenames (Step 4), so the convention is load-bearing, not cosmetic.

1. Create `source/api/sdkV<N>.bs` with the new endpoint shapes (model it on `sdkV2.bs`).
2. Add the `if m.getApiVersion() >= N` dispatch branches in [`source/api/ApiClient.bs`](../../../source/api/ApiClient.bs) — keep the existing `>= 2` shape, put the new `>= N` branch **ahead** of it. `grep -rn "getApiVersion" source/` surfaces every dispatch site (`ApiClient.bs`, `sdk.bs`, `items.bs`, `deviceCapabilities.bs`) so none is missed.
3. **The endpoint-specific request/response logic is yours to fill from the diff — this skill scaffolds the file + branches and points at the sites; it does not invent the new API shape.** Leave a clear `TODO(V<N>)` marker on any branch you stub before the spec finalizes (RCs can still change — that's why `/server-upgrade` re-diffs).

## Step 3 — Device profile branch

If the new tier changes the device-profile shape, add a `V<N>` branch in [`source/utils/deviceCapabilities.bs`](../../../source/utils/deviceCapabilities.bs) (the `V1`/`V2` selectors are already internal; `V<N>` follows the same `getApiVersionFromGlobal()`-keyed pattern). Skip if the profile is unchanged.

## Step 4 — Manifest tier-clamp + regenerate

The API-usage manifest ([`docs/architecture/api-usage-manifest.json`](../../../docs/architecture/api-usage-manifest.json)) is AST-generated and drift-gated. Its cross-function clamp ([`scripts/generate/api-usage-manifest.js`](../../../scripts/generate/api-usage-manifest.js), ~line 467) pins endpoints by shim filename. Add the new tier and clamp the now-frozen middle tier:

- `sdkV<N>.bs` → `minApiVersion = Math.max(min, N)`
- the previously-active shim (e.g. `sdkV2.bs`) → gains a `maxApiVersion = Math.min(max ?? N-1, N-1)` clamp (it's now the frozen middle tier)

Then regenerate + commit:

```bash
npm run docs:api-manifest    # re-extracts; the >= N branches from Step 2 are picked up automatically
```

## Step 5 — Endpoint-availability ledger (if relevant)

If the new tier introduces endpoints reached on older servers via a guard/sibling, register them in [`docs/dev/jellyfin-endpoint-availability.yml`](../../../docs/dev/jellyfin-endpoint-availability.yml) (see its header for the schema) so the floor-coverage check doesn't re-flag them every release, then validate:

```bash
npm run lint:endpoint-availability   # checks each entry's guard/sibling claim against current code
```

## Step 6 — Verify statically (no Roku hardware needed)

Standing up a tier is verified entirely by **static analysis of the `.bs` sources** — the same kind of AST scan CI already runs over the API files — so you never have to sideload to a device to confirm the wiring:

1. **Twin-consistency gate (the load-bearing check)** — `npm run lint:apiversion-consistency` parses `resolveApiVersion()` from `misc.bs` with the BrighterScript AST and asserts its `versionChecker(serverVersion, "X.Y.Z") → N` guards exactly match the boundary map (right `minServer` per tier, right fallback, highest-tier-first order). If Step 1's two halves drifted, this fails with the specific mismatch. **This is the check that replaces the old hardware unit test.**
2. **Dispatch wiring** — `npm run docs:api-manifest` re-extracts the manifest from the AST; the `>= N` branches from Step 2 + the `sdkV<N>.bs` filename now show the new tier range on the affected endpoints. A missing branch shows up as drift in the committed manifest (CI-gated).
3. **Boundary validity** — `npm run test:scripts` runs `version-boundaries.test.js` (loads + validates the real committed map; a malformed Step 1 edit fails here), `apiversion-consistency.test.js`, and the manifest drift gate. `npm run lint:docs` checks the doc references.
4. **Optional, not required** — extend [`tests/source/unit/utils/resolveApiVersion.spec.bs`](../../../tests/source/unit/utils/resolveApiVersion.spec.bs) with a `>= X` → `N` case if you want belt-and-suspenders runtime coverage, but the static gate above already proves the twin is correct offline. Don't block the tier on a device being reachable.

## Step 6b — Docs + fingerprint

1. **Prose twins** — update [`docs/dev/jellyfin-server-versioning.md`](../../../docs/dev/jellyfin-server-versioning.md) (the tier tables + "Version Detection" steps) and [`source/api/CLAUDE.md`](../../../source/api/CLAUDE.md)'s "10.7–10.8 (V1) / 10.9+ (V2)" line to include the new tier. Also [`docs/user/jellyfin-server-feature-matrix.md`](../../../docs/user/jellyfin-server-feature-matrix.md) if user-facing support changed.
2. **Fingerprint** — no new fingerprint for the RC/master that prompted this; the next *acknowledged stable* release commits its fingerprint via the normal `/server-upgrade` flow. The floor (`10.7.0`) never moves, so the backward/symmetry checks need no change.

## Step 7 — Capture the decision + close out

Standing up a tier is decision-shaped (it closes off cramming the new shape into the existing tier). Offer to invoke `/log decision` with a slug like `apiversion-v<N>-split` capturing why `X` warranted a new tier. Summarize the surfaces touched and flag any `TODO(V<N>)` stubs left for when the spec finalizes. If this came from a `/server-upgrade <rc>` triage, remind the user to re-run that against the FINAL stable when it ships (the RC can still change).

## When NOT to use

- A routine new endpoint or additive field on a current-tier server → use the existing `if m.getApiVersion() >= 2` shape directly; no new tier.
- A registry-schema change for a user setting → that's [`/new-migration`](../new-migration/SKILL.md).
- You just want to know what an RC/master build changes → [`/server-upgrade <rc-or-unstable>`](../server-upgrade/SKILL.md) (this skill is the *follow-up* when that triage says a new tier is warranted).

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/new-api-version/SKILL.md and follow Steps 0-7 to stand up apiVersion tier N for server version X=<version>, wrapping the jellyfin-server-versioning.md recipe; keep jellyfin-version-boundaries.yml, resolveApiVersion(), and the sdkVN.bs/manifest-clamp convention in lockstep; scaffold the shim + dispatch branches and stop at each validator` in the Task prompt.