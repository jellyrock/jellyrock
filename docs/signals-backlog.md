---
last-updated: 2026-09-09
---

# Signals backlog

External version-watching journal. Tracks upstreams JellyRock depends on or cares about; when an upstream moves, the `action_when_moves` field tells us what to do.

Distinct from [tech-debt.md](architecture/tech-debt.md) (internal debt), [`docs/adr/`](adr/README.md) (architectural decisions), and [decisions.md](decisions.md) (sub-ADR notes). Three rows, all auto-maintained by the [`/catchup` aggregator](../scripts/catchup-state.js): `latest_upstream` and `last_checked` are fetched + written back on each `/catchup`. The `current` field stays as static prose describing JellyRock's posture toward the upstream (e.g. "minimum supported is X.Y") — it does NOT track upstream movement. The `latest_acknowledged` field is the close-loop counterpart to `latest_upstream`: bump it via `/done <slug>` when you've reviewed the new upstream version. A row goes "stale" (banner-worthy) when `latest_upstream != latest_acknowledged` AND status is `watching` — i.e., upstream moved past the last version you acknowledged. Use `/log signal <slug>` only to add new rows; existing rows update themselves.

npm dependencies (`brighterscript`, `rooibos-roku`, `roku-log`) are NOT tracked here — Renovate covers those, and the journal would just duplicate the dep-bump PR's signal.

## Schema

Each row is an `H3` block:

```markdown
### <slug>: <one-line label>

- **watching**: <what we're watching upstream>
- **current**: <static prose describing JellyRock's posture toward this upstream>
- **latest_upstream**: <fresh upstream version, auto-fetched>
- **latest_acknowledged**: <last upstream version reviewed via /done; seed = latest_upstream at row creation>
- **last_checked**: YYYY-MM-DD
- **action_when_moves**: <what triggers a JellyRock change>
- **status**: watching | action_pending | completed
```

Schema is enforced by `npm run lint:docs` (`signals-schema-invalid` category). A row is "stale" — and surfaces as a banner in `/catchup` — when `latest_upstream != latest_acknowledged` AND `status == watching`. Run `/done <slug>` to acknowledge the new upstream (sets `latest_acknowledged = latest_upstream`).

