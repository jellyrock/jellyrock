# ADR 0005: Placeholder cards as runtime themed SceneGraph composition

**Status:** Accepted
**Date:** 2026-05-09

**related-files**: `components/ui/placeholder/JRPlaceholder.xml`, `components/ui/placeholder/JRPlaceholder.bs`, `source/utils/placeholderImage.bs`, `resources/placeholders/placeholders.json`, `components/ui/rowitem/JRRowItem.xml`

Placeholder images needed visual weight ("glyph on a styled card") at poster-tile size. Baking the card background into the PNG at build time was rejected because JellyRock supports 8 built-in themes plus user-customizable brand colors — per-theme PNG variants would multiply asset count by theme × placeholder × resolution, and a hardcoded background defeats custom-color theming entirely. The build pipeline cannot know the runtime theme.

Instead: the card is a runtime SceneGraph composition. `JRPlaceholder` wraps a `RectangleBackgroundSecondary` (themed to `colorBackgroundSecondary`) behind a `Poster` glyph (white-fill PNG tinted via `blendColor=colorBackgroundPrimary`). This generalizes the inline backdrop + `blendColor` pattern `JRRowItem` already used, extracted as a reusable component. Placeholder PNGs remain transparent-canvas white-fill — identical contract to the icon set — so the same `icons-build.js` pipeline produces both icon and placeholder assets with no new rendering mode.
