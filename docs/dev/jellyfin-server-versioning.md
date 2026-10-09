---
topic: jellyfin-server-versioning
related-files:
  - source/api/ApiClient.bs
  - source/api/sdk.bs
  - source/api/sdkV1.bs
  - source/api/sdkV2.bs
  - source/utils/deviceCapabilities.bs
  - source/utils/misc.bs
  - source/utils/languageFilters.bs
  - source/utils/mediaSegments.bs
  - docs/dev/jellyfin-endpoint-availability.yml
  - docs/dev/jellyfin-version-boundaries.yml
  - scripts/lint/apiversion-consistency-check.js
last-reviewed: 2026-10-09
---

# Jellyfin server versions

How JellyRock works with every Jellyfin server from 10.7.0 up: the API tier that picks request paths, the device profile, the guards on endpoints and parameters newer than 10.7, and Quick Connect. At the end: what to do when a release breaks something.

There are two ways the app adapts:

- **The API tier** (`apiVersion`) for changes that cut across the API.
- **A version guard** for one endpoint or parameter that newer servers added or changed.

## The API tier

Jellyfin 10.9 moved the user endpoints off the `/Users/{userId}/` prefix, so the app has two tiers:

| `apiVersion` | Servers | Paths |
| --- | --- | --- |
| `1` | 10.7.x to 10.8.x | `/users/{userId}/items/{itemId}` |
| `2` | 10.9 and later | `/Items/{itemId}?userId=...` |

At login, `source/utils/session.bs` sets `m.global.server.apiVersion` from `resolveApiVersion()` (`source/utils/misc.bs`). Code reads it through `getApiVersionFromGlobal()`, or `m.getApiVersion()` inside `ApiClient`.

`ApiClient` hides the tier from callers. The same call works on every server:

```brighterscript
req = GetApi().BuildGetItemRequest(itemId, { fields: "Overview" })
res = fetchRes(req, "myReq")
if isValid(res) and res.ok then item = res.json
```

A method whose path differs by tier branches on `if m.getApiVersion() >= 2` and builds each path itself. `sdkV1.bs` and `sdkV2.bs` hold only `users.GetImageURL()`, which `ApiClient` picks by tier. `ApiClient` also fills in the user ID and, through `injectApiParams()` (`source/utils/misc.bs`), `EnableImageTypes`, `ImageTypeLimit` and, on tier 2, the `Trickplay` field.

`npm run lint:apiversion-consistency` checks that `resolveApiVersion()` matches the tier map in [`jellyfin-version-boundaries.yml`](jellyfin-version-boundaries.yml).

## The device profile

The profile tells the server what the Roku can play. `getDeviceProfile()` in `source/utils/deviceCapabilities.bs` picks `getDeviceProfileV1()` or `getDeviceProfileV2()` by tier:

- **V1** (10.7 to 10.8) carries the DLNA fields `Identification`, `SupportedMediaTypes` and `ResponseProfiles`.
- **V2** (10.9 and later) can use `VideoRangeType` in codec conditions to describe HDR and Dolby Vision. On tier 1 the profile drops those conditions, because older servers reject the profile with them.

## Fields newer servers return

A field a newer server adds is missing from an older server's response, so the code checks it before use:

| Field | Added | Read with |
| --- | --- | --- |
| `Trickplay` | 10.9 | `isValid()`, and requested only on tier 2 |
| `HasLyrics` | 10.9 | `??` |
| `NormalizationGain` | 10.9 | `isValid()` |
| `VideoRangeType` | 10.9 | `isValid()` |

`ImageTags` and `BackdropImageTags` are not in the `ItemFields` enum. The server returns them when the request has `EnableImageTypes`, which `ApiClient` always adds.

## Endpoints newer than 10.7

An endpoint added after 10.7 inside tier 2 has a guard: a function that takes the server version and says whether to call it. The caller checks the guard and skips the request on an older server.

