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
`**supersedes**` / `**superseded-by**` / `**partially-supersedes**` /
`**partially-superseded-by**` / `**related-files**`, then 1-2 short paragraphs.
Slugs are unique, each field appears at most once, and **fields must sit in the
contiguous block directly under the heading** — the linter stops reading at the
first line of prose.

**Notes are append-only in their prose** — a superseded note gets a *new* note
that references it; you never rewrite the old note's body, and you never insert
mid-file. The one exception is the **supersede ritual**, which is a three-part
edit. [`docs/adr/README.md`](adr/README.md) states the same convention for ADRs:
a later decision "is written as a new ADR that references (and flips the status
of) the one it supersedes."

1. the new note declares `**supersedes**: <old-slug>`;
2. the old note's `**status**` flips `accepted` → `superseded`;
3. the old note gains `**superseded-by**: <new-slug>`.

Miss any part and the chain lies — a note still reading `accepted` while a
successor exists is worse than no record at all, since `/catchup` and every
future reader treat these journals as authoritative. The same holds in reverse:
a note reading `superseded` that names no successor leaves a reader no way to
find what replaced it.

### Partial supersedes, and the two statuses that aren't `accepted`

When only *part* of a note is replaced, the full ritual would be a lie — the
rest of it is still live. Use the partial pair instead, and leave **both notes
`accepted`**. This mirrors what the ADR tier already does ([ADR 0003](adr/0003-icons-material-rounded-house-style.md)
/ [0004](adr/0004-icons-outlined-by-default.md), [ADR 0008](adr/0008-server-upgrade-issue-filing.md)
/ [0011](adr/0011-server-upgrade-phase6.md)), where the partially-superseded
record keeps `**Status:** Accepted`:

- the successor declares `**partially-supersedes**: <old-slug> (<what moved>)`;
- the predecessor gains `**partially-superseded-by**: <new-slug> (<what moved>)`.

The scope annotation is **required** — a partial supersede that doesn't say
which part moved isn't a usable record. A note can be partially superseded by
one record and later fully superseded by another; both relationships coexist.

`**status**: withdrawn` is **terminal**: the decision was abandoned rather than
replaced, so a withdrawn note has no successor. It can neither be superseded nor
supersede anything — those are different fates, and collapsing them loses the
distinction between "we changed our minds" and "we replaced this."

Every pointer resolves **within this file**. A note superseded by an *ADR* has
no field for it — cross-tier relationships are written as prose markdown links
(`Refines [ADR 0023](adr/0023-cold-launch-cast-producer.md)`), which the link
checker already validates. If a note has grown ADR-grade, that promotion is a
judgment call for [`/log decision`](../.claude/skills/log/SKILL.md), not a
field.

`npm run lint:docs` validates all of the above — unique slugs, one value per
field, the status enum, both pairs resolving and symmetric, `superseded` naming
its successor, `withdrawn` staying terminal, and nothing pointing at itself — so
a half-applied ritual fails at push time rather than silently. ADR supersede
chains are prose and are **not** machine-checked. Use
[`/log decision`](../.claude/skills/log/SKILL.md), which applies all three
parts; raw markdown edits to this file are not the sanctioned path.

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

## decision-id: decisions-supersede-schema

**date**: 2026-07-31
**status**: accepted
**related-files**: `docs/decisions.md`, `scripts/lint/docs-check.cjs`, `.claude/skills/log/SKILL.md`, `.claude/skills/docs-lint/SKILL.md`, `docs/architecture/build-and-tooling.md`

`docs/decisions.md` recognizes **two** validated supersede shapes rather than one. The **full** ritual is the three-part edit it always was — the successor declares `**supersedes**`, and the predecessor flips to `**status**: superseded` and gains `**superseded-by**`. The **partial** shape is new: when only part of a note is replaced, both records stay `accepted` because both are still live, and the relationship is carried by `**partially-supersedes**` / `**partially-superseded-by**`, each requiring a `(scope)` annotation naming what moved. That mirrors the ADR tier, where [ADR 0003](adr/0003-icons-material-rounded-house-style.md)/[0004](adr/0004-icons-outlined-by-default.md) and [ADR 0008](adr/0008-server-upgrade-issue-filing.md)/[0011](adr/0011-server-upgrade-phase6.md) both keep `**Status:** Accepted` on the partially-superseded record. `withdrawn` is terminal — abandoned, not replaced — so a withdrawn note can neither be superseded nor supersede anything; collapsing the two would lose the distinction between "we changed our minds" and "we replaced this." Every pointer resolves to a slug **within this file**; note↔ADR relationships stay prose markdown links, which the link checker already validates. [`docs-check.cjs`](../scripts/lint/docs-check.cjs) enforces all of it under category `decisions-supersede-chain`.

