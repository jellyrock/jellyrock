/**
 * A playback start on a server that is slow to answer, driven through the request-failure
 * switch's `slow` rule (`rtaFailRequests`). Every start opens a playback-start app wait
 * (`QueueManager.beginPlaybackStart`), a Promise that the player ends when it holds a stream,
 * and that anything else ending the start fails — so the spinner follows the start rather than
 * whichever stop ran last:
 *
 *  - Back mid-start from details or from a grid takes the spinner with it, and leaves the
 *    remote live;
 *  - before any player exists the start holds the remote (AppWaitHost): Back cancels it and
 *    shows the screen Play was pressed on again, as Back from the player does, so a Series
 *    "Play all" never begins; and a second press is ignored rather than starting a second
 *    launch;
 *  - a slow start says it is still loading;
 *  - Play on a library the server is slow to list still plays it, and Back while it waits
 *    frees the request's pool slot (#811).
 *
 * The grid and "Play all" cases were each measured wrong on an Ultra (2026-09-26) before
 * playback-start waits: the spinner stayed up over the grid and Home 35 s after Back, with the
 * scene holding the remote disabled; and "Play all" started the series 8 s after the viewer had
 * backed out to the grid. Before the start held the remote, Back from a start with no player
 * yet left the screen Play was pressed on, one step further back than Back from the player.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import {
  focusDetailButton,
  navLibraryGrid,
  openLibraryByType,
  navSeriesDetails,
  navTvLibrary,
  startPlayback,
} from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import {
  focusIsInside,
  getActiveVal,
  getActiveVals,
  getGlobalVal,
  getVal,
  press,
  sleep,
  stopPlayback,
  waitFocusInside,
  waitFocused,
  waitFor,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const STILL_LOADING = 'Still loading…';
// Under a default-limit request's own wait (timeouts.API_WAIT_MS, 12 s), so the rule is
// honored exactly and the answer still arrives: long enough to press Back into, short enough
// that a start nobody stopped would reach its player inside the spec.
const HOLD_MS = 8000;
// Play on a whole library asks the server for its items at random, which a large library on a
// slow server takes past an ordinary request's limit (#811). Past that request's wait
// (timeouts.API_WAIT_MS, 12 s), inside the library query's own.
const SLOW_LIBRARY_MS = 20000;
// Far longer than the spec waits for the slot to come back, so only a stop can free it.
const HELD_LIBRARY_MS = 90000;

let ctx;

beforeAll(async () => {
  const session = await authenticate(RTA_CONFIG.server);
  const libraries = await getLibraries(session);
  const hero = await getHero(session, libraryIdFor(libraries, 'movies'));
  ctx = { heroIndex: hero.index, heroId: hero.id, session, libraries };
});

async function freshApp() {
  const expectedServer = await seedHome(ctx.session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'playback-start');
}

function waitHeld(count, label, timeout = 10000) {
  return waitFor('rtaHeldRequests', (v) => v === count, {
    read: getGlobalVal,
    timeout,
    interval: 250,
    label,
  });
}

function waitActive(subtype, label) {
  return waitFor('subtype()', (v) => v === subtype, {
    read: getActiveVal,
    timeout: 15000,
    interval: 250,
    label,
  });
}

/**
 * Whether the active screen can be seen: neither hidden (`visible`) nor faded out (`opacity`).
 * Both, because what matters is what the viewer sees, not which field did the hiding.
 */
async function activeScreenShows() {
  const [visible, opacity] = await getActiveVals(['visible', 'opacity']);
  return visible === true && opacity === 1;
}

/** The spinner is gone, the scene does not hold the remote, and the screen shows again. */
async function expectStartEndedOn(label) {
  await waitFor('#spinner.visible', (v) => v === false, {
    timeout: 3000,
    interval: 250,
    label: `no spinner over ${label} once Back left the start`,
  });
  expect(await getVal('isRemoteDisabled'), `remote live on ${label}`).toBe(false);
  expect(await activeScreenShows(), `${label} shown again`).toBe(true);
}

