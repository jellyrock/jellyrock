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
 * library/detail views is zero, and any other number is a defect regardless of size.
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
import { authenticate, getLibraries } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, odc } from '../lib/driver.js';
import { navHomeReturnBare, navHomeReturnAfterDetails } from '../lib/nav.js';
import { waitHome, sleep } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0]; // en_US

/** Routed views that must not outlive the user backing out of them. */
const ROUTED_VIEWS = ['BaseGridView', 'ItemDetails', 'SearchResults'];

let session;
let ctx;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server, { role: 'rta-leaks' });
  // Library navs must target a library BY ID — see tests/rta/CLAUDE.md.
  ctx = { libraries: await getLibraries(session), session };
});

/**
 * Land on a seeded Home, run `walk`, and return the unparented count per routed view.
 *
 * The settle before reading is not a fixed-sleep workaround for a missing gate: the
 * walk's own waits already prove we are back on Home. It covers the render thread
 * finishing the teardown the LAST back press started, which no app field reports.
 */
async function retainedAfter(walk, label) {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch(); // never plain relaunch — the app would re-persist over the seed
  await assertSeedTookEffect(expectedServer, label);
  await waitHome();

  await walk(ctx);
  await sleep(3000);

  const roots = await odc.getRootsCount();
  return Object.fromEntries(ROUTED_VIEWS.map((t) => [t, roots.nodeCountByType?.[t] ?? 0]));
}

it('retains no views after a library round trip', async () => {
  const retained = await retainedAfter(navHomeReturnBare, 'leak: library round trip');
  // One object compare rather than three: a failure then reports every view's count,
  // so "which one leaked" is in the diff instead of being the next thing to go find.
  expect(retained, 'Home -> library -> back should leave nothing alive').toEqual({
    BaseGridView: 0,
    ItemDetails: 0,
    SearchResults: 0,
  });
}, 180000);

it('retains no views after six distinct detail round trips', async () => {
  // DISTINCT items on purpose. sgRouter's cache was keyed by route.path, so reopening
  // the same item resumed one cached view and the count never grew — the leak was only
  // visible across different paths. A regression that reintroduces path-keyed caching
  // would pass a same-item walk and fail this one.
  const retained = await retainedAfter(navHomeReturnAfterDetails, 'leak: six detail round trips');
  expect(retained, 'opening and closing 6 details should leave nothing alive').toEqual({
    BaseGridView: 0,
    ItemDetails: 0,
    SearchResults: 0,
  });
}, 300000);
