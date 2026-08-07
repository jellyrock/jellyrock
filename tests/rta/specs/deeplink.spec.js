/**
 * RTA functional tests for the deep-link / cast CONTRACT (the ECP `contentId`
 * consumer — ADR 0018). Each test lands logged-in on Home, fires a runtime cast
 * (`/input?contentId=...`, the same wire a Jellyfin sender mints), and asserts the
 * landing — regression-netting the contract beyond the manual `curl` recipes in
 * docs/dev/deep-linking.md.
 *
 * Ids are resolved at runtime from the demo (never hardcoded). Assertions read the
 * ACTIVE routed view (getActiveVal → m.global.activeRoutedView) and the device's
 * media-player state, both robust to sgRouter keepAlive (see tests/rta/CLAUDE.md).
 *
 * Requires a reachable device + .env (ROKU_IP / ROKU_PASSWORD), same as screens.spec.
 */
import { beforeAll, afterAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero, getLibraries, libraryIdFor, firstItemId } from '../lib/jellyfin.js';
import { seedHome, snapshotSession, restoreSession, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp } from '../lib/driver.js';
import { press, waitFor, getActiveVal, waitHome, sleep, hasChildren } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const PLAYING_STATES = ['startup', 'buffer', 'play', 'pause']; // Roku media-player active states
// Upper bound on the validate-before-navigate metadata fetch (+ toast). The invalid-id test
// asserts a NON-event (no navigation), so it must out-wait the fetch; this is a generous ceiling
// on a LAN fetch to the demo, not a tuned value. If the production fetch ever gains an explicit
// timeout constant, prefer deriving this from it.
const VALIDATION_FETCH_BUDGET_MS = 6000;

let saved;
let session;
let heroId; // a Movie (open / play targets)
let moviesLibraryId; // a CollectionFolder (library-divert target)
let audioId; // an Audio item (instantmix target — demo InstantMix returns a real mix)

beforeAll(async () => {
  saved = await snapshotSession(); // restore the device's prior session afterward
  session = await authenticate(RTA_CONFIG.server);
  heroId = (await getHero(session)).id;
  moviesLibraryId = libraryIdFor(await getLibraries(session), 'movies');
  audioId = await firstItemId(session, 'Audio');
  for (const [k, v] of Object.entries({ heroId, moviesLibraryId, audioId })) {
    if (!v) throw new Error(`deep-link spec setup: could not resolve ${k} on the demo server`);
  }
});

afterAll(async () => {
  await restoreSession(saved);
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
});

/** Land logged-in on Home, then fire a runtime cast (ECP /input?contentId=...). */
async function castFromHome(contentId) {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch(); // a plain relaunch lets the running app re-persist over the seed
  await assertSeedTookEffect(expectedServer, 'castFromHome');
  await waitHome();
  await ecp.sendInput({ params: { contentId } }); // querystring.build URL-encodes | and =
}

/** Poll the device media-player until it reaches an active playback state. */
async function waitMediaPlaying(label, timeout = 30000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    const mp = await ecp.getMediaPlayer().catch(() => null);
    last = mp?.state;
    if (mp && !mp.error && PLAYING_STATES.includes(mp.state)) return;
    await sleep(1000);
  }
  throw new Error(`deep-link ${label}: media player never started (last state=${last})`);
}

/**
 * Stop playback so it can't leak into the next spec. Back on the player stops it
 * (AudioPlayerView/PlayerHostView onKeyEvent "back" → control "stop") — necessary
 * because AUDIO keeps playing while you navigate away (correct music-app UX), so a
 * relaunch-to-Home alone won't silence it. Verify via media-player; retry Back.
 */
async function stopPlayback() {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const mp = await ecp.getMediaPlayer().catch(() => null);
    if (!mp || !PLAYING_STATES.includes(mp.state)) return;
    await press(ecp.Key.Back);
    await sleep(1200);
  }
}

// An invalid id must never disturb the session: validate-before-navigate toasts and
// stays put (ADR 0018). Assert we never leave Home (a non-event → a bounded wait).
it('invalid id leaves the session undisturbed (stays Home)', async () => {
  await castFromHome('deadbeefdeadbeefdeadbeefdeadbeef');
  await sleep(VALIDATION_FETCH_BUDGET_MS); // let the (failed) validation fetch resolve — it must NOT navigate
  expect(await getActiveVal('#homeRows.content.getChildCount()')).toBeGreaterThan(0);
}, 60000);

// Bare id (action defaults to open) → the item's details springboard, loaded with that id.
it('open (bare id) lands on the details springboard', async () => {
  await castFromHome(heroId);
  await waitFor('itemId', (id) => id === heroId, {
    read: getActiveVal,
    label: 'deep-link open -> ItemDetails(itemId)',
    timeout: 25000,
  });
}, 90000);

// action=play → playback actually starts (the per-type quickplay engine).
it('action=play starts playback', async () => {
  await castFromHome(`id=${heroId}|action=play`);
  await waitMediaPlaying('play');
  await stopPlayback(); // leave a clean slate for the next spec
}, 120000);

// The once-per-navigation dedup keys off the router's per-navigation route.id
// (ItemDetails.checkDeepLinkLaunch / replayDeepLinkRuntime). TWO OPPOSING requirements ride on
// that one field, and castFromHome relaunches every time so the specs above never exercise either:
//   - a back-from-player resume (SAME route.id) must NOT re-fire (else an infinite relaunch loop);
//   - a repeat cast of the SAME item (its keepAlive ItemDetails still mounted) must RE-fire.
// This is the regression net docs/dev/deep-linking.md advertises for the keepAlive-resume bug.
it('back-from-player does not re-fire; a repeat play cast does', async () => {
  // First play cast → the movie plays (Home → Details(?deeplink=play) → Player back-stack).
  await castFromHome(`id=${heroId}|action=play`);
  await waitMediaPlaying('first play');

  // Back from the player resumes the launching details (keepAlive). Same route.id, so
  // checkDeepLinkLaunch must NOT re-fire — playback must stay stopped.
  await press(ecp.Key.Back);
  await waitFor('itemId', (id) => id === heroId, {
    read: getActiveVal,
    label: 'back-from-player -> ItemDetails(heroId)',
    timeout: 15000,
  });
  // Assert the non-event: a broken dedup would relaunch within ~1-2s. Bounded wait, then check.
  await sleep(5000);
  const afterBack = await ecp.getMediaPlayer().catch(() => null);
  expect(PLAYING_STATES.includes(afterBack?.state)).toBe(false);

  // Repeat cast of the SAME item, NO relaunch — we're on its loaded keepAlive details. A fresh
  // navigation route.id (the in-place playFromDeepLink path) must RE-fire playback.
  await ecp.sendInput({ params: { contentId: `id=${heroId}|action=play` } });
  await waitMediaPlaying('repeat cast play');
  await stopPlayback();
}, 150000);

// A library/container id diverts to its grid (Phase 2 resolver-level divert).
it('library/container id lands on its grid', async () => {
  await castFromHome(moviesLibraryId);
  await waitFor('#itemGrid.content.getChildCount()', hasChildren, {
    read: getActiveVal,
    label: 'deep-link library -> grid items',
    timeout: 25000,
  });
}, 90000);

// action=instantmix → builds an instant mix from the item and starts playing it.
it('action=instantmix builds a mix and starts playback', async () => {
  await castFromHome(`id=${audioId}|action=instantmix`);
  await waitMediaPlaying('instantmix');
  await stopPlayback(); // audio keeps playing while browsing by design — stop it so it can't leak
}, 120000);
