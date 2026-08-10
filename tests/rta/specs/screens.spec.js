/**
 * RTA functional tests: each screen in the registry is reached and asserted
 * loaded against a real device. The nav steps' odc waits are the assertions —
 * a screen that fails to render makes the nav throw, failing the test.
 *
 * Run: `npm run test:rta` (build + deploy + run) or `npm run test:rta:fast`
 * (skip redeploy). Set RTA_CAPTURE=1 (or `npm run test:rta:capture`) to also
 * dump a raw UI screenshot per screen to out/rta-captures/ for GUI viewing.
 *
 * Requires a reachable device + .env (ROKU_IP / ROKU_PASSWORD), same as the
 * Rooibos device tests.
 */
import { beforeAll, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import {
  seedHome,
  seedUserSelect,
  seedServerSelect,
  seedLibraryLanding,
  assertSeedTookEffect,
} from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { SCREENS } from '../screens.js';
import { captureRawUI } from '../capture.js';

const CAPTURE = process.env.RTA_CAPTURE === '1';
const LOCALE = RTA_CONFIG.languages[0]; // en_US

let session;
let ctx;
let libraries;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  const hero = await getHero(session);
  libraries = await getLibraries(session); // runtime collectionType -> id (no hardcoded GUIDs)
  // Functional tests assert each screen LOADS; the hero movie exercises every nav
  // (incl. trickplay). The trickplay-specific film is a store-screenshot concern.
  // `session` + `libraries` ride along for asserts that check rendered content
  // against the server (assertGenreRowsOwnTheirItems), rather than only that it rendered.
  ctx = {
    heroIndex: hero.index,
    heroId: hero.id,
    seekSeconds: RTA_CONFIG.seekSeconds,
    session,
    libraries,
  };
});

// A plain loop rather than `it.each` — `it.each` passes ONLY the case object, no
// TestContext, so a case cannot skip itself at runtime. That matters because whether
// a screen is testable depends on server content we only learn in beforeAll.
for (const screen of SCREENS) {
  // `testCtx` is Vitest's per-test context (for .skip); `ctx` remains the shared nav context.
  it(`screen "${screen.name}" loads`, async (testCtx) => {
    // A `view` screen needs its library to exist on the server. The demo server's
    // content is not a fixed contract — it resets and its libraries come and go (the
    // playlists library was present when RTA was set up and has not been since), so a
    // missing library is a statement about the fixture, not a regression in the app.
    // Skipping (visibly, with a reason) beats a red run nobody reads. Deliberately
    // generic: any content-dependent screen self-skips, no per-screen allowlist to
    // maintain.
    if (screen.view && !libraryIdFor(libraries, screen.view.collectionType)) {
      testCtx.skip(`server has no "${screen.view.collectionType}" library`);
    }

    let expectedServer;
    if (screen.state === 'home') expectedServer = await seedHome(session, LOCALE);
    else if (screen.state === 'userSelect') expectedServer = await seedUserSelect(session, LOCALE);
    else if (screen.state === 'serverSelect')
      expectedServer = await seedServerSelect(session, LOCALE);
    // Deterministic landing view for library-dependent screens (resolve id at runtime).
    if (screen.view) {
      await seedLibraryLanding(
        session,
        libraryIdFor(libraries, screen.view.collectionType),
        screen.view.landing,
      );
    }
    // hardRelaunch, NOT relaunch: a plain relaunch only foregrounds the running
    // channel, which then re-persists its in-memory session over everything seeded
    // above. See assertSeedTookEffect for what that failure looks like.
    await hardRelaunch();
    await assertSeedTookEffect(expectedServer, screen.name);
    if (screen.nav) await screen.nav(ctx); // nav's waitFor gates assert "loaded"
    if (screen.assert) await screen.assert(ctx); // explicit assert for seed-to-land screens
    if (CAPTURE && screen.capture?.eligible) await captureRawUI(screen.name);
  });
}
