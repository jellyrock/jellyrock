/**
 * Quick Connect, end to end on a real device — the first functional coverage this
 * sign-in path has ever had.
 *
 * ## Why it was untestable, and what changed
 *
 * Quick Connect needs a SECOND device: the TV shows a code, a human approves it
 * somewhere else, and only then does the TV get a token. There is no second
 * device in this harness, which is why the flow shipped for years verified only
 * by hand. `POST /QuickConnect/Authorize?code=` is that human — and the suite
 * already authenticates against the fixture server, so it can be them. The whole
 * round trip (initiate -> authorize -> connect reports Authenticated -> exchange
 * returns an AccessToken) was probed against Jellyfin 10.11.11 before this file
 * was written, per the tests/rta/CLAUDE.md rule about checking a
 * capability-dependent assertion against the real server first.
 *
 * ## What this covers that unit tests cannot
 *
 * The poll classification, the request builders and the dialog's geometry are all
 * unit-tested on device. What only this can reach is the SEQUENCE: that pressing
 * the button produces a code, that a server-side approval is noticed by the poll
 * loop within its cadence, that the token exchange runs, and that the app ends up
 * on Home. That sequence is exactly what the migration rewrote.
 *
 * ## Credentials are deliberately NOT saved
 *
 * The post-auth prompt is answered "No" (the safe side showConfirmDialog focuses
 * by default), so the run signs in without writing an authToken into the device
 * registry. `scripts/rta-run.js` restores the registry either way; this keeps the
 * test from depending on that.
 */
import { beforeAll, expect, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, authorizeQuickConnect, quickConnectEnabled } from '../lib/jellyfin.js';
import { seedUserSelect, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import { waitFor, waitHome, hasChildren, getVal, press, sleep } from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const CAPTURE = process.env.RTA_CAPTURE === '1';
const LOCALE = RTA_CONFIG.languages[0];

let session;
let qcAvailable;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  // A capability of the FIXTURE, not of the app. A server with Quick Connect
  // switched off (or older than 10.8, where the endpoint does not exist) cannot
  // support these tests, and that is a reason to skip visibly rather than to go
  // red — the same shape screens.spec.js uses for a missing library. Matters more
  // than usual here because the server can be aimed elsewhere via RTA_SERVER_URL.
  qcAvailable = await quickConnectEnabled(session);
});

/**
 * Land on the signed-out user picker with the Quick Connect button focused.
 *
 * Focus is walked with a real press rather than teleported: JRButtonGroup tracks
 * its own focused index and re-asserts it whenever the group gains focus, so
 * focusing a child directly gets reverted (the same reason dialogs.spec.js enters
 * the detail button group and walks it).
 */
async function focusQuickConnectButton() {
  const expectedServer = await seedUserSelect(session, LOCALE);
  // hardRelaunch, not relaunch: a plain relaunch re-persists the running session
  // over the seed and the suite silently drives a signed-IN app.
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'quickConnect');

  await waitFor('#userRow.content.getChildCount()', hasChildren, {
    label: 'user-select user row',
    timeout: 20000,
  });

  // The button is REMOVED when the server reports Quick Connect disabled, so a
  // missing one here is a fixture statement — check it before blaming focus.
  const buttonId = await getVal('#quickConnect.id');
  if (buttonId !== 'quickConnect') {
    throw new Error(
      'UserSelect has no #quickConnect button — the probe removed it, so this server reports Quick Connect disabled',
    );
  }

  await odc.focusNode({ base: 'scene', keyPath: '#buttons' });
  await waitFor('#buttons.buttonFocused', (n) => typeof n === 'number', {
    label: 'user-select button group focused',
    timeout: 8000,
  });
  // Quick Connect is index 0; walk left until we are on it. Guarded (press only
  // while not yet there) so a group that already answered is never perturbed.
  await waitFor('#buttons.buttonFocused', (n) => n === 0, {
    label: 'quick connect button focused',
    timeout: 8000,
    action: async () => {
      if ((await getVal('#buttons.buttonFocused')) !== 0) await press(ecp.Key.Left);
    },
  });
}

/** Press Quick Connect and wait for the server-issued code to reach the screen. */
async function openQuickConnectDialog() {
  await press(ecp.Key.Ok);
  const code = await waitFor(
    '#quickConnectCode.text',
    (v) => typeof v === 'string' && v.trim().length > 0,
    { label: 'quick connect code displayed', timeout: 20000 },
  );
  return code.trim();
}

it('shows a server-issued code, notices approval, and signs in', async (testCtx) => {
  if (!qcAvailable) testCtx.skip('server reports Quick Connect disabled');

  await focusQuickConnectButton();
  const code = await openQuickConnectDialog();

  // The dialog is a scene overlay now, on the same shared id as the rest of the
  // family — it used to live on Roku's modal channel, invisible to every
  // isDialogOpen / cancelOpenDialog caller in the app.
  expect(await getVal('#jrDialog.id')).toBe('jrDialog');
  // One button, and it is Cancel: the only outcome this dialog can produce on
  // its own. Approval arrives from the server, not from the remote.
  expect(await getVal('#buttonRow.getChildCount()')).toBe(1);

  if (CAPTURE) await captureRawUI('quickConnect');

  // Be the second device.
  expect(await authorizeQuickConnect(session, code)).toBe(true);

  // The poll runs every 3s; the app then exchanges the secret and asks whether to
  // save credentials. Two buttons distinguishes that confirm from the code
  // dialog's single Cancel, so this gate cannot pass on the dialog we came from.
  await waitFor('#buttonRow.getChildCount()', (n) => n === 2, {
    label: 'save-credentials confirm after approval',
    timeout: 30000,
  });

  // showConfirmDialog focuses the SAFE side first, which here means "No".
  const safeLabel = await getVal('#buttonRow.0.text');
  expect(typeof safeLabel).toBe('string');
  await press(ecp.Key.Ok);

  await waitHome();
}, 180000);

it('cancel leaves the code dialog and returns to the user picker', async (testCtx) => {
  if (!qcAvailable) testCtx.skip('server reports Quick Connect disabled');

  await focusQuickConnectButton();
  await openQuickConnectDialog();

  await press(ecp.Key.Back);
  await waitFor('#jrDialog.id', (v) => v === undefined, {
    label: 'quick connect dialog dismissed',
    timeout: 10000,
  });

  // Still signed out, still on the picker — a cancel must not half-start a
  // session. Settle first: the dialog restores focus to its opener on close.
  await sleep(500);
  expect(await getVal('#userRow.content.getChildCount()')).toBeGreaterThan(0);
}, 120000);
