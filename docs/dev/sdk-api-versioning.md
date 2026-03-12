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
- `GetApi()` client automatically handles both versions

**Key Files:**
- `source/api/sdk.bs` - Dispatcher that routes to appropriate version
- `source/api/sdk.v1.bs` - 10.7.x - 10.8.x endpoint implementations
- `source/api/sdk.v2.bs` - 10.9+ endpoint implementations
- `source/api/ApiClient.bs` - Unified client that uses sdk internally

### 2. Device Profile Versioning

Device profiles describe what media formats the Roku device can play. Different server versions expect different profile structures.

**How it works:**
- `V1 Profile`: 10.7.x - 10.8.x (includes Identification object, SupportedMediaTypes, ResponseProfiles)
- `V2 Profile`: 10.9+ (simplified structure, supports VideoRangeType)
- Profile is generated based on detected API version

**Key Differences:**
- V1 includes DLNA-related fields (Identification, SupportedMediaTypes)
- V2 adds support for `VideoRangeType` for HDR/DoVi detection
- V1 does NOT support VideoRangeType in codec conditions (causes 400 errors)

**Key Files:**
- `source/utils/deviceCapabilities.bs` - Generates appropriate profile
- `source/utils/deviceCapabilities.v1.bs` - V1 profile generation
- `source/utils/deviceCapabilities.v2.bs` - V2 profile generation

### 3. Field Availability Versioning (BaseItemDto)

Different Jellyfin versions return different fields in API responses. JellyRock handles this gracefully.

**How it works:**
- Fields added in 10.9+ are checked with `isValid()` before accessing
- Fields not available return gracefully with defaults
- ApiClient automatically injects required fields (EnableImageTypes, ImageTypeLimit)

**Notable Field Differences:**

| Field | 10.7.0 | 10.9+ | Handling |
|-------|--------|-------|----------|
| Trickplay | ❌ | ✅ | Safe with isValid() check |
| HasLyrics | ❌ | ✅ | Safe with ?? operator |
| NormalizationGain | ❌ | ✅ | Safe with ?? operator |
| VideoRangeType | ❌ | ✅ | Safe with isValid() checks |
| ImageTags | ✅ | ✅ | Always requested via ApiClient |
| SupportsSync | ✅ | ❌ | Not used in codebase |

**Note:** Some fields like `ImageTags` and `BackdropImageTags` are not in the `ItemFields` enum but are returned when `EnableImageTypes` is specified.

### 4. Authentication Compatibility

Most authentication flows work across all versions, with one exception:

**Quick Connect Field Name:**
- 10.7.x: Uses `Token` field
- 10.8.x+: Uses `Secret` field
- Current implementation uses `Secret` (10.8.x+ compatible)

Username/password authentication works identically across all versions.

### 5. Client Interface Versioning

The `GetApi()` client provides a unified interface that hides version complexity:

```brightscript
' Same code works on all server versions
api = GetApi()
data = api.GetItem(itemId, { fields: "Overview" })
```

**Automatic handling:**
- Image parameters injected automatically (EnableImageTypes, ImageTypeLimit)
- Version-specific fields added conditionally (e.g., Trickplay for 10.9+)
- UserId automatically retrieved from global state
- API version automatically detected and routed

## How Versioning Works Together

```
User Action → GetApi().GetItem()
                    ↓
            ApiClient.injectDefaults()
                    ↓
            sdk.users.GetItem() [dispatcher]
                    ↓
            Check m.global.server.apiVersion
                    ↓
            ├── apiVersion = 1 → sdkV1.users.GetItem()
            └── apiVersion = 2 → sdkV2.users.GetItem()
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
|--------|-----------|
| API Endpoints | `source/api/sdk.bs`, `source/api/sdk.v1.bs`, `source/api/sdk.v2.bs`, `source/api/ApiClient.bs` |
| Device Profile | `source/utils/deviceCapabilities.bs`, `source/utils/deviceCapabilities.v1.bs`, `source/utils/deviceCapabilities.v2.bs` |
| Field Handling | `source/data/JellyfinDataTransformer.bs`, `source/api/ApiClient.bs` |
| Version Detection | `source/utils/misc.bs` (resolveApiVersion), `source/utils/session.bs` |

## Adding Support for New Server Versions

If Jellyfin 11.0 introduces breaking changes:

1. **API Changes:** Create `source/api/sdk.v3.bs` with new endpoint paths
2. **Profile Changes:** Create `source/utils/deviceCapabilities.v3.bs` with new profile structure
3. **Update Detection:** Modify `resolveApiVersion()` to return `3` for 11.0+
4. **Update Dispatchers:** Add `apiVersion >= 3` branches in `sdk.bs`
5. **Forward Compatibility:** Existing `>= 2` checks automatically fall through to V2 until overridden

## Related Documentation

- `docs/dev/server-feature-matrix.md` - User-facing feature support by server version
- `docs/dev/adding-user-settings.md` - How to add version-aware settings
- `docs/dev/registry-migrations.md` - Handling data migrations across versions