| Endpoint | From | Guard | Used for |
| --- | --- | --- | --- |
| `GET /Audio/{itemId}/Lyrics` | 10.9.0 | `supportsLyrics()` | Song lyrics |
| `GET /MediaSegments/{itemId}` | 10.10.0 | `supportsMediaSegments()` | Skipping intros, recaps and credits |
| `GET /Items/{itemId}/Collections` | 12.0.0 | `extrasRows.supportsItemCollections()` | The Collections row on item details |
| `GET /Items` with `audioLanguages` or `subtitleLanguages` | 12.0.0 | `languageFilters.supported()` | The library grid's language filters |
| `GET /Items/Filters2` | 12.0.0 | `languageFilters.supported()` | The options for those filters. It adds `AudioLanguages` and `SubtitleLanguages`; `/Items/Filters` still has `OfficialRatings` and `Years`, so a caller that wants both asks twice |
| `GET /Items` with `parentId` and `IncludeItemTypes=BoxSet` | 12.0.0 | `collectionsView.supported()` | A library's Collections view |

Write a guard so it takes the version as an argument where it can (`extrasRows.supportsItemCollections(serverVersion)`), so a unit test can check it against a table of versions.

**A parameter needs the version check most.** A missing endpoint answers 404, which the caller sees. An unsupported parameter on an existing endpoint is accepted and ignored, so the request succeeds with the wrong results. On 10.11, `audioLanguages=zzz` returns the whole library (checked on 10.11.11). With `parentId` and `IncludeItemTypes=BoxSet`, 10.11 returns every collection on the server when `Recursive=true`, and the user's library folders when `Recursive=false`. Nothing in either reply shows the parameter was ignored, so the version is the only gate.

The Quick Connect probe `GET /QuickConnect/Enabled` (10.8) has no guard. It answers 404 on 10.7, and the caller treats that as "available" (`UserSelect.probeQuickConnectAvailability`).

### The endpoint registry

[`jellyfin-endpoint-availability.yml`](jellyfin-endpoint-availability.yml) records every endpoint newer than 10.7 and how old servers are handled: a guard, a tier-1 equivalent, or a 404 the caller handles. The server-upgrade pipeline reads it ([`server-upgrade-automation.md`](../architecture/server-upgrade-automation.md)), and `npm run lint:endpoint-availability` checks each entry's guard against the code. When you add such an endpoint, add an entry; the lint reports one you forgot.

### Parameters whose meaning changed

A parameter can change what it does while the spec stays the same, so a spec diff does not show it:

| Endpoint | Parameter | Servers that act on it | Guard | Sent by |
| --- | --- | --- | --- | --- |
| `GET /Shows/NextUp` | `DisableFirstEpisode` | 10.7 to 10.10; ignored by 10.11, removed in 12.0 | `honorsDisableFirstEpisode()` | `buildHomeNextUpParams()` (`source/api/items.bs`) |

To add one:

1. **Check what each version does.** Read the controller and the code it calls at each release tag you support. Then send a request whose results differ by whether the server acted on the parameter: `npm run jellyfin:matrix -- '<path?query>'` sends one GET to a server of each version (`JELLYFIN_VERSION_SERVERS` in `.env.example`) and prints the status, item count and size from each.
2. **Write a guard** that takes the server version, beside the code that builds the request, and unit-test its table of versions.
3. **Register it** under `parameters:` in the registry. The lint then fails any `.bs` file under `source/` or `components/` whose code names the parameter without calling the guard, and any entry nothing sends any more. Comments don't count, so a comment can say why a call leaves the parameter out.

**The registry can't hold a combination.** The lint matches a parameter's name, which works when the name means one thing. The Collections view's gate is a combination of `parentId` and `IncludeItemTypes=BoxSet`, two names most of the app sends for other reasons. So `collectionsView.supported()` is in the table above and not in the registry. Its unit table and each server line's measured behavior are in `source/GridView/collectionsView.bs`.

