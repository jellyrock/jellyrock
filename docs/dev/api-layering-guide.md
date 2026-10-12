---
topic: api-layering-guide
related-files:
  - source/api/ApiClient.bs
  - source/api/image.bs
  - source/api/imageHelpers.bs
  - source/utils/itemImageUrl.bs
  - source/api/items.bs
  - source/api/userAuth.bs
last-reviewed: 2026-10-09
---

# API layering guide

JellyRock builds API requests and image URLs in three layers. Use the highest layer that does what you need: it handles more for you.

| Layer | Where | What it adds |
| --- | --- | --- |
| 3: domain helpers | `source/utils/itemImageUrl.bs`, `source/utils/rowItemImage.bs`, `source/api/imageHelpers.bs` | Reads what it needs from a `JellyfinBaseItem` or `JellyfinUser` node, and falls back to other images |
| 2: image URLs | `source/api/image.bs` | Checks the image tag, and sets default sizes and quality |
| 1: API client | `source/api/ApiClient.bs` | Builds each endpoint's request for the server's API version, and adds default query parameters |

## Layer 1: `ApiClient`

Call it through `GetApi().<method>()`. `ApiClient` builds requests for the Jellyfin endpoints and picks the right form for the server's API version (`V1` or `V2`). See [Jellyfin server versioning](jellyfin-server-versioning.md) for what the versions mean.

### Default parameters

Builders that fetch items pass your parameters through `injectApiParams()` (in `source/utils/misc.bs`), which adds:

| Parameter | Default | Why |
| --- | --- | --- |
| `EnableImageTypes` | `"Primary,Backdrop,Logo,Thumb"` | Asks for every image type the app shows |
| `ImageTypeLimit` | `1` | One image per type |
| `fields` | Your fields, plus those below | The app needs them on every item |

It adds these to `fields` when they are missing:

- `PrimaryImageAspectRatio`, which makes the server return `ImageTags`.
- `Chapters`.
- `Trickplay`, on `V2` servers (Jellyfin 10.9 and later).

Your own values override the image defaults. `BuildGetItemRawRequest` skips all of this.

One builder sets a default of its own:

