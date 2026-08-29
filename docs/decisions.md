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

## decision-id: comparison-refuses-identity-reports-drift

**date**: 2026-08-13
**status**: accepted
**related-files**: scripts/measure-compare.js, scripts/measurements.js, docs/dev/home-first-paint-performance.md

Tier 3 pairs two measurement series, and the rule for what makes them incomparable is the
guard's own rule one level up — **assert identity, record everything else**. An identity
difference REFUSES the comparison (measurement family, screen, server URL, device model, RAM
tier, build flags, `ENABLE_RTA`): those are two experiments, not two arms of one. Everything
else is REPORTED and never refused — workload drift, a series crossing the top of the hour, a
dirty tree, two units of the same model, an n below what the method resolves.

Both symmetric alternatives were considered and both fail. **Refuse on any difference** breaks
exactly where the tool earns its keep: an arm that rendered 9 rows against 10 is the case a
human most needs to see, and a tool that swallowed it would have nothing to say about the
failure it exists for. **Report everything, refuse nothing** fails the other way: a
`debug=true` arm is +121 ms on a Stick 4K before the change under test does anything, and no
amount of printing turns that into a comparison. The re-evaluation trigger is a legitimate
comparison being refused — that means an axis is on the wrong list, and the lists are one
function (`comparability`) pinned by tests, so moving one is a small diff.

The rank test moved into code for a reason worth recording beside it. Re-deriving the two
p-values in [`home-first-paint-performance.md`](dev/home-first-paint-performance.md) found
they were computed by **different methods and neither said so**: the `apiPipeline` pair
(n=5/6) is genuinely exact at 2/C(11,5) = 0.00433, while the batched-attach pair's
"U = 0.0, p = 0.0002" is the normal approximation with a continuity correction (z = 3.742 →
1.83e-4) whose exact value is 2/C(20,10) = 1.08e-5, seventeen times smaller. Both conclusions
are unaffected — they only get stronger — but a reader deriving one from the other would have
concluded the arithmetic was broken. So the tool reports which method produced a number, both
methods are reachable and pinned by tests, and the doc now says which produced its recorded
value.

## decision-id: roku-device-dictionary-generated

**date**: 2026-08-13
**status**: accepted
**related-files**: scripts/generate/roku-hardware.js, scripts/data/roku-hardware.json, scripts/roku-devices.js, .github/workflows/roku-hardware-sync.yml

The Roku device lookup is a GENERATED dataset derived from `rokudev/dev-doc`
`SPECIFICATIONS/hardware.md`, not a table anyone types. It replaced a 38-entry
`DEVICE_RAM_TIERS` literal that was *accurate* and still wrong: it keyed on `/^(\d{4})/`, so
all sixteen letter-prefixed Roku TV and Projector families (`J000X`, `A000X`, `K8PXX`)
resolved to `null` forever, spanning 512 MB to 2 GB — the largest device class Roku ships. It
also could not notice upstream commit `0cddfa29`, which added a supported device (`K000X`,
Roku TV "Roxton", 512 MB, 2024).

Three sub-decisions carry the design. **The parser refuses what it does not recognize**
rather than emitting null, so an upstream change of spelling fails the sync loudly instead of
silently degrading a device to unknown-tier — a dataset that degrades quietly is the
hand-typed table with extra steps. **The sync PR is gated on the derived DATA, not the
upstream file**: of four commits to `hardware.md` in three months one touched only the
document's own frontmatter and search metadata, so a file-watch would have been 25% noise,
and noise is what kills a watch nobody has to read. **A scheduled PR was chosen over a signals-backlog row** for the same
reason — a journal row someone must remember to read is a worse version of a diff that
arrives in the review queue.

The strict parser earned itself immediately by refusing to overwrite a key: one `GetModel()`
value can map to two physical devices (`8000X` is both Roku TV and Roku TV (Brazil); `4800X`
is both Roku Ultra LT and Roku Ultra). So `models` carry a `variants[]` array, with only RAM
and support tier hoisted and asserted invariant across them. The four-character family key is
the constraint worth re-evaluating: verified unambiguous across all 70 families today, and
re-checked on every generate — if Roku ships a 2 GB revision under an existing prefix,
`familyOf` needs revisiting.

## decision-id: measurement-navigates-via-screen-registry

**date**: 2026-08-13
**status**: accepted
**related-files**: scripts/measure.js, scripts/measure-args.js, tests/rta/screens.js

`npm run measure` reaches a non-Home screen by running the nav declared on that screen's
entry in `tests/rta/screens.js` (`--nav <screen>`), making measurement the THIRD consumer of
that registry after the functional suite and the store screenshots. A private nav registry
was rejected: the other two consumers already drive this same nav code against a real device on
every run, so reusing them means a broken nav surfaces as a red test rather than as a
measurement that quietly stopped reaching the screen it names. Before this, `measure`
reached a screen by RELAUNCHING, so the app was always on Home and 26 of the 29 registered
screens were unreachable.

It adopts that nav code WITHOUT the seeding. They read their context defensively
(`libraryIdFor(ctx?.libraries, …)`, `ctx?.heroIndex || 0`), so the detail screens navigate
with no session, no `ctx`, and no registry write — which is what lets `measure` keep the
invariant its header states: it never writes the registry, and it measures the developer's
own server rather than the demo. The cost is bounded and stated rather than discovered: the
two music-detail screens are distinguished only by a seeded landing view, so unseeded they
collapse into whichever view the device last persisted, and the recorded `variant` is the
only thing that says which was measured. Adopting `lib/registry.js` to fix that was rejected
— it would buy two screens and cost the invariant. Screens needing a signed-out state are
refused at parse time with the reason, rather than attempted and timed out on.

`--library <id>` threads an explicit library into `navLibraryByType`'s existing parameter.
Not speculative: the FIRST real run against the developer's server refused, because that
server has four movie libraries (and, separately, two TV ones) and the `collectionType` scan
will not guess between them. The refusal is correct — it fails rather than measuring the
wrong library — so the flag is the way out of it, not a loosening of it. It binds to the
TARGET SCREEN's own collection type rather than being mapped onto every type at once: the
blanket form handed a movies id to a TV nav without a word, which is the same silent
misreading the refusal exists to prevent. It is also recorded, because two arms that
opened different libraries are two workloads wearing one name and nothing else in the record
can say so. A nav failure abandons the series rather than retrying, since a nav that cannot
reach its screen once will not reach it on the remaining launches.

A CHAINED nav (a Season reached through its Series) mounts one component several times per
launch, and all of those loads really happened, so all are recorded. What the tool refuses is
to guess which one was meant: a launch carrying more than one variant publishes no median
until `--variant` names one, and `--variant` is refused when no sample carried it. Selecting
by position was the alternative, and it is how the tool would confidently report the screen
you passed THROUGH as the screen you asked for.

## decision-id: screen-with-two-loads-is-two-runs

**date**: 2026-08-14
**status**: accepted
**related-files**: components/search/SearchResults.bs, components/search/SearchRow.bs, source/utils/screenReadiness.bs

