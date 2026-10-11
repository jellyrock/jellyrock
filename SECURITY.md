# Security policy

## Supported versions

JellyRock is a rolling release. Only the latest published release (in the Roku Channel Store, or the newest `main` build) gets fixes. If you run an older sideloaded build, update before you report an issue.

| Version | Supported |
| --- | --- |
| Latest release or current `main` | ✅ |
| Anything older | ❌ Update first |

## Reporting a vulnerability

**Don't report a security vulnerability in a public GitHub issue, a discussion or the Matrix chat.**

Report it privately through GitHub:

1. Go to the repository's **Security** tab.
2. Select **Report a vulnerability** (GitHub's private vulnerability reporting).
3. Describe the issue, the affected version and the steps to reproduce it.

The maintainer replies as soon as they can. Allow a reasonable time to investigate and ship a fix before you disclose it publicly.

## Scope

JellyRock is a Roku client that connects to a Jellyfin server you control. The most useful reports cover how JellyRock handles server credentials and tokens, any data it sends off the device, and anything that could expose another user's session on a shared Roku. Report issues in the Jellyfin server itself to the Jellyfin project, not here.
