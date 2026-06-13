# Security Policy

## Supported versions

JellyRock is a rolling release. Only the **latest published release** (Roku
Channel Store, or the most recent `main` build) receives fixes. If you're on an
older sideloaded build, please update before reporting an issue.

| Version | Supported |
| --- | --- |
| Latest release / current `main` | ✅ |
| Anything older | ❌ — please update first |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or the Matrix chat.**

Report privately through GitHub's built-in flow:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** (Private Vulnerability Reporting).
3. Describe the issue, the affected version, and reproduction steps.

You'll get a response as soon as the maintainer is able. Please give a
reasonable window to investigate and ship a fix before any public disclosure.

## Scope

JellyRock is a Roku client that connects to a Jellyfin server you control.
Reports that are most useful concern: handling of server credentials and tokens,
data sent off-device, and anything that could expose another user's session on a
shared Roku. Issues in your Jellyfin **server** itself should go to the Jellyfin
project, not here.
