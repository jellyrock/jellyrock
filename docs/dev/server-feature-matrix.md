# Jellyfin Server Feature Support Matrix

This document shows which JellyRock features are available based on your Jellyfin server version.

## Quick Reference

| Server Version | API Version | Status |
|----------------|-------------|--------|
| 10.7.0 - 10.8.x | 1 | ✅ Fully Supported |
| 10.9.0 - 10.10.x | 2 | ✅ Fully Supported |
| 10.11.x+ | 2 | ✅ Fully Supported |

## Feature Availability by Server Version

### Core Features

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **Media Playback** | ✅ | ✅ | ✅ | All video/audio formats |
| **Libraries View** | ✅ | ✅ | ✅ | Movies, TV, Music, etc. |
| **Continue Watching** | ✅ | ✅ | ✅ | Resume partially watched items |
| **Next Up** | ✅ | ✅ | ✅ | Next episode in series |
| **Latest Media** | ✅ | ✅ | ✅ | Recently added content |
| **Favorites** | ✅ | ✅ | ✅ | Mark/unmark favorites |
| **Search** | ✅ | ✅ | ✅ | Search across libraries |
| **Shuffle Play** | ✅ | ✅ | ✅ | Random playback order |

### Image Features

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **Poster Images** | ✅ | ✅ | ✅ | Primary artwork display |
| **Backdrop Images** | ✅ | ✅ | ✅ | Background images on item details |
| **Logo Images** | ✅ | ✅ | ✅ | Series/movie logos on OSD |
| **Thumbnail Images** | ✅ | ✅ | ✅ | Video thumbnails |
| **Image Tag Support** | ✅ | ✅ | ✅ | Caching and optimization |

### Video Features

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **Direct Play** | ✅ | ✅ | ✅ | Stream without transcoding |
| **Transcoding** | ✅ | ✅ | ✅ | Server-side format conversion |
| **HDR Support** | ✅* | ✅* | ✅ | HDR10, HLG detection |
| **Dolby Vision** | ✅* | ✅* | ✅ | DoVi profile detection |
| **Subtitle Support** | ✅ | ✅ | ✅ | SRT, ASS, PGS, etc. |
| **Audio Track Selection** | ✅ | ✅ | ✅ | Multiple audio languages |
| **Chapter Support** | ✅ | ✅ | ✅ | Chapter markers and thumbnails |

*HDR/DoVi detection limited on 10.7.x-10.8.x (no VideoRangeType field)

### TV/Series Features

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **Seasons View** | ✅ | ✅ | ✅ | Browse seasons |
| **Episodes List** | ✅ | ✅ | ✅ | Episode grid/list |
| **Next Episode Auto-Play** | ✅ | ✅ | ✅ | Play next episode automatically |
| **Special Features** | ✅ | ✅ | ✅ | Behind the scenes, deleted scenes |
| **Intros/Pre-roll** | ✅ | ✅ | ✅ | Custom intro videos |

### Music Features

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **Album Art** | ✅ | ✅ | ✅ | Cover images |
| **Artist Images** | ✅ | ✅ | ✅ | Artist artwork |
| **Audio Playback** | ✅ | ✅ | ✅ | All audio formats |
| **Lyrics Display** | ❌ | ❌ | ✅ | Requires 10.9+ |
| **Instant Mix** | ✅ | ✅ | ✅ | Auto-generated playlists |
| **Normalization** | ❌ | ❌ | ✅ | Audio normalization (10.9+) |

### Advanced Features

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **Trickplay** | ❌ | ❌ | ✅ | Video preview thumbnails (10.9+) |
| **Quick Connect** | ⚠️ | ✅ | ✅ | 10.7.x uses different field name |
| **Remote Control** | ✅ | ✅ | ✅ | Control from other devices |
| **User Management** | ✅ | ✅ | ✅ | Multiple user support |
| **Live TV** | ✅ | ✅ | ✅ | Live TV and DVR support |

### Settings & Configuration

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **User Settings Sync** | ✅ | ✅ | ✅ | Settings saved to server |
| **Display Preferences** | ✅ | ✅ | ✅ | Show/hide backdrop, etc. |
| **Subtitle Settings** | ✅ | ✅ | ✅ | Language preferences |
| **Audio Settings** | ✅ | ✅ | ✅ | Default audio language |

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully supported |
| ❌ | Not supported on this version |
| ⚠️ | Partially supported / has limitations |

## Version-Specific Limitations

### 10.7.x - 10.8.x (API v1)

**Limitations:**
- Trickplay thumbnails: Not available (feature added in 10.9)
- Music lyrics: Not available (feature added in 10.9)
- Audio normalization: Not available (feature added in 10.9)
- HDR/DoVi detection: Limited (no VideoRangeType field)
- Quick Connect: Uses `Token` field (vs `Secret` in 10.8+)

**Workarounds:**
- App gracefully degrades - features simply won't appear
- All core functionality works identically

### 10.9.x+ (API v2)

**Full feature set available.**

All features listed as ✅ above are available on 10.9.x and newer versions.

## Troubleshooting

**Q: Why doesn't Trickplay work on my 10.8 server?**
A: Trickplay is a Jellyfin 10.9+ feature. Upgrade your server to enable it.

**Q: Why are some images not loading on 10.7?**
A: Ensure you're running the latest JellyRock version. Earlier versions had image loading issues on 10.7 that have been resolved.

**Q: Can I use Quick Connect on 10.7?**
A: Quick Connect has limited support on 10.7 due to API differences. Username/password login is recommended for 10.7 servers.

**Q: Will newer Jellyfin versions break JellyRock?**
A: No. The app is designed to be forward-compatible. New server versions automatically use the 10.9+ (API v2) code paths until explicitly updated.

## Checking Your Server Version

You can check your Jellyfin server version in the app:
1. Go to Settings → Server Information
2. The version is displayed at the top

Or check directly in your Jellyfin web dashboard:
1. Log in as admin
2. Go to Dashboard → General
3. Version shown in top right

## Upgrade Recommendations

**Minimum Recommended:** 10.7.0 (all core features work)

**Optimal:** 10.9.0 or newer (all features including Trickplay, lyrics, etc.)

JellyRock will continue to support 10.7.x indefinitely, but upgrading to 10.9+ unlocks all features.
