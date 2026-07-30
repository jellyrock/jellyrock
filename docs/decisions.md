# Decision notes (sub-ADR)

Lightweight notes for **sub-architectural** decisions — narrow, single-component,
or implementation-level choices that still carry a non-obvious *why* worth
keeping, but don't rise to an architectural / hard-to-reverse / cross-component
**Architecture Decision Record**. Those live as numbered, immutable ADRs in
[`docs/adr/`](adr/) — see [`docs/adr/README.md`](adr/README.md) for the index.

## When to add a note here

- **Has a non-obvious rationale** that wouldn't be apparent from the code alone.
- **Closes off alternatives** that someone else might reasonably re-propose.
- **Has a constraint or trade-off** worth re-evaluating later.

…but is **local in blast radius** (one component / file / tooling surface). If a
decision is architectural, hard-to-reverse, or cross-component, it's an **ADR**,
not a note. If every decision became an ADR, no decision would be architectural.

Don't add an entry for routine bug fixes, obvious choices, or time-bound state.

## Format

Each note is its own `H2` section: `## decision-id: <stable-kebab-slug>`, then
`**date**` / `**status**` (`accepted` | `superseded` | `withdrawn`), optional
`**supersedes**` / `**superseded-by**` / `**related-files**`, then 1-2 short
paragraphs.

**Notes are append-only in their prose** — a superseded note gets a *new* note
that references it; you never rewrite the old note's body, and you never insert
mid-file. The one exception is the **supersede ritual**, which is a three-part
edit (the same convention [`docs/adr/README.md`](adr/README.md) states for ADRs,
where a later ADR "supersedes — and flips the status of — the one it supersedes"):

1. the new note declares `**supersedes**: <old-slug>`;
2. the old note's `**status**` flips `accepted` → `superseded`;
3. the old note gains `**superseded-by**: <new-slug>`.

Miss any part and the chain lies — a note still reading `accepted` while a
successor exists is worse than no record at all, since `/catchup` and every
future reader treat these journals as authoritative. `npm run lint:docs`
validates the chain (status enum, both pointers resolve, symmetry, no
self-supersede), so a half-applied ritual fails at push time rather than
silently. Use [`/log decision`](../.claude/skills/log/SKILL.md), which applies
all three parts; raw markdown edits to this file are not the sanctioned path.

## decision-id: signals-backlog-scope

**date**: 2026-05-08
**status**: accepted
**related-files**: docs/signals-backlog.md, scripts/catchup-state.js, scripts/lib/signals-fetch.cjs

`docs/signals-backlog.md` tracks external platform and upstream version signals (Jellyfin server, Roku OS) but explicitly excludes npm package dependencies. The exclusion holds because Renovate already tracks and proposes bumps for npm packages (`brighterscript`, `rooibos`, `roku-log` and the rest) — two systems tracking the same thing produces noise, not signal. The signal rows that were deleted (`brighterscript`, `rooibos`, `roku-log`) were manual-update-only and always stale; Renovate PRs surface the same information more reliably and sooner.

The auto-maintained design (aggregator fetches `latest_upstream` each `/catchup` run) required a second user-controlled field, `latest_acknowledged`, to separate "what's out there" from "what a human reviewed". A row is stale (banner-worthy) only when `latest_upstream != latest_acknowledged` and `status == watching` — this lets the aggregator update freely without triggering false-positive banners on rows the user already reviewed. The `--no-network` flag makes the aggregator testable offline. Considered: manual-only `last_checked` staleness (the prior approach — worked for Renovate-covered deps but failed for platform signals because no Renovate bot tracks Roku OS or Jellyfin server major bumps).

## decision-id: placeholder-logo-tint

**date**: 2026-05-15
**status**: accepted
**related-files**: components/ItemDetails.bs

`ItemDetails` surfaces placeholder PNGs in the logo slot (via `getPlaceholderImagePath`) when no server image resolves. Unlike real server images — which render in their native colors and should stay white-blend — placeholder glyphs at logo size compete visually with the nearby title text when left at full-white. `onLogoLoadStatusChanged` tints any logo whose URI starts with `pkg:/images/placeholders/` to `colorBackgroundSecondary`, making it recede like a watermark rather than dominate the composition.

