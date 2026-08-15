/**
 * RTA retained-view test — does the app still hold screens the user backed out of?
 *
 * ## Why this exists as a GATE rather than a measurement
 *
 * The bug it was written for was invisible to every other signal we had. Timings
 * did not move: a `home-latest-rows` before/after series across 1 vs 7 retained
 * views came back flat-to-faster, with a valid control, because the retained views
 * do not slow the row-fetch pipeline — they cost memory, texture residency, and
 * render-thread observers. The functional suite was green throughout, because every
 * screen still loaded. The only thing that changed was an integer, and nobody was
 * counting it.
 *
 * So this is deliberately not a perf test. There is nothing to average and nothing
 * to explain away: a view the user has left either still exists or it does not.
 *
 * ## What it reads, and why that is a census rather than a proxy
 *
 * ODC's `getRootsCount` is implemented on-device as `m.top.getRoots()`, which Roku
 * documents as every existing node WITHOUT a parent, adding:
 *
 *   "The existence of these unparented nodes means they are being kept alive by
 *    direct BrightScript references. These could be in variables local to a
 *    function, arrays, or associative arrays, including a component global m or an
 *    associative array field of a node."
 *
 * That is the exact shape of both leaks this guards:
 *   - sgRouter's detach store (`m.__router_detachedViews`) — an associative array
 *     on a component global, which is where a `keepAlive` route parked every view
 *     that was POPPED, forever;
 *   - a retain CYCLE — `BaseGridView -> m.data -> GridItem scope -> m.gridView ->
 *     BaseGridView` — which BrightScript refcounting can never collect.
 *
 * A routed view that has been popped is unparented BY DEFINITION (the router
 * removes it from the outlet), so a popped view showing up in `getRoots()` is
 * precisely "something is still holding it".
 *
 * ## Why the counts must be zero rather than "not growing"
 *
 * A threshold invites the next leak to hide under it. These walks end with the user
 * back on Home having closed everything they opened, so the correct number of live
 * library/detail/search views is zero, and any other number is a defect regardless
 * of size.
 *
 * ## What the per-type census CANNOT see — and what covers it
 *
 * Counting subtypes only finds leaks whose leaked node IS one of the named types. The
 * `BaseGridView` cycle was visible that way only because `GridItem` caches the VIEW
 * node; a cell class that caches just the content root (`JRRowItem` does, and never
 * unobserves) would strand the content root plus its cells as an island with no routed
 * view in it, and every counter here would read zero. Adding `GridItem` to the list
 * would not help: cells stay parented to their grid, so they never appear in
 * `getRoots()` at all — pre-fix dumps show none.
 *
 * What does see it is `totalNodes` across the two grid walks. They are identical
 * except for how many screens are opened and closed, so anything retained PER VISIT
 * shows up as a difference between them — no absolute baseline, no device- or
 * fixture-specific constant. Pre-fix that difference was ~938 roots (946 -> 1884
 * across the six round trips); post-fix the walk ends flat, and below the cold-Home
 * baseline it started from.
 *
 * ## What a failure here means
 *
 * Some screen's `onDestroy` no longer releases everything, OR a route regained a
 * `keepAlive` flag. Both are real; neither shows up anywhere else until a user on a
 * memory-constrained device feels it. See docs/architecture/navigation.md for the
 * flag semantics and the measured before/after.
 *
 * Run: npm run test:rta:fast -- -t 'retains no views'
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, odc } from '../lib/driver.js';
import { navHomeReturnBare, navHomeReturnAfterDetails, navSearchReturn } from '../lib/nav.js';
import { waitHome, sleep } from '../lib/steps.js';
import { MOVIES_GRID } from '../screens.js';
import { recordAssertion } from '../../../scripts/run-record.js';

const LOCALE = RTA_CONFIG.languages[0]; // en_US

/** Routed views that must not outlive the user backing out of them. */
const ROUTED_VIEWS = ['BaseGridView', 'ItemDetails', 'SearchResults'];

/** Every routed view released — the expected census after any of these walks. */
const NOTHING_RETAINED = Object.fromEntries(ROUTED_VIEWS.map((t) => [t, 0]));

/**
 * Ceiling on the extra unparented roots the six-screen walk may leave over the
 * one-screen walk. Sized to catch a PER-VISIT leak, not to police jitter: the defect
 * this replaced left ~938, and the fixed app leaves ~0, so 100 sits an order of
 * magnitude under the failure and well over the noise from texture pools and the
 * recycled cell pools Home rebuilds on return.
 *
 * The observed delta is recorded as the `perVisitRootDelta` assertion on every run, so
 * the real spread accumulates in the run ledger instead of staying unknown. Tighten this
 * once a few green runs agree on a number — and do not raise it to make a run green.
 */
const PER_VISIT_ROOT_BUDGET = 100;

