# SDK API Versioning

## Overview

Jellyfin 10.9 removed all `/Users/{userId}/` path prefixes, moving those endpoints to
top-level paths with `userId` passed as a query parameter instead. JellyRock supports
both server generations transparently through a version-dispatch layer in the SDK.

## Architecture

```text
api.users.*  (sdk.bs)          — single entry-point for callers
    │
    ├─ `apiVersion` >= 2 ──────▶  apiV2.users.*  (sdk.`v2`.bs)  — 10.9+ paths
    └─ `apiVersion` < 2  ──────▶  apiV1.users.*  (sdk.`v1`.bs)  — `pre-10.9` paths
```

`m.global.server.apiVersion` is an integer set once at login by `resolveApiVersion()`
in `misc.bs` and stored on the `JellyfinServer` ContentNode. All callers use `api.users.*`
and never reference the shim namespaces directly.

## Files

| File | Role |
| ------ | ------ |
| `source/api/sdk.bs` | Dispatcher stubs — `api.users.*` namespace |
| `source/api/sdk.`v1`.bs` | `V1` shims — Jellyfin < 10.9 paths |
| `source/api/sdk.`v2`.bs` | `V2` shims — Jellyfin ≥ 10.9 paths |
| `source/utils/misc.bs` | `resolveApiVersion(serverVersion)` helper |
| `source/utils/session.bs` | Calls `resolveApiVersion()` after login |
| `components/data/jellyfin/JellyfinServer.xml` | `apiVersion` field (integer, default 0) |

## Path Mapping (`pre-10.9` → 10.9+)

| Function | `V1` Path | `V2` Path |
| ---------- | --------- | --------- |
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
| `GetRoot` | `GET /Users/{id}/Items/Root` | `GET /Items/Root?userId=` |
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

## Adding a New Server Version

If a future Jellyfin release (e.g., 11.0) breaks additional endpoints:

1. Add an `apiV3.users` namespace in a new `source/api/sdk.v3.bs`
2. Update `resolveApiVersion()` in `misc.bs` to return `3` for the new boundary
3. Add `apiVersion >= 3` branches to the affected dispatcher stubs in `sdk.bs`
4. Import `sdk.v3.bs` at the top of `sdk.bs`

The `>= 2` check in each `V2` dispatcher is intentionally forward-compatible: unknown
future versions automatically fall through to `V2` behavior until explicitly overridden.

## `DeviceProfile` Version Differences

Beyond user endpoints, the `DeviceProfile` structure also changed between versions:

### 10.7.x - 10.8.x (API `v1`)

- Full `DeviceProfile` with `Identification` object (`FriendlyName`, `Manufacturer`, `Model`, etc.)
- `SupportedMediaTypes` field
- `ResponseProfiles` field
- Does NOT support `VideoRangeType` in `codec` conditions (returns 400 error)

**`V1` Profile Structure:**

```brightscript
{
  "Name": "JellyRock",
  "Id": "device-id",
  "Identification": {
    "FriendlyName": "Roku Device",
    "ModelNumber": "4200X",
    "ModelName": "Roku 3",
    "ModelDescription": "Type: STB",
    "Manufacturer": "Roku"
  },
  "MaxStreamingBitrate": 140000000,
  "MaxStaticBitrate": 140000000,
  "MusicStreamingTranscodingBitrate": 192000,
  "DirectPlayProfiles": [...],
  "TranscodingProfiles": [...],
  "ContainerProfiles": [...],
  "CodecProfiles": [...],
  "SubtitleProfiles": [...],
  "SupportedMediaTypes": "Video,Audio",
  "ResponseProfiles": []
}
```

### 10.9+ (API `v2`)

- Simplified `DeviceProfile` without `Identification` object
- Removed `DLNA`-related fields
- Supports `VideoRangeType` for `HDR`/`DoVi` detection
- Added `MaxStaticMusicBitrate` field

**`V2` Profile Structure:**

