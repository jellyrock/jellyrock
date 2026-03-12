# API Architecture Layering Guide

This document defines the standardized approach for making API calls in JellyRock, ensuring consistent patterns across the codebase.

## Overview

The API architecture follows a **3-layer abstraction model**, where each layer builds upon the one below it. Developers should use the **highest-level layer** that meets their specific use case.

```text
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Domain Helpers                                    │
│  (source/api/ImageHelpers.bs)                               │
│  • Type-safe node wrappers                                  │
│  • JellyfinUser, JellyfinBaseItem specific functions        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Business Logic Utilities                          │
│  (source/api/Image.bs)                                      │
│  • Validation + defaults + error handling                   │
│  • Prevents 404s, sets standard dimensions                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Raw API Client                                    │
│  (source/api/ApiClient.bs)                                  │
│  • Direct API endpoint calls                                │
│  • V1/V2 server version dispatch                            │
│  • No validation or defaults                                │
└─────────────────────────────────────────────────────────────┘
```

## Layer 1: `ApiClient` (Foundation)

**File:** `source/api/ApiClient.bs`  
**Access:** `GetApi().<method>()`

The `ApiClient` provides raw access to Jellyfin API endpoints with automatic `V1`/`V2` server version dispatch. This layer has **no validation, no defaults, and minimal error handling**.

### When to Use Layer 1

- You need full control over parameters
- Building custom helper functions (Layers 2-3)
- Working with non-standard endpoints

### Image Methods

| Method                                     | Purpose               | Example Endpoint                                                                   |
|--------------------------------------------|-----------------------|------------------------------------------------------------------------------------|
| `GetImageURL(id, type, index, params)`     | **Item images** only  | `/items/{id}/images/{type}/{index}`                                                |
| `GetUserImageURL(id, type, index, params)` | **User avatars** only | `V1`: `/users/{id}/images/{type}/{index}`<br>`V2`: `/UserImage?userId={id}`        |

⚠️ **Critical:** Always use the correct method for the resource type:

- Use `GetUserImageURL()` for user avatars
- Use `GetImageURL()` for items (movies, episodes, etc.)

### Layer 1 Example

```brighterscript
' Raw API call - no validation, no defaults
url = GetApi().GetUserImageURL(userId, "primary", 0, {
  maxHeight: 300,
  maxWidth: 300,
  quality: 90
})
' Returns: "http://server:8096/users/abc123/images/primary/0?maxHeight=300..." (V1)
' Or:      "http://server:8096/UserImage?userId=abc123&type=primary..." (V2)
```

## Layer 2: Business Logic (Validation & Defaults)

**File:** `source/api/Image.bs`  
**Import:** `import "pkg:/source/api/Image.bs"`

This layer adds:

- **Tag validation:** Prevents `404` errors by checking if image tags exist/are valid
- **Sensible defaults:** Standard dimensions and quality settings
- **Error handling:** Returns empty string instead of invalid

### When to Use Layer 2

- Loading images where you have raw IDs and tags
- Need standard dimensions without node objects
- Want 404 prevention without full helper wrapper

### Layer 2 Functions

| Function                               | Purpose      | Defaults                                           |
|----------------------------------------|--------------|----------------------------------------------------|
| `ImageURL(id, version, params)`        | Item images  | `maxHeight`: 384, `maxWidth`: 196, quality: 90     |
| `UserImageURL(id, params)`             | User avatars | `maxHeight`: 300, `maxWidth`: 300, quality: 90     |

### Key Feature: Tag Validation

Both functions validate the `tag` parameter:

- If `tag` is provided but invalid/empty → returns `""` (prevents broken image)
- If `tag` is valid → proceeds with URL generation

### Layer 2 Example

```brighterscript
' With validation and defaults
url = UserImageURL(userId, {
  tag: user.primaryImageTag,
  maxHeight: 36,
  maxWidth: 36
})
' Returns: "" if tag is invalid
' Or: valid URL with defaults applied
```

## Layer 3: Domain Helpers (Type-Safe Wrappers)

**File:** `source/api/ImageHelpers.bs`  
**Import:** `import "pkg:/source/api/ImageHelpers.bs"`

The highest-level layer provides **type-safe, node-specific functions** that extract data from Jellyfin content nodes automatically.

### When to Use Layer 3

- Working with `JellyfinUser` or `JellyfinBaseItem` nodes
- Need fallbacks (try primary, then thumb, then parent, etc.)
- Want simplest possible API for common operations

### Layer 3 Functions

| Function                                   | Input              | Fallback Chain                                                                                            |
|--------------------------------------------|--------------------|-----------------------------------------------------------------------------------------------------------|
| `GetPosterURLFromItem(item, maxH, maxW)`   | `JellyfinBaseItem` | primary → thumb → `parentPrimary` → `parentThumb` → `seriesPrimary` → backdrop                            |
| `GetBackdropURLFromItem(item, maxH, maxW)` | `JellyfinBaseItem` | backdrop → `parentBackdrop`                                                                               |
| `GetLogoURLFromItem(item, maxH, maxW)`     | `JellyfinBaseItem` | logo only                                                                                                 |
| `GetUserAvatarURL(user, maxH, maxW)`       | `JellyfinUser`     | primary only (with validation)                                                                            |

