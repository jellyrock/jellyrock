/**
 * Where the app lands after a manual sign-in, and what a signed-out moment may leave behind
 * for it to act on.
 *
 * ## The bug this nets
 *
 * Signing in by hand landed on Search instead of Home. After sign-in, `replayAfterLogin`
 * walked to whatever path the auth guard had saved, and the guard saved any guarded path
 * requested while nobody was signed in. Nothing a person can do while signed out requests
 * one, so the saved path was only ever a stray: here, a request made from the sign-in screen
 * (`JRScene.routerNavigate`, the seam main-thread callers use), and a remote-control command
 * that drains on the main thread after `SignOut` has stopped the receiver (`STOP` is not a
 * join, so a command already queued on the port still runs). Each was replayed as Home,
 * then the stray.
 *
 * ## What must keep working
 *
 * A deep link that arrives while signed out is the one thing a signed-out moment may hand to
 * the sign-in. It has its own stash (`AuthManager.stashedDeepLink`), and the companion
 * plugin's cold wake (ADR 0023) rides it: an ECP `/launch` with a `contentId`, into a closed
 * app or into one sitting on the sign-in screen. Both must still open their item once the
 * user signs in.
 *
 * Every case signs in through the user picker's Manual Login, with the username prefilled
 * from the registry (the demo user has no password), so the path under test is the one the
 * bug was reported on and no keyboard dialog is involved.
 */
import { beforeAll, expect, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero } from '../lib/jellyfin.js';
import { seedUserSelect, assertSeedTookEffect, GLOBAL } from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import {
  waitFor,
  waitFocused,
  waitFocusInside,
  walkFocusInto,
  walkFocusUntil,
  waitHome,
  waitToast,
  getActiveVal,
  press,
  sleep,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// How long a landing on Home must hold before it counts. The replay this spec nets left Home
// about 300 ms after arriving (measured 2026-10-22 on a Stick 4K), so this is a generous
// ceiling on that, not a tuned value.
const LANDING_HOLD_MS = 3000;
// locale/custom/en_US.json MessageDeepLinkAfterSignIn.
const DEEP_LINK_DEFERRED = 'Sign in to open your content.';

let session;
let heroId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  heroId = (await getHero(session)).id;
  if (!heroId)
    throw new Error('sign-in-landing setup: could not resolve a movie on the demo server');
});

/** Seed the signed-out user picker with the username prefilled for Manual Login, and restart cold. */
async function startSignedOut({ launchParams } = {}) {
  const expectedServer = await seedUserSelect(session, LOCALE);
  await odc.writeRegistry({ values: { [GLOBAL]: { username: RTA_CONFIG.server.username } } });
  await hardRelaunch({ params: launchParams });
  await assertSeedTookEffect(expectedServer, 'sign-in-landing');
}

/** From the user picker, take Manual Login and wait for the sign-in screen. */
async function openManualLogin() {
  await waitFor('subtype()', (v) => v === 'UserSelect', {
    read: getActiveVal,
    label: 'the user picker after a signed-out start',
    timeout: 30000,
  });
  await waitFocusInside('#buttons', {
    label: 'user picker buttons focused',
    timeout: 8000,
    interval: 300,
    action: walkFocusInto(ecp.Key.Down, '#buttons'),
  });
  // Quick Connect sits left of Manual Login only when the server enables it, so walk to the
  // button by id rather than by index.
  const onManualLogin = (f) => f?.node?.id === 'manualLoginButton';
  await waitFocused(onManualLogin, {
    label: 'Manual Login focused',
    timeout: 8000,
    interval: 400,
    action: walkFocusUntil(ecp.Key.Right, onManualLogin),
  });
  await press(ecp.Key.Ok);
  await waitForSignInScreen();
}

async function waitForSignInScreen() {
  await waitFor('subtype()', (v) => v === 'LoginScene', {
    read: getActiveVal,
    label: 'the sign-in screen',
    timeout: 15000,
  });
}

