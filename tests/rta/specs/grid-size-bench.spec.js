/**
 * The library grid drawn at candidate column counts, for picking the Size steps by eye.
 * It gates nothing, so it runs only when asked for:
 *
 *   RTA_BENCH=1 npm run test:rta -- grid-size-bench
 *
 * Each capture lands in `out/rta-captures/` as `grid-<shape>-<columns>x<width>-<titles>.png`.
 * A candidate is a column count and a cell width; the rest is the arithmetic of
 * `libraryGrid.cellFor()`, repeated here so a candidate can be drawn before it is in the
 * app's table. A candidate reaches the app through the RTA-only `rtaGridStep` global, which
 * `BaseGridView.configureGrid()` reads when a library opens, so each one is drawn by the
 * app's own path on a library opened anew.
 *
 * `RTA_GRID_ONLY=portrait|square|presentation` runs one part. Set `RTA_GRID_TAG` to keep
 * two runs apart.
 */
import { beforeAll, it } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryByType, waitGridLoaded } from '../lib/nav.js';
import { press, sleep, waitHome } from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const BENCH_ENABLED = process.env.RTA_BENCH === '1';
const ONLY = process.env.RTA_GRID_ONLY || '';
const TAG = process.env.RTA_GRID_TAG ? `${process.env.RTA_GRID_TAG}-` : '';
// A resized cell asks for its poster again, and no field says when the last one has drawn
const PAINT_SETTLE_MS = 5000;

// libraryGrid.cellFor()'s inputs, mirrored (source/GridView/libraryGrid.bs)
const SPAN = 1728;
const TEXT_ROW_GAP = 18 + 33 + 18;
const floorToGrid = (n) => n - (n % 3);

// [columns, width]: the plan's candidate for each count, then tighter ones down to the
// 18 pixel floor (libraryGrid.MIN_GAP)
const PORTRAIT = [
  [5, 300],
  [5, 312],
  [6, 252],
  [6, 264],
  [7, 216],
  [7, 228],
  [8, 192],
  [8, 198],
  [9, 168],
  [9, 174],
];
const SQUARE = [
  [4, 405],
  [4, 414],
  [5, 324],
  [5, 330],
  [6, 258],
  [6, 273],
  [7, 216],
  [7, 231],
];

function cellFor(shape, columns, width, textLines) {
  const height = shape === 'square' ? width : (width * 3) / 2;
  const columnGap = floorToGrid(Math.floor((SPAN - columns * width) / (columns - 1)));
  const rowGap = textLines > 0 ? TEXT_ROW_GAP : columnGap;
  return { columns, width, height, columnGap, rowGap };
}

let session;
let libraries;

beforeAll(async () => {
  if (!BENCH_ENABLED) return;
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

/**
 * A cold start on Home with the titles setting and the library's landing written.
 * Returns the walk that opens the library from Home, or false when the server has none.
 */
async function seedLibrary(collectionType, view, layout, areTitlesShown) {
  const libraryId = libraryIdFor(libraries, collectionType);
  if (!libraryId) {
    console.log(`  [grid] no "${collectionType}" library on this server: skipped`);
    return false;
  }
  const expectedServer = await seedHome(session, RTA_CONFIG.languages[0]);
  await odc.writeRegistry({
    values: { [session.userId]: { itemGridTitles: areTitlesShown ? 'showalways' : 'hidealways' } },
  });
  const landing = await seedLibraryLanding(session, libraryId, view, { layout });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, `grid ${collectionType}`, landing ? { landing } : {});
  await waitHome();
  return async () => {
    await navLibraryByType(collectionType, libraryId);
    await waitGridLoaded(`grid ${collectionType} ${view}`);
  };
}

/** Open the library drawn as one candidate, capture it, and go back to Home. */
async function drawAndCapture(shape, [columns, width], areTitlesShown, label, open) {
  const cell = cellFor(shape, columns, width, areTitlesShown ? 1 : 0);
  await odc.setValue({ base: 'global', keyPath: 'rtaGridStep', value: { columns, width } });
  await open();
  console.log(
    `  [grid] ${label} ${columns} x ${cell.width} by ${cell.height}, gaps ${cell.columnGap} and ${cell.rowGap}`,
  );
  await sleep(PAINT_SETTLE_MS);
  const titles = areTitlesShown ? 'titles' : 'notitles';
  await captureRawUI(`grid-${TAG}${label}-${columns}x${width}-${titles}`);
  await press(ecp.Key.Back);
  await waitHome();
}

it.skipIf(!BENCH_ENABLED)(
  'captures the library grid at each candidate size',
  async () => {
    for (const areTitlesShown of [true, false]) {
      if (!ONLY || ONLY === 'portrait') {
        const open = await seedLibrary('movies', 'movies', 'comfortable', areTitlesShown);
        for (const candidate of open ? PORTRAIT : []) {
          await drawAndCapture('portrait', candidate, areTitlesShown, 'portrait', open);
        }
      }
      if (!ONLY || ONLY === 'presentation') {
        const open = await seedLibrary('movies', 'movies', 'presentation', areTitlesShown);
        for (const candidate of open ? PORTRAIT : []) {
          await drawAndCapture('portrait', candidate, areTitlesShown, 'presentation', open);
        }
      }
      if (!ONLY || ONLY === 'square') {
        const open = await seedLibrary('music', 'albums', undefined, areTitlesShown);
        for (const candidate of open ? SQUARE : []) {
          await drawAndCapture('square', candidate, areTitlesShown, 'square', open);
        }
      }
    }
  },
  30 * 60 * 1000,
);
