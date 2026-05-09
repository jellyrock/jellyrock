// Auto-generates per-resolution PNG triples (FHD + HD) from SVG sources for
// JellyRock's in-app icons. Pairs with the manifest `uri_resolution_autosub`
// declaration so a Poster URI like `pkg:/images/icons/play_$$RES$$.png` is
// rewritten by Roku at load time to the correct per-device asset.
//
// Why this exists: at `ui_resolutions=hd,fhd`, the Roku OS auto-downsamples
// FHD-only assets to 720p / 480p, which is lossy on small bitmap glyphs
// (spinner, IconButton icons, OSD playback controls). Shipping native HD
// assets via Roku's blessed `uri_resolution_autosub` mechanism eliminates
// the OS downsample step on HD displays. See docs/architecture/build-and-tooling.md
// and issue #419.
//
// What it does:
//   - Walks `resources/icons/*.svg` (committed source-of-truth).
//   - For each SVG: renders it large, trims Material's design-grid padding,
//     resizes the bare glyph to the per-icon target glyph size (preserving
//     aspect ratio), then center-pads with transparent border to canvas size.
//   - Default output dir is `images/icons/`. Per-icon overrides
//     (canvas size, glyph size, output directory) live in
//     `resources/icons/icons.json`.
//
//   Two distinct sizes per icon:
//     - canvasSize (sizeFhd): the full PNG dimensions; matches the Poster's
//       `width`/`height` declared in component XML. Default 96px.
//     - glyphSize: how big the visible glyph is INSIDE that canvas. Default
//       54px (matches the dense JellyRock UI-glyph cluster like info / error /
//       liveTV / tv). The remaining canvas pixels are transparent padding.
//
//   Detection order for each (override > existing-PNG measurement > default):
//     canvasSize:
//       1. `sizeFhd` from icons.json
//       2. Width of an existing `<name>_fhd.png` in the output dir
//       3. Width of an existing pre-migration `<name>.png` in the output dir
//       4. Default 96
//     glyphSize:
//       1. `glyphSize` from icons.json
//       2. max(width, height) of the trimmed bbox of an existing
//          `<name>_fhd.png` (preserves established density across rebuilds)
//       3. max(width, height) of the trimmed bbox of a pre-migration `<name>.png`
//          (preserves established density during the migration window)
//       4. Default 54
//
// Run modes:
//   node scripts/generate/icons-build.js           → write (default)
//   node scripts/generate/icons-build.js --check   → fail on drift (CI)
//
// npm scripts:
//   icons:build        → regenerate (write mode)
//   icons:check        → drift check (used by pre-push hook + CI)
//
// Pre-push hook integration: when `resources/icons/*.svg` or
// `resources/icons/icons.json` or this script changes, the hook runs the
// regen step in auto-fix mode. Drift never lands.

import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const ROOT_DIR = positional[0] || '.';
const CHECK_MODE = args.includes('--check');

const SVG_DIR = join(ROOT_DIR, 'resources/icons');
const DEFAULT_OUTPUT_DIR = 'images/icons';
const ICONS_JSON_PATH = join(SVG_DIR, 'icons.json');

const HD_SCALE = 2 / 3;
const DEFAULT_CANVAS_SIZE = 96;
const DEFAULT_GLYPH_SIZE = 54;

// Render Material at high density so the trim bbox is fine-grained, then
// downsample. Higher = sharper glyph silhouette + slightly slower build.
const RENDER_DENSITY_PX = 256;

// Sharp render config — locked for deterministic byte-identical output across
// runs given a fixed sharp version. Drift detection in --check mode relies on
// this; CI must use the same sharp version (devDependency is exact-pinned).
const PNG_OPTIONS = {
  compressionLevel: 9,
  palette: false,
  effort: 10,
  progressive: false,
};
const TRIM_OPTIONS = {
  background: { r: 0, g: 0, b: 0, alpha: 0 },
  threshold: 1,
};
const TRANSPARENT_BACKGROUND = { r: 0, g: 0, b: 0, alpha: 0 };

// ────────────────────────────────────────────────────────────────────

function loadOverrides() {
  if (!existsSync(ICONS_JSON_PATH)) return {};
  return JSON.parse(readFileSync(ICONS_JSON_PATH, 'utf8'));
}

async function readPngWidth(pngPath) {
  // Graceful: corrupted / mid-write / placeholder PNGs return null so the
  // caller falls through to the next detection strategy.
  try {
    const meta = await sharp(pngPath).metadata();
    return meta.width || null;
  } catch {
    return null;
  }
}

async function readPngGlyphMaxDim(pngPath) {
  // Returns max(trimmed_width, trimmed_height) of the visible content. Used to
  // auto-detect glyphSize from an existing PNG so a rebuild preserves the
  // established density.
  try {
    const trimmed = await sharp(pngPath).trim(TRIM_OPTIONS).toBuffer({ resolveWithObject: true });
    return Math.max(trimmed.info.width, trimmed.info.height) || null;
  } catch {
    return null;
  }
}

async function detectCanvasSize(outputDir, name) {
  const fhdPath = join(outputDir, `${name}_fhd.png`);
  if (existsSync(fhdPath)) {
    const w = await readPngWidth(fhdPath);
    if (w) return w;
  }
  const legacyPath = join(outputDir, `${name}.png`);
  if (existsSync(legacyPath)) {
    const w = await readPngWidth(legacyPath);
    if (w) return w;
  }
  return null;
}

async function detectGlyphSize(outputDir, name) {
  const fhdPath = join(outputDir, `${name}_fhd.png`);
  if (existsSync(fhdPath)) {
    const g = await readPngGlyphMaxDim(fhdPath);
    if (g) return g;
  }
  const legacyPath = join(outputDir, `${name}.png`);
  if (existsSync(legacyPath)) {
    const g = await readPngGlyphMaxDim(legacyPath);
    if (g) return g;
  }
  return null;
}

