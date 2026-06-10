/**
 * scripts/screenshots-store.js — gather the store-listing screenshots.
 *
 * Reads RTA_CONFIG.storeLanguages (the curated subset that ships in the Roku
 * store listing — the single hand-maintained "what's in the store" list) and
 * copies just those locale folders from docs/screenshots/<lang>/ into
 * out/store/<lang>/ (gitignored), ready to upload to the Roku Developer Portal.
 *
 * The point: you never hunt through the full capture set (which grows to ~99
 * locales for the font blast-radius analysis). Adding a store language = add it
 * to storeLanguages and re-run `npm run screenshots:store`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RTA_CONFIG } from '../tests/rta/config.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(repoRoot, 'docs', 'screenshots');
const outDir = path.join(repoRoot, 'out', 'store');

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
  const pngs = fs.existsSync(from) ? fs.readdirSync(from).filter((f) => f.endsWith('.png')) : [];
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
