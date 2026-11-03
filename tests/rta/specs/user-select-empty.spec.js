/**
 * A server that lists no users, with none saved on this Roku, still lands on the user picker.
 *
 * Quick Connect lives on the user picker, not on the sign-in screen. The router used to send
 * a server with no users to pick straight to the sign-in screen, so Quick Connect was never
 * offered. Now the picker always shows: a message where the users go, and focus on the first
 * button.
 *
 * The demo server always lists users, so `rtaEmptyUserList` (`buildPublicUserList`, RTA builds
 * only) empties the list. It is set after the relaunch, on the server picker, so the case runs
 * the path the bug was reported on: a server submitted from the server picker.
 */
import { beforeAll, expect, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, quickConnectEnabled } from '../lib/jellyfin.js';
import { seedServerSelect, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import { failRequests } from '../lib/failRequests.js';
import { waitForSignInScreen } from '../lib/nav.js';
import {
  getActiveVal,
  getActiveVals,
  press,
  sleep,
  waitFor,
  waitFocused,
  waitFocusInside,
  walkFocusUntil,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// locale/custom/en_US.json ButtonSignIn and MessageNoUsersToShow.
const HEADING = 'Sign In';
const EMPTY_MESSAGE = 'No users to show. Choose how to sign in below.';
// How long the picker must hold after a refused stray before it counts. A redirect would
// land within a navigation, far under this; a generous ceiling, not a tuned value.
const STRAY_HOLD_MS = 3000;

let session;
let qcAvailable;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  qcAvailable = await quickConnectEnabled(session);
});

/** The focused node's id is `id`. */
const focusedId = (id) => (f) => f?.node?.id === id;

/**
 * Submit the saved demo server from the server picker with the user list emptied, and wait
 * for the user picker. `beforeSubmit` runs on the server picker, after the relaunch, for rules
 * that live in app memory.
 */
async function submitServerWithNoUsers(beforeSubmit = async () => {}) {
  const expectedServer = await seedServerSelect(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'user-select-empty');
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
  await odc.setValue({ base: 'global', keyPath: 'rtaEmptyUserList', value: true });
  await beforeSubmit();
  await press(ecp.Key.Ok);
  await waitFor('subtype()', (v) => v === 'UserSelect', {
    read: getActiveVal,
    label: 'the user picker, not the sign-in screen',
    timeout: 30000,
  });
}

it('a server with no users lands on the user picker with Quick Connect focused', async (testCtx) => {
  if (!qcAvailable) testCtx.skip('server reports Quick Connect disabled');
  await submitServerWithNoUsers();

  await waitFocused(focusedId('quickConnect'), {
    label: 'Quick Connect focused on arrival',
    timeout: 10000,
    interval: 300,
  });
  const [heading, message, messageShown, rowShown] = await getActiveVals([
    '#selectUserLabel.text',
    '#emptyMessage.text',
    '#emptyMessage.visible',
    '#userRow.visible',
  ]);
  expect(heading).toBe(HEADING);
  expect(message).toBe(EMPTY_MESSAGE);
  expect(messageShown).toBe(true);
  expect(rowShown).toBe(false);

  // A guarded route requested while signed out (a stray) is refused: the viewer stays on the
  // picker, with Quick Connect, rather than being sent to the sign-in screen.
  await odc.callFunc({
    base: 'scene',
    keyPath: '',
    funcName: 'routerNavigate',
    funcParams: ['/search'],
  });
  await sleep(STRAY_HOLD_MS);
  expect(await getActiveVal('subtype()')).toBe('UserSelect');
  await waitFocused(focusedId('quickConnect'), {
    label: 'Quick Connect still focused after the refused stray',
    timeout: 5000,
    interval: 300,
  });

  // Up has nothing to go to. Had it left the buttons for the empty row, Right would move
  // inside the row and never reach Manual Login.
  await press(ecp.Key.Up);
  await waitFocused(focusedId('manualLoginButton'), {
    label: 'Manual Login reached with Right after Up',
    timeout: 8000,
    interval: 400,
    action: walkFocusUntil(ecp.Key.Right, focusedId('manualLoginButton')),
  });

  // Back from sign-in returns to the picker, where Quick Connect is; it no longer forgets
  // the server.
  await press(ecp.Key.Ok);
  await waitForSignInScreen();
  await press(ecp.Key.Back);
  await waitFor('subtype()', (v) => v === 'UserSelect', {
    read: getActiveVal,
    label: 'Back from sign-in returns to the user picker',
    timeout: 15000,
  });

  // Back from the picker changes server.
  await press(ecp.Key.Back);
  await waitFor('subtype()', (v) => v === 'SetServerScreen', {
    read: getActiveVal,
    label: 'Back from the user picker returns to the server picker',
    timeout: 15000,
  });
}, 180000);

// The availability probe answers after the picker opens, while Quick Connect holds focus.
// Removing the focused button must hand focus to the one left, or the remote does nothing.
it('Quick Connect turned off moves focus to Manual Login, not to nothing', async () => {
  // `empty` answers the probe ok with no body, which UserSelect reads as disabled.
  await submitServerWithNoUsers(() =>
    failRequests([{ prefix: 'quickConnectEnabled', kind: 'empty' }]),
  );

  await waitFocused(focusedId('manualLoginButton'), {
    label: 'Manual Login focused once Quick Connect is removed',
    timeout: 10000,
    interval: 300,
  });
  expect(await getActiveVal('#quickConnect.id')).toBeUndefined();
  // Focus is usable: OK opens sign-in.
  await press(ecp.Key.Ok);
  await waitForSignInScreen();
}, 180000);