### The grid's "#" filter needs no guard

The grid's "#" holds every name that doesn't start with A to Z, asked for as two ranges: `NameLessThan=A`, then `NameStartsWithOrGreater={` (`{` follows `z`). See `gridPage.hashRanges`. Servers compare those values differently:

| Server | Compares |
| --- | --- |
| 10.7 to 10.10 | The whole stored `SortName` against the lowercased value |
| 10.11.0 to 10.11.2 | The first character of `SortName` or `Name`, strictly less or greater than the raw value |
| 10.11.3 to 10.11.x | The whole stored `SortName` against the lowercased value ([jellyfin/jellyfin#15381](https://github.com/jellyfin/jellyfin/pull/15381)) |
| 12.x | The whole `SortName`, lowercased in the query, against the lowercased value |

A check on 2026-09-25 found that A to Z plus the two ranges put every item in exactly one place on 10.7.7, 10.8.13, 10.9.11, 10.10.7, 10.11.11 and 12.0.0. It covered `/Items` and `/Genres`; `/Artists`, `/Artists/AlbumArtists` and `/Studios` use the same server function as `/Genres`. Two server behaviors follow from how `SortName` is stored, on every version:

- **A leading `{` is dropped**, so "{Brace}" files under B.
- **From 10.9, names are transliterated** (`アキラ` becomes `akira`), so a non-Latin title files under a letter. On 10.7 and 10.8 it files after "z".

On 10.11.0 to 10.11.2, `_Under` and `[Bracket]` fell in no range, and `Élite`, `アキラ` and `Ωmega` landed in "#" and under a letter. No query can fix a first-character comparison, so those three releases are a known server limit, not a guard.

### Media segments (10.10.0 and later)

The `MediaSegments` API gives the times of a video's intro, outro, recap, preview, commercial and unknown segments. For each type the user picks an action: skip it, show a skip button (the default), or do nothing. The choices come from the server's `DisplayPreferences` `CustomPrefs` (`segmentTypeAction__<Type>`), and a JellyRock setting can override them on one device.

| Where | What |
| --- | --- |
| `source/utils/mediaSegments.bs` | `supportsMediaSegments()`, `resolveSegmentAction()`, `findActiveSegment()` |
| `source/enums/MediaSegmentType.bs`, `source/enums/MediaSegmentAction.bs` | The segment types, and the actions `None`, `AskToSkip` and `Skip` |
| `source/api/ApiClient.bs`, `source/api/items.bs` | `BuildGetMediaSegmentsRequest()`, and `GetMediaSegments()`, which checks the guard |
| `components/ItemGrid/LoadVideoContentTask.bs` | Fetches the segments after the item's metadata |
| `components/video/VideoPlayerView.bs`, `components/video/VideoNotification.bs` | Finds the active segment during playback and shows the skip prompt |

## Quick Connect

Sign-in with a password works the same on every version. Quick Connect differs at two boundaries, which `ApiClient` handles when it builds the request, so `components/login/UserSelect.bs` does not check versions:

| What | 10.7.x | 10.8.x | 10.9 and later | Decided by |
| --- | --- | --- | --- | --- |
| `AuthenticateWithQuickConnect` body | `{ "Token": secret }` | `{ "Secret": secret }` | `{ "Secret": secret }` | `versionChecker(version, "10.8.0")` in `BuildAuthenticateWithQuickConnectRequest()` |
| `/QuickConnect/Initiate` method | `GET` | `GET` | `POST` | `m.getApiVersion() >= 2` in `BuildInitiateQuickConnectRequest()` |
| `/QuickConnect/Connect` | `GET ?secret=` | the same | the same | |
| `/QuickConnect/Enabled` | missing | present | present | Treated as available when missing |

The body changes at 10.8.0, inside tier 1, so it uses `versionChecker()` and not the tier.

Most of Quick Connect's failures show only as a status code, and two codes depend on the version. These come from the published specs, 10.7.0 to 10.11.8:

| Endpoint | 10.7.0 to 10.10.7 | 10.11.0 and later | Meaning |
| --- | --- | --- | --- |
| `/QuickConnect/Connect` | `200`, `404` | adds `503` | `404`: the code expired or was never issued |
| `/QuickConnect/Initiate` | `200`, `401` | adds `503` | `401`: Quick Connect is off on the server |
| `AuthenticateWithQuickConnect` | `200`, `400` | adds `503` | `400`: missing token. A live 10.11.11 also answered an undeclared `404` for a secret not yet approved |
| `/QuickConnect/Enabled` | `200` (missing before 10.8) | adds `503` | A plain boolean |

The app relies on two of these:

- **`503` means the server is starting, not that Quick Connect is off.** `quickConnectInitiateFailure()` and `quickConnectExchangeFailure()` (`source/utils/quickConnect.bs`) report it separately, so a user whose server is booting is not told the feature is disabled.
- **`401` is also what a wrong method returns**: `GET` to 10.9 or later, or `POST` to 10.8. The method choice above keeps that from happening.

On 10.7 only, `QuickConnectResult` also has `Error` and `Authentication`; 10.8.0 dropped both. A 10.7 server can answer `200` with `Authenticated: false` and an error, which a poll loop must not read as "not yet". See `quickConnectPollOutcome()`.

## When a server release breaks something

### Triage the release

The server-upgrade pipeline diffs the API between two server versions ([`server-upgrade-automation.md`](../architecture/server-upgrade-automation.md)). Run `/server-upgrade <from> <to>` when a stable release lands.

You can also triage before the release. `<to>` can be a release candidate (`10.12.0-rc1`), `unstable` or `master` (the latest datestamped build), or a datestamp. A pre-release triage writes a note to `.claude/handoffs/` and files no GitHub issues. To follow a release candidate, set the `jellyfin-server-rc` signal's `latest_acknowledged` to the RC you triaged, and the next run diffs only what changed since. A release candidate can still change, so triage the final release again when it ships.

### Add a guard

When one endpoint or parameter changes, add a guard and a registry entry, as above.

### Add an API tier

When a release changes the API widely enough that guards won't do, add a tier. The [`/new-api-version`](../../.claude/skills/new-api-version/SKILL.md) skill walks through it and stops at each check. A jump to `12.0.0` needs nothing special: versions compare segment by segment, and the newest tier has no upper bound.

1. **Tier map:** in [`jellyfin-version-boundaries.yml`](jellyfin-version-boundaries.yml), set tier `2` to `status: frozen` with its last server as `maxServer`, and add tier `3` with `status: active` and `maxServer: null`. The loader requires exactly one active tier, the one without a bound.
2. **Detection:** make `resolveApiVersion()` return `3` from the new minimum. `npm run lint:apiversion-consistency` compares it with the tier map, so you can check the split without a Roku.
3. **Requests:** add `m.getApiVersion() >= 3` branches to the `ApiClient` methods that change. Existing `>= 2` branches keep serving tier 3 until you add one.
4. **Profile:** add a tier 3 branch to `getDeviceProfile()` if the profile changes.
5. **Usage manifest:** if you add `sdkV3.bs`, give it a `min ≥ 3` clamp in [`api-usage-manifest.js`](../../scripts/generate/api-usage-manifest.js) beside the `sdkV1.bs` and `sdkV2.bs` ones, and cap `sdkV2.bs` at `max ≤ 2`. Then run `npm run docs:api-manifest`. The extractor reads the `N` in each `getApiVersion() >= N` branch.

The floor stays at 10.7.0, so the pipeline's other checks need no change.

## Related docs

- [`jellyfin-server-feature-matrix.md`](../user/jellyfin-server-feature-matrix.md): what users get on each server version.
- [`new-user-setting.md`](new-user-setting.md): adding a setting.
- [`registry-migrations.md`](registry-migrations.md): changing stored settings.