async function renderPng(svgBuffer, canvasSize, glyphSize) {
  // Pipeline: render large → trim Material's design-grid padding → resize
  // bare glyph to fit inside [glyphSize, glyphSize] preserving aspect ratio
  // → center-pad with transparent border to reach canvasSize.
  //
  // The trim step is the load-bearing piece — it eliminates the ~25% padding
  // baked into Material Symbols' viewBox so each icon's visible glyph
  // dominates its target square at the per-icon density.
  const rendered = await sharp(svgBuffer, { density: RENDER_DENSITY_PX })
    .resize(RENDER_DENSITY_PX, RENDER_DENSITY_PX, { fit: 'inside' })
    .toBuffer();

  const trimmed = await sharp(rendered).trim(TRIM_OPTIONS).toBuffer();

  const fitted = await sharp(trimmed)
    .resize(glyphSize, glyphSize, {
      fit: 'inside',
      kernel: 'lanczos3',
    })
    .toBuffer();

  // Pad (don't resize) the fitted glyph to canvas size with a transparent
  // border centered. We use extend() rather than resize(...,fit:'contain')
  // because fit:'contain' would upscale the glyph to fill the longer canvas
  // dimension — defeating the per-icon glyphSize contract.
  const fittedMeta = await sharp(fitted).metadata();
  const widthPad = Math.max(0, canvasSize - fittedMeta.width);
  const heightPad = Math.max(0, canvasSize - fittedMeta.height);

  return sharp(fitted)
    .extend({
      top: Math.floor(heightPad / 2),
      bottom: Math.ceil(heightPad / 2),
      left: Math.floor(widthPad / 2),
      right: Math.ceil(widthPad / 2),
      background: TRANSPARENT_BACKGROUND,
    })
    .png(PNG_OPTIONS)
    .toBuffer();
}

async function buildOne(svgFile, overrides) {
  const name = basename(svgFile, '.svg');
  const override = overrides[name] || {};
  const outputDir = join(ROOT_DIR, override.outputDir ?? DEFAULT_OUTPUT_DIR);

  const canvasFhd =
    override.sizeFhd ?? (await detectCanvasSize(outputDir, name)) ?? DEFAULT_CANVAS_SIZE;
  const canvasHd = Math.round(canvasFhd * HD_SCALE);

  const glyphFhd =
    override.glyphSize ?? (await detectGlyphSize(outputDir, name)) ?? DEFAULT_GLYPH_SIZE;
  const glyphHd = Math.round(glyphFhd * HD_SCALE);

  const svgBuffer = readFileSync(join(SVG_DIR, svgFile));
  const [fhdBuffer, hdBuffer] = await Promise.all([
    renderPng(svgBuffer, canvasFhd, glyphFhd),
    renderPng(svgBuffer, canvasHd, glyphHd),
  ]);

  return [
    {
      path: join(outputDir, `${name}_fhd.png`),
      buffer: fhdBuffer,
      canvas: canvasFhd,
      glyph: glyphFhd,
    },
    {
      path: join(outputDir, `${name}_hd.png`),
      buffer: hdBuffer,
      canvas: canvasHd,
      glyph: glyphHd,
    },
  ];
}

// ────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(SVG_DIR)) {
    console.log(`icons:build: ${SVG_DIR} not found; nothing to do.`);
    process.exit(0);
  }

  const svgFiles = readdirSync(SVG_DIR)
    .filter((f) => f.endsWith('.svg'))
    .sort();

  if (svgFiles.length === 0) {
    console.log(`icons:build: no SVG sources in ${SVG_DIR}.`);
    process.exit(0);
  }

  const overrides = loadOverrides();

  const driftPaths = [];
  let writtenCount = 0;
  let unchangedCount = 0;

  for (const svgFile of svgFiles) {
    let outputs;
    try {
      outputs = await buildOne(svgFile, overrides);
    } catch (err) {
      console.error(`icons:build: failed to render ${svgFile} — ${err.message}`);
      process.exit(1);
    }
    for (const { path: outPath, buffer, canvas, glyph } of outputs) {
      const exists = existsSync(outPath);
      if (exists) {
        const existing = readFileSync(outPath);
        if (existing.equals(buffer)) {
          unchangedCount++;
          continue;
        }
      }
      if (CHECK_MODE) {
        driftPaths.push({
          path: outPath,
          canvas,
          glyph,
          reason: exists ? 'content drift' : 'missing',
        });
      } else {
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, buffer);
        writtenCount++;
        console.log(`wrote: ${outPath} (canvas ${canvas}px, glyph ${glyph}px)`);
      }
    }
  }

  if (CHECK_MODE) {
    if (driftPaths.length > 0) {
      console.error(`icons:check: ${driftPaths.length} file(s) out of sync:\n`);
      for (const d of driftPaths) {
        console.error(`  ${d.reason}: ${d.path} (canvas ${d.canvas}px, glyph ${d.glyph}px)`);
      }
      console.error(`\nRun 'npm run icons:build' to regenerate.`);
      process.exit(1);
    }
    console.log(
      `icons:check: all PNGs in sync (${svgFiles.length} sources, ${unchangedCount} files).`,
    );
    process.exit(0);
  }

  if (writtenCount === 0) {
    console.log(`icons:build: all PNGs already in sync (${svgFiles.length} sources).`);
  } else {
    console.log(`icons:build: ${writtenCount} file(s) written from ${svgFiles.length} sources.`);
  }
  process.exit(0);
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  main();
}

export {
  buildOne,
  renderPng,
  detectCanvasSize,
  detectGlyphSize,
  readPngGlyphMaxDim,
  loadOverrides,
};
