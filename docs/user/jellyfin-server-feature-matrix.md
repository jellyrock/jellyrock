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
| **Quick Connect**         | ✅     | ✅     | ✅     | ✅       | Auto-dispatches per server API  |
| **Media Segments**        | ❌     | ❌     | ❌     | ✅       | Skip intro/outro/recap/etc.     |

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

Requires the Jellyfin server to have media segment detection configured (e.g., via intro/outro detection plugins). Per-segment-type action preferences (auto-skip, show skip button, do nothing) can be configured in the Jellyfin web client and optionally overridden in JellyRock's Settings > Playback > Media Segments.

## Upgrade Recommendations

**Minimum**: 10.7.0 (all essential features work)

**Recommended**: 10.10.0+ (enables Trickplay thumbnails and Media Segments)

JellyRock will continue supporting 10.7.x indefinitely.
