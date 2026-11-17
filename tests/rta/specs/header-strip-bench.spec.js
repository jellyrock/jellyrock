/**
 * The library header strip, drawn on every library type, for judging its layout by eye.
 * It gates nothing, so it runs only when asked for:
 *
 *   RTA_BENCH=1 npm run test:rta -- header-strip-bench
 *
 * Each capture lands in `out/rta-captures/` as `strip-<name>.png`. Set `RTA_STRIP_LOCALE`
 * (`de`) to capture another language, and `RTA_STRIP_TAG` to keep two runs apart
 * (`strip-<tag>-<name>.png`). `RTA_STRIP_ONLY=movies` stops after the Movies tab. A library the server lacks is skipped with a line saying so.
 */
import { beforeAll, it } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryByType, selectLibraryTab, waitGridLoaded } from '../lib/nav.js';
import {
  focusIsInside,
  press,
  sleep,
  waitFocusInside,
  waitHome,
  walkFocusUntil,
} from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const BENCH_ENABLED = process.env.RTA_BENCH === '1';
const LOCALE = process.env.RTA_STRIP_LOCALE || RTA_CONFIG.languages[0];
// `movies` stops after the Movies tab's captures, enough to compare two cell sizes;
// `livetv` captures the Live TV tabs alone, `presentation` those and the presentation layout
const ONLY = process.env.RTA_STRIP_ONLY || '';
const TAG = process.env.RTA_STRIP_TAG ? `${process.env.RTA_STRIP_TAG}-` : '';
// Posters and the backdrop load after the grid reports loaded, and no field says when
// they have drawn (see "Paint or texture settle" in tests/rta/CLAUDE.md).
const PAINT_SETTLE_MS = 4000;

let session;
let libraries;

beforeAll(async () => {
  if (!BENCH_ENABLED) return;
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

async function capture(name) {
  await sleep(PAINT_SETTLE_MS);
  await captureRawUI(`strip-${TAG}${name}`);
}

/** A cold start, then the library opened on `view` (in `layout` when given). False when absent. */
async function openLibrary(collectionType, view, layout) {
  const libraryId = libraryIdFor(libraries, collectionType);
  if (!libraryId) {
    console.log(`  [strip] no "${collectionType}" library on this server: skipped`);
    return false;
  }
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, libraryId, view, { layout });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, `strip ${collectionType}`, landing ? { landing } : {});
  await waitHome();
  await navLibraryByType(collectionType, libraryId);
  await waitGridLoaded(`strip ${collectionType} ${view}`);
  return true;
}

async function switchTab(tabId) {
  await selectLibraryTab(tabId);
  await waitGridLoaded(`strip tab ${tabId}`);
}

async function captureLiveTv() {
  if (!(await openLibrary('livetv', 'channels'))) return;
  await capture('livetv-channels');
  await selectLibraryTab('guide');
  await capture('livetv-guide');
  // Three quick Downs and a capture with no settle: rows built below the screen's edge
  // should arrive with their logos already drawn
  for (let i = 0; i < 3; i++) await press(ecp.Key.Down);
  await captureRawUI(`strip-${TAG}livetv-guide-after-three-downs`);
}

it.skipIf(!BENCH_ENABLED)(
  'captures the header strip on each library type',
  async () => {
    if (
      !['livetv', 'presentation'].includes(ONLY) &&
      (await openLibrary('movies', 'movies', 'grid'))
    ) {
      await capture('movies-grid');
      // Two rows down and one right, so the strip describes another item
      await press(ecp.Key.Right);
      await capture('movies-grid-second-item');
      await press(ecp.Key.Left);
      await waitFocusInside('#headerStrip', {
        action: walkFocusUntil(ecp.Key.Up, (f) => focusIsInside(f.keyPath, '#headerStrip')),
        label: 'the header strip, Up from the first row',
      });
      await capture('movies-chip-focused');
      await press(ecp.Key.Right);
      await capture('movies-second-chip-focused');
      await press(ecp.Key.Down);
      if (ONLY === 'movies') return;
      for (const tab of ['favorites', 'collections', 'genres', 'studios']) {
        try {
          await switchTab(tab);
          await capture(`movies-${tab}`);
        } catch (err) {
          console.log(`  [strip] movies tab "${tab}" not captured: ${err.message.split('\n')[0]}`);
        }
      }
    }
    if (ONLY === 'livetv') {
      await captureLiveTv();
      return;
    }
    if (await openLibrary('movies', 'movies', 'presentation')) {
      await capture('movies-presentation');
      // Other items, so the panel is seen with and without ratings and a tagline
      for (const n of [2, 3, 4]) {
        await press(ecp.Key.Right);
        await capture(`movies-presentation-item-${n}`);
      }
    }
    if (ONLY === 'presentation') {
      await captureLiveTv();
      return;
    }
    if (await openLibrary('tvshows', 'shows')) {
      await capture('shows');
      await switchTab('genres');
      await capture('shows-genres');
    }
    if (await openLibrary('music', 'albumartists')) {
      await capture('music-albumartists');
      await switchTab('albums');
      await capture('music-albums');
    }
    await captureLiveTv();
    if (await openLibrary('boxsets', '')) await capture('collections-library');
  },
  20 * 60 * 1000,
);
