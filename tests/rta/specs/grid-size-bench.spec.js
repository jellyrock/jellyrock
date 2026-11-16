/**
 * The library grid drawn at every count of items per row, for judging the sizes by eye.
 * It gates nothing, so it runs only when asked for:
 *
 *   RTA_BENCH=1 npm run test:rta -- grid-size-bench
 *
 * Each capture lands in `out/rta-captures/` as `grid-<part>-<count>-<titles>.png`. A count
 * reaches the app as a viewer's pick does, through the saved `columns_<view>` display
 * setting, so each one costs a cold start.
 *
 * `RTA_GRID_ONLY=portrait|presentation|square` runs one part, `RTA_GRID_COLUMNS=3,11`
 * those counts alone, and `RTA_GRID_TAG` keeps two runs apart.
 */
import { beforeAll, it } from 'vitest';
import { odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryByType, waitGridLoaded } from '../lib/nav.js';
import { sleep, waitHome } from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const BENCH_ENABLED = process.env.RTA_BENCH === '1';
const ONLY = process.env.RTA_GRID_ONLY || '';
const TAG = process.env.RTA_GRID_TAG ? `${process.env.RTA_GRID_TAG}-` : '';
const WANTED = (process.env.RTA_GRID_COLUMNS || '').split(',').filter(Boolean).map(Number);
// Posters load after the grid reports loaded, and no field says when the last has drawn
const PAINT_SETTLE_MS = 5000;

// libraryGrid.MIN_COLUMNS to MAX_COLUMNS; the presentation layout's floor is 5
const COUNTS = [3, 4, 5, 6, 7, 8, 9, 10, 11];
const PARTS = [
  { name: 'portrait', type: 'movies', view: 'movies', layout: 'comfortable', from: 3 },
  { name: 'presentation', type: 'movies', view: 'movies', layout: 'presentation', from: 5 },
  { name: 'square', type: 'music', view: 'albums', layout: undefined, from: 3 },
];

let session;
let libraries;

beforeAll(async () => {
  if (!BENCH_ENABLED) return;
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

/** A cold start with the count and the titles setting saved, the library opened, a capture. */
async function drawAndCapture(part, libraryId, columns, areTitlesShown) {
  const expectedServer = await seedHome(session, RTA_CONFIG.languages[0]);
  const landing = await seedLibraryLanding(session, libraryId, part.view, { layout: part.layout });
  await odc.writeRegistry({
    values: {
      [session.userId]: {
        itemGridTitles: areTitlesShown ? 'showalways' : 'hidealways',
        [`display.${libraryId}.columns_${part.view}`]: String(columns),
      },
    },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, `grid ${part.name}`, landing ? { landing } : {});
  await waitHome();
  await navLibraryByType(part.type, libraryId);
  await waitGridLoaded(`grid ${part.name} ${columns}`);
  await sleep(PAINT_SETTLE_MS);
  const titles = areTitlesShown ? 'titles' : 'notitles';
  await captureRawUI(`grid-${TAG}${part.name}-${columns}-${titles}`);
}

it.skipIf(!BENCH_ENABLED)(
  'captures the library grid at every count of items per row',
  async () => {
    for (const part of PARTS.filter((p) => !ONLY || p.name === ONLY)) {
      const libraryId = libraryIdFor(libraries, part.type);
      if (!libraryId) {
        console.log(`  [grid] no "${part.type}" library on this server: ${part.name} skipped`);
        continue;
      }
      const counts = COUNTS.filter((n) => n >= part.from && (!WANTED.length || WANTED.includes(n)));
      for (const areTitlesShown of [true, false]) {
        for (const columns of counts)
          await drawAndCapture(part, libraryId, columns, areTitlesShown);
      }
    }
  },
  60 * 60 * 1000,
);
