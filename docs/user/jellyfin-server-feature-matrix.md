# Jellyfin Server Feature Support Matrix

This document shows which JellyRock features require specific Jellyfin server versions.

## Quick Reference

| Server Version    | API Version |
| ----------------- | ----------- |
| 10.7.0 - 10.8.x   | 1           |
| 10.9.0+           | 2           |

## Version-Specific Features

| Feature                   | 10.7.x | 10.8.x | 10.9.x | 10.10.x+ | Notes                           |
| ------------------------- | ------ | ------ | ------ | -------- | ------------------------------- |
| **Trickplay Thumbnails**  | ❌     | ❌     | ✅     | ✅       | Video preview scrubbing         |
| **Quick Connect**         | ❌     | ✅     | ✅     | ✅       | 10.7 uses "Token" not "Secret"  |
| **Media Segments**        | ❌     | ❌     | ❌     | ✅       | Skip intro/outro/recap/etc.     |

## Legend

| Symbol | Meaning                       |
| ------ | ----------------------------- |
| ✅     | Fully supported               |
| ❌     | Not available on this version |

## Important Notes

### Quick Connect

Quick Connect authentication requires Jellyfin 10.8 or newer.

- **10.7**: ❌ Does not work (API uses "Token" field, app sends "Secret")
- **10.8+**: ✅ Works correctly

Use username/password login for 10.7 servers.

### Media Segments

Media Segments enable skip functionality for detected intros, outros, recaps, previews, and commercials during video playback.

- **10.9 and below**: ❌ Not available (the API endpoint does not exist)
- **10.10+**: ✅ Fully supported

Requires the Jellyfin server to have media segment detection configured (e.g., via intro/outro detection plugins). Per-segment-type action preferences (auto-skip, show skip button, do nothing) can be configured in the Jellyfin web client and optionally overridden in JellyRock's Settings > Playback > Media Segments.

## Upgrade Recommendations

**Minimum**: 10.7.0 (all essential features work)

**Recommended**: 10.10.0+ (enables Trickplay thumbnails and Media Segments)

JellyRock will continue supporting 10.7.x indefinitely.