Detection via `Left(uri, 24)` prefix was chosen over a `m.isPlaceholder` flag because the flag would need to be cleared and reset at each `setItemLogo` call site (8+ branches) and could fall out of sync if the logo URI is reassigned without going through `setItemLogo`. The prefix is an invariant of the asset layout — every placeholder PNG lives under `pkg:/images/placeholders/` by build-pipeline convention — so the check is always accurate without coordination. Constraint worth re-evaluating if the placeholder asset directory is ever reorganized.

## decision-id: multichannel-audio-fallback-codec

**date**: 2026-06-03
**status**: accepted
**related-files**: source/api/items.bs, source/utils/deviceCapabilities.bs

When `optimizeAudioCodecListForSource` would strip every codec from a video transcoding profile's `AudioCodec` list for a multichannel (>2ch) source, it leads the list with the user's `playbackPreferredMultichannelCodec` (default `eac3`) rather than falling back to stereo `aac` (PR #574's first approach, for issue #573). The empty-list condition only ever fires on a passthrough device playing surround content, so `aac` — a stereo-output codec the optimizer exists to strip — merely avoids the crash while abandoning the bitstream surround path the hardware was set up for; a surround codec preserves it. The same logic also rescues the `truehd,opus` mp4 shape, which the server otherwise resolves to `opus` (an on-device-decode path, not bitstream surround).

The fallback is clamped to `{eac3, ac3}`. `dts` is excluded even though the setting offers it: the Jellyfin server emits no audio stream for a `dts` transcode target (its ffmpeg encoder is experimental — verified via `/Items/{id}/PlaybackInfo` probes against 10.11), so a `dts` fallback would itself re-trigger the empty-`AudioCodec` → `m3u8` server fallback that is issue #573. Both `eac3` and `ac3` are valid HLS audio targets in every video transcoding container (ts and mp4), so no per-container clamp is needed. Ruled out: the `aac` fallback (preserves no surround); honoring `dts` literally (unencodeable, re-triggers the bug).

## decision-id: rta-screenshot-store-website-split

**date**: 2026-06-10
**status**: accepted
**related-files**: tests/rta/screens.js, scripts/capture-screenshots.js, scripts/screenshots-store.js, docs/screenshots/screenshots.json, docs/dev/rta-tests.md

The RTA screen registry originally conflated "captured" with "ships in the Roku store" — every `capture.eligible` screen landed in `docs/screenshots/<locale>/` and `screenshots-store.js` bundled whole locale folders. The Roku store caps a listing at **6 screenshots** (we have exactly 6), but we want to grow the captured set well past 6 for a website screenshot *gallery* (a UX preview users can browse/share) plus functional-test regression coverage — which would silently push the store bundle past its cap. Split the one flag into two: `capture.eligible` (captured at all — written to `docs/screenshots/<locale>/` for the website gallery + dumped by `RTA_CAPTURE`) and `capture.store` (additionally part of the frozen Roku-store / homepage 6). `screenshots.json` now emits `screens` (the full gallery superset, in registry order) and `storeScreens` (the curated 6); `screenshots-store.js` copies only store-flagged screens, so `out/store/` stays at 6 regardless of how many gallery screens are added. The website renders the full `screens` set on its gallery page and the ordered `storeScreens` on the homepage.

Ruled out: keeping one flat `eligible` set and curating the store bundle by hand (or by locale only) — that re-introduces the silent-overflow risk every time a screen is added. Adding a 7th store screen is now a deliberate Developer-Portal decision (flip `store: true` on one screen), not a code default. Extends `rta-functional-tests-vitest`; landed alongside the first website-gallery-only screens (Server Select, Settings), with more gallery screens (library views, the grid options dialog, per-item-type detail screens) following on the same branch. This supersedes the earlier intent (the #642 progress followup) to make capture-the-default turn *every* covered screen into a store image — the split deliberately decouples gallery breadth from the frozen store 6.

## decision-id: companion-net9-floor

**date**: 2026-07-17
**status**: accepted
**related-files**: (`jellyfin-plugin-jellyrock` repo) Jellyfin.Plugin.JellyRock/Jellyfin.Plugin.JellyRock.csproj, Jellyfin.Plugin.JellyRock/build.yaml

For the cold-launch producer (#668, phase `P2`) the JellyRock companion plugin floor-bumps from `net8` / Jellyfin.Controller 10.9 to **`net9` / 10.11**, dropping 10.9/10.10 support for all *future* companion releases — existing 10.9/10.10 servers stay on the last 10.9-`ABI` release, gated by the plugin-manifest `targetAbi`, and simply stop being offered newer versions. The phantom cast session must name the `User` entity (`ISessionManager.LogSessionActivity(User)` + `IUserManager.GetUserById`), which moved to `Jellyfin.Database.Implementations` in the 10.11 DB refactor, so a 10.9-floor build throws `TypeLoadException` the moment the phantom `JIT`-compiles on a 10.11 server. `jprm` ships **one `DLL` per manifest entry** and Jellyfin does no target-framework probing, so a single assembly cannot both carry the phantom and load on 10.9/10.10 — cold-cast is 10.11-only under every option.

Ruled out: (a) a **two-track `net8;net9` release** — keeps 10.9/10.10 receiving future *non*-cold-cast updates, but needs real release-pipeline surgery (two `jprm` invocations at different `targetAbi`, merged into one manifest) on the current single-track pipeline; deferred as revisit-if-demand. (b) a **reflection-based phantom in a single `net8` build** — fragile on exactly the version-sensitive surface that changed, unverified on 10.9, low reward. The floor-bump was chosen for simplicity given a young plugin (v0.2.0) whose install base skews to current-stable 10.11; the project's deliberate 10.9 compile-floor is the evidence weighed against it. Empirically confirmed: the `net9`/10.11 build loads and runs on a real 10.11.11 server with no `TypeLoadException`. To be absorbed into the forthcoming cold-launch **producer ADR** (which will cover the phantom architecture, the device-validation gate, and the `3rd-party-ECP` policy caveat); promote to a numbered ADR there.

## decision-id: deviceid-suffix-gate-10.11

**date**: 2026-07-17
**status**: superseded
**superseded-by**: `deviceid-header-authoritative`
**related-files**: source/utils/session.bs, source/api/baseRequest.bs, `source/remotecontrol/remoteProtocol.bs`, `docs/adr/0023-cold-launch-cast-producer.md`

JellyRock derives its server `DeviceId` as `serverDeviceName = device.id + user.friendlyName` (`SetServerDeviceName`, `session.bs:494`). Appending the username was a workaround for **old Jellyfin servers that revoked a device's sibling auth tokens on re-authentication**, so multiple users' saved tokens could coexist on one Roku for fast user-switching. The suffix makes `serverDeviceName` **unstable across startup** — bare `device.id` before login, `device.id + username` after (`SetServerDeviceName` runs post-login, `session.bs:459`) — and the auth-header `DeviceId`, the `ws://` socket URL, and the `/pair` report each capture it at a different moment, splitting one physical device+user into **two** Jellyfin sessions. On the HTTP (`ws://`) path this breaks the #668 cold-launch producer: the phantom keys on the `/pair` `DeviceId` while the live `ws://` `WebSocketController` lands on the *other* `DeviceId`, so the phantom never sees the app as open (double-presence). Reproduced on-device against a real Jellyfin 10.11.11 container.

Decision: **version-gate the suffix at server ≥ 10.11.** On 10.11+ use a bare, stable `device.id` (known pre-auth, so every session-creating channel agrees → identity continuity holds); on <10.11 keep `device.id + username` (unchanged behavior — and those servers have no cold-cast producer anyway, since the plugin is `net9`/10.11-floored per `companion-net9-floor`). The 10.11 boundary needs no version archaeology: cold-cast already lives *only* at 10.11+, and 10.11.11 was **empirically shown to allow multiple auth tokens per `DeviceId`** (two users authenticated on the same `DeviceId` both kept valid tokens), so the suffix is provably unneeded there. Ruled out: (a) disabling cold-launch on suffix-needing servers — unnecessary, no cold-cast-capable server needs the suffix; (b) hunting the exact pre-10.11 version where the server token-revoke bug was fixed — unnecessary, the 10.11 floor is a safe conservative gate; (c) keeping the suffix but finalizing `serverDeviceName` before auth — blocked, `friendlyName` comes from the post-auth user object. Pending client implementation in `session.bs`; must verify multi-user switching still works on 10.11+ and nothing else keyed on the suffixed name regresses. Cross-referenced from [ADR 0023](adr/0023-cold-launch-cast-producer.md).

## decision-id: cold-cast-admin-toggle

**date**: 2026-07-19
**status**: accepted
**related-files**: (`jellyfin-plugin-jellyrock` repo) Jellyfin.Plugin.JellyRock/Configuration/PluginConfiguration.cs, Jellyfin.Plugin.JellyRock/Configuration/configPage.html, Jellyfin.Plugin.JellyRock/Plugin.cs, Jellyfin.Plugin.JellyRock/RemoteControl/PairingDecision.cs, Jellyfin.Plugin.JellyRock/RemoteControl/PhantomSessionService.cs

The cold-launch cast producer (ADR 0023, #668) publishes a phantom cast target for every validated, reachable, closed Roku. This lets a server admin control that visibility on the companion plugin via two default-on switches on the plugin's first dashboard config page: `EnableColdLaunchCasting` (master — hide all closed devices) and `IncludeDevelopmentBuilds` (hide sideloaded `IsDev` builds, the test/CI-device case). Both default `true`, so existing installs and users without a sideloaded build see no behavior change; the admin who wants closed or dev targets hidden toggles once.

The gate lives **purely server-side at the publish layer** — a pure `PairingDecision.ConfigAllowsPublish(record, master, includeDev)` composed into `PhantomSessionService.RefreshPairingAsync`, which also skips the live ECP reachability probe when publishing is disallowed. Because the phantom is minted 100% server-side, a plugin-only gate needs **no Roku client change** and leaves the frozen long-poll wire contract untouched; the client keeps reporting `/pair` as before. Gating at *publish*, not at `/pair`, keeps the pairing store lossless, so toggling is instant and reversible with no re-pair wait (flip back on → republished on the next 30s tick; flip off → the existing `ShouldPublish==false` revoke path drops live phantoms on the same tick).

Ruled out: (a) **per-device admin selection** — deferred as more UI surface than v1 needs; the per-record `IsDev` / decision evaluation stays per-device-ready so a future per-device flag slots in with no schema break. (b) **client-side reporting suppression** — adds client↔plugin coupling and a cache-invalidation problem to save one cheap best-effort LAN POST, and on HTTP the client doesn't even probe `/info`, so it'd save nothing. (c) **purge-on-disable** — destructive, breaks reversibility (every device re-pairs on its next open, up to the 14-day window), and couples the toggle to the pairing subsystem it should stay orthogonal to. Refines [ADR 0023](adr/0023-cold-launch-cast-producer.md).

## decision-id: plugin-config-machine-state

**date**: 2026-07-19
**status**: accepted
**related-files**: (`jellyfin-plugin-jellyrock` repo) Jellyfin.Plugin.JellyRock/Configuration/PluginConfiguration.cs, Jellyfin.Plugin.JellyRock/Plugin.cs, Jellyfin.Plugin.JellyRock.Tests/PluginConfigurationPersistenceTests.cs

Non-admin-editable **machine state** stored in a Jellyfin plugin's `PluginConfiguration` (here, the cold-cast `Collection<PairingRecord> Pairings`, populated by `/pair` reports — see [`cold-cast-admin-toggle`](decisions.md) and [ADR 0023](adr/0023-cold-launch-cast-producer.md)) must be **`[JsonIgnore]` + re-injected on `UpdateConfiguration`**, or an admin settings save silently wipes it. Root cause, found live while testing the plugin's first config page: `System.Text.Json` serializes a get-only collection on the config API **GET** but cannot repopulate it on **deserialize** (default `Replace` handling), so every `updatePluginConfiguration` POST (what the config page's Save does) rebuilds the config with an **empty** `Pairings` and persists that. This wiped every validated pairing; with zero pairings the phantom service iterates nothing, so an already-published cast phantom was never revisited or revoked and lingered in "Play On" regardless of the toggle. A real data-loss regression introduced purely by adding the config page — the plugin had no admin save path before.

Fix (two parts, both load-bearing): (a) `[System.Text.Json.Serialization.JsonIgnore]` on `Pairings` keeps machine state off the admin JSON API entirely — the `XmlSerializer` that persists the plugin XML ignores the `System.Text.Json` attribute, so on-disk persistence is unaffected; (b) override `Plugin.UpdateConfiguration` to copy the server's current `Pairings` into the incoming config before `base` persists, so a settings save can never clobber it even from a stale config page snapshot or a raw POST. Ruled out: a plain setter on `Pairings` (would round-trip via the page, but a stale page snapshot or concurrent `/pair` could still overwrite the live set — the override is race-safe by always preferring server-owned state). Verified live on a real 10.11.11 server (save preserves pairings; toggling flips `SupportsRemoteControl` within the 30s phantom tick) plus a 3-case unit regression test exercising the real override. **Reusable rule:** any future non-admin state added to `PluginConfiguration` needs this same `[JsonIgnore]` + preserve-on-update treatment.

## decision-id: deviceid-header-authoritative

**date**: 2026-07-25
**status**: accepted
**supersedes**: `deviceid-suffix-gate-10.11`
**related-files**: `components/remotecontrol/RemoteControlTask.bs`, source/api/baseRequest.bs, `source/remotecontrol/remoteProtocol.bs`, `components/vendor/BrightWebSocket/web_socket_client/WebSocketClientTask.brs`, `docs/architecture/remote-control.md`

Jellyfin resolves a request's `DeviceId` from the `Authorization` header and **nowhere else** — it never reads the query string, and when the header omits `DeviceId` it silently substitutes the id the auth **token** was minted under (`AuthorizationContext.GetAuthorizationInfoFromDictionary`, verified identical in 10.7.7 / 10.8.13 / 10.9.11 / 10.10.7 / 10.11.11). A token's device row is fixed at mint time and never rewritten afterwards; only `DeviceName` and `AppVersion` are. The superseded note assumed the opposite — that the auth header, the `ws://` socket URL and the `/pair` report each capture the `DeviceId` at a different moment, so stabilizing the *computed* name would be enough. It is not: the `&deviceId=` parameter on the socket URL is inert, so a header-less `ws://` upgrade inherits the token's binding. On an install upgraded from a build older than #721 that is the old suffixed id, which put the command channel on a different Jellyfin session than the REST API, the capabilities POST and the `/pair` report — the cast target resolved but commands were delivered where the app wasn't listening (#743). #721 did not fail to engage on those installs; it **introduced** the split, and passed on-device testing only because a fresh install mints a bare-bound token so the advertised id and the binding coincide by construction.

Decision: **the advertised `DeviceId` is authoritative, and every channel that opens a Jellyfin session must send the `Authorization` header** — `RemoteControlTask` sends `buildAuthHeader(false)` on the `ws://` upgrade handshake. Sessions are keyed `GetSessionKey(client, deviceId)`, so "same `Client` + same `DeviceId`" is the whole invariant, and the token's stale binding becomes irrelevant rather than something to repair. Ruled out: (a) a registry migration clearing saved tokens to force a re-mint — forces a Roku-remote password re-entry across the entire install base to fix a subset, and doesn't remove the split, so the next `DeviceId` change re-breaks it; (b) adopting the server's binding by omitting `DeviceId` from the header — also needs no re-login, but it inverts control to the server, leaves the app unable to filter `/Sessions?deviceId=` for its own session, and rests on a fallback Jellyfin's own source marks `// TODO: Remove these checks`. Accepted trade-offs: the free-text device name is omitted from the socket header (the handshake is written as a raw string with no header-encoding layer, and the server already holds the name on the token's device row), and `api_key` stays on the socket URL so a reverse proxy that strips `Authorization` degrades to the old behavior instead of failing to connect. Refines [ADR 0023](adr/0023-cold-launch-cast-producer.md).

## decision-id: ci-lint-parity-meta-gate

**date**: 2026-07-30
**status**: accepted
**related-files**: `scripts/lint/ci-parity-check.js`, `package.json`, `.husky/pre-push`, `.github/workflows/_lint-docs.yml`, `docs/architecture/build-and-tooling.md`

CI does **not** run the `npm run lint` aggregate and will not be changed to. It stays assembled from ~11 path-filtered per-domain reusable workflows (`_lint-*.yml`), and the two surfaces are kept honest by a meta-gate — [`scripts/lint/ci-parity-check.js`](../scripts/lint/ci-parity-check.js) fails when any aggregate member has no CI home, with a `LOCAL_ONLY` allowlist that requires a written reason per entry and treats a stale entry as a failure. The problem this solves was real and had been live for a long time: three checks (`lint:promise-ratchet`, `docs:api-manifest:check`, `lint:dictionary`) were in the aggregate and in no workflow, so they gated nothing — and `.husky/pre-push`, `promise-ratchet.cjs`, `scripts/CLAUDE.md`, `build-and-tooling.md` and `async.md` all asserted the opposite, four of them by inferring "it's in `npm run lint`, therefore CI-blocking." The #551 anti-backslide ratchet in particular blocked nothing from the day it landed.

Ruled out: **making CI run `npm run lint` in one job**, which is the obvious fix and genuinely tempting ("CI runs exactly what you run", and the whole class disappears). Rejected on cost: the aggregate includes `validate` (a full BrighterScript compile) plus Prettier and spellcheck over the whole tree, which today run as parallel path-filtered jobs. Collapsing them means a docs-only PR pays a full BSC compile, CI wall-clock rises materially, and 11 granular job results become one opaque red "lint" — a real DX regression traded for conceptual tidiness. The meta-gate buys the same guarantee at the cost of one small script that uses only the Node standard library — no new dependency, and no `npm ci` added to the job that runs it. Also ruled out: fixing the three gaps without the gate (leaves the class intact — the next check added to the aggregate silently repeats it). Accepted trade-off: a new check must still be wired in **both** places by hand; the gate catches the omission but can't pick the right workflow, so the docs now say so explicitly. Two known residual gaps, both filed as [`ci-path-filters-unverified`](architecture/tech-debt.md#ci-path-filters-unverified): the gate proves a check has *a* CI home, but not that that home's path filter actually matches the files the check reads, nor that its status-check context is **required** on `main` (a non-required context runs and reports red without blocking a merge — `floor-system` and `issue-templates` were both in that state, and were added to branch protection alongside this change). Directly mirrors [`validate-deps-workflow-sync.cjs`](../scripts/lint/validate-deps-workflow-sync.cjs), which guards the same class one layer down, and is wired beside it in `_lint-docs.yml`.

## Migrated to ADRs

These decisions were promoted to numbered ADRs on the operating-model
convergence (audit-before-migrate). Old `decision-id` references resolve here:

| former decision-id | now |
|---|---|
| `triage-opus-inline-investigation` | [ADR 0001](adr/0001-triage-opus-inline-investigation.md) |
| `four-pillar-journal-reshape` | [ADR 0002](adr/0002-four-pillar-journal-reshape.md) |
| `icons-material-rounded-house-style` | [ADR 0003](adr/0003-icons-material-rounded-house-style.md) |
| `icons-outlined-by-default` | [ADR 0004](adr/0004-icons-outlined-by-default.md) |
| `jrplaceholder-themed-composition` | [ADR 0005](adr/0005-jrplaceholder-themed-composition.md) |
| `per-issue-crash-enrichment` | [ADR 0006](adr/0006-per-issue-crash-enrichment.md) |
| `server-upgrade-anchor-strategy` | [ADR 0007](adr/0007-server-upgrade-anchor-strategy.md) |
| `server-upgrade-issue-filing` | [ADR 0008](adr/0008-server-upgrade-issue-filing.md) |
| `server-upgrade-proactive-ci` | [ADR 0009](adr/0009-server-upgrade-proactive-ci.md) |
| `server-upgrade-phase5-maturation` | [ADR 0010](adr/0010-server-upgrade-phase5-maturation.md) |
| `server-upgrade-phase6` | [ADR 0011](adr/0011-server-upgrade-phase6.md) |
| `promise-native-interface-fetchres-exception` | [ADR 0012](adr/0012-promise-native-interface-fetchres-exception.md) |
| `auto-abandon-promises-bsc-plugin` | [ADR 0013](adr/0013-auto-abandon-promises-bsc-plugin.md) |
| `non-pool-http-stays-task-blocking` | [ADR 0014](adr/0014-non-pool-http-stays-task-blocking.md) |
| `server-upgrade-anchor-vs-resolved-decoupling` | [ADR 0015](adr/0015-server-upgrade-anchor-vs-resolved-decoupling.md) |
| `global-signin-language` | [ADR 0016](adr/0016-global-signin-language.md) |
| `rta-functional-tests-vitest` | [ADR 0017](adr/0017-rta-functional-tests-vitest.md) |
