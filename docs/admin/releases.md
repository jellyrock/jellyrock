# Releases

A release takes three actions from you: push a release branch, merge the PR it opens, and publish the draft release. Workflows do the rest. Store submission needs a signed `.pkg`, which you build on your own machine.

## Overview

```bash
# 1. Create and push the release branch
git checkout -b release-1.21.3
git push origin release-1.21.3

# 2. CI checks the version, merges translations, bumps the version files,
#    opens the PR "Prepare for v1.21.3 release" and creates a draft release with a ZIP

# 3. Review and merge the PR
#    CI rebuilds the draft release's ZIP from main

# 4. Edit the draft release: add the scheduled release date, review the notes, publish

# 5. Publishing creates the tag; CI turns [Unreleased] into the release's changelog section
```

## Step by step

### 1. Push a release branch

```bash
git checkout -b release-1.21.3
git push origin release-1.21.3
```

A branch named `release-X.Y.Z` starts `release-management.yml`, which:

1. Checks the version is in `x.y.z` form and greater than the latest release. If not, it stops with an error.
2. Merges translations from Weblate into the branch, fills gaps from other Jellyfin clients, and sends the result back to Weblate. See [Weblate sync](../architecture/translations.md#weblate-sync) for the steps and the `WEBLATE_TOKEN` it needs.
3. Updates the version in `package.json`, `package-lock.json` and `manifest`.
4. Opens the PR "Prepare for v1.21.3 release" as `jellyrock[bot]`, labeled `release-prep`.
5. Builds the production app and creates a draft GitHub release with the ZIP. An existing draft for the same tag is deleted first. The release notes come from the changelog, under a "Release Schedule" heading with a placeholder date.

### 2. Merge the release PR

Merging a PR labeled `release-prep` into `main` starts `update-draft-release.yml`. It reads the version from the PR title, builds the production app from `main`, and replaces the draft release's ZIP.

### 3. Publish the release

Edit the draft release: set the scheduled release date and review the notes. Then publish it.

Publishing creates the `vX.Y.Z` tag on `main`, which starts `release-build.yml`. It turns `[Unreleased]` in `CHANGELOG.md` into the release's section and commits that to `main`. How changelog entries are built, and how to fix one, is in [Changelog](changelog.md).

## Files the release changes

| File | Changed by | What changes |
| --- | --- | --- |
| `package.json`, `package-lock.json` | The release workflow | `version` |
| `manifest` | The release workflow | `major_version`, `minor_version`, `build_version` |
| `CHANGELOG.md` | CI | `[Unreleased]` becomes the release's section at publish |
| `Makefile` | Nobody | Its `VERSION` stays at 1.0.0 unless you change it by hand |
| The draft release's notes | You | The scheduled release date |

## Fixing a release in progress

- **Wrong code or version files:** push fixes to the release branch before you merge its PR.
- **Wrong release notes:** edit the draft release before you publish it.
- **Start over:** delete the draft release. Pushing to the release branch again creates a new one.

## Signed `.pkg` for Roku Channel Store

The Channel Store takes a signed `.pkg`, not the sideload ZIP. Roku has no upload API, so you always upload by hand, but `npm run package:signed` builds the `.pkg` for you.

### Build it

After the release PR has merged, run this with your dev Roku on the network:

```bash
npm run package:signed
```

It runs `npm run build:prod`, then `node scripts/create-signed-package.cjs`, which signs the build on your Roku with `roku-deploy`'s `deployAndSignPackage()`. The output is `out/jellyrock-vX.Y.Z.pkg`. The version comes from `manifest`, so a missed version bump shows in the file name. Upload the file to the [Roku Developer Portal](https://developer.roku.com/).

### One-time setup

If you have no `.env` yet, copy [`.env.example`](../../.env.example) to `.env` and fill it in. Otherwise add these two values to your `.env`:

```sh
ROKU_SIGNING_PASSWORD=...   # the password you type into the dev portal
ROKU_DEV_ID=...             # optional but recommended; see "Finding ROKU_DEV_ID" below
```

Run `chmod 600 .env` so only you can read it. To keep the signing password off disk, pass it from your secret manager instead. The script only reads environment variables:

```bash
ROKU_SIGNING_PASSWORD=$(pass show jellyrock/signing) npm run package:signed
```

### Finding `ROKU_DEV_ID`

`ROKU_DEV_ID` is the **keyed developer ID**: a 40-character hex value that comes from the signing key on your Roku. Roku uses other IDs that are easy to mix up with it:

| ID | Looks like | Where you find it |
| --- | --- | --- |
| Keyed developer ID (the one you want) | 40 hex characters | `keyed-developer-id` in the Roku's device info |
| Channel ID | A number: JellyRock's is `819325` | The app list on a Roku (`/query/apps`) |
| Channel Store listing | 32 hex characters | The channel's store URL, `details/<this>:<other>/jellyrock` |

To read your Roku's keyed developer ID:

```bash
curl -s "http://${ROKU_IP}:8060/query/device-info" | grep keyed-developer-id
```

If the current Channel Store `.pkg` installs on this Roku through **Install from File** in the developer settings, the Roku has the same key the published channel was signed with. Copy the value into `.env`. If the install fails, the Roku has a different key, and you must rekey it from the current store `.pkg` first.

### Safety checks

- **Production build only.** The script refuses to sign if `build/` contains any source map (`*.map`), which means a dev or test build is sitting there. `npm run package:signed` runs `build:prod` first, so this only catches running the script directly against an old build.
- **Right key.** When `ROKU_DEV_ID` is set, the script reads the Roku's `keyed-developer-id` and stops before signing if it doesn't match. This catches a `.pkg` signed with the wrong key before you upload it.

### Why it runs locally, not in CI

One maintainer ships releases. Signing in CI would save a sideload and a portal step, but downloading and decrypting a CI artifact costs about as much. If JellyRock gets several maintainers who ship, revisit this.
