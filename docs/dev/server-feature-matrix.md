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
| **Music Lyrics** | ❌ | ❌ | ✅ | On-screen lyrics display |
| **Audio Normalization** | ❌ | ❌ | ✅ | ReplayGain support |
| **HDR Type Detection** | ⚠️ | ⚠️ | ✅ | Limited on 10.7-10.8 |
| **Dolby Vision Detection** | ⚠️ | ⚠️ | ✅ | Limited on 10.7-10.8 |
| **Quick Connect** | ⚠️ | ✅ | ✅ | 10.7 uses "Token" field |

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully supported |
| ❌ | Not available on this version |
| ⚠️ | Partially supported |

## Important Notes

### HDR/Dolby Vision (⚠️ on 10.7-10.8)
HDR and Dolby Vision content plays fine on all versions. However:
- **10.9+**: Full detection via `VideoRangeType` field
- **10.7-10.8**: Limited detection, may not display HDR badges

Does NOT affect playback quality - only visual indicators in the UI.

### Quick Connect (⚠️ on 10.7)
Quick Connect authentication works on 10.7 but uses a different field name:
- **10.7**: Uses `Token` field
- **10.8+**: Uses `Secret` field

If Quick Connect fails on 10.7, use username/password login instead.

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

**Recommended**: 10.9.0+ (enables Trickplay, lyrics, better HDR detection)

JellyRock will continue supporting 10.7.x indefinitely.