A screen whose two loads are separated by a USER is measured as TWO readiness-ledger runs,
told apart by `variant`, rather than as one run. `search` is the first: it opens a keyboard
(`open`) and then runs a query (`query`), and a person types in between. One run spanning
both was rejected on a measurement rather than an argument — its `settled` would include the
typing, and the RTA harness alone sits 1.2 s in that gap on `.177`, which is a property of
whatever did the typing and not of this screen. Not instrumenting the open was also
rejected: the screen paints in 3 ms and cannot ACCEPT A KEYSTROKE for another ~200 ms, because nothing
takes focus until the router shows the view, so a single number would have published "search
opens in 4 ms" and hidden 98% of the wait — the flattering-first-paint failure the ledger
exists to prevent, and the same one the `settings` screen had already produced once.

This EXTENDS [ADR 0028](adr/0028-mount-identity-component-and-variant.md) rather than
competing with it. There `variant` answers "what KIND of thing this load was" (an item type,
a library type); here it also answers "WHICH of this screen's loads". Both are the same job —
separating the samples of one component so a reader can name the one it meant — so no new
field and no tooling change was needed, and the existing ambiguity refusal does the work: a
bare `--nav search` publishes no median and names `searchResults/open, searchResults/query`.
The cost is that every search measurement must pass `--variant`, which is accepted because
the tool prints exactly what to pass. Recorded because 0028 read narrowly would suggest this
is a misuse of the field, and the convention would then get "corrected" out by someone
instrumenting the next multi-load screen.

## decision-id: prelogin-paint-is-a-handoff

**date**: 2026-08-15
**status**: accepted
**related-files**: source/loginRouter.bs, source/utils/screenReadiness.bs

The readiness ledger is used for `preLogin`, which is NOT a screen, and there its `paint`
marks the moment the COORDINATOR stopped blocking and handed a route to the router — not a
moment the user can act on. Everywhere else `paint` means a screen rendered something
actionable, so this stretches [ADR 0027](adr/0027-screen-readiness-ledger.md) and is recorded
rather than left for a reader to discover from a number that looks like every other paint.
The user is on a spinner for the whole run; the destination view's own paint is a SEPARATE
run, which is the shape `screen-with-two-loads-is-two-runs` already established. `variant`
names WHICH load — `start` for a cold start or session reset, `connect` for a submitted
server — because the fills already say where it routed.

Two alternatives were rejected. **Painting at `NavigationEnd`**, which would be a true paint,
is unreachable: sgRouter resolves on the RENDER thread and this ledger's state lives on the
main thread's `m`, so closing the run there would mean a scene field plus an event-loop branch
— shipped app code existing only for measurement, which the ledger's own header reserves for
milestones genuinely worth it. **A second measurement family** with no paint/settle at all
would be the most literal answer, and it was rejected because it buys honesty this note buys
for free while giving up the property that has held for three component shapes: one
`screen-load` family, `scripts/measurements.js` unchanged.

The constraint worth re-evaluating: **for this component the paint/settle split says nothing
— read the FILLS.** Every fill is a synchronous main-thread call already resolved by the time
the handoff happens, so `settled` lands on the same millisecond as `paint`, exactly like the
`query` variant of `search`. That is not a defect of the instrument, it is what makes it
useful here: measured on `.177` the run's own 490-552 ms decomposes into `session` (the
`AboutMe` round trip, 29-47 ms) and `userLoad` (`user.Login` reading the user's settings out
of the registry on the main thread, ~350-460 ms). A single fill read as "the server took
460 ms" when the server took 40. If a future change makes the handoff itself expensive, or
moves the bootstrap off the main thread, revisit whether the split starts carrying meaning.

## decision-id: flag-names-assert-state-not-action

**date**: 2026-08-15
**status**: accepted
**related-files**: scripts/measure-args.js, scripts/measurement-guard.js

A measurement flag is named for the STATE it asserts, never for the user action that
produces that state — because the action's ambiguity is inherited by the name. The flag
declaring that the app has no server was first called `--signed-out`, borrowing the app's
own word, and that word describes a DIFFERENT state: `SignOut()` (app menu → Sign out) and
`SignOut(false)` (→ Change user) both clear `active_user` and leave `server` in place, so
both land on `userSelect` — where the flag refuses. Only Change server
(`unsetSetting("server")` + `server.Delete()`) produces what it asserts.

The cost was paid before anyone typed it: four wrong sentences across the arg parser, two
error messages and the project plan, plus a closed loop where an operator measuring
`userSelect` is told to sign out, does, is refused by tier 1, and is pointed at the one menu
item that takes them off the screen they were trying to measure. Renamed to `--no-server`,
which reads as the plain negation of `--server <url>` and cannot drift, because the state it
names is the state tier 1 checks.

Rejected: keeping the name and fixing the prose around it. The prose had already been written
four times and was wrong four times, which is the evidence that the name — not the writing —
was doing it. Related to [`intent-based-naming`](../.claude/rules/intent-based-naming.md),
which covers naming by goal over mechanism; this is the narrower case where two nearby STATES
share one colloquial word, so the fix is precision about which state, not intent-vs-mechanism.

## decision-id: environment-keyed-variant-is-two-populations

**date**: 2026-08-15
**status**: accepted
**related-files**: scripts/measure-selection.js, components/config/SetServerScreen.bs

A measurement series whose LAUNCHES stamped different `variant` values is REFUSED a median,
not warned about. This extends [ADR 0028](adr/0028-mount-identity-component-and-variant.md),
which established `variant` as half of a mount's identity on the assumption — true of every
instrument until now — that it is a property of what the navigation opened (the item type,
the library type) and therefore constant across a series by construction. `setServer` breaks
that: it stamps `discovered` when SSDP answered THAT launch and `savedOnly` when it did not,
so which one you get is decided by the ENVIRONMENT, and an intermittent LAN yields a series
that is two populations with nothing per-launch to flag.

Refused rather than warned because the failure is in the RECORD, not the console: with no
variant named, `measure.js` writes `screenVariant` from the FIRST sample, so a six-and-nine
split publishes a median over both populations, carrying the name of whichever variant
the first launch happened to draw — well-formed, and undetectable by any later reader. A warning prints once and is
gone; the record persists. The refusal nulls both selection fields and leaves
`observedVariants` to say what was actually seen.

Counted over the SELECTED samples, never all of them: a no-server launch legitimately mounts
`preLogin/start` alongside `setServer/savedOnly`, so the naive form fires on every correct run
of the screen that motivated the check — and a refusal that fires routinely is worse than
none, the same reasoning the readiness ledger uses to stay silent on an ordinary post-settle
refresh. Checked AFTER the per-launch ambiguity refusal, so a launch offering several mounts
is reported as that instead, since its message already asks for the flag that resolves both.

## decision-id: measure-loop-throws-not-exits

**date**: 2026-08-16
**status**: accepted
**related-files**: scripts/measure-loop.js, scripts/measure.js

`runSeries` throws a typed `NavFailedError` when a navigation cannot reach its screen,
where the inline loop it replaces called `refuse()` and exited the process. The entry point
catches it and refuses with the identical message, so single-device behavior is unchanged —
this changes a contract, not what an operator sees.