Ruled out: **forbidding partial supersede in notes and routing it to an ADR.** Cheaper — a message string instead of two fields — and defensible on evidence, since no note has ever needed one. Rejected on the shape of the bad path: an author who genuinely has a partly-replaced note hits a hard push failure whose only sanctioned remedies are promoting a two-paragraph note to a numbered ADR (wrong-sized) or marking it fully `superseded` — and the second passes the gate silently while destroying the "still partly live" truth. A gate that makes the journal-corrupting move the path of least resistance re-introduces exactly the harm it was built to prevent. The ADR tier's base rate pointed the same way: of its three supersede events, two are partial. Also ruled out: **letting `**superseded-by**` accept an ADR target.** It would invent a second cross-tier mechanism beside the prose-link convention already in constant use in both directions, for a lifecycle with zero instances — no note has ever been promoted out of this file, and `/log`'s one-tap "promote to an ADR" is capture-time routing of a *new* record, not a lifecycle on an existing one. Accepted trade-off: the partial fields may go unused; that cost is two fields in a validator, against a failure mode that corrupts the journal.

## decision-id: ws-socket-thread-release

**date**: 2026-07-31
**status**: accepted
**related-files**: `components/vendor/BrightWebSocket/web_socket_client/WebSocketClientTask.brs`, `components/remotecontrol/RemoteControlTask.bs`, `source/api/userAuth.bs`, `scripts/lint/socket-thread-release-check.js`, `docs/architecture/remote-control.md`