/** On the sign-in screen with the username prefilled: walk to Submit and press it once. */
async function submitSignIn() {
  await waitFocusInside('#buttons', {
    label: 'Submit focused',
    timeout: 10000,
    interval: 400,
    action: walkFocusInto(ecp.Key.Down, '#buttons'),
  });
  await press(ecp.Key.Ok);
}

/** Home, and still Home once the window a replay would have used has passed. */
async function expectLandingHoldsOnHome() {
  await waitHome();
  await sleep(LANDING_HOLD_MS);
  expect(await getActiveVal('subtype()')).toBe('Home');
}

/** Hand the main thread a remote-control command, exactly as the receiver marshals one. */
async function deliverRemoteCommand(command) {
  await odc.setValue({
    base: 'global',
    keyPath: 'remoteControlTask.dispatchCommand',
    value: command,
  });
}

it('manual sign-in lands on Home', async () => {
  await startSignedOut();
  await openManualLogin();
  await submitSignIn();
  await expectLandingHoldsOnHome();
}, 180000);

it('a guarded route requested while signed out is not opened after sign-in', async () => {
  await startSignedOut();
  await openManualLogin();
  // The guard sends a signed-out request for a guarded route back to sign-in.
  await odc.callFunc({
    base: 'scene',
    keyPath: '',
    funcName: 'routerNavigate',
    funcParams: ['/search'],
  });
  await waitForSignInScreen();
  await submitSignIn();
  await expectLandingHoldsOnHome();
}, 180000);

it('a remote-control route command arriving while signed out is ignored', async () => {
  await startSignedOut();
  await openManualLogin();
  await deliverRemoteCommand({ kind: 'route', route: '/search' });
  await waitForSignInScreen();
  await submitSignIn();
  await expectLandingHoldsOnHome();
}, 180000);

it('a remote-control DisplayContent arriving while signed out is ignored', async () => {
  await startSignedOut();
  await openManualLogin();
  await deliverRemoteCommand({ kind: 'navigate', itemId: heroId, itemType: 'Movie' });
  await waitForSignInScreen();
  await submitSignIn();
  await expectLandingHoldsOnHome();
}, 180000);

it('a cold launch with a contentId while signed out opens the item after sign-in', async () => {
  await startSignedOut({ launchParams: { contentId: heroId, mediaType: 'movie' } });
  await openManualLogin();
  await submitSignIn();
  await waitFor('itemId', (id) => id === heroId, {
    read: getActiveVal,
    label: 'cold-launch deep link -> ItemDetails(itemId) after sign-in',
    timeout: 30000,
  });
}, 180000);

it('a launch with a contentId into the open sign-in screen opens the item after sign-in', async () => {
  await startSignedOut();
  await openManualLogin();
  // The companion plugin's wake when the app is open but signed out: it has no live session
  // to see, so it sends the same /launch it sends a closed app.
  await ecp.sendLaunchChannel({
    channelId: 'dev',
    params: { contentId: heroId, mediaType: 'movie' },
    verifyLaunch: false,
  });
  await waitToast(DEEP_LINK_DEFERRED, { label: 'deep link deferred until sign-in' });
  // Roku may hand the link to the running app, which keeps the sign-in screen, or restart the
  // app, which starts again on the user picker (followup ecp-launch-restarts-running-app in
  // docs/progress.md). The item must open after sign-in either way.
  const screen = await waitFor('subtype()', (v) => v === 'LoginScene' || v === 'UserSelect', {
    read: getActiveVal,
    label: 'the sign-in screen or, after a restart, the user picker',
    timeout: 30000,
  });
  if (screen === 'UserSelect') await openManualLogin();
  await submitSignIn();
  await waitFor('itemId', (id) => id === heroId, {
    read: getActiveVal,
    label: 'deep link into the open sign-in screen -> ItemDetails(itemId) after sign-in',
    timeout: 30000,
  });
}, 180000);