let session;
let ctx;
/** `totalNodes` from the one-screen walk; the six-screen walk is compared against it. */
let bareWalkRoots;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server, { role: 'rta-leaks' });
  // Library navs must target a library BY ID — see tests/rta/CLAUDE.md.
  ctx = { libraries: await getLibraries(session), session };
});

/**
 * Land on a seeded Home, run `walk`, and report the unparented-node census.
 *
 * Seeds the Movies landing as well as Home: `display.<id>.landing` is registry-persisted
 * and survives the relaunch, so without it these walks inherit whichever view another
 * spec left behind — and a Genres landing renders `#genreList`, not the `#itemGrid` the
 * walks drive. A no-op when the server has no movies library, which the walk then reports
 * itself rather than timing out here.
 *
 * The settle before reading is not a fixed-sleep workaround for a missing gate: the
 * walk's own waits already prove we are back on Home. It covers the render thread
 * finishing the teardown the LAST back press started, which no app field reports.
 */
async function retainedAfter(walk, label) {
  const expectedServer = await seedHome(session, LOCALE);
  await seedLibraryLanding(session, libraryIdFor(ctx.libraries, 'movies'), MOVIES_GRID.landing);
  await hardRelaunch(); // never plain relaunch — the app would re-persist over the seed
  await assertSeedTookEffect(expectedServer, label);
  await waitHome();

  await walk(ctx);
  await sleep(3000);

  const roots = await odc.getRootsCount();
  return {
    byType: Object.fromEntries(ROUTED_VIEWS.map((t) => [t, roots.nodeCountByType?.[t] ?? 0])),
    total: roots.totalNodes,
  };
}

/**
 * The one-screen walk's root total, which the six-screen walk is measured against.
 *
 * Normally set as a side effect of the first test, which already runs that walk. When
 * that test did NOT run — `-t 'six distinct'`, a reorder, a `.only` — this recomputes it
 * rather than failing on a missing baseline, so a filtered run still measures a real
 * delta. Costs nothing in a full-file run, where the value is already cached.
 */
async function baselineRoots() {
  if (typeof bareWalkRoots !== 'number') {
    const { total } = await retainedAfter(navHomeReturnBare, 'leak: per-visit delta baseline');
    bareWalkRoots = total;
  }
  return bareWalkRoots;
}

it('retains no views after a library round trip', async () => {
  const { byType, total } = await retainedAfter(navHomeReturnBare, 'leak: library round trip');
  bareWalkRoots = total; // the per-visit comparison below reads this
  // One object compare rather than three: a failure then reports every view's count,
  // so "which one leaked" is in the diff instead of being the next thing to go find.
  expect(byType, 'Home -> library -> back should leave nothing alive').toEqual(NOTHING_RETAINED);
}, 180000);

it('retains no views after six distinct detail round trips', async () => {
  // DISTINCT items on purpose. sgRouter's cache was keyed by route.path, so reopening
  // the same item resumed one cached view and the count never grew — the leak was only
  // visible across different paths. A regression that reintroduces path-keyed caching
  // would pass a same-item walk and fail this one.
  const { byType, total } = await retainedAfter(
    navHomeReturnAfterDetails,
    'leak: six detail round trips',
  );
  expect(byType, 'opening and closing 6 details should leave nothing alive').toEqual(
    NOTHING_RETAINED,
  );

  // The class-level half of the gate (see the header): six screens opened and closed
  // must not cost meaningfully more unparented roots than one, whatever type they are.
  const baseline = await baselineRoots();
  const delta = total - baseline;

  // Recorded BEFORE the assertion, and on every outcome. PER_VISIT_ROOT_BUDGET is
  // deliberately loose because nobody has ever seen the real spread — and nobody would,
  // while the number appeared only inside a failure message. Landing it in the run record
  // (`assertions` in run-meta.json / runs.jsonl) means a few green runs are enough to
  // tighten the budget from data instead of from guesswork.
  recordAssertion({ name: 'perVisitRootDelta', verified: delta });

  expect(
    delta,
    `six screens left ${total} roots vs ${baseline} for one — something is retained per visit`,
  ).toBeLessThanOrEqual(PER_VISIT_ROOT_BUDGET);
}, 300000);

it('retains no views after a search round trip', async () => {
  // Search is the least-exercised of the three teardowns and the most consequential:
  // /search was keepAlive, so SearchResults.onDestroy never ran in production, and it
  // owns releasing the firmware's global voice route (one voiceEnabled node at a time —
  // a leaked claim denies it to the next screen that wants one). Its rows are
  // BrowseRowItem cells, the same cache-the-content-root shape the grid fix addresses.
  const { byType } = await retainedAfter(navSearchReturn, 'leak: search round trip');
  expect(byType, 'Home -> search -> back should leave nothing alive').toEqual(NOTHING_RETAINED);
}, 180000);