A Roku OS Task thread is not released by dropping the node reference, so the vendored `WebSocketClient` — one fresh node per connect attempt — leaked a thread per reconnect toward the 100-thread hard cap (the `&h29` class in #728). Three mechanisms now release it, and the node is **single-connection** as a result: reopening after close needs a fresh one. The load-bearing detail is *where* the loop's exit test sits. `m.ws.run()` both performs the CLOSED transition and posts the final `ready_state`/`on_close`/`on_error` messages to the port, so a drained-port observation taken before `run()` says nothing about what `run()` then enqueued — an exit test placed after `run()` releases the thread with the terminal events still queued, `m.top.on_close` never lands, and `RemoteControlTask.connectAndPump` blocks forever instead of reconnecting. The test therefore sits at the head of the loop body, armed by a flag set after `run()`. `SignOut` reads the published `socketNode` into a local before stopping it, because `control = "STOP"` does not join the receiver thread and re-reading the field races `closeSocket()` clearing it.

Ruled out: **reverting the vendored change and relying only on `closeSocket()`'s `control = "STOP"`.** It does cover every reconnect — `connectAndPump` returns only through that path — and it avoids narrowing an upstream contract. Rejected because it leaves a child orphaned by an abnormal receiver exit running forever, and because it rests on `STOP` reliably killing a thread parked in `wait()`, which is asserted throughout this codebase but never measured; keeping both mechanisms is correct under either answer. Also ruled out: **keying the exit on having forwarded `on_close`/`on_error` rather than on a drained port** — a benign mid-session `on_error` (a failed send while still OPEN) would arm it early, and the invalid-URL path posts no `on_close` at all. Accepted constraint: this is vendored code no test can reach (RTA drives `https://`, the receiver only runs on `http://`, and Rooibos cannot hold a real socket open and drop it), so the ordering is gated statically by `npm run lint:socket-thread-release` and exercised by a Vitest model whose loop ordering is read back out of the real file. Re-evaluate on any upstream `BrightWebSocket` re-sync.

## decision-id: latest-rows-failure-vs-empty

**date**: 2026-08-02
**status**: accepted
**related-files**: `components/home/LoadLatestRowsTask.bs`, `source/home/latestRows.bs`, `components/home/HomeRows.bs`, `source/api/apiPipeline.bs`

A request that never answered says nothing about what a library holds, so Home's latest-media rows distinguish it from an authoritative empty result. Result children carry a status: `ok` may act on the list (an empty one still removes the row — that is how a genuinely empty library clears), while a timeout or transport failure is skipped and the existing row stands untouched. Before this, any empty result removed the row, so a flaky network deleted good content on refresh — the failing path emitted an empty row and `populateRowFromData` removes a row it is handed an empty list for.

Ruled out: retry-in-place, which adds a second timeout budget to a path that already recovers. The safety rests on `Home.refresh()` firing from `onScreenShown` on every return to Home, so a failed row self-heals on the next navigation instead of sticking — re-evaluate this note if that trigger ever becomes conditional. Note the asymmetry this introduces: the other five Home rows still feed `populateRowFromData` directly and DO clear on failure; only the latest rows carry the status. Verified on device by pointing the server URL at a closed port mid-load — 11 injected failures left all 9 rows intact with unchanged item counts.

## decision-id: latest-rows-no-mid-run-restart

**date**: 2026-08-02
**status**: accepted
**related-files**: `components/home/HomeRows.bs`, `source/home/latestRows.bs`, `source/constants/timeouts.bs`

A Home refresh that lands while a latest-rows run is in flight now SKIPS, leaving the running orchestrator to finish, instead of STOPping it and setting `control = "RUN"` again on the same reused Task node — the rule `updateHomeRows()` already applies to the other five persistent tasks. Roku documents the hazard the old shape carried: "if a Task node is already in a given state as indicated by its state field, including RUN, setting its control field to that same state value has no effect" (dev-doc `DEVELOPER/core-concepts/threads.md`, "Re-running a task"). The restart therefore worked only if the STOP had already moved `state` to `stop` by the time the RUN was written; STOP-via-control is a documented path to that state, but nothing documents the transition as synchronous with the field write, and under the losing ordering the refresh silently did nothing. The guard removes the dependency — a running task is never STOPped, and a task that has returned is in `stop`, where RUN is documented to take.

The collision is reachable by construction, not by luck: sgRouter SUSPENDS Home on a forward push rather than destroying it (`Router.brs` routes the outgoing active view through `suspendView`, not `beforeViewClose`), `Home.onScreenHidden` stops no tasks, and teardown lives in `onDestroy`, which a revisit never reaches. Any return during a run overlaps it — the pool is FIFO over 3 slots, so the libraries fetch gating `startLatestMediaLoads` lands about one round trip after a slot frees, while the run still owes `(N-3)/3` more waves. How often real users land in that window is deliberately NOT claimed here: it needs telemetry, and one local server is a data point rather than evidence. It also does not need claiming — the guard is a safety property, and the old path had no mechanism preventing the collision at all.

Ruled out: **cancel-and-restart with run-id stamping** (the `m.programDetailsSeq` idiom from `components/liveTv/schedule.bs`) — it fixes the stale-child replay but leaves the documented no-op above in place. Also ruled out: **a fresh Task node per run** — unambiguous, and thread count would still be one, but it trades the file's persistent-task convention for an allocation per refresh to solve what the guard solves for free. Accepted constraint: the guard must never wedge, so `latestRows.runIsStalled` reclaims a run past `PIPELINE_RUN_MS + API_WAIT_MS` — a crashed orchestrator never delivers its last child, and without the backstop one dead thread would freeze these rows for the life of that Home instance. One reuse trap checked and currently clear: the same doc section warns that non-cloneable references created in a Task's `init()` reach only the FIRST thread the node launches. `LoadLatestRowsTask.init()` holds only `m.log` (an AA of functions plus an `roSGNode` — all on the cloneable list), and `apiPipeline` creates its `roMessagePort` and `roTimespan` inside the task function, so each run gets its own. Keep it that way; an `roXxx` added to that `init()` would be `invalid` from the second run onward.

## decision-id: photo-unresolvable-failure-policy

**date**: 2026-08-03
**status**: accepted
**related-files**: `components/photos/PhotoDetails.bs`

A photo whose URI won't resolve now raises a non-blocking toast and advances to the next slide, and after `MAX_CONSECUTIVE_PHOTO_FAILURES` (3) consecutive failures stops advancing rather than cycling. The reason skipping is the right default is a property of this screen specifically: `PhotoDetails.xml` draws exactly one full-bleed `Poster` plus a status label that is opacity-0 outside the slideshow-paused flash, and `init` sets `isOverhangVisible = false`. There is no title, date, or chrome — so a failed photo shows the user nothing new, and `photo.uri` is left untouched, meaning the previous frame stays up. Skipping therefore hides nothing, which is the usual argument against silently skipping.

Ruled out: **a blocking modal** (the prior behavior) — it interrupts a slideshow the user is passively watching, which is the wrong shape for a per-item failure. That path was almost certainly never exercised anyway: the pre-existing guard tested `isValid()` on a SceneGraph `string` field, which never goes invalid.

> **Correction (2026-08-09).** This entry originally also ruled the modal out as *non-viable*, on the grounds that `showDialog` builds an `roFontRegistry` for text metrics and that "is a MAIN|TASK-only component Roku refuses to construct on the render thread." **That is false** — measured on device (Streaming Stick 4K, Roku OS 15.2.4): constructing `roFontRegistry` inside a component `init()`, which is unambiguously the render thread, succeeds and returns usable font metrics. The claim was reasoned from the component's category rather than measured, and its phrasing only parses if main and render are the same thread, which they are not. The decision above stands on its remaining grounds; only that rationale was wrong. See [threading.md](architecture/threading.md). Also ruled out: **unbounded skipping**, because random mode has no end-of-list terminator, so a wholesale failure (an unset server URL fails every photo) would cycle a blank screen indefinitely; the bound converts that into a stop. Constraint worth re-evaluating: the bound of 3 is a judgment call with no measurement behind it, and once #757's render-thread-safe `JRDialog` lands the terminal case could become a real dialog instead of simply halting.

## decision-id: no-refill-on-completion

**date**: 2026-08-04
**status**: accepted
**related-files**: `source/api/apiPipeline.bs`, `docs/dev/home-first-paint-performance.md`

`apiPipelineNext` tops the pool up ONCE per call, at the top of its loop, and deliberately does not refill again immediately after taking a completion. The rejected design is intuitive and will be re-proposed by anyone reading the slot accounting: the caller does real per-result work (transform, build `ContentNode`s, `appendChild`) on the same thread between calls, so the slot a completion just freed sits idle for all of it — at `SLOT_COUNT = 3` that reads as a third of the pool parked for the length of the run.

It was implemented, measured and reverted. Across six independent comparisons on three device tiers (n=30 on a 512 MB Stick over four separate build/deploy passes, n=10 each on a Stick 4K and an Ultra, same server, 11 libraries) it was slower every time and never faster — roughly 1-3%, sign test p=0.031. Per-device Mann-Whitney was not significant, so this is evidence of NO BENEFIT rather than proof of harm, and the original justification (a 2673 to 2586 ms median at n=4) did not reproduce. Two things worth knowing before re-opening it: the per-column split is noise-dominated at these sample sizes — at n=10 `wait` appeared to confirm the mechanism and at n=30 it reversed — and the method resolves only ~120 ms and up, so a genuine sub-1% win would be invisible either way. Re-propose it only with a measurement that clears that floor.

## decision-id: rta-interrupt-restore-scripts-only

**date**: 2026-08-07
**status**: superseded
**superseded-by**: `rta-registry-lifecycle-outside-vitest`
**related-files**: `tests/rta/lib/seed.js`, `scripts/capture-screenshots.js`, `tests/rta/demos/run.mjs`

`armSessionRestoreOnInterrupt` is armed only from MAIN-PROCESS scripts — `scripts/capture-screenshots.js` and `tests/rta/demos/run.mjs` — and deliberately NOT from the Vitest specs, even though all five call `snapshotSession` and all five are interruptible. Without this note the omission looks like one someone should "finish".

Measured 2026-08-07 rather than assumed. Vitest 4 runs specs in forked child processes (`isMainThread=true`, `ppid != pid`) that share the parent's process group, so a terminal Ctrl-C genuinely reaches them — the handler is not unreachable. It is simply too slow: Vitest tears the child down before a ~30s restore (cold restart plus verify) can complete. A deliberately interrupted run — SIGINT to the whole process group, matching Ctrl-C — produced no restore output and left the device signed into `demo.jellyfin.org`. Arming there would read as protection that does not exist, which is the failure mode this repo has already paid for twice (a code comment guarding the seed path in the `relaunch`/`hardRelaunch` split, and the same shape again in `findHomeLibraryTile`).

The fix that WOULD work is moving the session lifecycle out of the three per-spec `snapshotSession`/`restoreSession` pairs into `globalSetup`, which runs in Vitest's main process. Declined for now, and this is a closed decision rather than an open followup: the exposure is a Ctrl-C during an otherwise unattended 13-minute suite, and recovery is a two-minute registry rewrite that the handler's snapshot-print makes mechanical. **Tripwire:** re-open if a device is actually stranded by an interrupted spec run, or if the suite becomes something people routinely sit and watch.

## decision-id: retire-hd-native-layout-refactor

**date**: 2026-08-07
**status**: accepted
**related-files**: `manifest`, `docs/architecture/build-and-tooling.md`, `resources/icons/README.md`

Retired the `hd-native-layout-refactor` tech-debt slug (and closed #419) instead of implementing it. Hardware verification on a device with a 720p UI (Roku Stick `3600X`) disproved its premise: the FHD design space + OS framebuffer downsample renders 720p correctly (it's supersampling, not "lossy autoscale"), and `$$RES$$` autosub selects per-resolution assets by *device* UI resolution even under `ui_resolutions=fhd` (`r2d2_bitmaps` showed the `_hd` triples loaded, decoded at physical output size) — so the #560 icon pipeline already delivers native-resolution bitmaps with no layout refactor. A second finding hardens the call: `GetUIResolution()` returns the *device's* resolution (1280×720) even when the manifest declares only `fhd`, which made the parked foundation branch's "no-op until the manifest flips" scaling actively wrong on 720p devices.

Closes off: declaring `ui_resolutions=hd,fhd` and converting ~223 hardcoded `1920`/`1080` coordinates to runtime reads. Scope limit: this verdict covers 720p only — SD/480p output (CRT displays, non-square pixels) remains unverified on real hardware and may need a different strategy; that stays tracked as tech-debt slug `sd-resolution-native-support`. Re-open trigger for the HD side: concrete low-end-device perf/memory data implicating rendering in the FHD design space — and evaluate a root-scene `scale` field before any coordinate rewrite. The 720p `Gradient` banding found during the same verification is tracked separately as #777.

## decision-id: genre-skeletons-batched-not-per-row

**date**: 2026-08-07
**status**: accepted
**related-files**: `components/ItemGrid/LoadItemsTask2.bs`, `components/ItemGrid/BaseGridView.bs`, `docs/architecture/async.md`

The Genres view paints its rows early by publishing genre ids and titles in ONE cheap write, then filling them from the single `content` batch it always used. It deliberately does NOT deliver each genre's items as that genre's fetch lands, even though the per-row shape is what "progressive" usually means and is what `LoadLatestRowsTask` does for Home.

Per-row delivery was built and measured before being rejected, so this is a closed question rather than an untried idea. Same data, same nodes, 9 thread crossings instead of 1: task-thread `emit` went 220 → 734 ms and the whole run 520 → 1403 ms on a Streaming Stick 4K. Rendezvous cost is paid per crossing well before it is paid per byte, and the grid's per-genre transform (~26 ms) is far too small to hide a ~64 ms handoff — which is exactly why Home can afford the same shape and this screen cannot: Home's per-row transform is ~120 ms. Shipping built `ContentNode`s for the skeletons instead of `{ id, title }` AAs cost a further ~136 ms on that one crossing, hence the render thread building its own row nodes (`HomeRows.createSkeletonRows` does the same). The general cost model lives in [`async.md`](architecture/async.md); this note records the choice for this screen.

Accepted trade-off: total load grows ~280 ms (520 → 844 ms at 8 genres, 802 → 1081 ms at 23) to buy first paint at ~210 ms regardless of genre count. That holds because first paint tracks the single genre-list query while the blank time it replaces scales with genre count and round-trip latency — measured flat at 206 ms / 221 ms across 8 and 23 genres, with the blank time removed nearly doubling. **Tripwire:** re-open if a measurement shows the added total time growing with genre count (it did not between 8 and 23), or if per-row fill becomes worth its crossings on a high-latency server, where the wait between samples is long enough to hide the handoff cost.

## decision-id: rta-registry-lifecycle-outside-vitest

**date**: 2026-08-10
**status**: accepted
**supersedes**: `rta-interrupt-restore-scripts-only`
**partially-superseded-by**: `registry-snapshot-outside-build-output` (snapshot location)
**related-files**: `scripts/rta-run.js`, `scripts/rta-restore.js`, `tests/rta/lib/registry.js`, `tests/rta/setup/global-setup.js`, `tests/rta/lib/seed.js`, `vitest.config.js`

An RTA run owns the device's registry for its duration, so that ownership lives in `scripts/rta-run.js` — a parent process that deploys, snapshots, runs Vitest as a CHILD, and restores — rather than anywhere inside Vitest. The snapshot is the WHOLE registry, every section and key, written to `out/rta/registry-<host>.json` before any seeding. The restore is a verified diff: delete sections the run created, null keys it added, put changed values back, cold-restart, compare everything, retry, then throw naming the differing keys. `LastRunVersion` is the single documented exception, because the app rewrites it on boot by design. Specs no longer touch the lifecycle at all.

Both of the designs this replaces were measured, not reasoned about. The five-key allow-list snapshot could not express "delete a section", so months of runs left `.178` carrying a demo-user registry section with a live `authToken` and a seeded `display.<libraryId>.landing`, plus a `demo` entry appended into `available_users` — and reported `VERIFIED CLEAN` every time, because it only ever verified its own five keys. An allow-list of "keys the seeds write" is structurally blind to everything the APP writes under a seeded session, which is why the replacement snapshots everything rather than a longer list. Separately, a SIGINT ~15 s into `npm run test:rta` left the device signed into `demo.jellyfin.org` with no restore output at all: `afterAll` does not run on a terminated process. That was the superseded note's own stated tripwire — "re-open if a device is actually stranded by an interrupted spec run" — and it fired in normal use, not in a contrived test.

The superseded note named `globalSetup` as the fix that WOULD work. It is not, and that is the load-bearing correction here: Vitest's reporter installs its own SIGINT handler that calls `process.exit()` on a 1 ms timer (`addCleanupListeners`, `vitest/dist/chunks/cli-api.*.js`), so a ~30 s restore armed anywhere inside the Vitest process is racing an exit it cannot win. Only a parent owning Vitest as a child escapes it; `globalSetup` now just refuses a bare `vitest` invocation, which would otherwise drive a device with no snapshot and no restore. Persisting the snapshot before seeding is what makes this recoverable rather than merely careful — a leftover file means the last run did not restore, so `npm run rta:restore` reapplies it and the next run repairs the device BEFORE taking its own snapshot, closing the compounding failure where a stranded run's dirty state silently becomes the next run's baseline. Verified on `.178` 2026-08-10: a mid-suite SIGINT restored the full registry to 0 differences, as did two full suites; dropping four redundant per-spec restores also took the suite 800 s → 728 s. **Tripwire:** re-open if Vitest ever exposes a teardown that survives its own interrupt handler, which would let the parent process go away.

## decision-id: device-lock-scoped-to-local

**date**: 2026-08-10
**status**: accepted
**related-files**: scripts/device-lock.js, docs/dev/rta-tests.md, docs/architecture/testing.md

The shared-Roku lock serializes LOCAL device runs against each other, and does not
try to serialize local work against CI. An ECP sweep of the LAN on 2026-08-10 found
three Roku devices: CI drives `.200` (the org-level `ROKU_DEVICE_IP` secret,
unmodified since 2026-03-18 and read by both device workflows and by RTA), while
local development drives `.177`. The two parties cannot contend through the
hardware at all, so a lock keyed on the device's own identity — which this one is
— cannot detect a collision that never happens. What it does catch is a second
terminal on the same device, and a local run deliberately pointed at `.200`.

Ruled out: **polling the Actions API so a local run yields to any in-flight device
workflow.** That was the original design and it shipped in an earlier revision of
this work. Its observable behavior was "you may not use `.177` because CI is busy
on `.200`" — blocking a developer from their own hardware to protect a device
nobody was touching — and it carried a hardcoded workflow-filename list that rots
silently on rename, a wait budget, and a poll loop whose anonymous-rate-limit
workaround existed only to afford the polling. Also ruled out: a device-resident
lock (ECP has no persistent write, and the ODC registry path is circular because
the lock must be taken before the deploy that installs ODC), and a filesystem
lockfile (the contending parties are different hosts).

The justification originally offered for the CI-yield check was PR #800, whose CI
run reddened while a local `npm run test:rta` was running. That reading is refuted
by the sweep: a `hardRelaunch()` on `.177` cannot reach `.200`. What both parties
genuinely shared was `demo.jellyfin.org`, so the live candidates are demo-account
contention and plain flake. **Tripwire:** re-open if that investigation (tracked
in `docs/progress.md`) shows real cross-host contention — but note the resource to
lock would then be the demo server account rather than the device, so the answer
still would not be to restore the Actions-API check.

## decision-id: run-record-per-run-kind

**date**: 2026-08-10
**status**: accepted
**related-files**: scripts/run-record.js, scripts/device-lock.js, scripts/rta-run.js, scripts/run-roku-tests.js, scripts/capture-screenshots.js, tests/rta/demos/run.mjs, tests/rta/lib/diagnostics.js

The device run record (`run-meta.json`, `failures.jsonl`, `runs.jsonl`) lives in a
directory keyed on the RUN KIND — `out/rta/`, `out/screenshots/`, `out/demo/`,
`out/device/` — and its lifecycle (`beginRun` / `endRun`) belongs to
`scripts/run-record.js`, not to the RTA diagnostics module that writes into it.

The directory split is not tidiness. `writeRunMeta` is a full overwrite against a
module-level constant, so while all four entry points shared `out/rta/run-meta.json`
any device run destroyed the previous one's record. Harmless while the file held
only lock provenance; a live data-loss path once it carries folded failure records,
because the flake baseline's documented workflow is to read them back across N runs
— so a `npm run test:unit` between two RTA runs silently ate the first one's. An
unmapped run kind gets its own sanitized directory rather than defaulting to
`out/rta/`, since a default that aliases onto a known kind reintroduces exactly that
clobber for the case nobody tested.

The module split follows from the Rooibos runner needing the same record: #800
reddened on `SessionManagement.spec.bs` → "connects to Jellyfin stable demo server",
a Rooibos test against the same fixture, so its run window is evidence for the open
re-derivation. Ruled out: having `run-roku-tests.js` import
`tests/rta/lib/diagnostics.js`, which would drag the whole `roku-test-automation`
client into a runner that drives the device over telnet and never touches ODC, and
would invert the layering. Also ruled out: leaving `run-roku-tests.js` alone — that
does not dodge the clobber, it only forgoes the instrumentation.

This closes the "(b)" half of the `run-meta.json` followup in `docs/progress.md`;
the CI-artifact half stays open.

## decision-id: registry-snapshot-outside-build-output

**date**: 2026-08-11
**status**: accepted
**partially-supersedes**: `rta-registry-lifecycle-outside-vitest` (the snapshot's location, and the recovery guarantee that depended on it)
**related-files**: `tests/rta/lib/registry.js`, `scripts/rta-restore.js`, `tests/rta/lib/registry.test.js`

The RTA device-registry snapshot lives at `.device-runs/registry-<host>.json`, outside
`out/`, and stays SHARED across every entry point rather than being split per run kind.

The move fixes a live defect, not a tidiness concern. `snapshotRegistry()` repairs a
device the previous run left dirty by restoring from a leftover snapshot BEFORE taking
its own — that is what stops a stranded run's state silently becoming the next run's
baseline. But the file lived in `out/rta/`, every `build*` script opens with `npx rimraf
build/ out/`, and `npm run test:rta` is `npm run build && node scripts/rta-run.js`. So
"abandon a run, then re-run the suite" — the natural next move — deleted the recovery
file before it could be used, and the run then captured the demo-server state as the
user's real session and restored that from then on. Reproduced without a device: plant
the file, `npm run build`, it is gone. Every path that actually EXERCISED the recovery
(`demo`, `test:rta:fast`, `test:rta:tdd`, `rta:restore`) is a path that never builds,
which is why it stayed invisible. Same root cause as the run ledger: a file whose
contract is "survives across runs" cannot live in the build output directory.

Ruled out: splitting the snapshot per run kind the way the run record is split. That
symmetry is a trap, because the two want opposite things — the record is per-run
evidence, so a shared path CLOBBERS it, while the snapshot is cross-run recovery state,
so a device stranded by `npm run demo` must be repairable by the next `npm run test:rta`
and `rta:restore` must find it with no arguments. Splitting it would have broken the
recovery this change restores. `readSnapshotFile` falls back to the old location (and
`clearSnapshotFile` clears both) so upgrading across the move cannot orphan the snapshot
of a device that is stranded right now; the fallback is removable once none can exist.
**Tripwire:** re-open if a build script stops wiping `out/` (a test pins that they do),
or if concurrent device runs against one host ever become possible — the shared path is
safe only because the device lock serializes writers.

## decision-id: restore-compares-credentials-by-presence

**date**: 2026-08-11
**status**: accepted
**related-files**: tests/rta/lib/registry.js, tests/rta/lib/registry.test.js, scripts/rta-restore.js, scripts/device-lock.js

The verified restore compares the two registry keys the app re-mints for ITSELF —
`authToken` and `primaryImageTag` — on **presence**, not on value. Everything else
stays byte-equal.

It has to. `resolveUser()` validates the stored token over REST on every cold boot
and falls back to `getToken(username, "")` on rejection, and the restore's verify
step IS a cold boot — so the restore wrote the snapshot's token, the app replaced
it, and the compare failed on every attempt. The snapshot is deliberately KEPT on
failure and `snapshotRegistry()` restores from it first, so one occurrence wedged
every later run, and `npm run rta:restore` re-ran the same non-converging loop.
Reproduced deliberately on `.177`, before and after.

What keeps this an exemption rather than a hole is that presence still fails in
both directions: a session DESTROYED (snapshot had one, device has none) is the
"signed my device out" damage the module exists to prevent, and a credential LEFT
BEHIND (device has one the snapshot never did) is the leak. Only "both present,
values differ" is accepted, which is the app doing its own job for the same user on
the same server.

Ruled out: **ignoring them outright** the way `LastRunVersion` is — that would drop
both failing directions, and losing a session is exactly what must stay red.
**Widening to the app's whole `sessionKeys` list** (`settings.bs`) — `username` and
`serverId` are re-written by the same login with STABLE values, so they compare
equal already and the assertion is free to keep. **Skipping the write in
`planRestore`** when the device already has a credential — this shipped in an
interim cut and the hardware reproduction refuted it: with an invalid token planted, the
restore left that token in place and reported converged. "As we found it" means the
user's value, so the exemption is on the COMPARE only.

`primaryImageTag` is included on the shared code path rather than an observed
failure — it rides the same `if saveCredentials` block in `session.bs` — because the
failure it would produce is the wedging one, and finding out the expensive way costs
more than exempting an avatar tag.

**Tripwire:** re-evaluate if the app ever stops re-authenticating on boot (the
exemption would then be unnecessary), or if a third key joins that write block —
add it here rather than widening to a category. `npm run rta:restore -- --accept`
exists for the residual case this cannot anticipate: without it, any diff that
will never converge blocks every later run and the only way out is `rm` on the
device's sole backup.

`--accept` clears the snapshot, and that clearing is the half that needed a
counterweight: it also removes the only durable signal that the device is dirty, so
the next `snapshotRegistry()` captures the accepted state as if it were the user's —
the compounding damage the module header describes (run N leaks, run N+1 adopts the
leak), reached from the other direction. So accepting writes
`.device-runs/accepted-<host>.json` — redacted, because it is evidence rather than a
backup, and appended to rather than overwritten, because an earlier accept is still
live damage when a later one lands — and `npm run device:status` reports it until a
human deletes it. Nothing
clears it automatically: a later verified restore proves the device matches the last
snapshot, which after an accept IS the accepted state, so it cannot prove the
original value came back. It is gone, and only a person can close that.

## decision-id: ledger-records-run-outcome

**date**: 2026-08-12
**status**: accepted
**partially-superseded-by**: outcomes-partition-into-samples (how a baseline consumes the field)
**related-files**: scripts/run-record.js, scripts/rta-run.js, scripts/run-roku-tests.js, scripts/capture-screenshots.js, tests/rta/demos/run.mjs

A ledger line records what BECAME of a run — `passed` / `failed` / `interrupted` /
`crashed` — as a field separate from the failures it diagnosed. `failures[]` fills
only from the five RTA throw sites that capture device state, so an empty list is
equally true of three different runs: one that passed, one that went red somewhere
the diagnostics do not reach (a plain `expect()`, or any error raised by Vitest
itself), and one that never executed at all. A flake baseline whose entire output is
"how many of N runs were red" cannot infer its own answer from the absence of
records.

The third case is what forced it. A deploy 401 appended `durationMs: 621,
failures: []` on a CLEAN tree — the first line ever to satisfy all four selection
keys (`variant`/`commit`/`dirty`/`deviceKey`), from a run where nothing ran, and it
printed nothing on the way out because a run with no failures had nothing to say.

`crashed` is **inferred from the absence of a close**, not from an error signal.
Every entry point closes explicitly on the paths it can reach, so `armCloseOnExit`
firing on a still-open run *is* the definition of dying before one of them ran. That
inversion is what makes it robust to the entry points that die in ways they cannot
themselves report — which is precisely the case that produced this note.

Deliberately NOT the raw exit code, and NOT per-test pass/fail counts. One derived
field cannot disagree with itself the way a raw-plus-derived pair can, and the
question the baseline asks is run-level. A per-test flake rate is the trade-off
worth re-evaluating later: if it is ever wanted, this is the field to extend rather
than a second one to add beside it.

## decision-id: outcomes-partition-into-samples

**date**: 2026-08-12
**status**: accepted
**partially-supersedes**: ledger-records-run-outcome (how a baseline consumes the field)
**related-files**: scripts/run-record.js, scripts/flake-baseline.js, docs/dev/rta-tests.md

The four outcomes are not four peers. `passed` and `failed` reached a verdict, so they
are SAMPLES — in the population, and in the numerator respectively. `crashed` and
`interrupted` never reached one — a deploy that 401'd, an operator's Ctrl-C — so they
are not evidence about the app in either direction and leave the population entirely.
Counting a non-sample red inflates the rate; counting it green hides a real failure.
`ledger-records-run-outcome` established the field but described consuming it as
"counts `outcome === 'passed'`", which is the second of those two errors.

`SAMPLE_OUTCOMES` is that partition, exported rather than restated by each reader: the
run summary's operator advice and `npm run flake-baseline` both consume it, so the
advice and the arithmetic cannot disagree. They did on first cut — the documented
recipe counted a crashed run as a failure while the summary told the operator to
exclude it.

The aggregation itself moved out of doc prose into `flake-baseline.js` for the same
reason: as a snippet a human retypes it was wrong three times in one PR cycle — the
variant filter, the sample partition, and a stale copy in a gitignored project plan —
and every one produced a plausible number rather than an error. An unrecognized outcome
is deliberately NOT coerced into a sample: it records as given, warns, and falls out of
the population, so a typo cannot score green.

## decision-id: session-identity-per-role-and-device

**date**: 2026-08-12
**status**: accepted
**related-files**: tests/rta/lib/jellyfin.js, scripts/run-record.js, scripts/capture-screenshots.js, tests/rta/demos/run.mjs

Jellyfin keys a session to its `DeviceId`, and a second `AuthenticateByName` under the same
one EVICTS the first token — measured against the demo server, where session A went from
OK to 401 the instant session B was minted. Every Node-side caller authenticated as the
literal string `"jellyrock-screenshots"`, so any two running at once logged each other
out. Sessions are now minted as `jellyrock-<role>-<deviceKey>`.

Per role AND per device because either axis alone leaves a live collision: per-role only
still breaks one tool driving two Roku devices, which is exactly the two-suite contention
experiment. Stable rather than random-per-process, deliberately — a random id is
collision-free but mints a new session on a shared public server every invocation, and a
stable one is also readable in a session list, which is what makes a stray session
traceable to the tool that opened it. The `deviceKey` comes from the lock (already resolved by an ECP lookup) via the
child's env; the degraded-lock fallback hashes `ROKU_IP` rather than sending a LAN address
to a third party.

This was unreachable before two devices were driven at once — `device-lock.js` serialized
every tool onto one device, which is why a shared `DeviceId` survived this long. Worth
re-evaluating if a caller ever needs two concurrent sessions on ONE device: the id has no
per-invocation component, so they would collide by design.

## decision-id: batch-reads-for-the-observation-window

**date**: 2026-08-12
**status**: accepted
**related-files**: tests/rta/lib/steps.js, tests/rta/screens.js, tests/rta/CLAUDE.md

A one-shot RTA assertion reads the screen through `getActiveVals` (one ODC `getValues`)
rather than a `getActiveVal` per field. **The reason is NOT speed, and the measurement
is what settled that.** On `.177`, 5 alternating rounds of 57 `keyPath`s: 57 sequential
reads take a median 303 ms, one batched read 58 ms — about **5.4 ms per round trip**.
Inside a ~20 s screen test that is a ~245 ms saving, and before/after full runs of the
genre screen confirmed it is invisible (19.87 s vs 20.24 s mean, n=3 each, the batched
arm nominally slower). Batching was folded into this phase partly on the theory that
The harness's own timing could distort the app-performance work RTA is used to validate; at this scale it does not, and that justification is retired. If harness timing ever
does distort a measurement, look at poll intervals and boot waits, not read patterns.

What the same numbers DO establish is the observation window. 57 sequential reads
observe a still-settling screen across 303 ms, so the field read 50th need not describe
the same frame as the field read 1st; batching collapses that to 58 ms. That is the
suite's north-star rule — establish the state that makes a read meaningful — applied to
reads instead of to input, and it is a correctness property. It also leaves the whole
view in memory, so the failure record carries it at no extra device cost.

The keep/skip constant is the 5.4 ms: restructuring a read pattern is worth it when the
reads must describe ONE moment, and not worth it for speed. Poll loops keep the
single-read form — they retry by design and `waitFor` owns their timeout.

## decision-id: measurement-identity-is-observed-not-declared

**date**: 2026-08-12
**status**: accepted
**related-files**: scripts/measurement-guard.js, scripts/measure.js, scripts/device-lock.js

An on-device performance sample is only worth the answer to "what was it taken against?", and
this note records two calls about where that answer comes from: it is **observed from the
running app**, never declared by the repo.

**Tier 1 asserts `serverUrl`, not the `serverId`/`userId` pair.** The original design called
that pair immune to content drift, because only a real server switch moves it — true for a
switch to a *different* server, and false for the mistake most likely here. Measured
2026-08-12: `demo.jellyfin.org/stable` and `/unstable` are genuinely different backends
(Jellyfin 10.11.11 vs 12.0.0, different `ServerName`) **cloned from one seed database, so they
report an identical `serverId` AND `userId`**. `RTA_CONFIG` points at `/stable` while the
API-version work targets `/unstable`, so that is the live confusion, and the pair cannot see
it. `serverUrl` can. The other two are kept as recorded provenance, where being equal across
two servers costs nothing. A mutation test pins it — making the URL normalizer one step more
eager turns three tests red on exactly that case — because the tempting future change is
"normalize a bit harder", and that is precisely what re-blinds it.

**`ENABLE_RTA` is derived from ODC answering, not read from the manifest.** The first revision
read it from the checkout and got it backwards on every run: RTA's deploy rewrites the flag in
the STAGED build directory, never in the repo, so the committed value is always `false` — and
the record carried `manifestFlags.ENABLE_RTA: false` two fields away from `enableRta: true`.
One record, two contradictory answers about one flag, manufactured by consulting a file that
structurally cannot know. The on-device ODC component exists only in a build deployed with
`injectTestingFiles`, so an identity read that ANSWERS is itself proof the running build has
the flag on — strictly more than a manifest read can say, and true whether or not this
invocation performed the deploy. The general rule this leaves behind: the checkout may only
speak for itself, which is why `appVersion` / `commit` / `dirty` now sit under a `checkout`
key beside `deployedFromCheckout` and an `agreesWithDevice` comparison against the app's own
`[debug=… perfTiming=…]` bracket.

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