Two things forced it. A `process.exit` inside the loop cannot be caught, so the rule it
implements could not be tested at all: a nav that cannot reach its screen once will not reach
it on the remaining launches, so the series is ABANDONED rather than retried — one of the few
behaviors in this subsystem worth pinning, and there was nowhere to pin it. And the
multi-device driver that `measure-single-device-only` described (since shipped as
[`npm run measure:devices`](../scripts/measure-devices.js), and the slug retired) has to
record one device as blocked and carry on; an exit inside the per-device loop takes the
whole matrix down with it. Rejected: keeping `refuse()` inside the extracted
loop, which would have preserved today's behavior exactly and left both problems in place.

## decision-id: matrix-seed-pins-the-locale

**date**: 2026-08-16
**status**: accepted
**related-files**: scripts/measure-signin.js, scripts/measure-devices.js, tests/rta/lib/seed.js

`measure:devices --sign-in` seeds every device with `RTA_CONFIG.languages[0]`, so a matrix
measures every tier in one language regardless of what each device carried. Rejected:
preserving each device's own `globalTranslationLocale`, which the snapshot already has in
hand and which costs two lines. That option reads as the more conservative one — the seed
would then change only the session, matching the mode's own "restored to the state it was
found in" promise — and it is in fact the confounded choice: a matrix exists to compare
HARDWARE, so a row measured in `fr` beside one in `en_US` differs in workload as well as in
silicon, which is the same class of confound `--server` was made a hard refusal over.

The cost is real and is disclosed rather than dismissed: a seeded series and a plain
`npm run measure` series on one device need not have run in the same language, and
`measurements.jsonl` carries no locale field to tell them apart. Both tools print the locale
and [`rta-tests.md`](dev/rta-tests.md) documents the pin; carrying it in the record is
tracked under `measure-record-assembly-untested`, deliberately blocked on checking whether
the app exposes the active locale where `IDENTITY_REQUESTS` could batch-read it. Re-evaluate
if the matrix ever needs to COMPARE locales rather than hold them still — that is a different
measurement, and it wants `--locale` as an explicit arm rather than this default flipped.

## decision-id: restore-path-stays-lock-free

**date**: 2026-08-16
**status**: accepted
**related-files**: scripts/measure-signin.js, scripts/rta-restore.js, scripts/measure-devices.js

The sign-in child of `measure:devices --sign-in` takes the device lock, as `measure.js` does
for the series it drives. The restore that follows it — `rta-restore.js`, spawned per device
— deliberately does not, even though it writes the registry too. Rejected: locking both,
which is the symmetric-looking answer.

The asymmetry is about what each window can damage, and about who needs the tool. The
sign-in window is the one that POISONS: a concurrent run whose `snapshotRegistry()` lands
while a device is seeded adopts our seed as that user's own state and then restores it
faithfully forever — the compounding damage [`registry.js`](../tests/rta/lib/registry.js)
was written to prevent, reached from outside. The restore window cannot do that; the worst
it hands a contender is a mid-write registry, and the common case is a cleaner one. Against
that, `rta:restore` is the documented repair for a device stranded by a run that DIED — and
a repair tool the dead run's own leftover lease can block is unavailable exactly when it
is needed, leaving `node scripts/device-lock.js release` or a ~15-minute wait as the only way
out. Worth re-evaluating if the lock ever grows a "steal for repair" mode, which removes the
objection entirely.

## decision-id: overhang-username-trigger-stays-fixed-width

**date**: 2026-08-16
**status**: accepted
**related-files**: `components/ui/dropdown/JRDropdown.xml`, `components/ui/dropdown/JRDropdown.bs`, `components/JROverhang.bs`

The overhang user menu's trigger label keeps a fixed `width="150"`, and long usernames
truncate mid-character. Both obvious improvements were measured and rejected. **Widening**
is blocked on the right: the trigger is anchored at x=1450, putting its right edge at
x=1660, and the clock's left edge sits at x=1691 for a two-digit hour — `31px` of gutter, so
the cap cannot move while that anchor holds. **Shrinking the trigger to its text** is worse
than it looks: the menu is left-aligned to the trigger and expands rightward at
`max(300, buttonWidth)`, and in clock-hidden mode `JROverhang.positionUserDropdown` computes
the left edge as `1824 - triggerWidth - 15`, so a narrower trigger pushes the menu *right* —
a prototype put a short username's menu at 1678..1978, i.e. `58px` off a 1920 screen.

