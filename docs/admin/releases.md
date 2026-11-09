# Releases

A release takes four actions from you: push a release branch, merge the PR it opens, add the summary, and publish the draft release. Workflows do the rest. Store submission needs a signed `.pkg`, which you build on your own machine.

## Overview

```bash
# 1. Create and push the release branch
git checkout -b release-1.21.3
git push origin release-1.21.3

# 2. CI checks the version, merges translations, bumps the version files,
#    opens the PR "Prepare for v1.21.3 release" and creates a draft release with a ZIP
#    and its notes

# 3. Review and merge the PR
#    CI rebuilds the draft release's ZIP and notes from main

# 4. Type /release-summary 1.21.3 in Claude Code to add the summary, then review the
#    draft and publish it

# 5. Publishing creates the tag; CI turns [Unreleased] into the release's changelog section,
#    copies the summary into it, stamps the version on feature pages that said
#    `since: unreleased`, and links an Announcements discussion
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
5. Builds the production app and creates a draft GitHub release with the ZIP, in the Announcements discussion category. An existing draft for the same tag is deleted first, and its summary is kept. `node scripts/changelog-syncer.js release-notes <version>` builds the notes:
   - a Release Schedule with the next Roku Channel Store release day (the next weekday, Monday after a Friday or weekend), worked out when the notes are built
   - the summary, when the draft has one
   - the version's changelog lines, each crediting its author with an `@mention`, and New Contributors
   - a **Full Changelog** link
   - the support block, read from `snippets/support.md` in `jellyrock/.github`. The build fails when that file is missing or does not start with its heading.

### 2. Merge the release PR

Merging a PR labeled `release-prep` into `main` starts `update-draft-release.yml`. It reads the version from the PR title, builds the production app from `main`, replaces the draft release's ZIP, and builds its notes again the same way, keeping the summary.

### 3. Add the summary

Type `/release-summary X.Y.Z` in Claude Code. It drafts a short paragraph on what users would notice, checks it, and shows it to you. On your `ok` it writes it under the Release Schedule in the draft, as a `### Summary` block. Run it again to replace it. See [the skill](../../.claude/skills/release-summary/SKILL.md) for what it reads and the shape it holds to.

### 4. Publish the release

Review the draft: check the release date and read the notes. Then publish it.

Publishing creates the `vX.Y.Z` tag on `main`, which starts `release-build.yml`. It turns `[Unreleased]` in `CHANGELOG.md` into the release's section, copies the draft's summary to the top of that section (a release without one gets a warning and no summary), changes `since: unreleased` to the version on each feature page that said so in the tagged commit, writes the feature catalog, the features index and the README list again, and commits all of it to `main`. The catalog dates each feature from its release's heading in `CHANGELOG.md`, so the changelog step runs first, and the catalog step fails if the heading is missing. A feature page merged after the tag stays `unreleased` for the next release. How changelog entries are built, and how to fix one, is in [Changelog](changelog.md).

Publishing also starts `release-announcement.yml`, which links an Announcements discussion to the release when it has none. Run it by hand with a tag to link one to an older release.

## Files the release changes

| File | Changed by | What changes |
| --- | --- | --- |
| `package.json`, `package-lock.json` | The release workflow | `version` |
| `manifest` | The release workflow | `major_version`, `minor_version`, `build_version` |
| `CHANGELOG.md` | CI | `[Unreleased]` becomes the release's section at publish, with the summary at its top |
| `docs/user/features/*.md`, `docs/feature-catalog.json`, `docs/user/features/index.md`, `README.md` | CI | `since: unreleased` becomes the version at publish, on pages that were unreleased in the tagged commit |
| `Makefile` | Nobody | Its `VERSION` stays at 1.0.0 unless you change it by hand |
| The draft release's notes | You, through `/release-summary` | The summary |

## Fixing a release in progress

- **Wrong code or version files:** push fixes to the release branch before you merge its PR.
- **Wrong release notes, before the release PR merges:** fix the cause (a PR title, see [Changelog](changelog.md)) and sync `main`. Merging the release PR rebuilds the notes from `main`, so a hand edit to the draft before then is lost; only the summary is kept.
- **Wrong release notes, after the merge:** edit the draft release by hand before you publish it.
- **Start over:** delete the draft release. Pushing to the release branch again creates a new one.

## Signed `.pkg` for Roku Channel Store

The Channel Store takes a signed `.pkg`, not the sideload ZIP. Roku has no upload API, so you always upload by hand, but `npm run package:signed` builds the `.pkg` for you.

The store's descriptions change only with a submission. Paste them from [the store listing](store-listing.md) when you submit, after any change to them has merged.

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
- **One job per Roku.** The script takes the device lock before it contacts the Roku, and stops if a test run or an `F5` session holds it, naming the holder ([the device lock](../dev/rta-tests.md#the-device-lock)).
- **Right key.** When `ROKU_DEV_ID` is set, the script reads the Roku's `keyed-developer-id` and stops before signing if it doesn't match. This catches a `.pkg` signed with the wrong key before you upload it.

### Why it runs locally, not in CI

One maintainer ships releases. Signing in CI would save a sideload and a portal step, but downloading and decrypting a CI artifact costs about as much. If JellyRock gets several maintainers who ship, revisit this.