**Exception — `jellyfin-server-stable`:** its staleness is **not** the version-string compare. The [server-upgrade tracker](../.github/workflows/server-upgrade-tracker.yml) auto-closes the per-release digest for a mechanically-clean release **without** bumping `latest_acknowledged` (CI never writes the journals), so the string compare would false-fire forever after every clean release. For this row `/catchup` treats it as stale only when an **open** `server-upgrade:tracker` digest exists (a candidate-bearing release that needs `/server-upgrade` triage); clean releases close their own digest and never nag. `latest_acknowledged` here is the **diff anchor / last deep review** and advances only on a real `/server-upgrade` triage — it intentionally trails the newest clean release. See [server-upgrade-automation.md](architecture/server-upgrade-automation.md#decisions).

## Watching

### jellyfin-server-stable: Jellyfin server stable channel

- **watching**: latest stable release on api.jellyfin.org/openapi/stable/
- **current**: 10.7.0 minimum supported; latest tested per [user/jellyfin-server-feature-matrix.md](user/jellyfin-server-feature-matrix.md)
- **latest_upstream**: 10.11.11
- **latest_acknowledged**: 10.11.8
- **last_checked**: 2026-06-07
- **action_when_moves**: run [`/server-upgrade`](../.claude/skills/server-upgrade/SKILL.md) to triage the release (mechanical report → agent investigation → human-gated issue filing); the proactive tracker issue maintained by [.github/workflows/server-upgrade-tracker.yml](../.github/workflows/server-upgrade-tracker.yml) nudges this with candidate counts. If a new minor introduces a breaking endpoint shape, the triage adds a v3 dispatcher per [dev/jellyfin-server-versioning.md](dev/jellyfin-server-versioning.md)'s "Adding Support for New Server Versions" section
- **status**: watching

### jellyfin-server-rc: Jellyfin server release candidate channel

- **watching**: pre-release builds on api.jellyfin.org/openapi/stable/ whose base version is greater than the latest stable (sparse — only present while a new release is in flight)
- **current**: n/a (we don't pre-test against RCs by default)
- **latest_upstream**: (no RC in flight)
- **latest_acknowledged**: (no RC in flight)
- **last_checked**: 2026-06-07
- **action_when_moves**: spin up the RC against a test library; file findings as GitHub issues if breakage is detected before the stable release
- **status**: watching

### roku-os: Roku OS firmware

- **watching**: rokudev/dev-doc release notes — the first `## Roku OS X.Y` heading wins (file order is newest-first)
- **current**: not pinned in source; we run on whatever Roku OS the device ships — review when the latest jumps a major
- **latest_upstream**: 15.2
- **latest_acknowledged**: 15.2
- **last_checked**: 2026-06-07
- **action_when_moves**: review video pipeline + scene graph capability changes; update [architecture/playback.md](architecture/playback.md) if a codec / DRM / OSD change affects JellyRock
- **status**: watching

### sgrouter-can-go-back: sgRouter history-depth / `canGoBack()` API

- **watching**: @rokucommunity/sgrouter releases for a public history-depth or `canGoBack()` method (none in 0.1.3; pinned)
- **current**: `sgrouter.goBack()` returns a bare `false` for THREE different reasons — a navigation is in flight, the history is at its root, or the previous entry's `nodeId` resolves to no view — and `JRScene`'s back arbiter must tell them apart to decide between swallowing the key and raising the Exit dialog. It infers: `isRouterNavigating()` reads `routerState.type` directly for the first, and treats what remains as "at root". A public `canGoBack()` / history-depth API would let it ask instead of infer (`m.__router_historyStack` is private, and the vendored copy is regenerated by ropm, so we deliberately did not patch it). **Narrowed by [ADR 0029](adr/0029-destroy-routed-screens-on-pop.md) (2026-08-15):** the stale-`nodeId` case this row was originally filed against is created only by the `keepAlive` resume branch that reassigns `view.id` (`Router.brs` `addViewToStack`), and no route sets `keepAlive` any more — so that branch is unreachable and the router's `previousNodeIds` fallback is dead code in our configuration. No other path producing an unresolvable history entry was found. The inference therefore looks sound rather than merely lucky, which makes the remaining value of `canGoBack()` clarity rather than correctness — close this row if nothing exercises the third case
- **latest_upstream**: 0.1.3
- **latest_acknowledged**: 0.1.3
- **last_checked**: 2026-06-23
- **action_when_moves**: if an official history-depth / `canGoBack()` API lands, bump the pin and gate the `JRScene` Exit confirmation on it to close the stale `nodeId` edge cleanly (replaces the navigation-in-progress mirror). Consider contributing the API upstream as a PR
- **status**: watching

### bsfmt-multiline-indent-regression: `brighterscript-formatter` multi-line-AA indent regression

- **watching**: `brighterscript-formatter` releases after 1.7.28 that fix the [#140](https://github.com/rokucommunity/brighterscript-formatter/pull/140) "Multi-line Function parameters" indent regression
- **current**: pinned to 1.7.27. 1.7.28 over-indents every statement after a multi-line associative-array call argument (e.g. `fn("...", {\n ... \n})`) — the indent level is never popped, so the over-indent cascades past `end sub`/`end function` into the next top-level declaration. Cosmetic only (BrightScript blocks are keyword-delimited, so it still compiles) but `bsfmt --check` enforces the corruption. Renovate re-proposes 1.7.28 as a patch (no version hold in `renovate.json` by choice); close that PR without merging until a fixed release ships
- **latest_upstream**: 1.7.28
- **latest_acknowledged**: 1.7.28
- **last_checked**: 2026-06-28
- **action_when_moves**: when a release after 1.7.28 ships, format the multi-line-AA reproduction snippet under it (`npx bsfmt --write` on a `fn("x", { k: v })`-across-lines snippet followed by a top-level function); if indentation is correct, merge the Renovate bump and drop the 1.7.27 pin in `package.json`. Link the upstream issue once filed
- **status**: watching

### jellyrock-plugin-server-abi: companion plugin's Jellyfin server ABI pin (#667)

- **watching**: new Jellyfin **server** lines (esp. the **12.0 RC**) against the out-of-tree companion plugin `jellyfin-plugin-jellyrock`, whose `Jellyfin.Controller` / `Jellyfin.Model` package refs + `targetAbi` track the server line, not a stable SDK
- **current**: pinned to 10.11.11. The plugin's session-controller + long-poll endpoint use `ISessionManager` / `SessionInfo` / `ISessionController` surfaces that can shift between server minors (e.g. `EnsureController`, `SessionInfo.SupportsRemoteControl`); the plugin's own CI matrix is the primary breakage signal, this row is the cross-repo reminder
- **latest_upstream**: 10.11.11
- **latest_acknowledged**: 10.11.11
- **last_checked**: 2026-07-13
- **action_when_moves**: re-pin the plugin's `Jellyfin.Controller`/`Jellyfin.Model` + `build.yaml` `targetAbi` to the new line, rebuild in the SDK container, and re-verify the cast and closed app liveness gate on a test server (12.0 RC restructures the API — check `ISessionController` / `SessionInfo` shapes)
- **status**: watching

### rta-odc-connect-hang: `roku-test-automation` ODC socket setup never settles, and orphans its own rejection

- **watching**: `roku-test-automation` releases after 2.2.2 (including the `next` 3.0.0-alpha line) that fix EITHER half of `setupClientSocket` — settling its promise when the post-connect handshake fails, and attaching a handler to the promise its own `.finally()` returns
- **current**: pinned to 2.2.2. In `client/dist/OnDeviceComponent.js`, `setupClientSocket` resolves its cached `clientSocketPromise` from the socket's `connect` handler only after a `setSettings` handshake succeeds; the rejection arm of that `.then()` calls `debugLog` and **never settles the promise**. So a handshake that fails leaves every later ODC call awaiting a dead promise, and no timeout can fire — the per-request `promiseTimeout` wraps the request, not the socket setup, so no `defaultTimeout` / `timeoutMultiplier` value would help. Still present on upstream HEAD (verified 2026-09-04; the 3.0.0-alpha refactor to `RokuDeploySocket` kept the same handler). Observed once on `.178`: SIGINT mid-suite left `restoreRegistry` hung 8+ minutes on an ESTABLISHED socket to port 9000 with zero bytes queued and no timeout, after which the device refused new ODC connections and its debug console reported "already in use". The code defect is certain; that it is what hung that process is consistent with the evidence but not proven. Recovery is `kill` + a re-deploy — `npm run test:rta` does it automatically, since `snapshotRegistry()` restores from the stranded snapshot first. **The hang is now bounded on our side** (2026-09-06): reproduced deterministically with no device — a socket that accepts and never answers leaves `readRegistry()` still pending at 45 s — and `REGISTRY_READ_TIMEOUT_MS` in [`tests/rta/lib/registry.js`](../tests/rta/lib/registry.js) now caps it at 60 s with a message naming this row. **A SECOND defect in the same function, found 2026-09-06 and the reason this row was widened rather than closed:** line 1080 attaches a `.finally()` to clear the cached promise and never handles the promise `.finally()` RETURNS, so ANY connect rejection goes unhandled — and an unhandled rejection is a hard `exit 1`. Measured against the real client: a caller that awaits, catches and carries on still dies. Proven by control — patching `.catch(() => {})` onto that one derived promise removes the crash and changes nothing else. It **cannot be suppressed from outside the library** (`setupClientSocket` returns the ORIGINAL promise, not the derived one), which is why the in-repo answer is `ensureOdcReachable` in [`tests/rta/lib/driver.js`](../tests/rta/lib/driver.js) — not making the call — rather than a `.catch()` anywhere
- **latest_upstream**: 2.2.2
- **latest_acknowledged**: 2.2.2
- **last_checked**: 2026-09-06
- **action_when_moves**: read `setupClientSocket`'s `connect` handler in the new release — if the rejection arm now rejects (or the setup is wrapped in a timeout), take the bump and drop the recovery note from [`docs/dev/rta-tests.md`](dev/rta-tests.md). ALSO check line 1080's `.finally()` — the two halves are independent and either may land alone, so a release that fixes one leaves this row `watching` for the other. If the orphan is fixed, `ensureOdcReachable`'s reason for existing narrows but does not vanish (it still turns a 10 s refusal into a 1 ms one and names the cause). The watchdog this field used to defer to a second occurrence was built on 2026-09-06 instead, on the strength of a deterministic reproduction — see `current`
- **status**: watching

### jellyfin-demo-single-mediasource: demo server has no movie with two video sources

- **watching**: `demo.jellyfin.org/stable` regaining any movie that reports `numVideoSources >= 2` — or JellyRock standing up its own demo server, which is the plan (owner, 2026-09-07) and would let the fixture be seeded rather than waited on
- **current**: `tests/rta/specs/dialogs.spec.js`'s `osd video-source button opens the list dialog; back cancels it` skips at runtime, because `components/video/OSD.bs:204` correctly removes `#showVideoSourceMenu` when `numVideoSources < 2`. Jellyfin **`v12`** landed on the demo server and dropped Dracula's color version, so the hero reports one `MediaSource` and **0 of its 11 movies** carry more than one (checked 2026-09-08). The skip is therefore not conditional — the test **cannot run against the only fixture the suite has**, and has not run since `v12` landed. That is coverage which reads as present in the suite listing and is inert, which is the same "green for a reason nobody chose" class the rest of this harness work is about; it is tracked here rather than as a followup because the trigger is an EXTERNAL fixture change nobody here controls. The four `#showVideoInfoPopup` callers beside it still throw on a missing button — they have no content precondition, so a missing button there is a real defect
- **latest_upstream**: Jellyfin `v12` on demo.jellyfin.org/stable — 0 of 11 movies with >1 `MediaSource`
- **latest_acknowledged**: Jellyfin `v12` on demo.jellyfin.org/stable — 0 of 11 movies with >1 `MediaSource`
- **last_checked**: 2026-09-09
- **action_when_moves**: re-point the test at whichever item reports two sources and DELETE the `testCtx.skip` — a skip that outlives its cause is worse than a red, because nothing reports it. If the fixture moves to a `JellyRock`-owned demo server instead, seed one item with two video sources and delete the skip the same way. Either move also invalidates the run-count figures in the RTA timing followup in `docs/progress.md`, which counts this skip
- **status**: watching
