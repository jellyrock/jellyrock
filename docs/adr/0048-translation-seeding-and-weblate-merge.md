# ADR 0048: Missing translations are seeded from other Jellyfin clients, and release prep merges Weblate instead of overwriting

**Status:** Accepted
**Date:** 2026-10-04

**related-files**: `scripts/translations-seed.js`, `scripts/translations-merge.js`, `scripts/weblate-sync.js`, `scripts/lib/locale-files.cjs`, `scripts/lib/translation-formats.cjs`, `locale/seed/sources.yml`, `locale/seed/keymap.yml`, `.github/workflows/release-management.yml`, `docs/architecture/translations.md`

A new key used to start untranslated in all 97 non-English locales, even when another Jellyfin client's community had already translated the same string. `npm run translations:seed` now fills those gaps (#931). It takes translations only through a **reviewed key map** (`locale/seed/keymap.yml`), never by matching English text. The same English can mean different things across projects: web's "Idle" is a process priority, and French uses different words for audio channels and Live TV channels. A source's own translation can also be wrong for its key. Each entry records the English both sides had when it was reviewed, so it stops seeding when either changes. Sources are config (`locale/seed/sources.yml`), pinned to a commit SHA, from an allowlist of `GPL-2.0-only`, `GPL-2.0-or-later` and `MPL-2.0`. JellyRock is `GPL-2.0-only`, and `MPL-2.0` §1.12 names `GPL-2.0` a Secondary License, so a file marked "Incompatible With Secondary Licenses" is refused and `GPL-3.0` projects can never be added. The seeder only fills; it never overwrites. The first run, from 7 sources, added 2658 values.

Seeding on `main` alone would not have lasted. Release prep ran `git checkout origin/weblate -- locale/custom/`, and nothing sent main's non-English files to the `weblate` branch, so every translation added on `main` was reverted at the next release. Release prep now flushes Weblate, then merges key by key: Weblate wins every conflict, keys only `main` has are kept, and orphans are dropped. It then seeds what is still missing and pushes the result back to `weblate`. Translators stay the authority on wording, and nothing they haven't seen is thrown away.

**Ruled out:**

- **jellyfin-web only.** A string missing there can exist in another client.
- **One-off seeding per issue (#531's shape).** It rebuilds the key map and locale-code logic every time.
- **Loading strings straight into Weblate.** It needs admin steps that can't be checked from the repo.
- **Keeping the overwrite.** It silently reverts every main-side translation each release.
- **Re-casing translations to JellyRock's English casing.** Title Case is an English convention.

**Revisit if:** a source changes its license (the seeder refuses it at fetch), or translators report redoing work that a mid-cycle sync would have spared them (tech-debt `weblate-branch-stale-sync`).