it('Back mid-start from details ends the start', async () => {
  await freshApp();
  await failRequests([{ prefix: 'playbackInfo', kind: 'slow', ms: HOLD_MS, times: 1 }]);
  await startPlayback(ctx);
  await waitHeld(1, 'the playback info request is on a pool slot');
  expect(await getVal('#spinner.visible'), 'spinner up while the start waits').toBe(true);
  expect(await getVal('isRemoteDisabled'), 'a start does not lock the whole remote').toBe(false);

  await press(ecp.Key.Back);
  await waitActive('ItemDetails', 'back on details');
  await expectStartEndedOn('details');
});

it('Back mid-start from a grid ends the start', async () => {
  await freshApp();
  await navLibraryGrid(ctx);
  await waitFocusInside('#itemGrid', { label: 'movie grid focused', timeout: 15000 });
  await failRequests([{ prefix: 'playbackInfo', kind: 'slow', ms: HOLD_MS, times: 1 }]);
  await press(ecp.Key.Play);
  await waitHeld(1, 'the playback info request is on a pool slot');
  expect(await getVal('#spinner.visible'), 'spinner up while the start waits').toBe(true);

  await press(ecp.Key.Back);
  await waitActive('BaseGridView', 'back on the grid');
  await expectStartEndedOn('the grid');
});

/** The start holds the remote: keys go to AppWaitHost, not to the screen it hides. */
function waitStartHoldsRemote() {
  return waitFocusInside('#appWaitHost', {
    label: 'the start holds the remote',
    timeout: 5000,
  });
}

async function startSeriesPlayAll(rule) {
  await freshApp();
  await navSeriesDetails(ctx);
  await focusDetailButton('playButton');
  await waitFocusInside('#buttons', { label: 'Play all focused', timeout: 8000 });
  await failRequests([rule]);
  await press(ecp.Key.Ok);
  await waitHeld(1, "the series' episode list is on a pool slot");
  expect(await getVal('#spinner.visible'), 'spinner up while the episodes load').toBe(true);
  expect(await activeScreenShows(), 'details hidden behind the backdrop, as before').toBe(false);
  await waitStartHoldsRemote();
}

it('Back during a Series "Play all" cancels it and stays on the series', async () => {
  await startSeriesPlayAll({ prefix: 'qp_playAllSeries', kind: 'slow', ms: HOLD_MS, times: 1 });

  await press(ecp.Key.Back);
  await expectStartEndedOn('the series details');
  expect(await getActiveVal('subtype()'), 'still on the series details').toBe('ItemDetails');
  await waitFocusInside('#buttons', { label: 'focus back on the buttons', timeout: 5000 });

  await waitHeld(0, 'the episode list answered', HOLD_MS + 5000);
  // Timer window, proving a NON-EVENT: before this fix the answer started the series a moment
  // after it landed. No app field reports that a launch did NOT happen, so this out-waits it.
  await sleep(3000);
  expect(await getActiveVal('subtype()'), 'still on the series details, nothing playing').toBe(
    'ItemDetails',
  );
});

it('Back mid-start from the TV grid cancels it and stays on the grid', async () => {
  await freshApp();
  await navTvLibrary(ctx);
  await waitFocusInside('#itemGrid', { label: 'TV grid focused', timeout: 15000 });
  // A series tile expands into its queue on a QuickPlayTask, whose first request is the
  // series' resume lookup: held, no player exists yet.
  await failRequests([{ prefix: 'qp_seriesResume', kind: 'slow', ms: HOLD_MS, times: 1 }]);
  await press(ecp.Key.Play);
  await waitHeld(1, "the series' resume lookup is on a pool slot");
  expect(await getVal('#spinner.visible'), 'spinner up while the series expands').toBe(true);
  await waitStartHoldsRemote();

  await press(ecp.Key.Back);
  await expectStartEndedOn('the TV grid');
  expect(await getActiveVal('subtype()'), 'still on the TV grid').toBe('BaseGridView');
  await waitFocusInside('#itemGrid', { label: 'focus back in the grid', timeout: 5000 });
});

