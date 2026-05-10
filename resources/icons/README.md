# `resources/icons/` — SVG sources for in-app icons

SVGs in this directory are the committed source-of-truth for JellyRock's in-app
icon assets. Per-resolution PNGs (`images/icons/<name>_fhd.png` +
`<name>_hd.png`) are **generated** from these SVGs by
[`scripts/generate/icons-build.js`](../../scripts/generate/icons-build.js); they
are committed but are not hand-authored. Drift is enforced by the pre-push hook
and CI (`npm run icons:check`).

The pipeline pairs with the manifest's [`uri_resolution_autosub`](../../manifest)
declaration so a Poster URI like `pkg:/images/icons/play_$$RES$$.png` is
rewritten by the Roku OS at load time to the correct per-device asset.

> **Current state — foundation only.** The asset pipeline is fully wired but
> the manifest still declares `ui_resolutions=fhd`, so the OS holds rendering
> at FHD design space and the per-resolution HD assets don't yet deliver a
> measurable quality win. Realizing the full benefit requires a layout
> refactor (every hardcoded `1920` / `1080` becomes a runtime read from
> `m.global.device.uiResolution`) so we can safely declare
> `ui_resolutions=hd,fhd`. Tracked as
> [`hd-native-layout-refactor`](../../docs/architecture/tech-debt.md#hd-native-layout-refactor).
> Until then, this directory and the build script are durable foundation
> work — the assets will start delivering value immediately when that
> refactor lands. See
> [`docs/architecture/build-and-tooling.md`](../../docs/architecture/build-and-tooling.md)
> for the full pipeline shape.

## House style (locked)

JellyRock standardizes on the [Material Symbols](https://fonts.google.com/icons)
family at these locked coordinates:

- **Variant**: Rounded (best for 10-foot UI — antialiases cleanly under 720p
  downsample, matches the soft Jellyfin/JellyRock brand language)
- **Weight**: 500 (heavier than Material's 400 default — better legibility at
  TV viewing distance)
- **Fill**: 0 (outlined) by default — see [Fill convention](#fill-convention)
  for the exception cases
- **Optical size**: `24px`

The `npm run icons:add` script enforces these — contributors don't pick a
variant per icon, so the system never drifts. If a future icon genuinely needs
a different style (e.g., a bespoke brand mark), commit a hand-authored SVG
directly and document the reason in the [Density notes](#density-notes) section
below.

### Fill convention

**Default: outlined (`fill=0`).** Outlined glyphs read more clearly at TV
viewing distance because the silhouette is recognizable independent of color.
Modern Material 3 / Apple HIG / IBM Carbon all default to outlined for
medium-size action icons.

Pass `--filled` to `npm run icons:add` (or store an `_filled.svg` variant
file) ONLY when one of these seven pinned-filled rules applies:

| # | Rule | Trigger | Examples |
|---|---|---|---|
| 1 | Pure-shape primitive | No meaningful outlined alternative | `play`, `pause`, `circle`, `record`, `spinner`, `check`, `arrow-*` |
| 2 | Small-canvas size | Canvas width less than `32px` | `mic_icon` (24×24) — outlined strokes lose visibility at small sizes (Material 3 small-target guidance, Apple HIG ≤ `28pt`) |
| 3 | Subject / identity content | Represents a person, user, or content-type subject (album, artist, music collection) | `person`, `person_36px` (avatars), `album`, `missingArtist`, `musicFolder`, `musicNote` (content-type representations) — filled glyphs read more clearly than outlined when the icon IS the subject (e.g., the album disc on the audio player's now-playing screen) rather than an action affordance |
| 4 | Placeholder / representative content | Lives in `images/placeholders/` | All 10 placeholders (`movie`, `album`, `folder`, etc.) — Apple Finder / Google Drive / Material 3 file pickers all use filled placeholders |
| 5 | Rating glyph | Inline rating display | `star` — industry-standard filled for ratings |
| 6 | Playback action button | Composes filled `play` | `resume` (arc + play-triangle) — visual consistency with the `play` standalone |
| 7 | Toggle on-state | Paired with outlined off-state | `heart` (on-state in ItemDetails Favorite button), `favorite_selected` (on-state in ItemGridOptions favorite menu — geometry outlined, signaled by hard-coded red color) |

**Decision tree for adding a new icon:**

```text
Is it a `play` triangle / `pause` bars / `circle` / pure shape?    → --filled (Rule 1)
Is its rendered canvas below 32 pixels wide?                       → --filled (Rule 2)
Does it represent a person OR a content-type subject?              → --filled (Rule 3)
Does it live in images/placeholders/ (item-type representation)?   → --filled (Rule 4)
Is it a star used for ratings?                                     → --filled (Rule 5)
Does it visually compose `play` for a playback action?             → --filled (Rule 6)
Is it the on-state of a toggle paired with an outlined off-state?  → --filled (Rule 7)
Otherwise:                                                         → outlined (default)
```

**Shared glyphs:** when the same Material symbol is needed in BOTH an
outlined-icon context and a filled-placeholder context, commit two SVG
files: `<name>.svg` (outlined for icon use) + `<name>_filled.svg` (filled
for placeholder use). The placeholder config (`resources/placeholders/placeholders.json`)
points at the `_filled.svg` source. Subject-identity glyphs (Rule 3 —
`album`, `missingArtist`, `musicFolder`, `musicNote`, `person`) skip the
two-SVG dance because they're filled in BOTH contexts; one SVG file
suffices and `placeholders.json` references the same file the icon set
uses. Single-context placeholder-only glyphs (Rule 4 — e.g., `movie`,
`folder`, `playlist`) live as `<name>_filled.svg` only.

The build script ([`scripts/generate/icons-build.js`](../../scripts/generate/icons-build.js))
auto-skips files ending in `_filled.svg` from the icons-rendering loop —
these variants exist purely as placeholder sources, so rendering them as
`images/icons/<name>_filled_*.png` would produce unused orphan PNGs. They
are still rendered through the placeholders loop when referenced from
`placeholders.json`.

**Examples:**

```bash
# Default outlined chrome action icon
npm run icons:add -- search

# Sub-32px small icon (Rule 2)
npm run icons:add -- mic --as mic_icon --filled

# Avatar (Rule 3)
npm run icons:add -- person --filled

# Toggle on-state (Rule 7)
npm run icons:add -- favorite --as favorite_selected --filled

# Subject-identity (Rule 3): one filled SVG used by both icon and placeholder
npm run icons:add -- album --filled

# Placeholder-only glyph (Rule 4): filename signals placeholder-only intent
npm run icons:add -- movie --as movie_filled --filled
```

## Adding a new icon

1. **Pick the Material symbol.** Browse [icons.google.com](https://fonts.google.com/icons)
   to find a name (e.g., `play_arrow`, `menu_book`). You only need the *name* —
   don't download anything manually.
2. **Run the add script.** Two forms:

   ```bash
   # Same JellyRock filename as Material name:
   npm run icons:add -- favorite

   # Rename to preserve an existing JellyRock callsite name:
   npm run icons:add -- play_arrow --as play
   ```

   The script fetches the canonical SVG from `google/material-design-icons`,
   injects `fill="#FFFFFF"` so the source is white (required for `blendColor`
   tinting at render time — see [Why white fill](#why-white-fill)), saves to
   `resources/icons/<name>.svg`, and appends a row to the [Provenance table](#provenance).
3. **(Optional) Pin a glyph size in `icons.json`.** Skip this if the default
   density (`54px` glyph in a `96px` canvas) looks right. Override only when
   matching the size of an existing JellyRock icon during migration, or when
   visual judgment says the default is wrong. See [Glyph density](#glyph-density).
4. **Generate the PNGs.** Run `npm run icons:build`. Two new files appear:
   `images/icons/<name>_fhd.png` (FHD, default canvas `96px`) and
   `<name>_hd.png` (≈0.667× FHD).
5. **Update the call site.** Change the Poster URI from
   `pkg:/images/icons/<name>.png` to `pkg:/images/icons/<name>_$$RES$$.png`.
   The Roku OS rewrites `$$RES$$` per device at load time.
6. **Delete any superseded single-res PNG.** After grep-confirming zero
   remaining bare-`.png` references:

   ```bash
   grep -rn "pkg:/images/icons/<name>\.png" --include="*.bs" --include="*.brs" --include="*.xml"
   ```

## Glyph density

Each icon's PNG has two distinct sizes:

- **Canvas size** (`sizeFhd` in `icons.json`): the full PNG dimensions in
  pixels. Matches the `width`/`height` declared on the Poster in the component
  XML. Default ``96px``.
- **Glyph size** (`glyphSize` in `icons.json`): how big the visible glyph is
  *inside* that canvas. The remaining pixels are transparent padding centered
  around the glyph. Default `54px` (matches the dense cluster of existing
  JellyRock UI glyphs like `info`/`error`/`liveTV`/`tv`).

The build script picks each value in this order (override > measurement of
existing PNG > default):

| Field | 1st | 2nd | 3rd | Default |
|---|---|---|---|---|
| `sizeFhd` | `icons.json` | width of existing `<name>_fhd.png` | width of legacy `<name>.png` | `96` |
| `glyphSize` | `icons.json` | max-dim of trimmed bbox in `<name>_fhd.png` | max-dim of trimmed bbox in legacy `<name>.png` | `54` |

The auto-detection is what makes a *migration* a pure refactor: when an
existing single-res PNG is present at build time, the new render preserves its
established glyph size to within ±1 pixel (Material's natural aspect ratios may
differ slightly from the original, but the visible footprint matches). Once
the per-resolution `_fhd.png` is committed, future rebuilds preserve it.

To intentionally change an icon's size, set `sizeFhd` and/or `glyphSize` in
`icons.json` and re-run `npm run icons:build`.

## Density notes

Per-icon notes for non-default density choices. Add to this section whenever
an icon needs a `glyphSize` or `sizeFhd` override that isn't self-explanatory.

- **`spinner`** (`sizeFhd: 125`, `glyphSize: 125`): the global loading spinner
  is 125×125 because [`components/JRScene.xml`](../../components/JRScene.xml)
  positions it assuming that bitmap size. The `glyphSize: 125` makes the
  Material `progress_activity` arc fill the entire canvas (no padding) to
  match the original spinner's outer-circle visual. Don't shrink without
  re-positioning the JRScene placement.
- **`play`/`pause`/`itemPrevious`/`itemNext`/`chapters`** (`glyphSize` between
  38 and 60): each pinned to the max bbox dimension of the original trimmed
  hand-authored PNG, so the migration to Material is a pure visual swap with
  the same screen footprint.
- **`mic_icon`** (`sizeFhd: 24`, `glyphSize: 22`): voice-search inline indicator
  in [`components/ItemGrid/Alpha.xml`](../../components/ItemGrid/Alpha.xml),
  positioned next to a keyboard letter at width 15 × height 22 (`<Poster
  id="alphaMic" height="22" width="15" />`). The 24×24 canvas with a 22-pixel
  glyph preserves the natural mic aspect; the Poster scale-to-fits.
- **`favorite.svg` (`fill="#000000"`) and `favorite_selected.svg`
  (`fill="#FF0000"`)**: toggle pair for the favorite state. Both use the
  outlined Material `favorite` glyph; the visual distinction between off/on
  comes from hand-modified fill colors (black / red), not fill geometry. This
  predates the [Fill convention](#fill-convention) and the [Why white fill](#why-white-fill)
  rule — it means `blendColor` cannot tint these (the hard-coded fill
  dominates). If a future surface needs themed favorite icons, replace these
  with the standard white-fill convention and apply `blendColor` at usage time.

## Why white fill

Material Symbols ship with no `fill` attribute on their `<path>`, which
defaults to **black** when rendered. JellyRock's `IconButton` and `Spinner`
components apply `blendColor` at render time to tint the icon. `blendColor`
performs per-channel multiplication: a black source (RGB `0,0,0`) stays black
regardless of the tint color. For `blendColor` to actually colorize the icon,
the source must be **white** (RGB `255,255,255`).

The `npm run icons:add` script handles this automatically by injecting
`fill="#FFFFFF"` into every `<path>` in the fetched SVG. If you author a
custom (non-Material) SVG by hand, set `fill="#FFFFFF"` on every path
yourself.

If an icon is intentionally never tinted (e.g., a multi-color brand mark),
set the explicit fill colors in the SVG and the script will leave them alone.

## Non-Material SVGs (custom + sourced)

A small number of icons aren't Material Symbols and live in `resources/icons/`
alongside the Material ones. The build pipeline treats them identically — only
the source differs:

- **`tomato-fresh.svg` + `tomato-rotten.svg`** — sourced from Wikimedia Commons
  ([fresh](https://commons.wikimedia.org/wiki/File:Rotten_Tomatoes.svg),
  [rotten](https://commons.wikimedia.org/wiki/File:Rotten_Tomatoes_rotten.svg)).
  Both are PD-textlogo (public domain — "consists only of simple geometric
  shapes or text"). Used by `components/ui/label/metadata/CriticRating.bs` to
  render Rotten Tomatoes scores. The trademark belongs to Fandango Media — we
  use these icons nominatively to attribute the scores they represent (standard
  practice for media clients), not as JellyRock branding.

When adding a new non-Material SVG: drop it directly into `resources/icons/`,
add a row to the [Provenance](#provenance) table, set explicit fill colors in
the SVG (the `npm run icons:add` white-fill injection only applies to fetched
Material Symbols), and `npm run icons:build` will render the per-resolution
PNGs through the same pipeline.

## License & attribution

Material Symbols are licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
JellyRock ships under `GPL-2.0`; the Apache 2.0 license is compatible under the
"combined work" interpretation. Attribution is preserved here per Apache 2.0
§4(c).

> Material Symbols by Google. Used under the Apache License, Version 2.0.
> Source: <https://github.com/google/material-design-icons>

## Provenance

Each icon's source is listed below. The `npm run icons:add` script appends to
this table automatically.

| File | Material Symbols name | Style | Weight | Fill | Size | Downloaded |
|---|---|---|---|---|---|---|
| `play.svg` | `play_arrow` | Rounded | 500 | 1 | `24px` | 2026-05-08 |
| `pause.svg` | `pause` | Rounded | 500 | 1 | `24px` | 2026-05-08 |
| `itemPrevious.svg` | `skip_previous` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `itemNext.svg` | `skip_next` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `chapters.svg` | `menu_book` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `spinner.svg` | `progress_activity` | Rounded | 500 | 1 | `24px` | 2026-05-08 |
| `playOutline.svg` | `play_arrow` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `error.svg` | `error` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `info.svg` | `info` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `warning.svg` | `warning` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `refresh.svg` | `refresh` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `search.svg` | `search` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `settings.svg` | `settings` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `shuffle.svg` | `shuffle` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `tv.svg` | `tv_gen` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `delete.svg` | `delete_forever` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `expand.svg` | `unfold_more` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `closedCaptions.svg` | `closed_caption` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `liveTV.svg` | `live_tv` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `musicNote.svg` | `music_note` | Rounded | 500 | 1 | `24px` | 2026-05-10 |
| `repeat.svg` | `repeat` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `repeat-1.svg` | `repeat_one` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `instantMix.svg` | `instant_mix` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `fileInfo.svg` | `unknown_document` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `record.svg` | `fiber_manual_record` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `videoFile.svg` | `video_file` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `mic_icon.svg` | `mic` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `star.svg` | `star` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `person.svg` | `person` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `person_36px.svg` | `person` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `resume.svg` | `resume` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `check.svg` | `check` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `check-black.svg` | `check` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `check-white.svg` | `check` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `arrow-up-black.svg` | `arrow_upward` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `arrow-up-white.svg` | `arrow_upward` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `arrow-down-black.svg` | `arrow_downward` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `arrow-down-white.svg` | `arrow_downward` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `favorite.svg` | `favorite` | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `favorite_selected.svg` | `favorite` (hand-edited fill `#FF0000`) | Rounded | 500 | 0 | `24px` | 2026-05-09 |
| `heart.svg` | `favorite` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `album.svg` | `album` | Rounded | 500 | 1 | `24px` | 2026-05-10 |
| `missingArtist.svg` | `account_box` | Rounded | 500 | 1 | `24px` | 2026-05-10 |
| `musicFolder.svg` | `library_music` | Rounded | 500 | 1 | `24px` | 2026-05-10 |
| `playlist_filled.svg` | `playlist_play` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `circle.svg` | `circle` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `tomato-fresh.svg` | non-Material — [Wikimedia](https://commons.wikimedia.org/wiki/File:Rotten_Tomatoes.svg) (PD-textlogo) | n/a | n/a | (red) | 139×141 | 2026-05-09 |
| `tomato-rotten.svg` | non-Material — [Wikimedia](https://commons.wikimedia.org/wiki/File:Rotten_Tomatoes_rotten.svg) (PD-textlogo) | n/a | n/a | (green) | 145×140 | 2026-05-09 |
| `movie_filled.svg` | `movie` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `playCircle_filled.svg` | `play_circle` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `photo_filled.svg` | `photo` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `photoAlbum_filled.svg` | `photo_album` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `folder_filled.svg` | `folder` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
