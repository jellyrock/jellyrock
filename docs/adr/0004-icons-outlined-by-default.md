# ADR 0004: Icons default to outlined (fill 0), with documented fill-1 exceptions

**Status:** Accepted
**Date:** 2026-05-09
**Supersedes:** ADR 0003 — `icons-material-rounded-house-style` (fill axis only)

**related-files**: resources/icons/README.md, scripts/generate/icons-add.js

PR #560 defaulted `icons:add` to `fill=1`. Visual audit during placeholder integration confirmed that `fill=0` (outlined) reads more clearly at 10-foot TV distance — the silhouette is recognizable regardless of fill state — and matches the Material 3 / Apple HIG / IBM Carbon defaults for medium-size action icons. The URL pattern for the fill=0 variant was also wrong in the script (`fill=0` uses `<name>_wght500_<size>.svg`, not the nonexistent `<name>_wght500fill0_<size>.svg`), so some of the "fill=0" icons committed in PR #560 were actually the Material CDN default (coincidentally fill=0 for the specific symbols chosen).

The convention was revised to `fill=0` as the default with 7 documented exception categories: pure-shape primitives, small-canvas size (under 32 pixels), subject/identity content (avatars + content-type representations like `album` / `missingArtist` / `musicFolder` / `musicNote`), placeholder context, rating glyphs, playback-action buttons composing `play`, and toggle on-states. See the decision tree in `resources/icons/README.md#fill-convention`. The `icons:add` script gained a `--filled` flag to opt into fill=1 for the exception cases.
