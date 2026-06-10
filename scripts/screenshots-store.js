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
 * Copies just those (locale x screen) PNGs from docs/screenshots/<lang>/ into
 * out/store/<lang>/ (gitignored), ready to upload to the Roku Developer Portal —
 * you never hunt through the full capture set. Adding a store language = add it to
 * storeLanguages and re-run `npm run screenshots:store`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RTA_CONFIG } from '../tests/rta/config.js';
import { SCREENS } from '../tests/rta/screens.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'docs', 'screenshots');
const outDir = path.join(repoRoot, 'out', 'store');

// The frozen Roku-store screen set (<= 6) — only these ship, even though the locale
// folders also hold website-gallery-only screens.
const storeScreens = SCREENS.filter((s) => s.capture?.eligible && s.capture?.store).map(
  (s) => `${s.name}.png`,
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
  // Only the store-flagged screens — NOT every PNG in the folder (the folder also
  // holds website-gallery-only screens that must stay out of the store upload).
  const pngs = storeScreens.filter((png) => fs.existsSync(path.join(from, png)));
  if (!pngs.length) {
    missing.push(lang);
    continue;
  }
  const to = path.join(outDir, lang);
  fs.mkdirSync(to, { recursive: true });
  for (const png of pngs) fs.copyFileSync(path.join(from, png), path.join(to, png));
  console.log(`  ${lang}: ${pngs.length} screens`);
  total += pngs.length;
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
