---
topic: jellyfin-server-versioning
related-files:
  - source/api/ApiClient.bs
  - source/api/sdk.bs
  - source/api/sdkV1.bs
  - source/api/sdkV2.bs
  - source/utils/deviceCapabilities.bs
  - source/utils/misc.bs
  - source/utils/mediaSegments.bs
  - docs/dev/jellyfin-endpoint-availability.yml
last-reviewed: 2026-05-30
---

# JellyRock Versioning Systems Overview

This document provides a high-level overview of how JellyRock handles multiple versioning systems to maintain compatibility across different Jellyfin server versions and Roku device capabilities.

## Overview

JellyRock supports Jellyfin servers from 10.7.0 through the latest version. To achieve this, the app implements several versioning layers that work together seamlessly.

## Versioning Systems

### 1. API Endpoint Versioning (`apiVersion`)

Jellyfin 10.9 introduced breaking changes to user API endpoints by removing `/Users/{userId}/` path prefixes. JellyRock transparently handles both endpoint styles through a dispatch layer.

**How it works:**

- `apiVersion = 1`: 10.7.x - 10.8.x (legacy paths with `/Users/{id}/` prefix)
- `apiVersion = 2`: 10.9+ (top-level paths with `userId` query parameter)
- `ApiClient` class routes to the appropriate version (`sdkV1` or `sdkV2`) based on `m.global.server.apiVersion`
- Static endpoints (shows, artists, movies, etc.) use `sdk.*` directly without version dispatch

**Key Files:**

- `source/api/ApiClient.bs` - Dispatcher that routes to appropriate version and injects defaults
- `source/api/sdk.bs` - Base SDK with static endpoints (shows, artists, items, etc.)
- `source/api/sdkV1.bs` - 10.7.x - 10.8.x user endpoint implementations
- `source/api/sdkV2.bs` - 10.9+ user endpoint implementations

### 2. Device Profile Versioning

Device profiles describe what media formats the Roku device can play. Different server versions expect different profile structures.

**How it works:**

- `V1 Profile`: 10.7.x - 10.8.x (includes `Identification` object, `SupportedMediaTypes`, `ResponseProfiles`)
- `V2 Profile`: 10.9+ (simplified structure, supports `VideoRangeType`)
- Profile is generated based on detected API version

**Key Differences:**

- `V1` includes DLNA related fields (`Identification`, `SupportedMediaTypes`)
- `V2` adds support for `VideoRangeType` for `HDR`/`DoVi` detection
- `V1` does NOT support `VideoRangeType` in codec conditions (causes 400 errors)

**Key Files:**

- `source/utils/deviceCapabilities.bs` - Generates the appropriate profile (`V1` vs `V2` selected internally based on `m.global.server.apiVersion`)

### 3. Field Availability Versioning (BaseItemDto)

Different Jellyfin versions return different fields in API responses. JellyRock handles this gracefully.

**How it works:**

- Fields added in 10.9+ are checked with `isValid()` before accessing
- Fields not available return gracefully with defaults
- `ApiClient` automatically injects required fields (`EnableImageTypes`, `ImageTypeLimit`)

**Notable Field Differences:**

| Field | 10.7.0 | 10.9+ | Handling |
| ----- | ------ | ----- | -------- |
| `Trickplay` | ❌ | ✅ | Safe with `isValid()` check |
| `HasLyrics` | ❌ | ✅ | Safe with ?? operator |
| `NormalizationGain` | ❌ | ✅ | Safe with ?? operator |
| `VideoRangeType` | ❌ | ✅ | Safe with `isValid()` checks |
| `ImageTags` | ✅ | ✅ | Always requested via `ApiClient` |
| `SupportsSync` | ✅ | ❌ | Not used in codebase |

**Note:** Some fields like `ImageTags` and `BackdropImageTags` are not in the `ItemFields` enum but are returned when `EnableImageTypes` is specified.

### 4. Version-Gated API Endpoints

