# Jellyfin Server Feature Support Matrix

This document shows which JellyRock features require specific Jellyfin server versions.

## Quick Reference

| Server Version    | API Version |
| ----------------- | ----------- |
| 10.7.0 - 10.8.x   | 1           |
| 10.9.0+           | 2           |

## Version-Specific Features

| Feature                  | 10.7.x | 10.8.x | 10.9.x | 10.10.x–10.11.x | 12.0+ | Notes                                              |
| ------------------------ | ------ | ------ | ------ | --------------- | ----- | -------------------------------------------------- |
| **Trickplay Thumbnails** | ❌     | ❌     | ✅     | ✅              | ✅    | Video preview scrubbing                            |
| **Quick Connect**        | ✅     | ✅     | ✅     | ✅              | ✅    | Auto-dispatches per server API                     |
| **Media Segments**       | ❌     | ❌     | ❌     | ✅              | ✅    | Skip intro/outro/recap/etc.                        |
| **Song Lyrics**          | ❌     | ❌     | ✅     | ✅              | ✅    | Lyrics your library already has                    |
| **Collections row**      | ❌     | ❌     | ❌     | ❌              | ✅    | The collections an item is in, on its details page |

## Legend

| Symbol | Meaning                       |
| ------ | ----------------------------- |
| ✅     | Fully supported               |
| ❌     | Not available on this version |

## Important Notes

### Quick Connect

Quick Connect works on every supported Jellyfin version. JellyRock auto-detects
the server version and uses the right request shape.

- **10.7.x**: ✅ Works — uses `Token` body field on `AuthenticateWithQuickConnect`
- **10.8.x**: ✅ Works — uses `Secret` body field; `Initiate` is `GET`
- **10.9.0+**: ✅ Works — uses `Secret` body field; `Initiate` is `POST`

The Quick Connect button is hidden when the server explicitly reports the
feature disabled (10.8+ via `/QuickConnect/Enabled`); on 10.7 the button is
always shown and a clear dialog appears if Quick Connect is unavailable.

### Media Segments

Media Segments enable skip functionality for detected intros, outros, recaps, previews, and commercials during video playback.

- **10.9 and below**: ❌ Not available (the API endpoint does not exist)
- **10.10+**: ✅ Fully supported

Requires a media segment provider plugin on the server to detect the segments. See [Media Segments](media-segments.md) for the plugins JellyRock is tested with, how to choose what happens for each segment type, and troubleshooting.

### Collections row

An item's details page lists the collections it belongs to, so you can open a collection from any movie, series or episode in it.

- **10.11 and below**: ❌ Not available (the API endpoint does not exist)
- **12.0+**: ✅ Fully supported

Only collections the item was added to directly are listed — an episode shows the collections that episode is in, not the ones its series is in.

## Upgrade Recommendations

**Minimum**: 10.7.0 (all essential features work)

**Recommended**: 10.10.0+ (enables Trickplay thumbnails and Media Segments)

JellyRock will continue supporting 10.7.x indefinitely.

---

_For contributors: the machine-readable map of which endpoints require which
server version (and how JellyRock copes on older servers) lives in
[`docs/dev/jellyfin-endpoint-availability.yml`](../dev/jellyfin-endpoint-availability.yml),
consumed by the server-upgrade-automation pipeline. This user-facing table is the
plain-language mirror._
