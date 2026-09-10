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
 * That argument has a hole worth naming: `getRoots()` sees an island by its ROOT, so a
 * stranded content root reads as ~1 whether it drags 5 cells behind it or 50, and the
 * per-visit budget below is 20. `getAllCount` — the same primitive over `getAll()`
 * instead of `getRoots()` — counts the whole island, and `retainedAfter` now records it
 * alongside. It is deliberately NOT asserted on yet; see the note at that call.
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
 * **Set from measurement, not from caution.** Nine runs on `.178` (2026-08-15, recorded as
 * the `perVisitRootDelta` assertion) read `-5, +2, 0, 0, 1, 0, -1, 0` across the eight that
 * were green — max magnitude 5, and negative as often as positive, which is the signature
 * of pool jitter rather than of anything retained. 20 is 4x the observed noise.
 *
 * It stays this loose on purpose, because the gap it sits in is enormous: the delta spans
 * SIX extra screen visits, and one leaked view is ~150 nodes, so the smallest real
 * per-visit leak reads ~900. Anything between roughly 30 and 500 would catch the identical
 * set of defects; 20 buys detection of the sub-view case (a stranded content-root island,
 * which the per-type census structurally cannot see) without approaching the noise floor.
 *
 * Do not raise it to make a run green — a run that exceeds this is either a real leak or
 * evidence the noise floor moved, and both deserve a look rather than a bigger number.
 */
const PER_VISIT_ROOT_BUDGET = 20;

let session;
let ctx;
/** `totalNodes` from the one-screen walk; the six-screen walk is compared against it. */
let bareWalkRoots;
/** The same, from `getAll()` — the census the roots figure structurally under-counts. */
let bareWalkAll;

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

  // Second census, RECORDED BUT NOT ASSERTED — it measures the blind spot named above.
  // `getRoots()` counts unparented nodes, so a retained island whose members stay parented
  // to one another (a cached content root and its cells) contributes ~1 to it whatever its
  // size; `getAll()` counts the whole island. Measured on `.177` 2026-09-08 as the reason
  // to believe that gap is real, not theoretical: on a settled Home `ContentNode` and
  // `JellyfinBaseItem` read roots 0 / all 8 and 14 — entirely parented, hence invisible to
  // the census above.
  //
  // No assertion, on purpose, and for the same reason PER_VISIT_ROOT_BUDGET was landed
  // loose: nobody has measured how `getAll()` totals spread across these walks, and a
  // threshold guessed here would buy flakes on the one suite whose job is consistency.
  // Landing the number in the run record makes a few green runs enough to set that budget
  // from data. Cost is one extra round trip per walk — 9 ms device / 15 ms wall, n=10.
  const all = await odc.getAllCount();
  // Per-walk detail into the raw stream. NOTE it does not reach `run-meta.json` or the
  // ledger: `foldAssertions` keeps a record only when `verified` is a NUMBER, so an
  // object-valued one is written here and dropped there. The durable figure is the
  // scalar `perVisitAllDelta` below — this line is the working, not the record.
  recordAssertion({
    name: 'nodeCensus',
    label,
    verified: { roots: roots.totalNodes, all: all.totalNodes },
  });

  return {
    byType: Object.fromEntries(ROUTED_VIEWS.map((t) => [t, roots.nodeCountByType?.[t] ?? 0])),
    total: roots.totalNodes,
    allTotal: all.totalNodes,
  };
}

/**
 * The one-screen walk's two census totals, which the six-screen walk is measured against.
 *
 * Normally set as a side effect of the first test, which already runs that walk. When
 * that test did NOT run — `-t 'six distinct'`, a reorder, a `.only` — this recomputes it
 * rather than failing on a missing baseline, so a filtered run still measures a real
 * delta. Costs nothing in a full-file run, where the values are already cached.
 */
async function baselineCensus() {
  if (typeof bareWalkRoots !== 'number') {
    const { total, allTotal } = await retainedAfter(
      navHomeReturnBare,
      'leak: per-visit delta baseline',
    );
    bareWalkRoots = total;
    bareWalkAll = allTotal;
  }
  return { roots: bareWalkRoots, all: bareWalkAll };
}

it('retains no views after a library round trip', async () => {
  const { byType, total, allTotal } = await retainedAfter(
    navHomeReturnBare,
    'leak: library round trip',
  );
  bareWalkRoots = total; // the per-visit comparisons below read these
  bareWalkAll = allTotal;
  // One object compare rather than three: a failure then reports every view's count,
  // so "which one leaked" is in the diff instead of being the next thing to go find.
  expect(byType, 'Home -> library -> back should leave nothing alive').toEqual(NOTHING_RETAINED);
}, 180000);

it('retains no views after six distinct detail round trips', async () => {
  // DISTINCT items on purpose. sgRouter's cache was keyed by route.path, so reopening
  // the same item resumed one cached view and the count never grew — the leak was only
  // visible across different paths. A regression that reintroduces path-keyed caching
  // would pass a same-item walk and fail this one.
  const { byType, total, allTotal } = await retainedAfter(
    navHomeReturnAfterDetails,
    'leak: six detail round trips',
  );
  expect(byType, 'opening and closing 6 details should leave nothing alive').toEqual(
    NOTHING_RETAINED,
  );

  // The class-level half of the gate (see the header): six screens opened and closed
  // must not cost meaningfully more unparented roots than one, whatever type they are.
  const { roots: baseline, all: baselineAll } = await baselineCensus();
  const delta = total - baseline;

  // Recorded BEFORE the assertion, and on every outcome. PER_VISIT_ROOT_BUDGET is
  // deliberately loose because nobody has ever seen the real spread — and nobody would,
  // while the number appeared only inside a failure message. Landing it in the run record
  // (`assertions` in run-meta.json / runs.jsonl) means a few green runs are enough to
  // tighten the budget from data instead of from guesswork.
  recordAssertion({ name: 'perVisitRootDelta', verified: delta });

  // The same comparison over `getAll()`, and the reason the second census is taken at all:
  // it counts a retained island's whole membership where the roots figure sees only its
  // root. Recorded, NOT asserted — there is no measured noise floor for it yet, and a
  // threshold guessed here would buy flakes on the suite whose job is consistency. Scalar
  // and uniquely named so `foldAssertions` carries it into runs.jsonl, which is what makes
  // "set the budget from a few green runs" true rather than merely intended.
  //
  // First reading, `.177` 2026-09-08: roots 500 -> 526 over the six extra visits while
  // perVisitRootDelta was 0. Non-zero, and NOT yet attributable — n=1, no noise floor, and
  // recycled cell/texture pools are an equally good explanation. It is the signal this
  // census exists to make visible, not yet evidence of a leak.
  recordAssertion({ name: 'perVisitAllDelta', verified: allTotal - baselineAll });

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
