/**
 * A screen that loads its own data keeps the remote while it loads (ADR 0053). Opening a
 * details screen and opening the Live TV guide each wait on the server under the scene
 * spinner, and that wait is the screen's own (`screenWaits`, ADR 0044):
 *  - the screen stays on show and takes keys, so Back leaves it mid-load, and the spinner
 *    goes with it;
 *  - keys pressed on a details screen still waiting for its item do no harm, and the item
 *    lands once it arrives.
 * Both once blocked the remote and hid the screen until the first answer. Each case slows the
 * screen's one request through the request-failure switch (`rtaFailRequests`, `slow`).
 *
 * The guide cases need a server with a Live TV library, which the demo server does not have,
 * so they skip there. Run them against a local server with a tuner and a guide
 * (RTA_SERVER_URL / RTA_SERVER_USER / RTA_SERVER_PASS).
 */
import { beforeAll, expect, it } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryByType, navLibraryGrid, pressGridTile } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  getActiveVals,
  getGlobalVal,
  getVal,
  press,
  waitFor,
  waitHome,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// The details screen's item fetch (ItemDetailsMetaData) and the guide's channel page
// (LoadChannelsTask): the one request each screen waits on.
const DETAILS_READ = 'itemMetaData';
const GUIDE_READ = 'liveTvChannels';
// Far longer than any case waits, so only leaving the screen can take its spinner down.
const HELD_MS = 90000;
// Long enough to press keys into the screen while it waits, short enough to wait out.
const BRIEF_MS = 8000;

let session;
let libraries;
let liveTvId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
  liveTvId = libraryIdFor(libraries, 'livetv');
});

async function freshApp(label, landing = null) {
  const expectedServer = await seedHome(session, LOCALE);
  const seeded = landing
    ? await seedLibraryLanding(session, landing.libraryId, landing.view)
    : null;
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label, { landing: seeded });
}

function waitHeld(count, label) {
  return waitFor('rtaHeldRequests', (v) => v === count, {
    read: getGlobalVal,
    timeout: 10000,
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

function waitSpinner(visible, label) {
  return waitFor('#spinner.visible', (v) => v === visible, {
    timeout: 5000,
    interval: 250,
    label,
  });
}

/** The spinner is up over `subtype`, which is on show and takes keys. */
async function expectLiveUnderSpinner(subtype) {
  const [view, visible] = await getActiveVals(['subtype()', 'visible']);
  expect(view).toBe(subtype);
  expect(visible, 'the screen stays on show while it loads').toBe(true);
  expect(await getVal('#spinner.visible'), 'the spinner is up while it loads').toBe(true);
  expect(await getVal('isRemoteDisabled'), 'the remote is live while it loads').toBe(false);
}

/** Open the first movie's details with its item fetch held for `ms`. */
async function openDetailsHeld(ms) {
  await freshApp('screen-load-waits details');
  await navLibraryGrid({ libraries });
  await failRequests([{ prefix: DETAILS_READ, kind: 'slow', ms, times: 1 }]);
  await pressGridTile(0);
  await waitActive('ItemDetails', 'details opened');
  await waitHeld(1, 'the details item fetch is on a pool slot');
}

it('details: Back mid-load leaves the screen, and the spinner goes with it', async () => {
  await openDetailsHeld(HELD_MS);
  await expectLiveUnderSpinner('ItemDetails');

  await press(ecp.Key.Back);
  await waitActive('BaseGridView', 'back on the grid');
  await waitSpinner(false, 'no spinner over the grid once details closed');
  expect(await getVal('isRemoteDisabled')).toBe(false);
});

it('details: keys pressed while it loads do no harm, and the item lands', async () => {
  await openDetailsHeld(BRIEF_MS);
  await expectLiveUnderSpinner('ItemDetails');

  await press(ecp.Key.Down);
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'the details title once the item arrives',
    timeout: BRIEF_MS + 10000,
  });
  await waitSpinner(false, 'the spinner gone with the item');
  expect(await getActiveVal('subtype()'), 'still on details').toBe('ItemDetails');
});

/** Open the Live TV library on its guide view with the first channel page held for `ms`. */
async function openGuideHeld(ms) {
  await freshApp('screen-load-waits guide', { libraryId: liveTvId, view: 'tvguide' });
  await failRequests([{ prefix: GUIDE_READ, kind: 'slow', ms, times: 1 }]);
  await navLibraryByType('livetv', liveTvId);
  await waitHeld(1, 'the first channel page is on a pool slot');
}

it('guide: Back mid-load leaves the library, and the spinner goes with it', async (testCtx) => {
  if (!liveTvId) testCtx.skip('server has no Live TV library');
  await openGuideHeld(HELD_MS);
  await expectLiveUnderSpinner('BaseGridView');

  await press(ecp.Key.Back);
  await waitHome();
  await waitSpinner(false, 'no spinner over Home once the guide closed');
  expect(await getVal('isRemoteDisabled')).toBe(false);
});

it('guide: the channels land and take the spinner with them', async (testCtx) => {
  if (!liveTvId) testCtx.skip('server has no Live TV library');
  await openGuideHeld(BRIEF_MS);
  await expectLiveUnderSpinner('BaseGridView');

  await waitFor('#scheduleGrid.content.getChildCount()', (n) => n > 0, {
    read: getActiveVal,
    label: 'the guide channels once the page arrives',
    timeout: BRIEF_MS + 10000,
  });
  await waitSpinner(false, 'the spinner gone with the channels');
});
