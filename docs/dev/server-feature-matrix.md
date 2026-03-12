# Jellyfin Server Feature Support Matrix

This document shows which JellyRock features require specific Jellyfin server versions.

## Quick Reference

| Server Version | API Version | Support Level |
|----------------|-------------|---------------|
| 10.7.0 - 10.8.x | 1 | Core features only |
| 10.9.0+ | 2 | Full feature set |

## Version-Specific Features

Only features with version differences are listed below. All other features (playback, browsing, search, etc.) work identically across all supported versions.

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **Trickplay Thumbnails** | ❌ | ❌ | ✅ | Video preview scrubbing |
| **Quick Connect** | ❌ | ✅ | ✅ | 10.7 uses "Token" not "Secret" |

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully supported |
| ❌ | Not available on this version |
| ⚠️ | Partially supported |

## Important Notes

### Quick Connect
Quick Connect authentication requires Jellyfin 10.8 or newer.

- **10.7**: ❌ Does not work (API uses "Token" field, app sends "Secret")
- **10.8+**: ✅ Works correctly

Use username/password login for 10.7 servers.

### What Works on ALL Versions

The following features work identically on 10.7.0 through latest:

- Video/audio playback (all formats)
- Direct play and transcoding
- Library browsing (Movies, TV, Music)
- Continue watching / Next up
- Favorites and playlists
- Search functionality
- Subtitle support
- Image display (posters, backdrops, logos)
- Live TV and DVR
- Multiple user accounts
- User settings sync

## Upgrade Recommendations

**Minimum**: 10.7.0 (all essential features work)

**Recommended**: 10.9.0+ (enables Trickplay thumbnails)

JellyRock will continue supporting 10.7.x indefinitely.
