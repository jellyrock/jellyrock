# Jellyfin Server Feature Support Matrix

This document shows which JellyRock features require specific Jellyfin server versions.

## Quick Reference

| Server Version | API Version |
|----------------|-------------|
| 10.7.0 - 10.8.x | 1 |
| 10.9.0+ | 2 |

## Version-Specific Features

| Feature | 10.7.x | 10.8.x | 10.9.x+ | Notes |
|---------|--------|--------|---------|-------|
| **Trickplay Thumbnails** | ❌ | ❌ | ✅ | Video preview scrubbing |
| **Quick Connect** | ❌ | ✅ | ✅ | 10.7 uses "Token" not "Secret" |

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully supported |
| ❌ | Not available on this version |

## Important Notes

### Quick Connect

Quick Connect authentication requires Jellyfin 10.8 or newer.

- **10.7**: ❌ Does not work (API uses "Token" field, app sends "Secret")
- **10.8+**: ✅ Works correctly

Use username/password login for 10.7 servers.

## Upgrade Recommendations

**Minimum**: 10.7.0 (all essential features work)

**Recommended**: 10.9.0+ (enables Trickplay thumbnails)

JellyRock will continue supporting 10.7.x indefinitely.
