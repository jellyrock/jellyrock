/**
 * RTA functional tests for the deep-link / cast CONTRACT (the ECP `contentId`
 * consumer, ADR 0018). Each test lands logged-in on Home, fires a runtime cast
 * (`/input?contentId=...`, the same wire a Jellyfin sender mints), and asserts the
 * landing, regression-netting the contract beyond the manual `curl` recipes in
 * docs/dev/deep-linking.md.
 *
 * Ids are resolved at runtime from the demo (never hardcoded). Assertions read the
 * ACTIVE routed view (`getActiveVal` reads `m.global.activeRoutedView`) and the device's
 * media-player state, both robust to a suspended view lingering (see tests/rta/CLAUDE.md).
 *
 * Requires a reachable device + .env (ROKU_IP / ROKU_PASSWORD), same as screens.spec.
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero, getLibraries, libraryIdFor, firstItemId } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { navSeriesDetails, focusDetailButton } from '../lib/nav.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import {
  press,
  waitFor,
  getActiveVal,
  homeListId,
  waitHome,
  sleep,
  hasChildren,
  waitMediaPlaying,
  stopPlayback,
  waitToast,
  waitFocusInside,
  waitFocusInHomeContent,
  waitDialogClosed,
  focusIsInside,
  PLAYING_STATES,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// Upper bound on the validate-before-navigate metadata fetch (+ toast). The invalid-id test
// asserts a NON-event (no navigation), so it must out-wait the fetch; this is a generous ceiling
// on a LAN fetch to the demo, not a tuned value. If the production fetch ever gains an explicit
// timeout constant, prefer deriving this from it.
const VALIDATION_FETCH_BUDGET_MS = 6000;
// locale/custom/en_US.json MessageShuffleUnsupported.
const SHUFFLE_UNSUPPORTED = "Can't shuffle this.";

let session;
let heroId; // a Movie (open / play targets)
let moviesLibraryId; // a CollectionFolder (library-divert target)
let audioId; // an Audio item (instantmix target; the demo InstantMix returns a real mix)

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  heroId = (await getHero(session)).id;
  moviesLibraryId = libraryIdFor(await getLibraries(session), 'movies');
  audioId = await firstItemId(session, 'Audio');
  for (const [k, v] of Object.entries({ heroId, moviesLibraryId, audioId })) {
    if (!v) throw new Error(`deep-link spec setup: could not resolve ${k} on the demo server`);
  }
});

/** Land logged-in on Home, then fire a runtime cast (ECP /input?contentId=...). */
async function castFromHome(contentId) {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch(); // never plain relaunch: only hardRelaunch confirms the cold start
  await assertSeedTookEffect(expectedServer, 'castFromHome');
  await waitHome();
  await ecp.sendInput({ params: { contentId } }); // querystring.build URL-encodes | and =
}

// An invalid id must never disturb the session: validate-before-navigate toasts and
// stays put (ADR 0018). Assert we never leave Home (a non-event, so a bounded wait).
it('invalid id leaves the session undisturbed (stays Home)', async () => {
  await castFromHome('deadbeefdeadbeefdeadbeefdeadbeef');
  await sleep(VALIDATION_FETCH_BUDGET_MS); // let the (failed) validation fetch resolve; it must not navigate
  // Resolved rather than named: the list id is a property of Home's selected tab. Still read
  // through `getActiveVal`: the assertion is that Home is the ACTIVE view and populated, and a
  // scene-rooted read would also be satisfied by a suspended Home sitting behind another screen.
  const list = await homeListId();
  expect(await getActiveVal(`${list}.content.getChildCount()`)).toBeGreaterThan(0);
}, 60000);

// Bare id (action defaults to open) lands on the item's details springboard, loaded with that id.
it('open (bare id) lands on the details springboard', async () => {
  await castFromHome(heroId);
  await waitFor('itemId', (id) => id === heroId, {
    read: getActiveVal,
    label: 'deep-link open -> ItemDetails(itemId)',
    timeout: 25000,
  });
}, 90000);

// action=play: playback actually starts (the per-type quickplay engine).
it('action=play starts playback', async () => {
  await castFromHome(`id=${heroId}|action=play`);
  await waitMediaPlaying('deep-link play');
  await stopPlayback(); // leave a clean slate for the next spec
}, 120000);

