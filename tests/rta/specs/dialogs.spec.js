/**
 * Standard-dialog functional test: proves the JRDialog overlay works end-to-end
 * on a real device through a real user flow — the Series "watched" button opens
 * the confirm dialog (an exemplar migrated to source/utils/dialogs.bs in the
 * dialog-standardization work), and back cancels it without mutating anything.
 *
 * Cancel-only on purpose: the demo server is shared, so the test never confirms
 * the mark-all-episodes action.
 */
import { beforeAll, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding } from '../lib/seed.js';
import { relaunch, ecp, odc } from '../lib/driver.js';
import { navSeriesDetails } from '../lib/nav.js';
import { waitFor, waitFocused, getVal, press, sleep } from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const CAPTURE = process.env.RTA_CAPTURE === '1';
const LOCALE = RTA_CONFIG.languages[0];

let session;
let libraries;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

it('series watched button opens the standard confirm dialog; back cancels it', async () => {
  await seedHome(session, LOCALE);
  await seedLibraryLanding(session, libraryIdFor(libraries, 'tvshows'), 'Shows');
  await relaunch();
  await navSeriesDetails();

  // JRButtonGroup tracks its own focused index and re-asserts it whenever the group
  // gains focus, so teleporting focus onto #watchedButton gets reverted. Enter via
  // the GROUP (it focuses its current index) and walk right with real presses.
  let watchedIndex = -1;
  for (let i = 0; i < 12; i++) {
    const id = await getVal(`#buttons.${i}.id`);
    if (id === undefined) break;
    if (id === 'watchedButton') {
      watchedIndex = i;
      break;
    }
  }
  if (watchedIndex < 0) throw new Error('watchedButton not found in detail button group');

  await odc.focusNode({ base: 'scene', keyPath: '#buttons' });
  await sleep(300);
  const groupIndex = await getVal('#buttons.buttonFocused');
  if (typeof groupIndex !== 'number')
    throw new Error(`cannot read #buttons.buttonFocused (got ${groupIndex})`);
  for (let i = groupIndex; i < watchedIndex; i++) await press(ecp.Key.Right);
  await waitFor('#buttons.buttonFocused', (n) => n === watchedIndex, {
    label: 'watched button focused in group',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);

  // The JRDialog overlay mounts on the scene with two TextButtons under the panel.
  // #buttonRow is a child id (recursive findNode), not a field — don't chain it off #jrDialog.
  await waitFor('#buttonRow.getChildCount()', (n) => n === 2, {
    label: 'confirm dialog button row',
    timeout: 10000,
  });

  if (CAPTURE) await captureRawUI('confirmDialog');

  // Identify the buttons by their rendered labels rather than hardcoding the
  // translated strings. ODC can read a field off an indexed child, but not call a
  // method on one, so focus is asserted via the focused NODE (waitFocused).
  const cancelLabel = await getVal('#buttonRow.0.text');
  const confirmLabel = await getVal('#buttonRow.1.text');

  // showConfirmDialog focuses the SAFE side first
  await waitFocused((f) => f.node?.text === cancelLabel, {
    label: 'cancel focused on open',
    timeout: 5000,
  });

  // Focus WRAPS at the ends, matching JRButtonGroup — the app's other horizontal
  // button row. Two Rights on a two-button dialog must land back on Cancel; a
  // dialog that dead-ends at the last button would stay on the confirm side.
  await press(ecp.Key.Right);
  await waitFocused((f) => f.node?.text === confirmLabel, {
    label: 'confirm focused after right',
    timeout: 5000,
  });
  await press(ecp.Key.Right);
  await waitFocused((f) => f.node?.text === cancelLabel, {
    label: 'focus wrapped back to cancel',
    timeout: 5000,
  });

  // Back cancels: the overlay removes itself from the scene
  await press(ecp.Key.Back);
  await waitFor('#jrDialog.id', (v) => v === undefined, {
    label: 'confirm dialog dismissed',
    timeout: 10000,
  });

  // Focus is restored to the opener
  await sleep(500);
  const afterCloseFocusId = await getVal('focusedChild.id');
  if (afterCloseFocusId === 'jrDialog') throw new Error('focus stuck on dismissed dialog');
});
