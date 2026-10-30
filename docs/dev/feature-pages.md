---
topic: feature-pages
related-files:
  - docs/user/features
  - docs/user/jellyfin-server-plugins.md
  - docs/screenshots/screenshots.json
  - scripts/lint/docs-check.cjs
last-reviewed: 2026-10-29
---

# Document a feature

Every feature a user can see has one page in [`docs/user/features/`](../user/features/). Users read it on docs.jellyrock.app. Its frontmatter holds the facts about the feature (what it does in one sentence, what it needs, when it shipped), so other pages can reuse them instead of restating them.

## When a pull request needs a page

- A `feat` pull request that adds a feature users can see adds its page in the same pull request.
- A pull request that changes what a feature does, what it needs or how to use it updates the page.
- A refactor, a test or a tooling change needs no page.

## Write the page

1. Create `docs/user/features/<feature>.md`, named for what the user does: `manage-subtitles.md`, not `subtitle-panel.md`.
2. Start it with the frontmatter below, then a sentence-case `#` title.
3. Write these parts, and leave out one that has nothing to say:
   - An opening paragraph: what the feature does for the viewer.
   - `## What you need`: the server version, any plugin, account permissions and Roku models it depends on.
   - How to use it, under a heading in the user's words.
   - `## Settings`: the settings that change it, each linked to its entry in [App settings](../user/app-settings.md).
   - `## Troubleshooting`: what goes wrong and how to tell why.
4. Link the other user pages one folder up, for example `../app-settings.md#playback-media-segments`. The docs site rewrites the links, so they work on GitHub and on the site.
5. Run `npm run lint:docs`.

[Media segments](../user/features/media-segments.md) is a short page in this shape.

## The frontmatter

```yaml
---
pitch: Skip the intros, outros, recaps, previews and commercials your server has marked, or get a button to skip them.
since: 2.9.0
server: 10.10.0
plugins: Chapter Segments Provider, Intro Skipper
---
```

| Field | Required | What it holds |
| --- | --- | --- |
| `pitch` | yes | One sentence, at most 120 characters, saying what the viewer gets. Plain words, no claim the code doesn't back. |
| `since` | yes | The JellyRock release the feature first shipped in, or `unreleased` until it ships. Change `unreleased` to the version when the release goes out. |
| `server` | yes | The oldest Jellyfin server the feature works with. A feature that works on every supported server takes the floor, `10.7.0`. |
| `plugins` | no | The server plugins it needs one of, separated by commas, each named as in the table in [Jellyfin server plugins](../user/jellyfin-server-plugins.md). Add a new plugin's row there first. |
| `screenshots` | no | Keys from [`screenshots.json`](../screenshots/screenshots.json)'s `screens`, separated by commas. |
| `highlight` | no | A rank from 1 to 6: the README lists the ranked features in that order, then links the features index. Leave it out otherwise. Rank the features that best say what JellyRock does, the strongest first; no two pages share a rank. |

Write one `key: value` per line, with no quotes and no nesting. `npm run lint:docs` fails when a page has no frontmatter, misses a required field, has a field not in this table, or holds a value that doesn't match the app: a `since` newer than the app's version, a `server` older than the floor in [`jellyfin-version-boundaries.yml`](jellyfin-version-boundaries.yml), a plugin or screenshot key that isn't listed, or a `highlight` that is not a rank from 1 to 6 or repeats another page's.

## Move or rename a page

A page's file name is its address on docs.jellyrock.app. When you move or rename one, add its old and new paths to `MOVED_PAGES` in the docs site repo ([`jellyrock/docs`](https://github.com/jellyrock/docs), `user-docs/astro.config.mjs`), so links to the old address keep working.
