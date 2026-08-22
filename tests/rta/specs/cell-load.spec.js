/**
 * Cell-load instrumentation gate — does the ledger count things that actually happened?
 *
 * ## Why this exists as a GATE, and why nothing else could have been one
 *
 * The defect it was written for was invisible to every other layer we have, and the branch
 * that shipped it ran all of them green:
 *
 *  - **Unit tests could not see it.** `cellLoad.spec.bs` feeds the ledger synthetic call
 *    sequences and mutation-verifies each one. The defect was not in the ledger — it was a
 *    call site being invoked in a state where the call is wrong. A spec that supplies the
 *    calls itself cannot observe who really makes them. (That gap is the repo-wide
 *    "no spec instantiates a SceneGraph cell component" followup; this spec does not close
 *    it, it routes around it by asserting on the DEVICE instead.)
 *  - **The sweep measurements could not see it.** `cellSweepGrid` reads identically —
 *    `appearances` 46, `popIns` 24, `popInsCold` 6 — with and without the bug, because a
 *    sweep never suspends its screen. Five launches, every field identical, both arms.
 *  - **The functional suite could not see it.** Nothing about the app misbehaves. The only
 *    thing that changed was an integer, and it changed in the direction that makes the
 *    subsystem under test look BETTER.
 *
 * So this is deliberately not a perf test. There is nothing to average and nothing to
 * explain away: a cell either came on screen or it did not.
 *
 * ## The invariant, and why it is falsifiable rather than green-forever
 *
 * Back out of an item detail onto the grid underneath and scroll NOTHING. Any cell that
 * legitimately appears in that window must have been rebound to get there, so:
 *
 *     appearances <= binds        (for a resume with no scrolling)
 *
 * This is not true in general — a scroll sweep runs `appearances` 46 against `binds` 28,
 * because a cell that scrolls off and back is not rebound. It is true for THIS walk, which
 * is what makes the assertion worth having rather than structurally unviolatable: measured
 * on `.177` 2026-08-22 against the demo server this suite already targets, the pre-fix build
 * read **18 appearances against 10 binds** here and the fixed build reads **0 against 10**.
 * Those two counts are the demo library's, and they will move when it does — which is
 * exactly why the assertion is a bound and not an equality.
 *
 * The 18 were `visible=false` propagating down to every cell's `renderTracking` when the
 * detail opened, read as "the cell left the screen", and read again on the way back as "the
 * cell arrived". Neither happened. `hidden` freezes textures loaded, so every one of those
 * phantom arrivals was a guaranteed non-pop-in landing in the denominator of
 * `popIns / appearances` as a free win.
 *
 * ## Why it asserts a bound rather than an exact number
 *
 * How many cells the grid rebinds on resume is a property of the fixture (library size,
 * column count, which row focus was left on), and pinning it would make this fail on any
 * library but the one it was written against. The BOUND is a property of the app.
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp } from '../lib/driver.js';
import { navMovieDetails } from '../lib/nav.js';
import { getActiveVal, press, waitHome, waitFocusInside, waitCellsQuiet } from '../lib/steps.js';
import { MOVIES_GRID } from '../screens.js';

const LOCALE = RTA_CONFIG.languages[0];

let session;
let ctx;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  ctx = { libraries: await getLibraries(session) };
});

it('resuming a suspended grid does not manufacture cell appearances', async (testCtx) => {
  const moviesId = libraryIdFor(ctx.libraries, MOVIES_GRID.collectionType);
  if (!moviesId) testCtx.skip('server has no "movies" library');

  // Seed the landing view, do NOT inherit it. `display.<id>.landing` is registry-PERSISTED
  // and survives a relaunch, so the Movies library opens on whatever view ran last — and
  // `genre-skeleton.spec.js` leaves it on `Genres`, which is a RowList with no `#itemGrid`
  // in it at all. Without this the walk below times out waiting for focus that can never
  // arrive, and it does so ONLY when the suite runs in the order that puts that spec first:
  // caught 2026-08-22 by the full suite after the spec had passed twice in isolation.
  const expectedServer = await seedHome(session, LOCALE);
  await seedLibraryLanding(session, moviesId, MOVIES_GRID.landing);
  await hardRelaunch(); // never plain relaunch — the app re-persists over the seed
  await assertSeedTookEffect(expectedServer, 'cell-load suspend/resume');

  await waitHome();
  // home -> Movies grid -> movie detail. Opening the detail SUSPENDS the grid
  // (sgRouter keeps it in the scene tree with visible=false), which fires
  // hideTextureManager -> cellLoad.emit, so its counters restart from zero here.
  await navMovieDetails(ctx);

  // Back pops the detail and the grid resumes. No key presses beyond this one, so
  // nothing scrolls and every appearance below has to be paid for by a bind.
  await press(ecp.Key.Back);
  await waitFocusInside('#itemGrid', { timeout: 20000 });

  // Gate the read on the app's own quiescence rather than a sleep — `Appearances` is in
  // CELL_QUIET_COUNTERS, so this settles on the very field under test.
  const { counts, instrumented, resolved } = await waitCellsQuiet('#itemGrid');
  if (!resolved) testCtx.skip('#itemGrid did not resolve — nothing was watched');
  if (!instrumented) testCtx.skip('build carries no cell-load counters (perfTiming off)');

  const binds = await getActiveVal('#itemGrid.content.cellLoadBinds');
  const appearances = await getActiveVal('#itemGrid.content.cellLoadAppearances');

  expect(
    appearances,
    `resuming the grid produced ${appearances} appearance(s) against ${binds} bind(s) with ` +
      'nothing scrolled. An appearance with no bind behind it is `visible=false` propagating ' +
      'to renderTracking being read as a departure and a return — see JRRowItem.noteAppearance, ' +
      `which gates cellLoad.departed() on textureManagerState for exactly this. Settled at ` +
      `${JSON.stringify(counts)}.`,
  ).toBeLessThanOrEqual(binds);
});
