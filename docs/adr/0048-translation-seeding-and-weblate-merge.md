# ADR 0048: Missing translations are seeded from other Jellyfin clients, and release prep merges Weblate instead of overwriting

**Status:** Accepted
**Date:** 2026-10-04

**related-files**: `scripts/translations-seed.js`, `scripts/translations-merge.js`, `scripts/weblate-sync.js`, `scripts/lib/locale-files.cjs`, `scripts/lib/translation-formats.cjs`, `locale/seed/sources.yml`, `locale/seed/keymap.yml`, `locale/seed/seeded.json`, `.github/workflows/release-management.yml`, `docs/architecture/translations.md`

A new key used to start untranslated in all 97 non-English locales, even when another Jellyfin client's community had already translated the same string. `npm run translations:seed` now fills those gaps (#931). It takes translations only through a **reviewed key map** (`locale/seed/keymap.yml`), never by matching English text. The same English can mean different things across projects: web's "Idle" is a process priority, and French uses different words for audio channels and Live TV channels. A source's own translation can also be wrong for its key. Each entry records the English both sides had when it was reviewed, so it stops seeding when either changes. Sources are config (`locale/seed/sources.yml`), pinned to a commit SHA, from an allowlist of `GPL-2.0-only`, `GPL-2.0-or-later` and `MPL-2.0`. JellyRock is `GPL-2.0-only`, and `MPL-2.0` §1.12 names `GPL-2.0` a Secondary License, so a file marked "Incompatible With Secondary Licenses" is refused and `GPL-3.0` projects can never be added. The seeder only fills, and never fills the same cell twice: every fill is recorded with its source and commit in `locale/seed/seeded.json`, so a removed translation stays removed and every seeded value can be traced. The first run added 2658 values from 5 of the 7 configured sources (jellyfin-web, jellyfin-androidtv, streamyfin, the server and jellyfin-roku).

Seeding on `main` alone would not have lasted. Release prep ran `git checkout origin/weblate -- locale/custom/`, and nothing sent main's non-English files to the `weblate` branch, so every translation added on `main` was reverted at the next release. Release prep now locks and flushes Weblate, then merges key by key against the last state both sides agreed on (the previous shipped release's push-back to `weblate`): whichever side changed a key wins, deletions included, and Weblate wins when both did. Orphans are dropped. It then seeds what is still missing and pushes the result back to `weblate` under the same lock, which is why the Weblate token is required. Translators stay the authority on wording, and a change made on either side is no longer silently undone.

**Ruled out:**

- **jellyfin-web only.** A string missing there can exist in another client.
- **One-off seeding per issue (#531's shape).** It rebuilds the key map and locale-code logic every time.
- **Loading strings straight into Weblate.** It needs admin steps that can't be checked from the repo.
- **Keeping the overwrite.** It silently reverts every main-side translation each release.
- **A two-way merge.** It keeps additions but cannot tell a deletion from an addition, so a removed translation always came back and a fix on `main` lost to the older value in Weblate.
- **Using `main`'s release commit as the merge ancestor.** It also holds main's changes made after the release branch was cut, so a key added on `main` in that window would read as deleted in Weblate.
- **Re-casing translations to JellyRock's English casing.** Title Case is an English convention.

**Revisit if:** a source changes its license (the seeder refuses it at fetch), or translators report redoing work that a mid-cycle sync would have spared them (tech-debt `weblate-branch-stale-sync`).