it('a second press while a start waits is ignored', async () => {
  // Held twice: a second launch would hold a second request while the first still waits.
  await startSeriesPlayAll({ prefix: 'qp_playAllSeries', kind: 'slow', ms: HOLD_MS, times: 2 });

  await press(ecp.Key.Ok);
  let mostHeld = 0;
  await waitFor('rtaHeldRequests', (v) => v === 0, {
    read: async (keyPath) => {
      const held = await getGlobalVal(keyPath);
      mostHeld = Math.max(mostHeld, held ?? 0);
      return held;
    },
    timeout: HOLD_MS + 5000,
    interval: 250,
    label: 'the one episode-list request answered',
  });
  expect(mostHeld, 'one launch: the second press started nothing').toBe(1);

  await waitActive('PlayerHostView', 'the series plays once its episode list lands');
  await waitFor('#spinner.visible', (v) => v === false, {
    timeout: 20000,
    interval: 250,
    label: 'the spinner gone once the stream loads',
  });
  const focused = await waitFocused((f) => !focusIsInside(f.keyPath, '#appWaitHost'), {
    timeout: 5000,
    interval: 250,
    label: 'the player took the remote back',
  });
  expect(focused, 'focus left the start').toBeTruthy();
  await stopPlayback();
});

it('a slow start says it is still loading, then plays', async () => {
  await freshApp();
  // Past the first stage (loadingStages.STILL_LOADING_MS, 8 s), under the request's own limit.
  await failRequests([{ prefix: 'playbackInfo', kind: 'slow', ms: 11000, times: 1 }]);
  await startPlayback(ctx);
  await waitFor('#loadingStageText.text', (v) => v === STILL_LOADING, {
    timeout: 12000,
    interval: 500,
    label: '"Still loading" under the spinner',
  });
  await waitFor('#spinner.visible', (v) => v === false, {
    timeout: 15000,
    interval: 250,
    label: 'the spinner gone once the stream loads',
  });
  expect(await getActiveVal('subtype()'), 'the player took the start').toBe('PlayerHostView');
  await stopPlayback();
});

/** Home -> Play on the Movies library tile: quick play, which lists the library first. */
function quickPlayMoviesLibrary() {
  return openLibraryByType('movies', libraryIdFor(ctx.libraries, 'movies'), {
    key: ecp.Key.Play,
  });
}

it('Play on a library the server is slow to list still plays it', async () => {
  await freshApp();
  await failRequests([
    { prefix: 'qp_videoContainerMovies', kind: 'slow', ms: SLOW_LIBRARY_MS, times: 1 },
  ]);
  await quickPlayMoviesLibrary();
  await waitHeld(1, "the library's items are on a pool slot");
  await waitFor('#loadingStageText.text', (v) => v === STILL_LOADING, {
    timeout: 12000,
    interval: 500,
    label: '"Still loading" under the spinner',
  });
  await waitFor('subtype()', (v) => v === 'PlayerHostView', {
    read: getActiveVal,
    timeout: SLOW_LIBRARY_MS + 15000,
    interval: 500,
    label: 'the library plays once its items land',
  });
  await waitFor('#spinner.visible', (v) => v === false, {
    timeout: 20000,
    interval: 250,
    label: 'the spinner gone once the stream loads',
  });
  await stopPlayback();
});

it('Back while Play on a library waits on the server frees its pool slot', async () => {
  await freshApp();
  await failRequests([
    { prefix: 'qp_videoContainerMovies', kind: 'slow', ms: HELD_LIBRARY_MS, times: 1 },
  ]);
  await quickPlayMoviesLibrary();
  await waitHeld(1, "the library's items are on a pool slot");
  await waitStartHoldsRemote();

  await press(ecp.Key.Back);
  // Given back long before the hold would have let it go.
  await waitHeld(0, 'the slot was given back on Back');
  await expectStartEndedOn('Home');
});