### Layer 3 Example

```brighterscript
' Simplest usage - handles everything
userImage.uri = GetUserAvatarURL(m.global.user, 36, 36)
' Returns: "" if no valid image
' Or: valid URL with all validation and defaults
```

## Decision Tree

Use this flowchart to determine which layer to use:

```text
┌──────────────────────────────┐
│ Do you have a JellyfinUser   │
│ or JellyfinBaseItem node?    │
└──────────────────────────────┘
              │
      ┌───────┴───────┐
      ▼               ▼
    Yes              No
      │               │
      ▼               ▼
┌─────────────┐  ┌──────────────────────────┐
│ Use Layer 3 │  │ Do you have an image tag │
│ (Helpers)   │  │ and want validation?     │
└─────────────┘  └──────────────────────────┘
                          │
                  ┌───────┴───────┐
                  ▼               ▼
                Yes              No
                  │               │
                  ▼               ▼
         ┌─────────────┐  ┌─────────────────────────┐
         │ Use Layer 2 │  │ Do you need full param  │
         │ (Image.bs)  │  │ control or custom logic?│
         └─────────────┘  └─────────────────────────┘
                               │
                       ┌───────┴───────┐
                       ▼               ▼
                     Yes              No
                       │               │
                       ▼               ▼
              ┌─────────────┐  ┌──────────────┐
              │ Use Layer 1 │  │ Use Layer 2  │
              │ (ApiClient) │  │ (Image.bs)   │
              └─────────────┘  └──────────────┘
```

## Common Patterns

### Loading User Avatar in a Component

```brighterscript
import "pkg:/source/api/ImageHelpers.bs"

sub loadUserImage()
  ' Layer 3: Cleanest, handles validation
  userImage.uri = GetUserAvatarURL(m.global.user, 36, 36)
  
  if userImage.uri = ""
    ' No valid image - use fallback
    userImage.uri = "pkg:/images/icons/person_36px.png"
  end if
end sub
```

### Loading Item Poster with Fallbacks

```brighterscript
import "pkg:/source/api/ImageHelpers.bs"

sub loadItemPoster(item as object)
  ' Layer 3: Tries multiple image types automatically
  poster.uri = GetPosterURLFromItem(item, 440, 295)
end sub
```

### Custom Image with Specific Requirements

```brighterscript
import "pkg:/source/api/Image.bs"

sub loadCustomImage(itemId, imageTag)
  ' Layer 2: Custom size with validation
  url = ImageURL(itemId, "Primary", {
    tag: imageTag,
    maxHeight: 100,
    maxWidth: 100,
    quality: 85
  })
  
  if url <> ""
    poster.uri = url
  end if
end sub
```

### Direct API Access (Rare)

```brighterscript
' Layer 1: Only when you need full control
url = GetApi().GetUserImageURL(userId, "primary", 0, {
  maxHeight: 600,
  maxWidth: 600,
  quality: 95
})
```

## Anti-Patterns to Avoid

❌ **Don't use item endpoints for users:**

```brighterscript
' WRONG - uses item endpoint for user image
userImage.uri = GetApi().GetImageURL(userId, "primary", 0, params)
```

✅ **Correct:**

```brighterscript
' CORRECT - uses user endpoint
userImage.uri = GetApi().GetUserImageURL(userId, "primary", 0, params)
' Or better: use helper
userImage.uri = GetUserAvatarURL(user, 36, 36)
```

❌ **Don't skip validation:**

```brighterscript
' WRONG - will 404 if tag is invalid
params = { tag: possiblyInvalidTag }
url = GetApi().GetImageURL(id, "primary", 0, params)
```

✅ **Correct:**

```brighterscript
' CORRECT - validates tag first
url = ImageURL(id, "primary", { tag: possiblyInvalidTag })
if url <> ""
  ' Safe to use
end if
```

## Testing

When writing tests for image URL generation:

- **Layer 1 tests:** Verify correct endpoint paths for `V1/V2` (see `sdk.versioning.spec.bs`)
- **Layer 2 tests:** Verify tag validation and defaults (see `ImageURL.spec.bs`)
- **Layer 3 tests:** Verify node property extraction and fallback chains

## Migration Guide

If you encounter code using the wrong endpoint:

1. **Identify the resource type** (user vs item)
2. **Check for node availability** (`JellyfinUser`/`JellyfinBaseItem`)
3. **Select appropriate layer** using decision tree above
4. **Update imports** if needed
5. **Test on both `V1` and `V2` servers**

## References

- `source/api/ApiClient.bs` - Layer 1: Raw API client
- `source/api/Image.bs` - Layer 2: Business logic utilities
- `source/api/ImageHelpers.bs` - Layer 3: Domain helpers
- `tests/source/unit/api/sdk.versioning.spec.bs` - `V1/V2` endpoint tests
- `tests/source/unit/api/ImageURL.spec.bs` - Validation tests
- `docs/dev/sdk-api-versioning.md` - `V1` vs `V2` API differences
