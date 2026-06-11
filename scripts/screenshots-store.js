/**
 * scripts/screenshots-store.js — gather the store-listing screenshots.
 *
 * Two curated axes, both bounded by what the Roku store listing accepts:
 *  - storeLanguages: the locale subset that ships (a subset of the full capture
 *    matrix, which grows to ~99 locales for the font blast-radius analysis).
 *  - store-flagged SCREENS: the screen subset that ships. The store caps a listing
 *    at 6 screenshots, so only screens marked `capture.store` in tests/rta/screens.js
 *    are bundled — the locale folders also hold website-gallery-only screens, which
 *    must NOT end up in the store upload.
 *
 * The committed gallery images are WebP (small), but the Roku Developer Portal wants
 * PNG, so this DECODES each store-flagged WebP back to PNG into out/store/<lang>/
 * (gitignored), ready to upload — you never hunt through the full capture set. Adding
 * a store language = add it to storeLanguages and re-run `npm run screenshots:store`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RTA_CONFIG } from '../tests/rta/config.js';
import { SCREENS } from '../tests/rta/screens.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'docs', 'screenshots');
const outDir = path.join(repoRoot, 'out', 'store');

// The frozen Roku-store screen set (<= 6) — only these ship, even though the locale
// folders also hold website-gallery-only screens. Names only; committed as .webp.
const storeScreens = SCREENS.filter((s) => s.capture?.eligible && s.capture?.store).map(
  (s) => s.name,
);

// Guard: a store language must also be in the capture matrix, else it's never
// generated and the bundle would silently omit it.
const notCaptured = RTA_CONFIG.storeLanguages.filter((l) => !RTA_CONFIG.languages.includes(l));
if (notCaptured.length) {
  console.error(
    `storeLanguages not in RTA_CONFIG.languages (won't be captured): ${notCaptured.join(', ')}`,
  );
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
let total = 0;
const missing = [];
for (const lang of RTA_CONFIG.storeLanguages) {
  const from = path.join(srcDir, lang);
  // Only the store-flagged screens that exist as .webp in this locale folder.
  const names = storeScreens.filter((n) => fs.existsSync(path.join(from, `${n}.webp`)));
  if (!names.length) {
    missing.push(lang);
    continue;
  }
  const to = path.join(outDir, lang);
  fs.mkdirSync(to, { recursive: true });
  // Decode WebP -> PNG for the Roku upload.
  for (const n of names) {
    await sharp(path.join(from, `${n}.webp`))
      .png()
      .toFile(path.join(to, `${n}.png`));
  }
  console.log(`  ${lang}: ${names.length} screens`);
  total += names.length;
}

console.log(
  `\nBundled ${total} screenshots for ${RTA_CONFIG.storeLanguages.length - missing.length}/` +
    `${RTA_CONFIG.storeLanguages.length} store languages -> ${path.relative(repoRoot, outDir)}/`,
);
if (missing.length) {
  console.warn(
    `WARNING: no captured screenshots for: ${missing.join(', ')} — run screenshots:capture first.`,
  );
}
