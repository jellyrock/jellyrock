// Generates the tiny alpha-ramp PNGs that the Gradient component stretches
// across its bounds (see components/ui/Gradient.bs and issue #777).
//
// Why bitmaps at all: Rectangle-strip gradients alias into visible bars/gaps
// under the FHD→HD autoscale on 720p-UI devices (#777). A single stretched
// Poster is scale-independent and is the technique Roku OS itself uses for its
// player shade (FixedTheme PauseGradient.9.png — 3×1082, measured in
// r2d2_bitmaps on an Ultra 4850X). The assets
// stay tiny on purpose: texture memory is the DECODED SOURCE dimensions × 4B
// (verified with r2d2_bitmaps on hardware — a 4×270 asset allocates ~36KB
// regardless of displayed size), so this does NOT reintroduce the full-screen
// gradient PNGs (~2.3MB each) that the Rectangle design replaced.
//
// Asset contract (consumed by components/ui/Gradient.bs):
//   - White RGB throughout; the component tints via Poster.blendColor.
//   - Linear alpha ramp 255→0 along the fade axis. 270 ramp steps ≥ the 256
//     representable 8-bit alpha levels, so every alpha value appears and the
//     GPU stretch only ever interpolates between adjacent levels.
//   - 4px thick on the non-fade axis (stretched to any width/height).
//   - One file per orientation; the "180" variants are the flipped ramps used
//     for rotateDegrees=180/270 (opaque end at the far edge).
//
// Deterministic in the IMAGE, not in the bytes: sharp's prebuilt binary bundles
// its own libvips (and zlib), so the PNG encoder's output moves when sharp does.
// --check therefore compares decoded pixels (scripts/lib/png-compare.js), the
// same contract as icons-build.js.
//
// Usage:
//   node scripts/generate/gradient-assets.js [rootDir]         # write assets
//   node scripts/generate/gradient-assets.js [rootDir] --check # drift gate
//   node scripts/generate/gradient-assets.js [rootDir] --force # re-encode all
//
// --force is the deliberate escape hatch for the freeze that pixel comparison
// implies: write mode leaves a pixel-identical asset alone (which is what stops
// cross-machine churn), so the committed bytes stay on whatever encoder wrote
// them until someone asks for a re-encode. Same flag, same reason, in
// icons-build.js.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { matchesRenderedOutput } from '../lib/png-compare.js';

const args = process.argv.slice(2);
const CHECK_MODE = args.includes('--check');
// Rewrite every asset even when it already matches. Ignored in --check mode.
const REWRITE_ALL = args.includes('--force') && !CHECK_MODE;
const rootArg = args.find((a) => !a.startsWith('--'));
const ROOT_DIR = rootArg ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT_DIR, 'images', 'gradients');

const RAMP_STEPS = 270;
const THICKNESS = 4;
// Locked so a given ramp renders to the same IMAGE every run; drift detection
// compares pixels rather than bytes, for the reason in png-compare.js.
const PNG_OPTIONS = { compressionLevel: 9, palette: false, effort: 10, progressive: false };

// alpha(x, y) returns 0..1; ramps run along the long axis.
const ASSETS = {
  'fade-v.png': { w: THICKNESS, h: RAMP_STEPS, alpha: (_x, y) => 1 - y / (RAMP_STEPS - 1) },
  'fade-v180.png': { w: THICKNESS, h: RAMP_STEPS, alpha: (_x, y) => y / (RAMP_STEPS - 1) },
  'fade-h.png': { w: RAMP_STEPS, h: THICKNESS, alpha: (x, _y) => 1 - x / (RAMP_STEPS - 1) },
  'fade-h180.png': { w: RAMP_STEPS, h: THICKNESS, alpha: (x, _y) => x / (RAMP_STEPS - 1) },
};

async function renderAsset({ w, h, alpha }) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = 255;
      buf[i + 1] = 255;
      buf[i + 2] = 255;
      buf[i + 3] = Math.round(255 * alpha(x, y));
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .png(PNG_OPTIONS)
    .toBuffer();
}

const drift = [];
let written = 0;

for (const [name, spec] of Object.entries(ASSETS)) {
  const outPath = join(OUT_DIR, name);
  const buffer = await renderAsset(spec);
  const exists = existsSync(outPath);
  const upToDate =
    exists && !REWRITE_ALL && (await matchesRenderedOutput(readFileSync(outPath), buffer));
  if (upToDate) continue;

  if (CHECK_MODE) {
    drift.push({ path: outPath, reason: exists ? 'content drift' : 'missing' });
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(outPath, buffer);
    written++;
    console.log(`wrote: ${outPath} (${spec.w}x${spec.h})`);
  }
}

if (CHECK_MODE) {
  if (drift.length > 0) {
    console.error('gradient assets out of date — run `npm run gradients:build`:');
    for (const d of drift) console.error(`  ${d.reason}: ${d.path}`);
    process.exit(1);
  }
  console.log('gradient assets up to date');
} else {
  console.log(written === 0 ? 'gradient assets already up to date' : `wrote ${written} asset(s)`);
}