Some Jellyfin API endpoints are only available on specific server versions. These are guarded by direct version checks using `versionChecker()` rather than the `apiVersion` dispatch system.

| Endpoint | Min Version | Guard Function | Purpose |
| -------- | ----------- | -------------- | ------- |
| `GET /MediaSegments/{itemId}` | 10.10.0 | `supportsMediaSegments()` | Fetch intro/outro/recap/preview/commercial segments for skip functionality |

**How it works:**

- Guard functions call `versionChecker(m.global.server.version, "x.y.z")` to compare the raw server version string
- Callers check the guard before making the API request — the endpoint simply isn't called on older servers
- No `apiVersion` dispatch needed because these are top-level paths, not user-scoped endpoints

**Endpoints that gracefully degrade (no explicit guard):** some post-floor
endpoints have no version guard but are safe because a missing endpoint returns a
404 and the caller checks `isValid()` before use — e.g. `Audio/{itemId}/Lyrics`
(10.9+, no lyrics shown on older servers) and the Quick Connect probe `/QuickConnect/Enabled`
(10.8+, fail-open). These are not bugs, but they *do* trip the server-upgrade
pipeline's floor-coverage check (we call an endpoint the 10.7.0 floor spec lacks).

**Machine-readable registry:** every post-floor endpoint and its old-server
handling (guard / dispatch-sibling / graceful-degradation) is recorded in
[`jellyfin-endpoint-availability.yml`](jellyfin-endpoint-availability.yml) — the
server-upgrade pipeline's validated disposition ledger
([server-upgrade-automation.md](../architecture/server-upgrade-automation.md),
Phase 6). The table above is the human-readable mirror; the YAML is the source the
floor check consumes, and `npm run lint:endpoint-availability` validates each
entry's guard/sibling claim against current code so a removed guard resurfaces the
finding. When you add a version-gated or post-floor endpoint, add a registry entry
(the lint will tell you if you forgot — the finding will flag `needsInvestigation`).

**Media Segments (10.10.0+):**

The `MediaSegments` API provides segment timing data (intro, outro, recap, preview, commercial, unknown) for video items. JellyRock fetches segments during video content loading and supports three action modes per segment type: auto-skip, show skip button, or do nothing. All segment types default to "show skip button" (AskToSkip). User action preferences are loaded from the server's `DisplayPreferences` `CustomPrefs` (key format: `segmentTypeAction__[Type]`) with optional per-device overrides via JellyRock settings.

**Key Files:**

- `source/utils/mediaSegments.bs` - `supportsMediaSegments()` guard, `resolveSegmentAction()`, `findActiveSegment()`
- `source/enums/MediaSegmentType.bs` - Segment type enum (Intro, Outro, Commercial, Preview, Recap, Unknown)
- `source/enums/MediaSegmentAction.bs` - Action mode enum (None, AskToSkip, Skip)
- `source/api/ApiClient.bs` - `BuildGetMediaSegmentsRequest()` request builder
- `source/api/items.bs` - `GetMediaSegments()` helper (guards with `supportsMediaSegments()`)
- `components/ItemGrid/LoadVideoContentTask.bs` - Fetches segments after metadata load
- `components/video/VideoNotification.bs` - Reusable notification component for skip prompts
- `components/video/VideoPlayerView.bs` - Segment detection and action handling during playback

### 5. Authentication Compatibility

Most authentication flows work across all versions, with one quirk for
Quick Connect.

**Quick Connect:**

The two QC dispatches operate on different version boundaries — the SDK
handles them separately:

| Concern | 10.7.x | 10.8.x | 10.9.0+ | Boundary |
| ------- | ------ | ------ | ------- | -------- |
| `AuthenticateWithQuickConnect` body | `{ "Token": secret }` | `{ "Secret": secret }` | `{ "Secret": secret }` | `versionChecker(version, "10.8.0")` |
| `/QuickConnect/Initiate` HTTP method | `GET` | `GET` | `POST` | `getApiVersionFromGlobal() >= 2` |
| `/QuickConnect/Connect` | `GET ?secret=` | same | same | n/a |
| `/QuickConnect/Enabled` (gating probe) | missing | present | present | fail-open in `QuickConnectEnabledTask` |

