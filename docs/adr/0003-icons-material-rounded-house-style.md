# ADR 0003: Icon house style — Material Symbols Rounded, weight 500, `24px`

**Status:** Accepted
**Date:** 2026-05-09
**Partially superseded by:** ADR 0004 (fill axis only)

**related-files**: resources/icons/README.md, scripts/generate/icons-build.js, scripts/generate/icons-add.js, manifest

JellyRock standardizes all in-app icons on Material Symbols — Rounded variant, weight 500, `24px` optical size. These coordinates are locked in `npm run icons:add` (the fetch URL encodes all of them), so contributors can't drift per-icon. Rounded was chosen over Outlined and Sharp because it antialiases cleanest under 720p OS framebuffer downsample (the core concern of issue #419), matches the soft rounded aesthetic of the Jellyfin brand, and is the industry convention for media-streaming TV apps (YouTube TV, Google TV, Plex). Weight 500 gives better stroke contrast than Material's default 400 at 10-foot viewing distance. `24px` optical size pairs with the build-script's trim-and-pad pipeline so the rendered glyph fills the canvas at JellyRock's per-icon density instead of Material's ~25% built-in design-grid padding. Fill 0 (outlined) is now the default per `icons-outlined-by-default`; fill 1 is the documented exception for 7 specific categories (see `resources/icons/README.md#fill-convention`).

Non-Material exceptions are committed directly to `resources/icons/` and documented in the provenance table in `resources/icons/README.md`. Two current exceptions: `tomato-fresh.svg` and `tomato-rotten.svg` (Rotten Tomatoes tomatometer icons, PD-textlogo from Wikimedia Commons, used nominatively to attribute critic scores). Constraints worth re-evaluating: if Roku adds a `4K` UI resolution, if Material introduces a TV-specific variant axis, or if Jellyfin's brand direction changes.
