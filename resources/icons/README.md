# `resources/icons/`: SVG sources for in-app icons

The SVGs in this directory are the source of truth for JellyRock's in-app icons. [`scripts/generate/icons-build.js`](../../scripts/generate/icons-build.js) generates two PNGs per icon from them, `images/icons/<name>_fhd.png` and `<name>_hd.png`. The PNGs are committed, but nobody edits them by hand. When the icon sources change, the pre-push hook runs `npm run icons:check`, and CI runs the same comparison through `icons-build.test.js` in the Vitest suite.

The manifest's [`uri_resolution_autosub`](../../manifest) line pairs with the pipeline: the Roku OS rewrites a Poster URI such as `pkg:/images/icons/play_$$RES$$.png` at load time to the asset for the device.

> **Current state: in use on FHD and HD devices.** `$$RES$$` follows the *device's* UI resolution, not the manifest's `ui_resolutions=fhd` design space. A device with a 720p UI loads the `_hd` renders, decoded at the physical output size, so HD devices get native-resolution bitmaps today (verified on hardware with `r2d2_bitmaps` on 2026-08-07; see the closing comment on issue #419). No `_sd` images exist. Roku's manifest reference describes no fallback for a missing one, and shipping them needs NTSC pixel-aspect-ratio handling, tracked as [`sd-resolution-native-support`](../../docs/architecture/tech-debt.md#sd-resolution-native-support). The full pipeline is in [`docs/architecture/build-and-tooling.md`](../../docs/architecture/build-and-tooling.md).

## House style (locked)

JellyRock uses the [Material Symbols](https://fonts.google.com/icons) family at these fixed settings:

- **Variant:** Rounded, the best fit for a 10-foot UI. It antialiases cleanly when scaled down for 720p and matches the soft Jellyfin and JellyRock brand.
- **Weight:** 500, heavier than Material's default of 400, for legibility at TV viewing distance.
- **Fill:** 0 (outlined) by default. The exceptions are under [Fill convention](#fill-convention).
- **Optical size:** `24px`.

`npm run icons:add` enforces these, so a contributor never picks a variant per icon and the set cannot drift. If a future icon needs a different style (for example, a custom brand mark), commit a hand-made SVG and record the reason under [Density notes](#density-notes).

### Fill convention

**Default: outlined (`fill=0`).** An outlined glyph reads more clearly at TV viewing distance, because its silhouette is recognizable without color. Material 3, Apple's HIG and IBM Carbon all default to outlined for medium-size action icons.

Pass `--filled` to `npm run icons:add` (or store an `_filled.svg` variant) only when one of these seven rules applies:

| # | Rule | Trigger | Examples |
|---|---|---|---|
| 1 | Pure-shape primitive | No meaningful outlined alternative | `play`, `pause`, `circle`, `record`, `spinner`, `check`, `arrow-*` |
| 2 | Small canvas | Canvas narrower than `32px` | `mic_icon` (a 16×22 canvas): outlined strokes lose visibility at small sizes (Material 3 small-target guidance, Apple HIG at or under `28pt`) |
| 3 | Subject or identity content | Shows a person, a user or a content type (an album, a music note) | `person`, `person_36px` (avatars), `album`, `musicNote`. A filled glyph reads more clearly than an outlined one when the icon is the subject, such as the album disc on the audio player's now-playing screen, not an action. |
| 4 | Placeholder content | Lives in `images/placeholders/` | The placeholders (`movie`, `album`, `folder` and others), as in the file pickers of Apple Finder, Google Drive and Material 3. One exception: the `livetv` placeholder reuses the outlined `liveTV.svg`. |
| 5 | Rating glyph | Inline rating display | `star`: filled is the industry standard for ratings |
| 6 | Playback action button | Composes the filled `play` | `resume` (an arc plus the play triangle), to match the standalone `play` |
| 7 | Toggle on-state | Paired with an outlined off-state | `heart` (the on-state of the `ItemDetails` Favorite button), `favorite_selected` (the on-state in the `ItemGridOptions` favorite menu: outlined geometry, marked by a hard-coded red) |

**Choosing the fill for a new icon:**

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

**Shared glyphs.** When one Material symbol is needed both as an outlined icon and as a filled placeholder, commit two files: `<name>.svg` (outlined, for the icon) and `<name>_filled.svg` (filled, for the placeholder). The placeholder config, `resources/placeholders/placeholders.json`, points at the `_filled.svg` file. Subject glyphs (Rule 3: `album`, `musicNote`, `person`) are filled in both places, so one file serves both and `placeholders.json` names the same file the icon set uses. A glyph used only as a placeholder (Rule 4: for example `movie`, `folder`, `playlist`, `artist`, `musicFolder`, `book`, `studio`) exists only as `<name>_filled.svg`.

The build script skips files ending in `_filled.svg` in its icon loop: they exist only as placeholder sources, and rendering them as `images/icons/<name>_filled_*.png` would produce unused PNGs. The placeholder loop still renders them when `placeholders.json` names them.

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

1. **Pick the Material symbol.** Browse [icons.google.com](https://fonts.google.com/icons) for a name, such as `play_arrow` or `menu_book`. You need only the *name*: don't download anything.
2. **Run the add script.** Two forms:

   ```bash
   # Same JellyRock filename as Material name:
   npm run icons:add -- favorite

   # Rename to preserve an existing JellyRock callsite name:
   npm run icons:add -- play_arrow --as play
   ```

   The script fetches the SVG from `google/material-design-icons` and sets `fill="#FFFFFF"` on it, because `blendColor` tinting needs a white source (see [Why white fill](#why-white-fill)). It saves the file to `resources/icons/<name>.svg` and adds a row to the [Provenance table](#provenance).
3. **(Optional) Pin a glyph size in `icons.json`.** Skip this if the default density (a `54px` glyph in a `96px` canvas) looks right. Override it only to match an existing JellyRock icon during a migration, or when the default looks wrong. See [Glyph density](#glyph-density).
4. **Generate the PNGs.** Run `npm run icons:build`. Two files appear: `images/icons/<name>_fhd.png` (FHD, a `96px` canvas by default) and `<name>_hd.png` (two-thirds of the FHD size).
5. **Update the call site.** Change the Poster URI from `pkg:/images/icons/<name>.png` to `pkg:/images/icons/<name>_$$RES$$.png`. The Roku OS rewrites `$$RES$$` for each device at load time.
6. **Delete any old single-resolution PNG**, once this search finds no reference to it:

   ```bash
   grep -rn "pkg:/images/icons/<name>\.png" --include="*.bs" --include="*.brs" --include="*.xml"
   ```

## Glyph density

Each icon's PNG has two sizes:

- **Canvas size** (`sizeFhd` in `icons.json`): the full width and height of the PNG in pixels. It matches the `width` and `height` of the Poster in the component XML. The default is `96px`.
- **Glyph size** (`glyphSize` in `icons.json`): how big the visible glyph is *inside* the canvas. The rest is transparent padding, centered around the glyph. The default is `54px`, which matches the dense cluster of existing JellyRock glyphs such as `info`, `error`, `liveTV` and `tv`.

The build script picks each value in this order (an override, then a measurement of an existing PNG, then the default):

| Field | 1st | 2nd | 3rd | Default |
|---|---|---|---|---|
| `sizeFhd` | `icons.json` | width of existing `<name>_fhd.png` | width of legacy `<name>.png` | `96` |
| `glyphSize` | `icons.json` | max-dim of trimmed bbox in `<name>_fhd.png` | max-dim of trimmed bbox in legacy `<name>.png` | `54` |

Measuring the existing PNG is what makes a *migration* a pure refactor. When a single-resolution PNG exists at build time, the new render keeps its glyph size to within a pixel. Material's natural aspect ratios can differ slightly from the original, but the visible footprint matches. Once the `_fhd.png` is committed, later rebuilds keep its size.

To change an icon's size on purpose, set `sizeFhd`, `glyphSize` or both in `icons.json` and run `npm run icons:build` again.

## Density notes

Notes for icons whose density differs from the default. Add one whenever an icon needs a `glyphSize` or `sizeFhd` override that isn't obvious.

- **`spinner`** (`sizeFhd: 125`, `glyphSize: 125`): the global loading spinner is 125×125 because [`components/JRScene.xml`](../../components/JRScene.xml) positions it for a bitmap of that size. `glyphSize: 125` makes the Material `progress_activity` arc fill the whole canvas with no padding, to match the outer circle of the original spinner. Don't shrink it without moving its placement in `JRScene`.
- **`play`, `pause`, `itemPrevious`, `itemNext`, `chapters`** (`glyphSize` between 38 and 60): each is pinned to the largest dimension of the trimmed, hand-made original PNG, so the move to Material changed the look and kept the same footprint on screen.
- **`mic_icon`** (`sizeFhd: 16`, `glyphSize: 22`): the voice-search indicator in [`components/ItemGrid/Alpha.xml`](../../components/ItemGrid/Alpha.xml) sits next to a keyboard letter in a Poster that is not square, 15 wide and 22 tall (`<Poster id="alphaMic" height="22" width="15" />`). A square canvas would make the Poster letterbox it: the square source shrinks to the Poster's smaller dimension (15×15) and wastes about 30% of the height. So the build produces a 16×22 PNG instead, through the clamp in its `extend()` step (`Math.max(0, canvas - dim)`). The resized glyph is 22 tall and 16 wide at the mic's natural aspect, taller than `sizeFhd: 16`, so no vertical padding is added and the glyph extends past the square canvas. The result has the same 16×22 footprint as the hand-made asset that came before the pipeline.
- **`favorite.svg` (`fill="#000000"`) and `favorite_selected.svg` (`fill="#FF0000"`)**: the toggle pair for the favorite state. Both use the outlined Material `favorite` glyph, and only the hand-set fill color (black or red) tells off from on. The pair predates the [Fill convention](#fill-convention) and the [Why white fill](#why-white-fill) rule, so `blendColor` cannot tint them: the hard-coded fill wins. If a screen ever needs themed favorite icons, replace them with white-fill sources and apply `blendColor` where they are used.

## Why white fill

Material Symbols ship with no `fill` attribute on their `<path>`, so they render **black**. JellyRock's `IconButton` and `Spinner` components tint icons at render time with `blendColor`, which multiplies each color channel: a black source (RGB `0,0,0`) stays black whatever the tint. The tint shows only on a **white** source (RGB `255,255,255`).

`npm run icons:add` handles this by setting `fill="#FFFFFF"` on every `<path>` in the SVG it fetches. If you draw a custom (non-Material) SVG by hand, set `fill="#FFFFFF"` on every path yourself.

If an icon is never tinted on purpose (for example, a multi-color brand mark), set its fill colors in the SVG.

## Non-Material SVGs (custom and sourced)

A few icons in `resources/icons/` aren't Material Symbols. The build treats them the same way; only the source differs.

- **`tomato-fresh.svg` and `tomato-rotten.svg`**, from Wikimedia Commons ([fresh](https://commons.wikimedia.org/wiki/File:Rotten_Tomatoes.svg), [rotten](https://commons.wikimedia.org/wiki/File:Rotten_Tomatoes_rotten.svg)). Both are PD-textlogo, which is public domain: "consists only of simple geometric shapes or text". `components/ui/label/metadata/CriticRating.bs` uses them to show Rotten Tomatoes scores. The trademark belongs to Fandango Media. JellyRock uses the icons only to attribute the scores they stand for, as media clients commonly do, never as its own branding.

To add a non-Material SVG, put it in `resources/icons/`, add a row to the [Provenance](#provenance) table and set its fill colors in the SVG (the white fill from `npm run icons:add` applies only to fetched Material Symbols). `npm run icons:build` then renders its PNGs through the same pipeline.

## License & attribution

Material Symbols are licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). JellyRock ships under `GPL-2.0`; the Apache 2.0 license is compatible under the "combined work" interpretation. Attribution is kept here as Apache 2.0 §4(c) requires.

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
| `artist_filled.svg` | `account_box` | Rounded | 500 | 1 | `24px` | 2026-05-10 |
| `musicFolder_filled.svg` | `library_music` | Rounded | 500 | 1 | `24px` | 2026-05-10 |
| `playlist_filled.svg` | `playlist_play` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `circle.svg` | `circle` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `tomato-fresh.svg` | non-Material, from [Wikimedia](https://commons.wikimedia.org/wiki/File:Rotten_Tomatoes.svg) (PD-textlogo) | n/a | n/a | (red) | 139×141 | 2026-05-09 |
| `tomato-rotten.svg` | non-Material, from [Wikimedia](https://commons.wikimedia.org/wiki/File:Rotten_Tomatoes_rotten.svg) (PD-textlogo) | n/a | n/a | (green) | 145×140 | 2026-05-09 |
| `movie_filled.svg` | `movie` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `playCircle_filled.svg` | `play_circle` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `photo_filled.svg` | `photo` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `photoAlbum_filled.svg` | `photo_album` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `folder_filled.svg` | `folder` | Rounded | 500 | 1 | `24px` | 2026-05-09 |
| `book_filled.svg` | `menu_book` | Rounded | 500 | 1 | `24px` | 2026-05-15 |
| `studio_filled.svg` | `domain` | Rounded | 500 | 1 | `24px` | 2026-05-15 |
| `more_horiz.svg` | `more_horiz` | Rounded | 500 | 1 | `24px` | 2026-09-04 |
| `versions.svg` | `content_copy` | Rounded | 500 | 0 | `24px` | 2026-09-20 |