```brightscript
{
  "Name": "JellyRock",
  "Id": "device-id",
  "MaxStreamingBitrate": 140000000,
  "MaxStaticBitrate": 140000000,
  "MusicStreamingTranscodingBitrate": 192000,
  "MaxStaticMusicBitrate": 192000,
  "DirectPlayProfiles": [...],
  "TranscodingProfiles": [...],
  "ContainerProfiles": [...],
  "CodecProfiles": [...],
  "SubtitleProfiles": [...]
}
```

### `DeviceProfile` Dispatching

The `getDeviceProfile()` function in `source/utils/deviceCapabilities.bs` dispatches to:

- `getDeviceProfileV1()` for API `v1` servers (10.7.x - 10.8.x)
- `getDeviceProfileV2()` for API `v2` servers (10.9+)

### `VideoRangeType` Filtering

The `VideoRangeType` property was added in Jellyfin 10.9 for `HDR`/`DoVi` detection. Sending
this in `codec` conditions to 10.8.x servers causes a 400 Bad Request error.

The `filterCodecProfileConditions()` function removes `VideoRangeType` conditions when
`apiVersion < 2`:

```brightscript
' VideoRangeType was added in Jellyfin 10.9 (API v2)
' Remove it for older servers (10.7.x, 10.8.x) that don't support this property
if apiVersion < 2
  codecProfiles = filterCodecProfileConditions(codecProfiles, ["VideoRangeType"])
end if
```

## Authentication Compatibility

Authentication works across ALL server versions (10.7.x through 10.11.x+) without changes:

### Username/Password Login

**Endpoint:** `POST /Users/AuthenticateByName`

**Request Body:**

```json
{
  "Username": "user",
  "Pw": "plain-text-password"
}
```

**Compatibility:**

| Version | Field Support | Status |
| --------- | --------------- | -------- |
| 10.7.x | `Username`, `Pw`, `Password` (deprecated) | Works |
| 10.8.x | `Username`, `Pw`, `Password` (deprecated) | Works |
| 10.9.x+ | `Username`, `Pw` | Works |

**Note:** The `Pw` field (plain text) works across all versions. The deprecated `Password`
field (`SHA1` hashed) was removed in 10.9.0, but JellyRock uses `Pw` exclusively.

### Quick Connect

**Important:** There IS a breaking change for Quick Connect between 10.7.x and 10.8.x:

| Version | Request Field |
| --------- | --------------- |
| 10.7.x | `Token` |
| 10.8.x+ | `Secret` |

Current implementation uses `Secret` which works for 10.8.x+. To support 10.7.x Quick
Connect, version-specific handling would be needed.

### Other Auth Endpoints

All authentication-related endpoints are stable across versions:

- `GET /Users/Public` - No changes
- `GET /System/Info/Public` - No changes
- `POST /Users/AuthenticateByName` - No breaking changes
- `POST /Users/AuthenticateWithQuickConnect` - Only field name change (Token to Secret)

### Headers

Authentication headers are consistent across all versions:

```text
Authorization: MediaBrowser Client="JellyRock", Device="Roku", Token="access-token"
```

No version-specific header handling is required.

## Version Detection

The `resolveApiVersion()` function determines which API version to use:

```brightscript
function resolveApiVersion(serverVersion as string) as integer
  if not isValidAndNotEmpty(serverVersion)
    return 1  ' Safe fallback to legacy paths
  end if
  if versionChecker(serverVersion, "10.9.0")
    return 2
  end if
  return 1
end function
```

**Version Boundaries:**

| Server Version | `apiVersion` | Paths Used | `DeviceProfile` |
| ---------------- | ------------ | ------------ | --------------- |
| 10.7.x | 1 | `V1` (`/Users/{id}/`) | `V1` (with Identification) |
| 10.8.x | 1 | `V1` (`/Users/{id}/`) | `V1` (with Identification) |
| 10.9.x | 2 | `V2` (top-level) | `V2` (simplified) |
| 10.10.x | 2 | `V2` (top-level) | `V2` (simplified) |
| 10.11.x+ | 2 | `V2` (top-level) | `V2` (simplified) |

The version is stored in `m.global.server.apiVersion` after successful server connection
and login.