The cost is a fixed `150px` box that reserves space short names don't use, which shows as a
gap inside the focus highlight and as the name sitting left of the action-safe edge when the
clock is hidden. That is accepted. Measured on device at `fontSizeMedium`, `150px` holds about
9 mixed-case characters, so truncation is common rather than exceptional — the trigger must
therefore never set `ellipsizeOnBoundary`, which drops a too-long single-word name entirely
(issue #798). Worth re-evaluating if the trigger is ever re-anchored to grow leftward, which
removes both objections at once but moves the search/settings icons with it.

## decision-id: calibration-plain-arm-flips-the-flag

**date**: 2026-08-17
**status**: accepted
**related-files**: `scripts/measure-arms.js`, `tests/rta/lib/driver.js`, `docs/adr/0030-non-odc-arm-identity-by-enclosure.md`

The ODC calibration's `plain` arm drops the on-device component AND restores
`ENABLE_RTA=false` in the staged manifest, rather than dropping the component alone as
[ADR 0030](adr/0030-non-odc-arm-identity-by-enclosure.md) originally specified. That ADR
assumed `injectTestingFiles: false` skips both jobs; it skips only the injection — the
manifest rewrite sits outside that option's guard (`RokuDevice.js:71-76`) and `#if` is
evaluated on the device from the shipped manifest, so the component-only arm would still
run every `#if ENABLE_RTA` block. Three reasons to flip it: the resulting build is
byte-for-byte the state the non-RTA n=30 baselines were taken on, which is the
comparability harm this calibration exists to close; nothing then has to be argued
negligible, since the leftover hooks (`m.global.addFields({rtaSkeletonHoldMs: 0})` and a
`createObject` for a node type that is no longer there) are removed rather than dismissed;
and `provenance.enableRta` stays a true statement about the build instead of reading
`false` about a manifest saying `true`.

The cost is that a delta cannot say WHICH of the two it was. **Rejected: taking all three
arms up front** to decompose it — at n=30 the method resolves ~120 ms and up, and the
leftover hooks are one field-add, so that arm could only ever report "below the floor".
Revisit if a delta ever lands at or above the floor, which is the one case where the
decomposition can return an answer.

## decision-id: calibration-harness-out-of-process

**date**: 2026-08-17
**status**: accepted
**related-files**: `scripts/measure-calibration.js`, `scripts/measure-loop.js`, `scripts/measure.js`

`measure-calibration.js` spawns `measure.js` per block rather than calling `runSeries`
in-process. This is the same conclusion `measure-devices.js` reached, minus its decisive
reason: that driver had to go out-of-process because `roku-test-automation` binds its
client singletons to one host, and this tool only ever talks to one device. What remains
is decisive on its own — a series also needs the device lock, the console socket and its
replay defense, mount selection, the medians, the launch audit and the record assembly,
and that last one is the layer deliberately left untested
([`measure-record-assembly-untested`](architecture/tech-debt.md#measure-record-assembly-untested)).
An in-process harness would have doubled the subsystem's one untested surface to avoid
passing flags to a process that already does the job.

**Rejected: the in-process shape `measure-loop.js`'s own header predicted.** That
extraction named the multi-device driver and this harness as the two callers that would
otherwise duplicate the replay defense; both went the other way, so the module has one
caller and its header is corrected rather than left claiming otherwise. The extraction
still earned itself on testability (16 unit tests over window arithmetic that had none) —
which is worth separating from the reuse argument, because the reuse argument is the one
that did not hold. Consequence: the record a block publishes is assembled by the same code
a single-device run uses, so the calibration cannot drift from `measure` in what it records.

## decision-id: matrix-report-is-a-reader

**date**: 2026-08-16
**status**: accepted
**related-files**: scripts/measure-report.js, scripts/measure-matrix.js, scripts/measure-devices.js, scripts/measure.js, docs/dev/measuring-performance.md

The screen × RAM-tier matrix is a **reader over `.device-runs/measure/measurements.jsonl`**,
following the `flake-baseline.js` pattern — not a report the multi-device driver prints at the
end of its run. Every `measure` invocation appends one line per series, so a reader can rebuild
the matrix from runs taken weeks apart, on devices that were never on the LAN at the same time.
No matrix has ever in fact been taken in a single run: the three tiers were measured on separate
days, and the 512 MB device had to be signed in and restored around its block.

**Rejected: an in-process report from `measure:devices`.** It can only ever describe the run
that just finished, which is the one shape the data does not have. It would also have to hold
every device's samples in memory to compare them, re-implementing selection rules that
`measure-compare.js` already owns — and a second implementation of "which sample is the cold
one" is exactly what `measure-selection.js` exists to prevent (that rule was implemented three
times and two were wrong).

**The consequence is what makes this worth recording.** `measure.js`'s record assembly does NOT
need extracting for any phase of this work, because the reader consumes the artifact rather than
the code that writes it. That is why
[`measure-record-assembly-untested`](architecture/tech-debt.md#measure-record-assembly-untested)
stays filed as tech debt rather than becoming project work. Re-evaluate if a matrix ever needs a
figure the ledger does not carry — that would be a reason to change what `measure` RECORDS, not
a reason to move the report in-process.

## decision-id: home-row-removals-deferred

**date**: 2026-08-10
**status**: accepted
**related-files**: `components/home/HomeRows.bs`, `source/home/latestRows.bs`

During a latest-rows run, a Home row **that run delivers** whose library returned nothing is QUEUED for removal rather than removed on the spot, and the queue is drained — followed by a single `setRowItemSize()` — when the run ends. An empty library therefore keeps its skeleton for the rest of the run, which is already how a FAILED library's row behaves.

Two cheaper-looking shapes were built and measured before this one, so both are closed questions rather than untried ideas. Flushing the recompute at `onLatestRowsReady`'s drain loop coalesces nothing — the orchestrator delivers one row per observer wake, so 11 rows arrive over 11 wakes. Deferring only the RECOMPUTE while removing rows immediately is a visible bug: the row list shrinks while the three geometry arrays still describe the old one, so rows below a removal draw at their neighbor's size for ~1 s of first paint. Keeping tree and arrays in step is what makes the batching safe. Evidence and numbers live in [`home-row-size-recompute-per-row`](architecture/tech-debt.md#home-row-size-recompute-per-row).

**The batch stops at the run's own rows, and that scope is deliberate rather than inherited.** `populateRowFromData` serves every Home section, so a component-wide flag also swallows `resume` / `nextup` / `livetv` / `activeRecordings` removals — which it silently did at first, because the flag arrived by substituting `rowStructureChanged()` at every existing call site. Two reasons it does not stay that way. Those four are fired by `startParallelLoads`, which RACES the orchestrator, so whether a Continue Watching row collapses immediately or at the end of a run would depend on which HTTP response won — the same server, twice, two behaviors. And the queue is keyed by `sectionId` and held to the end of the run while `onProgramsExpired` and `Home.refresh()` can both re-fire those tasks mid-run, so a stale entry could delete a row that had just been repopulated. `latestRows.removalIsDeferrable` is the seam and is unit-tested.

Accepted trade-off: an empty library's skeleton persists to the end of the run instead of vanishing mid-load, in exchange for one row-size recompute per load instead of one per empty library. The re-insert branch is deliberately NOT batched — an insertion is the same defect mirrored (row list longer than the arrays), and it is rare where removals are one per empty library on every load. Nor are the four parallel sections: a recompute only fires for a section that returned EMPTY, and at most four exist (two only with Live TV configured), so declining to batch them costs 0 for a user with watch history and ~2 on a fresh account. **Tripwire:** re-open if the lingering skeleton ever reads as a stall, if a measurement shows the single recompute dominating on a large library set, or if a measurement shows those eager per-section recomputes exceeding the bound above — which would justify batching the whole Home load, at the cost of a multi-condition close and a watchdog.

## decision-id: spellchecker-sentence-final-dictionary

**date**: 2026-08-19
**status**: accepted
**related-files**: `.spellcheckerrc.yaml`, `dictionary.txt`, `dictionary-sentence-final.txt`, `scripts/generate/sentence-final-dictionary.js`

`retext` looks a paragraph's final word up WITH its period attached when the next block is a lowercase heading, a list, or a blockquote. Base-dictionary words survive that; `dictionary.txt` entries are matched as anchored regular expressions and do not — so a paragraph ending on one of our own words fails the lint. The `## decision-id: <slug>` schema of this very file is that shape, which put the trap inside the sanctioned `/log decision` path. The fix is a GENERATED companion dictionary holding each entry's sentence-final form, not a rule that ignores the reported token.

**The `ignore:` regex shape is ruled out, and it was tried first here.** An `ignore` entry broad enough to cover a glued sentence-final period also stops reporting genuine typos in the same position — measured at 47 paragraph-above-a-list sites across 24 of 88 linted files, growing with the docs, and its own comment understated the loss as "directly above a lowercase heading" when a list or a blockquote does it too. Adding the period-forms to `dictionary.txt` by hand is ruled out for a second reason: that had already happened ad-hoc (`codebase.`, `globals.`, `lifecycle.`, `lookups.`) and each one also accepted `codebaseX`, because the period was left as a wildcard rather than escaped.

Accepted cost: a committed generated artifact that can go stale, paid for by `dictionary:sentence-final:check` in the `lint` aggregate, in CI ahead of the spell lint, and in pre-push as both an auto-fix regen and a check. **Tripwire:** re-open if the generated file ever needs to diverge from a pure transform of `dictionary.txt`, or if `spellchecker-cli` gains an option controlling how it splits tokens, which would remove the need. Re-proposing the `ignore` shape needs a measurement showing the coverage loss is acceptable — the behavioral suite in `spellchecker-config.test.js` will fail until then.

## decision-id: failed-poster-no-scroll-retry

**date**: 2026-08-21
**status**: accepted
**related-files**: `components/ui/rowitem/JRRowItem.bs`, `components/ItemGrid/GridItem.bs`, `source/utils/textureManager.bs`, `source/utils/cellLoad.bs`

`reloadTexture` / `reloadGridTexture` gate on `isTextureUnloaded` rather than comparing the live poster URI to the cached one. Three paths leave a poster URI empty with the real URL still cached — eviction to free memory, a deferred off-screen bind, and the failure glyph — and only the first two want the image back. The URI compare could not tell the third from the other two, so a broken image was re-requested every time its cell came back into range: 103 glyph wipes per extras sweep on cells that were not moving, which is what reads to a user as blinking.

**What this closes off is retrying on scroll position.** It had no backoff, no attempt limit, and keyed on which way the user was scrolling rather than on elapsed time; it was a side effect of using URI equality as a proxy for "needs a texture" rather than a retry policy anyone designed. A deliberate one would be bounded and timed, and is left open as tech debt rather than folded in here.

**The constraint worth re-evaluating is the failure population, and the first answer to it was wrong.** The suppressed retries ARE the failed loads, so on a library whose artwork fails transiently this would suppress real recoveries. Measured 2026-08-21 on a 1 GB Stick 4K across three commit-pinned arms at n=10 each, it suppresses ~97 retries per extras sweep and costs zero recovered images: `loadsSucceeded` reads exactly 1 on all 30 launches in every arm. That figure is only trustworthy because the same branch added the counter — the earlier inference `loadsStarted - loadsFailed` put successes near 23, and the gap was requests still outstanding at the emit boundary rather than images that had arrived. Unmeasured on any other library, so the tripwire is a library whose person artwork exists and fails intermittently.

## decision-id: appearance-signal-gates-departure-only

**date**: 2026-08-22
**status**: accepted
**related-files**: `source/utils/cellLoad.bs`, `components/ui/rowitem/JRRowItem.bs`, `components/ItemGrid/GridItem.bs`, `tests/rta/specs/cell-load.spec.js`

The pop-in ledger scores an appearance off the compositor's `renderTracking`, not the app's own `getRowPosition()` + `isInHorizontalBuffer()`. The horizontal half of that model assumes the focused column is the leftmost visible one — an assumption the buffer arithmetic makes and that has never been verified — so scoring the buffer against its own coordinate system would bake an unverified premise into the number the buffer is judged by.

**Only the DEPARTURE is gated on `textureManagerState = "active"`, and the asymmetry is the decision.** `evaluateTextureState` already refuses `renderTracking` in `init` (a layout recalculation) and `hidden` (`visible=false` propagating when a screen is pushed over), and `noteAppearance` has to refuse it in the same two states: closing an episode there re-arms the once-per-episode gate, so the screen's return scores appearances nobody saw. Measured on the demo server before the gate, backing out of one item detail with no scrolling — 18 appearances against 10 binds, 0 pop-ins. Because `hidden` deliberately freezes textures loaded, every one of those is a guaranteed non-pop-in, so the error is one-way: it inflates the denominator of `popIns / appearances` in the buffer's own favor.

**What this closes off is gating `appeared()` as well, which is the symmetric-looking fix and is wrong.** An appearance is idempotent within its episode, so an ungated `appeared()` cannot double-count; and first paint legitimately happens while the manager is still `init`, because `activateTextureManager` runs only once initial content has loaded. Gating it would have silently deleted `popInsFirst` — 17 of the 24 pop-ins on a grid sweep. The constraint worth re-evaluating is that this rests on `textureManagerState` remaining the app's authority on whether a screen is really on screen; a fifth state means revisiting the gate, not extending it.

**No sweep measurement can catch a regression here**, which is why the invariant is gated on device instead. `cellSweepGrid` reads identically with and without the gate — 46 appearances, 24 pop-ins, 6 cold, 1 reload, 17 first, on every one of 5 launches in both arms — because a sweep never suspends its screen. [`tests/rta/specs/cell-load.spec.js`](../tests/rta/specs/cell-load.spec.js) asserts `appearances <= binds` for a resume with no scrolling, which fails at 18 vs 10 when the gate is removed.

## decision-id: settle-gate-kept-for-its-null

**date**: 2026-08-22
**status**: accepted
**related-files**: `tests/rta/lib/steps.js`, `tests/rta/lib/nav.js`, `docs/dev/measuring-performance.md`

`waitRowsSettled` was built to remove `cellSweepHome`'s bind variance and does not remove it. It is kept anyway, and the null result is the reason rather than a caveat attached to one. A 40-launch alternated campaign (n=20/arm, `.177`, build `ad944494`) put `binds` at 235–255 in BOTH arms, medians 242 and 242, |z| < 1.7 on every field — so the gate buys no dispersion at all, and the n=5 pilot that appeared to pin four fields was noise.

**What it is kept for is the precondition it prints, which nothing else could certify.** On all 20 gated launches it reported Home's rows already stable at gate-open (`settled in 1983–2048 ms`, the `quietMs` floor plus one poll), which is what converts "the sweep might be reading a half-built screen" from an untested hypothesis into a fact on every run. The ledger's `items` cannot do this: `cell-load` counts it at EMIT time, so it certifies the structure the sweep ENDED on and reads identically whether the sweep traveled a whole screen or a half-built one. Cost is ~2 s per `cellSweepHome` launch, on a nav that also runs once per full `test:rta` pass.

**This closes off two things.** Deleting the gate and keeping only the write-up: that leaves the strongest harness-side refutation resting on a paragraph, where the next session re-derives it — the campaign cost 40 launches and a printed line inherits it for free. And threading the settled sample into `sweepRowList` to save its re-read: the gate's one self-undetectable failure is firing early during a mid-build lull, and two independent observations are the only thing that can catch it. Made authoritative, the itinerary would agree with the settle BY CONSTRUCTION — reintroducing, one layer up, exactly the weakness that makes the ledger's `items` a poor certificate. The re-read costs two round trips against the ~2000 ms the gate already spends.

**The constraint worth re-evaluating is the justification itself, not the gate's cost.** It rests entirely on the printed precondition being worth ~2 s per launch, which holds while Home's spread is unexplained. If Phase B finds the app-side mechanism in `HomeRows` / `JRRowItem`, that premise expires and the gate should be re-examined rather than kept by inertia — the null result stays true either way, but "we still don't know why" stops being the reason to keep paying for the check.

## decision-id: one-overlay-dialog-supersedes

**date**: 2026-08-22
**status**: accepted
**related-files**: `source/utils/dialogs.bs`, `source/replayRoute.bs`, `components/dialogs/JRDialog.bs`, `components/dialogs/JRListDialog.bs`, `components/OverviewDialog.bs`

`presentOverlayDialog` cancels an already-open overlay before appending a new one, so exactly one is ever on screen. Roku's modal channel (`m.scene.dialog`) is single-slot — the OS replaces the incumbent — and the #288 phase-3 migration moved the four main-thread flows off it without replacing that guarantee. Two overlays then stacked under the shared `jrDialog` id, leaving `findNode` resolving to the corpse and the lower dialog visible but deaf. Reachable via remote control, which is sender-driven rather than human-paced: two casts in flight, or a `DisplayMessage` landing while the server-switch prompt is up.

**What this closes off is a per-caller guard.** The obvious fix — the guard `JRScene.showExitConfirmation` already carries — is wrong for the server-switch flow and would have to be written correctly at every future main-thread call site. `dispatchPlay` overwrites the stashed deep link *before* `promptServerSwitch` runs, so ignoring the second cast freezes a prompt naming item A over a stash holding item B. Superseding also means callers need no code at all: port delivery is asynchronous, so a superseded dialog's canceled result reaches `Main()` only after the flow has re-pointed at its new dialog, and the existing `isSameNode` guard rejects the stale one. The earlier choice — warn and stack — was correct only while there was no way to close someone else's dialog without stranding its owner; `cancelDialog()` is that missing primitive.

**The constraint worth re-evaluating is that this covers the OVERLAY channel only.** `cancelOpenDialog()` reaches both channels; the supersede deliberately does not. Canceling an open keyboard dialog is action-safe — all ten `result.confirmed` consumers in app code gate positively — but it discards what the user has typed, a materially worse trade than closing a yes/no prompt. So both channels can still be open at once with nothing arbitrating between them; that gap is filed separately in `tech-debt.md`.

## decision-id: task-fanout-keys-on-argument

**date**: 2026-08-22
**status**: accepted
**related-files**: `scripts/bsc-plugins/no-task-fanout.cjs`, `bsconfig.json`, `bsconfig-prod.json`, `docs/architecture/build-and-tooling.md`

The `no-task-fanout` plugin keys on the launched ARGUMENT's stability, not on the presence of a loop. A `launchTask()` inside a `for` / `for each` / `while` body is an Error unless its argument is a stable dotted path rooted at `m` **that the loop body does not rebind** — such a path names ONE node however many times the loop turns, so the thread count is bounded by the number of distinct field paths written in source rather than by the collection being iterated. An indexed step (`m.tasks[i]`), a loop variable, or a call result is flagged. So is a stable path the body reassigns (`m.loader = createObject(…)` then `launchTask(m.loader)`): that is a fresh node per turn wearing a stable name, and it is the first thing someone reaches for to clear the diagnostic, so leaving it exempt would have left the rule one token away from being bypassed. All three write spellings are read — `m.loader = …`, the literal-key `m["loader"] = …`, and a literal-AA `setFields` / `addFields`, which is the spelling `globals.bs` actually uses to park a Task node — so the exemption cannot be recovered by changing how the assignment is written.

**This closes off two rules that are more obvious and both wrong.** A blanket "no `launchTask` in a loop" would have failed the codebase on day one: `HomeRows.startParallelLoads()` legitimately loops over `m.sectionPlan` and launches four fixed singleton slots, each flag-guarded. A construction-site rule ("no `CreateObject(..Task)` inside a loop") is simpler to implement but guards the wrong event — construction costs nothing, the launch spends the thread — and misses a helper that builds the node outside the loop body. Validated against the real crash rather than a synthetic case: run over `HomeRows.bs` as it stood at `c59e96a1^` — with that file's raw `control = "RUN"` writes rewritten to the `launchTask()` form, since the `no-raw-run` migration came later — the rule reports exactly one diagnostic, the per-library `launchTask(loadLatest)` that caused `&h29`, and leaves the six in-loop `m.LoadXTask` launches in that same file alone.

**The constraint worth re-evaluating is the two accepted interprocedural gaps**, neither closable without call-graph analysis: a loop calling a helper that launches internally, and a local aliased to a stable slot before the loop (flagged though safe — contrived, absent from the codebase, and covered by the escape hatch). Alias-awareness is what `observe-without-on-destroy` pays real complexity for; there its false positives are routine, here they are hypothetical. If either gap produces a real miss or a real false positive, that is the evidence to revisit — not the theoretical incompleteness.

## decision-id: quickconnect-flow-owned-by-the-screen

**date**: 2026-08-23
**status**: accepted
**related-files**: `components/login/UserSelect.bs`, `components/dialogs/QuickConnectDialog.bs`, `source/utils/dialogs.bs`, `source/utils/quickConnect.bs`

Quick Connect's three requests — initiate, poll for approval, exchange the secret — run in `UserSelect`, and `QuickConnectDialog` is a pure view that shows a code and a Cancel button. The dialog used to own all of it, plus a `QuickConnect` Task node it re-created on every 3-second poll and a `user.Login()` call on that task thread.

**This split is forced, not stylistic, and that is the part worth keeping.** `fetchAsync` bridges the pool to a promise through a *named* render-thread `observeField`, which has no closure — so the pending-request registry lives on the `m` of the component that called it (`m.__apiPromisePending`, see `source/api/apiPromise.bs`). A dialog therefore cannot own a promise chain whose results a screen must act on: the callbacks would run in the dialog's `m`, and the dialog is a node the flow deletes halfway through. The same property is what makes `abandonApiPromises()` correct in the owner's `onDestroy` and nowhere else. So the general rule this closes off is "make the dialog self-contained": for any dialog-driven async flow, the SCREEN owns the chain and the dialog owns presentation and a `result`.

**The constraint worth re-evaluating is the main-thread hand-off at the end.** `user.Login()` reads and writes the registry, so it cannot move to the render thread, and `fetchAsync` cannot move to the main thread — the flow is split across both by construction, joined by one `preLoginIntent`. If BrighterScript ever ships `await`, or the registry gains an async read path, that seam is the thing to revisit; nothing else here would change.

## decision-id: prelogin-sync-is-a-call-site-constraint

**date**: 2026-08-23
**status**: accepted
**related-files**: `source/api/ApiClient.bs`, `source/loginRouter.bs`, `docs/architecture/tech-debt.md`, `docs/architecture/api.md`

The remaining synchronous `sdk.*` calls on the bootstrap path stay synchronous because of where they are CALLED, not because the API pool is unavailable. Both `api.md` and the `apiclient-sync-pool-coexistence` tech-debt entry said the opposite — "the persistent task pool isn't available pre-login" — and it was measurably wrong: `setGlobalNodes()` starts the three `ApiTask` slots and `ApiQueueTask` inside `Main()` *before* `reenterLogin()`, and `UserSelect` has issued pre-login `fetchAsync` calls since #551.

The real constraint is narrower. `fetchAsync` registers a named render-thread observer, which Roku dispatches only inside a SceneGraph component; `main.bs` and `source/loginRouter.bs` run on the main thread, where named observers never fire. **So migrating one of the survivors is a call-site move, not a plumbing change** — push the request down into the render-thread component that wants the answer and hand the coordinator only the finished result. That closes off the direction the entry used to imply (make the pool reachable from the main thread, or wire `promises.setMessagePort`/`wait2` into `Main()`'s loop), which would have been real work aimed at a problem that does not exist. Quick Connect is the worked example: three endpoints moved to `Build*Request()` builders driven from `UserSelect`, while `user.Login()` stayed on the main thread because it touches the registry.

The premise survived this long because it is plausible and nothing could contradict it — no gate reads a prose claim. Worth re-checking the same way if another "the pool can't do X" statement turns up.

## decision-id: rta-approves-its-own-quickconnect-code

**date**: 2026-08-23
**status**: accepted
**related-files**: `tests/rta/specs/quick-connect.spec.js`, `tests/rta/lib/jellyfin.js`

The RTA suite tests Quick Connect end to end by approving its own code: `POST /QuickConnect/Authorize?code=` with the authenticated session the suite already holds. Quick Connect had shipped for years with no functional coverage because approval is, by design, a human on a second device — and there is no second device in the harness.

**The move that generalizes is to ask what the missing actor actually needs to be.** "Needs a second device" was really "needs a second authenticated API caller", and the suite had been one since it started seeding registries. Verified against the live server before the test was written (initiate → authorize → connect reports `Authenticated` → exchange returns an `AccessToken`), per the `tests/rta/CLAUDE.md` rule about checking a capability-dependent assertion against the real server first; an unknown code answers 404, so the helper throws rather than returning false.

**Two constraints ride along.** The spec skips rather than fails when the server reports Quick Connect disabled, because that is a fact about the fixture — which matters more now that `RTA_CONFIG.server` can be aimed at another server via `RTA_SERVER_URL`. And it answers the save-credentials prompt "No", so a run signs in without writing an `authToken` into the device registry; `scripts/rta-run.js` would restore it either way, but the test does not lean on that.

## decision-id: session-established-is-its-own-signal

**date**: 2026-08-24
**status**: accepted
**related-files**: `source/utils/session.bs`, `source/loginRouter.bs`, `components/data/jellyfin/JellyfinUser.xml`

"Is a user signed in?" is answered by one field that ONLY a completed `user.Login()` sets — `JellyfinUser.isLoaded`, read through `user.IsAuthenticated()` — and it is checked in exactly one place, `finishLogin()`, which every login path converges on.

**The alternative this closes off is the obvious one, and it does not work.** `user.Login()` is a `sub`, so it cannot report that it refused; the natural fix is to make it `function ... as boolean` and branch at all five call sites, which is what the `userlogin-failure-unreportable` tech-debt entry proposed. That fixes who-can-ask but not what-they-can-ask-about: `m.global.user` is written **speculatively** before any authentication — `onUserSelected` sets `id` off the picker, and `validateSavedToken` sets `authToken` as its first statement — and neither is rolled back on failure, because the failure path clears the registry rather than the node. So after a rejected token the node still carries both fields, and the rule `JellyfinUser.xml` states ("if `user.id <> ""`, user IS authenticated") is false in practice. A boolean return would have left every later reader — Home, `buildAuthHeader()` — still unable to tell.

**The speculative writes are the constraint worth re-evaluating, and they are not sloppiness.** `validateSavedToken`'s is load-bearing: `AboutMe()` reads the token straight back off the node through `buildAuthHeader()`, so removing it means threading the token explicitly through the bootstrap path both cold start and user-pick depend on. That was judged too much risk for the same user-visible outcome, so the decision is a signal only a *completed* login sets, rather than an attempt to stop the node from ever lying. If that path is refactored for another reason, dropping the speculative writes would let `IsAuthenticated()` fall back to the simpler rule.

**Guarding at the choke point rather than at the five call sites is the other half.** All five converge on `finishLogin()` — the two bootstrap paths via `enterDecision`'s `status = "success"` branch — so one guard covers every path and a sixth login path inherits it instead of having to remember it. A return value nobody is forced to check is weaker than a guard nobody can bypass.

## decision-id: dialog-family-has-one-layout-shape

**date**: 2026-08-24
**status**: accepted
**related-files**: `source/utils/dialogLayout.bs`, `components/OverviewDialog.bs`, `components/dialogs/JRDialog.bs`, `scripts/bsc-plugins/no-hand-rolled-dialog.cjs`, `docs/architecture/dialogs.md`

`computeDialogLayout` has exactly one shape: the footer flows INSIDE the panel, and the panel is derived from its content. The `footerInside` and `panelHeight` parameters are deleted, not deprecated — both existed for `OverviewDialog` alone, and a dialog that does not fit is now answered by clamping the body at the ceiling rather than by adding a third mode.

**Both exceptions were recorded decisions, and neither survived a render.** The outside footer was justified on the grounds that a panel this large still reads as owning a button beneath it; a before/after capture on device showed the opposite — the button read as floating on the dimmed backdrop, with roughly 350 pixels of dead panel above it, which is the space it now occupies. It also cost a SECOND ceiling: a footer below the panel is not part of `panelHeight`, so `PANEL_MAX_HEIGHT` said nothing about it, and a panel at exactly the ceiling put a 72-pixel button 18 pixels off screen while reporting no overflow. One footer placement means one ceiling covers both.

**The fixed panel was half-true reasoning, and it was the wrong half.** "A scrolling body cannot decide its own size" is correct about height and irrelevant to the decision: the panel WIDTH is what decides where text wraps, and the width is fixed, so the text's natural height is fully known before any height decision. `JRDialog` had been sizing itself this way all along. What the scroll viewport actually needs is a body height it can compare content against, and the clamp supplies exactly that — so `overflows` now means "the body did not fit", and the two answers to it stay with the callers who differ: `JRDialog` truncates to `body.height` worth of lines, `OverviewDialog` scrolls at that height. Neither re-derives the ceiling.

**What this closes off is the cheap answer, not a considered one.** The next dialog that does not fit the flow will be tempting to serve with another parameter, which is how the two deleted modes arrived. The rule is that a bespoke dialog may bring its own BODY (`QuickConnectDialog`'s code at `fontSizeLargest` is the worked example) and never its own geometry. Convention already failed here once — three components each held a private copy of the chrome, and restyling one silently left two behind with every gate green — so the rule is backed by the `no-hand-rolled-dialog` BSC plugin rather than by agreement. The plugin catches structure (a hand-rolled backdrop, a hand-rolled scene append) and cannot catch a bad interaction design; `docs/architecture/dialogs.md` carries that judgment.

**The constraint worth re-evaluating is the clamp's silence.** A body that gets clamped is told only through `overflows`, and a caller that ignores the flag gets a quietly shortened body rather than an error. That is the right default for the two callers that exist, both of which read it. A third caller that wants neither truncation nor scrolling would need a real answer rather than a third mode.

## decision-id: home-feeds-are-sized-worklists-are-not

**date**: 2026-08-26
**status**: accepted
**related-files**: `components/home/LoadItemsTask.bs`, `components/home/LoadLatestRowsTask.bs`, `source/utils/config.bs`, `settings/settings.json`

`uiHomeRowLimit` sizes Home's browse FEEDS — Recently Added, On Now, Active Recordings — and deliberately does not reach Continue Watching or Next Up. The line is feed vs worklist. A feed is a SAMPLE of a larger set, so a limit picks how much of the sample to show and raising it hides nothing. A worklist is a set the user is trying to get THROUGH, where any cap hides something they have already started and no number is the right one to hide at. Next Up's `limit = 69` is therefore REMOVED rather than folded into the setting; Continue Watching has always sent none, and that silence is now an explicit comment on both rather than an omission a reader has to guess at.

**What this closes off is the tidy answer.** The three feeds previously agreed on 16 only because three files said so in comments (*"16 to be consistent with Latest In"*, *"parity with `onNow`"*), and the obvious cleanup is to sweep every Home row onto the one setting so nothing is special-cased. That would be a regression in two directions at once: it would put a cap on Continue Watching where none has ever existed, and it would re-cap Next Up at whatever the user picked. The Favorites tab is out on a different ground — `itemsToLoad = "favorites"` is loaded by `FavoritesRows` and is not a Home row at all, so capping it would truncate the user's whole favorites list.

**The rationale is not cost, and that matters for re-evaluation.** Measured 2026-08-26 on a Stick 4K against a 13-library server, `attachMs` is FLAT across a 7.4x change in item count (248 ms at 177 items, 271 ms at 1308) because only `TEXTURE_BUFFER_THRESHOLD` textures per row are ever resident and `RowList` virtualizes attach — so an uncapped worklist is not expensive to render, and the marginal cost is 0.76 ms/item of task-thread transform plus server wait. Uncapping Next Up was affordable; it is kept uncapped because capping a worklist is wrong, not because it is cheap. If the cost model ever inverts, that is a reason to revisit the NUMBER, not this rule.

**The constraint worth re-evaluating is the unmeasured tail.** Nobody has measured what Next Up returns on a very large library now that it sends no limit — `disableFirstEpisode: false` may mean it approaches one episode per series rather than only series the user has started, and the cached spec fingerprint carries parameter names without defaults so it cannot answer it. Tracked as an open followup in `docs/progress.md` with the reading that would close it. If it comes back in the hundreds, the answer is a generous cap on a row nobody can scroll to the end of — which is a different decision from this one.

## decision-id: resolution-cap-honors-user-choice

**date**: 2026-08-27
**status**: accepted
**related-files**: `source/utils/deviceCapabilities.bs`, `settings/settings.json`

The Maximum Resolution setting caps at exactly the height the user picked, and is NOT clamped against anything — not against the 1080 fallback the function starts from, and not against the device's current video mode. `getResolutionConditions()` had been comparing the chosen height against `maxVideoHeight`, which at that point is the "in case all our validation checks fail" default rather than a ceiling. So `2160` and `4320` — both offered in `settings.json` — collapsed to a 1080p cap, and on a 4K device the EXPLICIT choice came out more restrictive than the `auto` default it overrides, forcing every 4K source to transcode. A regression from `fd6ed367`; the dead `"2160"` / `"4320"` rows in the function's own `heightToWidth` table are the tell that they were written to be reached.

**Not clamping to the device is the deliberate half, and it turns on a platform fact.** Roku exposes no API for the attached display's maximum video resolution: `GetVideoMode()` reports the CURRENT output mode — the Roku's own Display Type setting, not the panel — and `GetDisplayProperties()` reports physical centimeters plus HDR flags, nothing in pixels. So a 4K TV left on a 1080p Display Type is indistinguishable from a genuine 1080p panel, and a clamp would leave that user no way to say otherwise. This setting is how they say it.

**What this closes off is the restoration.** The obvious fix is to clamp to `m.global.device.videoHeight` — which is what the code did before `fd6ed367`, and is what anyone reading the regression will propose first. It is wrong for the reason above. The other candidate, honoring the value but falling back to the output mode when `CanDecodeVideo()` refuses, was rejected on cost: that API takes codec + profile + level while this cap applies across every codec, so it would need a guessed resolution-to-level mapping feeding a safety mechanism nobody could test cheaply.

**Safe because the ladder already carries a more permissive rung.** `off` returns `[]` and sends no height or width condition at all, so honoring `4k` is strictly NARROWER than an option that already ships. That is also the invariant the tests now pin: a rung at or above what `auto` resolves to must never be more restrictive than `auto`.

**The clamp is rejected on a MEASUREMENT, not on the argument above alone.** Measured 2026-08-27 on a Streaming Stick 4K with Roku's Display Type set to 1080p: `A Man Called Otto` (`3840x2072`, `HEVC` Main 10, `SDR`) with the cap set to `off` played with its video stream COPIED — the playback report's Resolution row read `3840x2072` with no arrow, and the sole transcode reason was `AudioCodecNotSupported`. A 1080p output mode therefore does not stop the device accepting a 4K stream, so honoring `4k` cannot produce the failed direct play a clamp would exist to prevent. The test needed an `SDR` source specifically: every `HDR10` / DoVi 4K file trips an independent range-profile reason first, because `hevcVideoRangeTypes` only gains `HDR10` inside `if canPlay4k()` and `canPlay4k()` returns false below a `2160p` output mode.

**What it does to the transcode path — the one the setting is actually named for.** The setting's own description is *"the maximum resolution when transcoding"*, so the direct-play measurement above does not on its own settle it. Read against Jellyfin `master`: a `LessThanEqual` `Height` condition becomes `item.MaxHeight = Math.Min(...)` in `StreamBuilder.cs`, ships as `&MaxHeight=N` on the transcode URL from `StreamInfo.cs`, and is applied by a resize that only ever SHRINKS — `if (maxHeight > 0 && maxHeight < newHeight)` in `DrawingUtils.cs`. It is a ceiling, never a target, so a 1080p source still transcodes at 1080p under a `2160` cap and nothing is scaled up. The change makes the common case CHEAPER rather than costlier: a failed `Height` condition raises `VideoResolutionNotSupported`, so under the old 1080 collapse the 4K file measured above carried that reason ALONGSIDE `AudioCodecNotSupported` and was forced into a real 4K→1080p video transcode; honoring `4k` lets the video stream be copied and only the audio transcoded. The one case that gets more expensive is a source above 1080 that must transcode video for a NON-resolution reason (unsupported codec, profile, or level) — previously downscaled to 1080, now transcoded at its native height. That is precisely what picking `4k` asks for, and `off` already does the same.

## decision-id: device-profile-omits-unscaled-video-level

**date**: 2026-08-28
**status**: accepted
**related-files**: `source/utils/deviceCapabilities.bs`

A codec whose `VideoLevel` scale is not established in `jellyfinVideoLevel()` ships NO `VideoLevel` condition, rather than a number derived from a plausible-looking guess. The asymmetry is the whole decision, and it rests on how Jellyfin evaluates the field: `ConditionProcessor.IsConditionSatisfied` returns `!condition.IsRequired` when the stream's level is unknown, and our conditions are `IsRequired: false` — so an OMITTED level costs at most one avoidable transcode decision, while a WRONG level silently decides direct play versus transcode for every stream of that codec, in the direction nobody checks. Verified against `ConditionProcessor.cs` at both ends of the server range JellyRock supports (`v10.7.0` and `master`); both read `VideoLevel` as `int?` through `int.TryParse`.

**What this closes off is the MPEG-2 mapping.** Roku names MPEG-2's levels `"main"` / `"high"` and we shipped them straight into a numeric field, so every MPEG-2 stream carrying a level failed the condition and transcoded. The obvious repair — map the words onto MPEG-2's real numeric level scale — is rejected: that scale runs BACKWARDS (High = 4, Main = 8), so a `LessThanEqual` over it asserts the opposite of how it reads, and nobody here has established which of the values `ffprobe` reports Jellyfin would see. Jellyfin's own reference client ships no `mpeg2video` codec profile at all. We keep ours for the resolution, bitrate and `IsAnamorphic` conditions and drop only the level.

**The constraint worth re-evaluating** is that the scale table is an allowlist: `h264` (x10), `hevc` (x30) and `av1` (`seq_level_idx`) have scales, and `vp9`, `vp8`, `mpeg4` and `mpeg2` deliberately do not. A codec added to the device profile later inherits "no level" by default, which is the safe direction but is silent — the gate in `tests/source/unit/utils/DeviceCapabilities.spec.bs` is what makes it visible, by failing any codec that ships a level without a scale.

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
