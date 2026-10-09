# Jellyfin server feature matrix

Some JellyRock features need a newer Jellyfin server. This page shows which server version each one needs.

Features that need a server plugin are in [Jellyfin server plugins](jellyfin-server-plugins.md).

## Features by server version

| Feature | 10.7.x | 10.8.x | 10.9.x | 10.10.x–10.11.x | 12.0+ | What you get |
| --- | --- | --- | --- | --- | --- | --- |
| Trickplay thumbnails | ❌ | ❌ | ✅ | ✅ | ✅ | Preview images while you scrub through a video |
| Quick Connect | ✅ | ✅ | ✅ | ✅ | ✅ | Sign in with a code instead of a password |
| Media segments | ❌ | ❌ | ❌ | ✅ | ✅ | Skip intros, outros, recaps and more |
| Song lyrics | ❌ | ❌ | ✅ | ✅ | ✅ | Lyrics your library already has |
| Collections row | ❌ | ❌ | ❌ | ❌ | ✅ | The collections an item is in, on its details page |
| Collections view | ❌ | ❌ | ❌ | ❌ | ✅ | Browse one library's collections from its **View** menu |
| Language filters | ❌ | ❌ | ❌ | ❌ | ✅ | Filter a library by audio or subtitle language |

✅ means the feature works on that version. ❌ means it is not available.

## Quick Connect

Quick Connect works on every server version JellyRock supports.

On Jellyfin 10.8 and later, JellyRock hides the **Quick Connect** button when your server has the feature turned off. On 10.7 the button always shows, and a dialog tells you if Quick Connect is unavailable.

## Media segments

Media segments let JellyRock skip intros, outros, recaps, previews and commercials. They need Jellyfin 10.10 or later; 10.9 and earlier do not have the feature.

Your server also needs a media segment provider plugin to find the segments. See [Media segments](media-segments.md) for the plugins JellyRock is tested with, how to choose what happens for each segment type, and troubleshooting.

## Collections row

An item's details page lists the collections it belongs to, so you can open a collection from any movie, series or episode in it. It needs Jellyfin 12.0 or later; 10.11 and earlier do not have the feature.

Only collections the item was added to directly are listed. An episode shows the collections that episode is in, not the ones its series is in.

## Collections view

A movie or TV library's **View** menu gains a **Collections** entry that lists the collections in that library. Opening one shows what it contains, the same as opening it from the top-level **Collections** library.

It needs Jellyfin 12.0 or later. On 10.11 and earlier, JellyRock does not offer it: those servers ignore which library was asked about, so the list would mix in collections from your other libraries.

Playlists are not listed here. A playlist belongs to you, not to a library, and can hold items from several libraries. It stays in the top-level **Playlists** library.

## Language filters

A movie library's **Filter** menu gains **Audio Language** and **Subtitle Language**, which list the languages that library has.

They need Jellyfin 12.0 or later. On 10.11 and earlier, JellyRock does not offer them: those servers accept the filter and then ignore it, so you would get your whole library back.

A language spelled two ways in your files is one entry in the list, and picking it finds both. For example, Jellyfin knows French as both `fra` and `fre`.

## Which version to run

- **Minimum:** Jellyfin 10.7.0. Every essential feature works.
- **Recommended:** Jellyfin 10.10.0 or later, for media segments. Trickplay thumbnails and song lyrics need 10.9.0 or later.

JellyRock will keep supporting Jellyfin 10.7.x.

---

_For contributors: [`docs/dev/jellyfin-endpoint-availability.yml`](../dev/jellyfin-endpoint-availability.yml) maps each endpoint to the server version it needs and how JellyRock copes on older servers. [Jellyfin server versioning](../dev/jellyfin-server-versioning.md) explains how JellyRock picks its request shape for each version. This page is the plain-language version._