// The once-per-navigation dedup keys off the router's per-navigation route.id
// (ItemDetails.checkDeepLinkLaunch / replayDeepLinkRuntime). TWO OPPOSING requirements ride on
// that one field, and castFromHome relaunches every time so the specs above never exercise either:
//   - a back-from-player resume (SAME route.id) must not re-fire (else an infinite relaunch loop);
//   - a repeat cast of the SAME item (its ItemDetails still the active view) must RE-fire.
// This is the regression net docs/dev/deep-linking.md advertises for the same-path-resume bug.
it('back-from-player does not re-fire; a repeat play cast does', async () => {
  // First play cast: the movie plays (Home, then Details(?deeplink=play), then the Player
  // back-stack).
  await castFromHome(`id=${heroId}|action=play`);
  await waitMediaPlaying('deep-link first play');

  // Back from the player resumes the launching details (suspended, not popped). Same route.id, so
  // checkDeepLinkLaunch must not re-fire, so playback must stay stopped.
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

  // Repeat cast of the SAME item, no relaunch, because we're on its loaded details, which the router
  // reuses on a same-path navigation. A fresh route.id (the in-place playFromDeepLink path)
  // must RE-fire playback.
  await ecp.sendInput({ params: { contentId: `id=${heroId}|action=play` } });
  await waitMediaPlaying('deep-link repeat cast play');
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

// action=instantmix: builds an instant mix from the item and starts playing it.
it('action=instantmix builds a mix and starts playback', async () => {
  await castFromHome(`id=${audioId}|action=instantmix`);
  await waitMediaPlaying('deep-link instantmix');
  await stopPlayback(); // audio keeps playing while browsing by design, so stop it so it can't leak
}, 120000);

// action=shuffle on a type nothing shuffles (a movie). A Jellyfin sender's Shuffle arrives as
// this deep link for whatever item it names, so the app must say it can't, not ask for a retry
// that can never work (quickplayOutcome.STATUS_UNSUPPORTED).
it('action=shuffle on a movie says it cannot be shuffled and plays nothing', async () => {
  await castFromHome(`id=${heroId}|action=shuffle`);
  await waitToast(SHUFFLE_UNSUPPORTED, { label: 'the cannot-shuffle toast', timeout: 25000 });
  // The toast comes from the details screen's own Shuffle, so it is the active view by now.
  expect(await getActiveVal('itemId'), 'still on the movie details').toBe(heroId);
  const player = await ecp.getMediaPlayer().catch(() => null);
  expect(PLAYING_STATES.includes(player?.state), 'nothing playing').toBe(false);
}, 90000);

// Gate on the cast's details being the active view and built: until then the screen under the
// dialog is still the one that could hold the focus, and the router claims focus once the
// navigation settles, which is after the details' buttons exist.
async function castHeroAndSettle(label) {
  await ecp.sendInput({ params: { contentId: heroId } });
  await waitFor('itemId', (id) => id === heroId, {
    read: getActiveVal,
    label: `${label} -> ItemDetails(heroId)`,
    timeout: 25000,
  });
  await waitFor('#buttons.getChildCount()', hasChildren, {
    read: getActiveVal,
    label: `${label}: the cast details screen built its buttons`,
    timeout: 15000,
  });
}

// A cast that lands while an overlay dialog is open must not take the remote from it. The routed
// screen opened under the dialog used to take the focus in onScreenShown, so the dialog stayed on
// screen and ignored every key. Back must then close it and hand the focus to the screen the
// viewer is on (the cast's), not the one the dialog was opened over. The exit confirm is JRScene's,
// so nothing on Home ends it when Home is covered. Only Back is pressed on it: OK would exit.
it('a cast landing under the exit confirm leaves it focused, and Back focuses the new screen', async () => {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch(); // never plain relaunch: only hardRelaunch confirms the cold start
  await assertSeedTookEffect(expectedServer, 'cast under the exit confirm');
  await waitFocusInHomeContent({ label: 'Home content focused before Back', timeout: 10000 });

  await press(ecp.Key.Back);
  await waitFocusInside('#jrDialog', { label: 'exit confirm focused', timeout: 10000 });

  await castHeroAndSettle('cast under the exit confirm');
  const focused = await odc.getFocusedNode({ includeNode: true });
  expect(
    focusIsInside(focused?.keyPath, 'jrDialog'),
    `the dialog still holds the remote (focus is on ${focused?.keyPath})`,
  ).toBe(true);

  await press(ecp.Key.Back);
  await waitDialogClosed('exit confirm dismissed over the new screen', { timeout: 10000 });
  await waitFocusInside('#buttons', {
    label: 'focus on the new screen after dismiss',
    timeout: 8000,
  });
  expect(await getActiveVal('itemId'), 'still on the cast movie').toBe(heroId);
}, 150000);

// A confirm about the item on screen (the Series Watched confirm) ends when a cast covers it:
// left open, it would act on a Series the viewer no longer sees. The cast's screen takes the
// remote with no dialog in the way.
it('a cast landing over an item confirm ends the confirm and focuses the new screen', async () => {
  const libraries = await getLibraries(session);
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, libraryIdFor(libraries, 'tvshows'), 'Shows');
  await hardRelaunch(); // never plain relaunch: only hardRelaunch confirms the cold start
  await assertSeedTookEffect(expectedServer, 'cast over an item confirm', { landing });
  await navSeriesDetails({ libraries });

  // The Series watched button opens a confirm dialog (see dialogs.spec.js).
  await focusDetailButton('watchedButton');
  await press(ecp.Key.Ok);
  await waitFocusInside('#jrDialog', { label: 'confirm dialog focused', timeout: 10000 });

  await castHeroAndSettle('cast over an item confirm');
  await waitDialogClosed('the covered Series confirm ended', { timeout: 10000 });
  await waitFocusInside('#buttons', { label: 'focus on the cast screen', timeout: 8000 });
  expect(await getActiveVal('itemId'), 'on the cast movie').toBe(heroId);
}, 150000);