`source/api/sdk.bs` dispatches both at call time, so callers
(`source/api/userAuth.bs`, `components/quickConnect/*`) are version-agnostic.
The Token→Secret split happens at 10.8.0 (a *finer* boundary than the
`apiVersion` 1→2 split at 10.9.0), so it uses raw `versionChecker` rather than
the `apiVersion` integer.

Username/password authentication works identically across all versions.

### 6. Client Interface Versioning

The `GetApi()` client provides a unified interface that hides version complexity:

```brightscript
' Same code works on all server versions; ApiClient routes V1/V2 internally.
req = GetApi().BuildGetItemRequest(itemId, { fields: "Overview" })
res = fetchRes(req, "myReq")
if isValid(res) and res.ok then item = res.json
```

**Automatic handling:**

- Image parameters injected automatically (`EnableImageTypes`, `ImageTypeLimit`)
- Version-specific fields added conditionally (e.g., Trickplay for 10.9+)
- `UserId` automatically retrieved from global state
- API version automatically detected and routed

## How Versioning Works Together

```text
User Action → GetApi().BuildGetItemRequest(...)
                    ↓
            ApiClient (dispatcher)
                    ↓
            Check m.global.server.apiVersion
                    ↓
            ├── apiVersion = 1 → /users/{userId}/items/{itemId}  (V1 path)
            └── apiVersion = 2 → /Items/{itemId}?userId=...      (V2 path)
                    ↓
            Static endpoints (shows, items, etc.) → sdk.* (single shape across versions)
                    ↓
            Device Profile (getDeviceProfile())
                    ↓
            Check m.global.server.apiVersion
                    ↓
            ├── apiVersion = 1 → getDeviceProfileV1()
            └── apiVersion = 2 → getDeviceProfileV2()
```

## Version Detection

Server version detection happens at login:

1. `resolveApiVersion()` checks server version string
2. Returns `1` for 10.7.x - 10.8.x
3. Returns `2` for 10.9+
4. Stored in `m.global.server.apiVersion`

All code references this value to determine behavior.

## Files by Versioning System

| System | Key Files |
| ------ | --------- |
| API Endpoints | `source/api/ApiClient.bs` (dispatcher), `source/api/sdk.bs` (static), `source/api/sdkV1.bs` (`V1` user), `source/api/sdkV2.bs` (`V2` user) |
| Device Profile | `source/utils/deviceCapabilities.bs` (`V1/V2` selection internal) |
| Field Handling | `source/data/JellyfinDataTransformer.bs`, `source/api/ApiClient.bs` |
| Version Detection | `source/utils/misc.bs` (resolveApiVersion), `source/utils/session.bs` |
| Version-Gated Endpoints | `source/utils/mediaSegments.bs` (supportsMediaSegments), `source/api/items.bs` (GetMediaSegments) |

## Adding Support for New Server Versions

If Jellyfin 11.0 introduces breaking changes:

1. **API Changes:** Create `source/api/sdk.v3.bs` with new endpoint paths
2. **Profile Changes:** Add a `V3` branch in `source/utils/deviceCapabilities.bs` (`V1/V2` are already internal selectors; `V3` follows the same pattern)
3. **Update Detection:** Modify `resolveApiVersion()` to return `3` for 11.0+
4. **Update Dispatchers:** Add `apiVersion >= 3` branches in `ApiClient.bs`
5. **Forward Compatibility:** Existing `>= 2` checks automatically fall through to `V2` until overridden

## Related Documentation

- `docs/user/jellyfin-server-feature-matrix.md` - User-facing feature support by server version
- `docs/dev/new-user-setting.md` - How to add version-aware settings
- `docs/dev/registry-migrations.md` - Handling data migrations across versions
