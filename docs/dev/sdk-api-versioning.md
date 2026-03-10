# SDK API Versioning

## Overview

Jellyfin 10.9 removed all `/Users/{userId}/` path prefixes, moving those endpoints to
top-level paths with `userId` passed as a query parameter instead. JellyRock supports
both server generations transparently through a version-dispatch layer in the SDK.

## Architecture

```
api.users.*  (sdk.bs)          — single entry-point for callers
    │
    ├─ apiVersion >= 2 ──────▶  apiV2.users.*  (sdk.v2.bs)  — 10.9+ paths
    └─ apiVersion < 2  ──────▶  apiV1.users.*  (sdk.v1.bs)  — pre-10.9 paths
```

`m.global.server.apiVersion` is an integer set once at login by `resolveApiVersion()`
in `misc.bs` and stored on the `JellyfinServer` ContentNode. All callers use `api.users.*`
and never reference the shim namespaces directly.

## Files

| File | Role |
|---|---|
| `source/api/sdk.bs` | Dispatcher stubs — `api.users.*` namespace |
| `source/api/sdk.v1.bs` | V1 shims — Jellyfin < 10.9 paths |
| `source/api/sdk.v2.bs` | V2 shims — Jellyfin ≥ 10.9 paths |
| `source/utils/misc.bs` | `resolveApiVersion(serverVersion)` helper |
| `source/utils/session.bs` | Calls `resolveApiVersion()` after login |
| `components/data/jellyfin/JellyfinServer.xml` | `apiVersion` field (integer, default 0) |

## Path mapping (pre-10.9 → 10.9+)

| Function | V1 path | V2 path |
|---|---|---|
| `GetImageURL` | `GET /Users/{id}/Images/{type}/{idx}` | `GET /UserImage?userId=&type=&index=` |
| `HeadImageURL` | `HEAD /Users/{id}/Images/{type}/{idx}` | `HEAD /UserImage?userId=&type=&index=` |
| `GetItemsByQuery` | `GET /Users/{id}/Items` | `GET /Items/?userId=` |
| `GetResumeItemsByQuery` | `GET /Users/{id}/Items/Resume` | `GET /UserItems/Resume?userId=` |
| `GetLatestMedia` | `GET /Users/{id}/Items/Latest` | `GET /Items/Latest?userId=` |
| `GetViews` | `GET /Users/{id}/Views` | `GET /UserViews?userId=` |
| `GetItem` | `GET /Users/{id}/Items/{itemId}` | `GET /Items/{itemId}?userId=` |
| `GetIntros` | `GET /Users/{id}/Items/{itemId}/Intros` | `GET /Items/{itemId}/Intros` |
| `GetLocalTrailers` | `GET /Users/{id}/Items/{itemId}/LocalTrailers` | `GET /Items/{itemId}/LocalTrailers` |
| `GetSpecialFeatures` | `GET /Users/{id}/Items/{itemId}/SpecialFeatures` | `GET /Items/{itemId}/SpecialFeatures` |
| `GetRoot` | `GET /Users/{id}/Items/Root` | `GET /Items/Root` |
| `GetSuggestions` | `GET /Users/{id}/Suggestions` | `GET /Items/Suggestions?userId=` |
| `GetGroupingOptions` | `GET /Users/{id}/GroupingOptions` | `GET /UserViews/GroupingOptions?userId=` |
| `MarkFavorite` | `POST /Users/{id}/FavoriteItems/{itemId}` | `POST /UserFavoriteItems/{itemId}?userId=` |
| `UnmarkFavorite` | `DELETE /Users/{id}/FavoriteItems/{itemId}` | `DELETE /UserFavoriteItems/{itemId}?userId=` |
| `MarkPlayed` | `POST /Users/{id}/PlayedItems/{itemId}` | `POST /UserPlayedItems/{itemId}?userId=` |
| `UnmarkPlayed` | `DELETE /Users/{id}/PlayedItems/{itemId}` | `DELETE /UserPlayedItems/{itemId}?userId=` |
| `DeleteRating` | `DELETE /Users/{id}/Items/{itemId}/Rating` | `DELETE /UserItems/{itemId}/Rating?userId=` |
| `UpdateRating` | `POST /Users/{id}/Items/{itemId}/Rating` | `POST /UserItems/{itemId}/Rating?userId=` |
| `MarkPlaying` | `POST /Users/{id}/PlayingItems/{itemId}` | `POST /PlayingItems/{itemId}?userId=` |
| `MarkStoppedPlaying` | `DELETE /Users/{id}/PlayingItems/{itemId}` | `DELETE /PlayingItems/{itemId}?userId=` |
| `ReportPlayProgress` | `POST /Users/{id}/PlayingItems/{itemId}/Progress` | `POST /PlayingItems/{itemId}/Progress?userId=` |
| `UpdateConfiguration` | `POST /Users/{id}/Configuration` | `POST /Users/Configuration` |
| `UpdatePassword` | `POST /Users/{id}/Password` | `POST /Users/Password` |
| `UpdateEasyPassword` | `POST /Users/{id}/EasyPassword` | *(removed in 10.9 — no-op)* |
| `Update` | `POST /Users/{id}` | *(removed in 10.9 — no-op)* |

## Adding a new server version

If a future Jellyfin release (e.g., 11.0) breaks additional endpoints:

1. Add a `apiV3.users` namespace in a new `source/api/sdk.v3.bs`
2. Update `resolveApiVersion()` in `misc.bs` to return `3` for the new boundary
3. Add `apiVersion >= 3` branches to the affected dispatcher stubs in `sdk.bs`
4. Import `sdk.v3.bs` at the top of `sdk.bs`

The `>= 2` check in each V2 dispatcher is intentionally forward-compatible: unknown
future versions automatically fall through to V2 behaviour until explicitly overridden.

## DeviceProfile Version Differences

Beyond user endpoints, the DeviceProfile structure also changed between versions:

### 10.7.x - 10.8.x (API v1)
- Full DeviceProfile with `Identification` object (FriendlyName, Manufacturer, Model, etc.)
- `SupportedMediaTypes` field
- `ResponseProfiles` field
- Does NOT support `VideoRangeType` in codec conditions (returns 400 error)

### 10.9+ (API v2)
- Simplified DeviceProfile without `Identification` object
- Removed DLNA-related fields
- Supports `VideoRangeType` for HDR/DoVi detection

The `getDeviceProfile()` function in `source/utils/deviceCapabilities.bs` dispatches to:
- `getDeviceProfileV1()` for API v1 servers
- `getDeviceProfileV2()` for API v2 servers

Additionally, `filterCodecProfileConditions()` removes `VideoRangeType` conditions from codec profiles when `apiVersion < 2`.

## Testing

- `tests/source/unit/utils/resolveApiVersion.spec.bs` — version boundary tests
- `tests/source/unit/api/sdk.versioning.spec.bs` — V1/V2 URL structure + dispatcher routing
- `tests/source/unit/utils/filterCodecProfileConditions.spec.bs` — DeviceProfile condition filtering tests