| Builder | Parameter | Default | Why |
| --- | --- | --- | --- |
| `BuildGetResumeItemsRequest` | `MediaTypes` | `"Video"` | `MediaTypes` is the only filter `/UserItems/Resume` accepts. Since Jellyfin 12.0 a folder also counts as resumable when something inside it is in progress, so without the filter the results include seasons and series as well as episodes ([#784](https://github.com/jellyrock/jellyrock/issues/784)). To change it, pass a comma-separated string. `buildParams` drops an array ([`buildparams-no-array-support`](../architecture/tech-debt.md#buildparams-no-array-support)), which leaves the default. |

### When to use layer 1

- You need full control of the parameters. Values you pass override the defaults.
- You are writing a layer 2 or layer 3 helper.
- The endpoint has no helper above it.

### Image URL methods

The two methods add no defaults and check nothing. Use the one that matches what the image belongs to:

| Method | For | Endpoint |
| --- | --- | --- |
| `GetImageURL(id, type, index, params)` | Items (movies, episodes and so on) | `/items/{id}/images/{type}/{index}` |
| `GetUserImageURL(id, type, index, params)` | User avatars | `V1`: `/users/{id}/images/{type}/{index}`<br>`V2`: `/UserImage?userId={id}` |

```brighterscript
url = GetApi().GetUserImageURL(userId, "primary", 0, {
  maxHeight: 300,
  maxWidth: 300,
  quality: 90
})
' V1: "http://server:8096/users/abc123/images/primary/0?maxHeight=300..."
' V2: "http://server:8096/UserImage?userId=abc123&type=primary..."
```

## Layer 2: image URLs

Import `pkg:/source/api/image.bs`. Its two functions return a URL string, or `""` when there is nothing to show.

| Function | For | Defaults |
| --- | --- | --- |
| `ImageURL(id, version, params, serverURL)` | Item images | `maxHeight` 384, `maxWidth` 196, `quality` 90 |
| `UserImageURL(id, params)` | User avatars | `maxHeight` 300, `maxWidth` 300, `quality` 90 |

**Both check the tag.** If `params` has a `tag` (or `Tag`) that is invalid or empty, they return `""`, so the app never requests an image the server doesn't have. Both also return `""` when no server URL is set.

`UserImageURL` calls layer 1's `GetUserImageURL`. `ImageURL` builds the item URL itself, and takes the server URL as its last argument when the caller already has it.

### When to use layer 2

- You have an ID and a tag, but no node.
- You want the default sizes, or the tag check, without a layer 3 helper.

```brighterscript
url = UserImageURL(userId, {
  tag: user.primaryImageTag,
  maxHeight: 36,
  maxWidth: 36
})
' "" when the tag is invalid, otherwise the URL with the defaults filled in
```

## Layer 3: domain helpers

These take a `JellyfinBaseItem` or `JellyfinUser` node, read the IDs and tags from it, and fall back to other images when the first choice is missing. Item helpers take a size from the `imageSize` namespace (`source/constants/imageSize.bs`).

| Function | Takes | Tries, in order |
| --- | --- | --- |
| `getItemPosterUrl(item, size)` | `JellyfinBaseItem` | Item primary, parent primary, series primary |
| `getItemWidePosterUrl(item, size)` | `JellyfinBaseItem` | Item thumb, item backdrop, parent thumb, parent backdrop |
| `getItemThumbnailUrl(item, size)` | `JellyfinBaseItem` | Same as `getItemWidePosterUrl`, with a smaller default size |
| `getItemBackdropUrl(item, size)` | `JellyfinBaseItem` | Item backdrop, parent backdrop |
| `getItemParentWidePosterUrl(item, size)` | `JellyfinBaseItem` | Parent thumb, parent backdrop |
| `getItemImageUrl(item, imageType, size)` | `JellyfinBaseItem` | Only the type you ask for, such as `"Logo"` |
| `getProgramImageUrl(programItem, channelItem, size)` | Two `JellyfinBaseItem` nodes | The Live TV program's image, then its channel's |
| `getRowItemImageUrl(item, slotWidth, posterHeight, userSettings, …)` | `JellyfinBaseItem` | Picks one of the above from the item type, the slot size and the user's settings |
| `GetUserAvatarURL(user, maxHeight, maxWidth)` | `JellyfinUser` | Primary only, with the tag check |

### When to use layer 3

- You have a `JellyfinBaseItem` or `JellyfinUser` node.
- You want the fallbacks.

## Which layer to use

1. You have a `JellyfinBaseItem` or `JellyfinUser` node: layer 3.
2. You have an ID and a tag, or you want the default sizes: layer 2.
3. You need full control of the parameters, or you are writing a helper: layer 1.

## Examples

### A user's avatar

```brighterscript
import "pkg:/source/api/imageHelpers.bs"

sub loadUserImage()
  userImage.uri = GetUserAvatarURL(m.global.user, 36, 36)
  if userImage.uri = ""
    ' No avatar: show the generic person icon
    userImage.uri = "pkg:/images/icons/person_36px_$$RES$$.png"
  end if
end sub
```

### An item's poster, with fallbacks

```brighterscript
import "pkg:/source/utils/itemImageUrl.bs"

sub loadItemPoster(item as object)
  poster.uri = getItemPosterUrl(item, imageSize.POSTER_LG)
end sub
```

### A custom size, with the tag check

```brighterscript
import "pkg:/source/api/image.bs"

sub loadCustomImage(itemId, imageTag)
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

## Mistakes to avoid

**Don't use the item endpoint for a user's image.** It requests the wrong resource.

```brighterscript
' Wrong: item endpoint for a user image
userImage.uri = GetApi().GetImageURL(userId, "primary", 0, params)

' Right: the user endpoint, or better, the helper
userImage.uri = GetApi().GetUserImageURL(userId, "primary", 0, params)
userImage.uri = GetUserAvatarURL(user, 36, 36)
```

**Don't skip the tag check.** Layer 1 builds the URL even when the tag is invalid, and the server answers 404.

```brighterscript
' Wrong: 404 when the tag is invalid
url = GetApi().GetImageURL(id, "primary", 0, { tag: possiblyInvalidTag })

' Right: "" when the tag is invalid
url = ImageURL(id, "primary", { tag: possiblyInvalidTag })
```

## Tests

- Layer 1: the endpoint paths for `V1` and `V2`, in `tests/source/unit/api/sdk.versioning.spec.bs`.
- Layer 2: the tag check and the defaults, in `tests/source/unit/api/ImageURL.spec.bs`.
- Layer 3: what each helper reads from the node, and its fallbacks.

When you move code to the right layer, find what the image belongs to (a user or an item) and whether you have a node, pick the layer from the list above, and test against a `V1` and a `V2` server.
