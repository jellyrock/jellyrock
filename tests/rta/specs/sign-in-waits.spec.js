/**
 * A sign-in step the viewer pressed is a wait Back can cancel (ADR 0053).
 *
 * Each step (a server connect, a user pick, a password sign-in) opens a session app wait at the
 * press (`signInStep.press`). It hides the screen and holds the keys in `AppWaitHost`, so a
 * second OK reaches no button, and Back cancels it: the screen comes back with its focus, and
 * `loginRouter` drops the answer when it arrives.
 *
 * Sign-in requests bypass the API pool (a synchronous `roUrlTransfer` on the main thread), so
 * `rtaFailRequests` cannot slow them. `rtaSignInHoldMs` holds a password sign-in and a server
 * connect on the main thread instead, as a slow server would, and `rtaSignInCount` counts the
 * password sign-ins sent (`rtaSignInHold`, `getToken` in `source/api/userAuth.bs`).
 *
 * Measured 2026-10-22 on a Stick 4K, before this: extra OK presses on Submit during the
 * sign-in spinner ran the whole sign-in again, and Back did nothing until a slow wait ended.
 */
import { beforeAll, expect, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import {
  seedHomeWithSavedServers,
  seedServerSelect,
  seedUserSelect,
  assertSeedTookEffect,
  GLOBAL,
} from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import { openManualLogin, submitSignIn } from '../lib/nav.js';
import {
  getActiveVal,
  getActiveVals,
  getGlobalVal,
  press,
  sleep,
  waitFor,
  waitFocused,
  waitFocusInHomeContent,
  waitFocusInside,
  waitHome,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// How long each sign-in step is held: long enough to press into, short enough for a spec.
const HOLD_MS = 6000;
// Past the hold, so the held answer has arrived and been dropped, or not.
const AFTER_HOLD_MS = HOLD_MS + 3000;

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

/**
 * The user picker, signed out, with no saved token for the demo user and its name prefilled.
 * `password: null` deletes a prefilled password another spec may have left (the demo user has
 * none; `sign-in-landing.spec.js` seeds a wrong one).
 */
async function startOnUserPicker() {
  const expectedServer = await seedUserSelect(session, LOCALE);
  await odc.writeRegistry({
    values: {
      [GLOBAL]: { username: RTA_CONFIG.server.username, password: null },
      [session.userId]: { authToken: null },
    },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'sign-in-waits');
  await waitFor('subtype()', (v) => v === 'UserSelect', {
    read: getActiveVal,
    label: 'the user picker after a signed-out start',
    timeout: 30000,
  });
}

/** Hold each sign-in step for `ms` from now on. Set after the relaunch: it lives in app memory. */
function holdSignIn(ms) {
  return odc.setValue({ base: 'global', keyPath: 'rtaSignInHoldMs', value: ms });
}

/** The step's wait took the keys: AppWaitHost holds the focus. */
function waitHeld(label) {
  return waitFocused((f) => f?.node?.subtype === 'AppWaitHost', {
    label,
    timeout: 8000,
    interval: 250,
  });
}

/** The active screen is `subtype` and can be seen again: neither hidden nor faded out. */
async function expectShownOn(subtype) {
  expect(await getActiveVal('subtype()')).toBe(subtype);
  const [visible, opacity] = await getActiveVals(['visible', 'opacity']);
  expect(visible === true && opacity === 1, `${subtype} shown again`).toBe(true);
  expect(await getGlobalVal('user.isLoaded'), 'still signed out').not.toBe(true);
}

it('extra OK presses during a sign-in send one sign-in, and it lands on Home', async () => {
  await startOnUserPicker();
  await openManualLogin();
  await holdSignIn(3000);
  await submitSignIn();
  await waitHeld('the sign-in holds the keys');
  // The presses the bug report describes: OK again while the spinner is up. Any press while
  // the keys are held is the case; waitHeld proved they are.
  await press(ecp.Key.Ok);
  await press(ecp.Key.Ok);
  await waitHome();
  expect(await getGlobalVal('rtaSignInCount')).toBe(1);
}, 180000);

it('Back during a password sign-in returns to Submit, and the late answer is dropped', async () => {
  await startOnUserPicker();
  await openManualLogin();
  await holdSignIn(HOLD_MS);
  await submitSignIn();
  await waitHeld('the sign-in holds the keys');

  await press(ecp.Key.Back);
  await waitFocusInside('#buttons', {
    label: 'focus back on Submit after Back',
    timeout: 5000,
    interval: 250,
  });
  await expectShownOn('LoginScene');
  expect(await getActiveVal('alert'), 'a cancel is not a failure').toBe('');

  // Timer window: the held answer arrives, and nothing may act on it.
  await sleep(AFTER_HOLD_MS);
  await expectShownOn('LoginScene');
  expect(await getGlobalVal('rtaSignInCount')).toBe(1);
}, 180000);

it('Back during a user pick returns to the picker, and the late answer is dropped', async () => {
  await startOnUserPicker();
  await waitFocusInside('#userRow', { label: 'a user tile focused', timeout: 8000, interval: 300 });
  await holdSignIn(HOLD_MS);
  await press(ecp.Key.Ok);
  await waitHeld('the user pick holds the keys');

  await press(ecp.Key.Back);
  await waitFocusInside('#userRow', {
    label: 'focus back on the user tile after Back',
    timeout: 5000,
    interval: 250,
  });
  await expectShownOn('UserSelect');

  await sleep(AFTER_HOLD_MS);
  await expectShownOn('UserSelect');
}, 180000);

it('Back during a server connect returns to Submit, and the late answer is dropped', async () => {
  const expectedServer = await seedServerSelect(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'sign-in-waits');
  await waitFor('subtype()', (v) => v === 'SetServerScreen', {
    read: getActiveVal,
    label: 'the server picker',
    timeout: 30000,
  });
  await waitFocusInside('#serverPicker', {
    label: 'the saved server focused',
    timeout: 15000,
    interval: 300,
  });
  // OK on the saved server fills the address and moves to Submit.
  await press(ecp.Key.Ok);
  await waitFocusInside('#buttons', { label: 'Submit focused', timeout: 5000, interval: 250 });
  await holdSignIn(HOLD_MS);
  await press(ecp.Key.Ok);
  await waitHeld('the connect holds the keys');

  await press(ecp.Key.Back);
  await waitFocusInside('#buttons', {
    label: 'focus back on Submit after Back',
    timeout: 5000,
    interval: 250,
  });
  await expectShownOn('SetServerScreen');

  await sleep(AFTER_HOLD_MS);
  await expectShownOn('SetServerScreen');
}, 180000);

// A cast that names another saved server asks to switch; the switch then probes that server
// before signing out of this one (`replayRoute.performServerSwitch`). The probe is the step's
// wait: Back cancels it, the viewer stays signed in where they were, and the probe's answer is
// dropped. The second server is a TEST-NET address (RFC 5737), never routed, so the probe waits
// out its own 8 s limit (`ServerReachableTask`) with no hook.
it('Back while a server switch probes the other server keeps the viewer where they were', async () => {
  const unreachable = {
    serverName: 'RTA unreachable',
    serverId: '00000000000000000000000000000001',
    serverUrl: 'http://192.0.2.1:8096',
  };
  const expectedServer = await seedHomeWithSavedServers(session, [session, unreachable], LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'sign-in-waits');
  await waitHome();
  const libraries = await getLibraries(session);
  const hero = await getHero(session, libraryIdFor(libraries, 'movies'));

  await ecp.sendInput({ params: { contentId: `id=${hero.id}|server=${unreachable.serverId}` } });
  // showConfirmDialog builds [Cancel, Switch] with Cancel focused: one Right reaches Switch.
  await waitFocused((f) => f?.node?.text === 'Cancel', {
    label: 'the switch prompt, Cancel focused',
    timeout: 15000,
    interval: 300,
  });
  await press(ecp.Key.Right);
  await waitFocused((f) => f?.node?.text === 'Switch', { label: 'Switch focused', timeout: 5000 });
  await press(ecp.Key.Ok);
  await waitHeld('the switch holds the keys while it probes');

  await press(ecp.Key.Back);
  await waitFocusInHomeContent({ label: 'focus back on Home after Back', timeout: 8000 });
  expect(await getActiveVal('subtype()')).toBe('Home');

  // Timer window: the probe gives up, and nothing may act on it.
  await sleep(11000);
  expect(await getActiveVal('subtype()')).toBe('Home');
  expect(await getGlobalVal('server.serverUrl')).toBe(session.serverUrl);
  expect(await getGlobalVal('user.isLoaded'), 'still signed in').toBe(true);
}, 180000);
