/**
 * Standard-dialog functional tests: prove the dialog family works end-to-end on a
 * real device through real user flows.
 *
 *   - JRDialog       — the Series "watched" confirm, opened from ItemDetails.
 *   - JRListDialog   — the OSD's video-source picker, opened during playback.
 *   - OverviewDialog — the OSD's playback-info report.
 *
 * Cancel-only on purpose: the demo server is shared, so no test confirms a
 * mutating action or actually switches the stream.
 *
 * WHY THE VIDEO-SOURCE PICKER AND NOT THE AUDIO ONE: the OSD REMOVES a picker
 * button whose menu would have nothing to choose from (`numAudioStreams < 2`
 * drops #showAudioMenu), and no item on the demo server has a second audio track
 * or any subtitles — probed 2026-08-21 across every movie there. Dracula does
 * have two media sources, so #showVideoSourceMenu is the one picker reachable
 * here. All three go through the same showTrackPicker -> showListDialog path in
 * PlayerHostView, so this covers the machinery; what it cannot cover is the
 * per-picker option builders, which are unit-tested instead
 * (tests/source/unit/utils/trackPickerOptions.spec.bs).
 */
import { beforeAll, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { relaunch, hardRelaunch, ecp, odc } from '../lib/driver.js';
import { navSeriesDetails, navMovieDetails } from '../lib/nav.js';
import {
  waitFor,
  waitFocused,
  waitHome,
  waitMediaPlaying,
  stopPlayback,
  PLAYING_STATES,
  getVal,
  press,
  sleep,
} from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const CAPTURE = process.env.RTA_CAPTURE === '1';
const LOCALE = RTA_CONFIG.languages[0];

let session;
let libraries;
let heroId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
  heroId = (await getHero(session)).id;
  if (!heroId) throw new Error('dialogs spec setup: could not resolve the hero movie on the demo');
});

/**
 * The state both OSD dialog tests start from: the hero movie playing, PAUSED,
 * with the OSD up and focus in its footer button group.
 *
 * Paused is not cosmetic — OSD.inactiveCheck returns early while the playback
 * state is "paused", so the OSD stops auto-hiding after 5s and every step below
 * is untimed. The Up / Back / Play sequence mirrors nav.js's navOsd: Up only
 * OPENS the OSD (it is not a toggle), so it has to be hidden again before Play
 * can reach the player and pause it.
 */
async function pausedOsd() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch(); // a plain relaunch lets the running app re-persist over the seed
  await assertSeedTookEffect(expectedServer, 'pausedOsd');
  await waitHome();

  // Cast rather than walk the grid: this spec is about the dialogs, and every
  // press between Home and the player is a chance to fail for another reason.
  await ecp.sendInput({ params: { contentId: `id=${heroId}|action=play` } });
  await waitMediaPlaying('osd dialogs');
  await sleep(1500); // let the just-started player settle before sending any input

  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 30000,
    interval: 2000,
    action: async () => {
      if ((await getVal('#osd.visible')) !== true) await press(ecp.Key.Up);
    },
    label: 'osd visible',
  });
  await press(ecp.Key.Back);
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await press(ecp.Key.Play); // pause + re-show the OSD
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'osd visible (paused)',
  });
}

/**
 * Walk the OSD footer to the button with `buttonId` and press it.
 *
 * Focus is walked with real Rights rather than teleported, because OSDButtonGroup
 * re-asserts its own buttonFocused index. The OSD DROPS buttons it has nothing to
 * show (see the file header), so a missing target is checked for FIRST — otherwise
 * "this item has one audio track" arrives as an unexplained focus timeout.
 */
async function pressOsdButton(buttonId) {
  if ((await getVal(`#${buttonId}.id`)) !== buttonId) {
    throw new Error(
      `OSD has no #${buttonId} — the item this spec plays no longer has enough streams/sources for it`,
    );
  }
  await waitFocused((f) => f.node?.id === buttonId, {
    timeout: 20000,
    action: async () => {
      const focused = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
      if (focused?.node?.id !== buttonId) await press(ecp.Key.Right);
    },
    label: `osd button ${buttonId} focused`,
  });
  await press(ecp.Key.Ok);
}

/**
 * Playback with the OSD up and STILL PLAYING — deliberately not paused.
 *
 * `pausedOsd` pauses, and OSD.inactiveCheck returns early while paused, so the
 * 5s auto-hide never runs there. That is convenient for driving a dialog, and it
 * is exactly why the auto-hide focus-theft bug was invisible to this suite: the
 * helper avoided the only state that reproduces it.
 */
async function playingOsd() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'playingOsd');
  await waitHome();

  await ecp.sendInput({ params: { contentId: `id=${heroId}|action=play` } });
  await waitMediaPlaying('osd auto-hide');
  await sleep(1500);

  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 30000,
    interval: 2000,
    action: async () => {
      if ((await getVal('#osd.visible')) !== true) await press(ecp.Key.Up);
    },
    label: 'osd visible (playing)',
  });
}

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
  // Gate on the BUTTON, not on its index. `watchedIndex` was resolved by scanning the
  // group above, and `ItemDetails` mutates that group asynchronously as data lands —
  // `m.buttonGrp.removeChild(loadingButton)` once the trailer check resolves through
  // `fetchAsync().then()`, `removeChild(trailerButton)` when there is none,
  // `removeChild(resumeButton)`. Every removal shifts the indices after it, so a gate
  // on `buttonFocused === watchedIndex` can be satisfied by a DIFFERENT button, and the
  // OK below then lands on it: no dialog opens, and by the time the wait gives up the
  // group has settled and the failure dump looks innocent — focus on `#watchedButton`,
  // no confirm. Recorded 4 times in 63 ledger runs, always `wait-for-timeout` on
  // `#buttonRow.getChildCount()`.
  //
  // This is the same defect as the library-nav wrong-turn (`openLibraryByType`):
  // commit to an index, act later, index means something else. `pressOsdButton` in this
  // same file already gates by identity for the same reason; this walk did not.
  await waitFocused((f) => f.node?.id === 'watchedButton', {
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

// FocusableOverview used to hand-roll its append (createObject + appendChild +
// setFocus) and never stamped the shared overlay id, so isOverlayDialogOpen /
// isDialogOpen / cancelOpenDialog were all blind to it. It now goes through
// showInfoDialog like every other overlay. Two things to prove: the overlay is
// findable by the shared id, and passing `returnFocusTo` explicitly still lands
// focus back on the opener rather than wherever derivation would have guessed.
it('item description opens the overview overlay; back restores focus to it', async () => {
  await seedHome(session, LOCALE);
  await seedLibraryLanding(session, libraryIdFor(libraries, 'movies'), 'Movies');
  await relaunch();
  await navMovieDetails({ libraries });

  // Guard the fixture before asserting on it: a movie with no overview leaves
  // #itemDescription hidden and every check below would pass having driven
  // nothing (tests/rta/CLAUDE.md — make it throw when it verified nothing).
  const overview = await getVal('#itemDescription.text');
  if (typeof overview !== 'string' || overview.length === 0)
    throw new Error(
      `hero movie has no overview on this fixture (#itemDescription.text = ${overview})`,
    );

  // Not a JRButtonGroup, so teleporting focus here sticks — no index to re-assert.
  await odc.focusNode({ base: 'scene', keyPath: '#itemDescription' });
  await waitFocused((f) => f.node?.id === 'itemDescription', {
    label: 'item description focused',
    timeout: 5000,
  });

  await press(ecp.Key.Ok);

  // The SHARED id is the point: the hand-rolled path never set it.
  await waitFor('#jrDialog.id', (v) => v === 'jrDialog', {
    label: 'overview overlay mounted with the shared id',
    timeout: 10000,
  });

  if (CAPTURE) await captureRawUI('overviewDialog');

  await press(ecp.Key.Back);
  await waitFor('#jrDialog.id', (v) => v === undefined, {
    label: 'overview overlay dismissed',
    timeout: 10000,
  });

  // returnFocusTo was passed explicitly as the FocusableOverview itself.
  await waitFocused((f) => f.node?.id === 'itemDescription', {
    label: 'focus restored to the item description',
    timeout: 5000,
  });
});

// The playback-time pickers moved off SceneManager's shared returnData onto
// JRListDialog, whose result is per-instance. This drives the one picker the demo
// server can populate and proves the overlay opens over the player, lists the real
// options, and cancels cleanly without disturbing playback.
it('osd video-source button opens the list dialog; back cancels it', async () => {
  await pausedOsd();
  await pressOsdButton('showVideoSourceMenu');

  // The overlay mounts on the SCENE (not on the player), with one row per source.
  await waitFor('#optionList.content.getChildCount()', (n) => typeof n === 'number' && n > 1, {
    label: 'video-source dialog rows',
    timeout: 10000,
  });

  if (CAPTURE) await captureRawUI('videoSourceDialog');

  // Focus opens ON the list — the picker's job is picking, and there is no
  // footer button to compete for it.
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#optionList'), {
    label: 'list focused on open',
    timeout: 5000,
  });

  // The list wraps in BOTH directions and Back is the only exit. This is the one
  // place that runs against a real LabelList, whose own wrap mode would swallow
  // both keys if it were ever re-enabled — which is the bug this replaced.
  const rows = await getVal('#optionList.content.getChildCount()');
  const startIndex = await getVal('#optionList.itemFocused');

  for (let i = startIndex; i < rows - 1; i++) await press(ecp.Key.Down);
  await waitFor('#optionList.itemFocused', (n) => n === rows - 1, {
    label: 'focus walked to the last row',
    timeout: 8000,
  });

  await press(ecp.Key.Down); // past the end -> wraps
  await waitFor('#optionList.itemFocused', (n) => n === 0, {
    label: 'DOWN on the last row wrapped to the top',
    timeout: 8000,
  });
  // ...and it must NOT have dismissed on the way
  if ((await getVal('#jrDialog.id')) !== 'jrDialog')
    throw new Error('DOWN past the last row dismissed the dialog instead of wrapping');

  // ...and UP on the first row wraps the other way, which is the reason wrapping
  // is worth having: one press reaches the end of a long list.
  await press(ecp.Key.Up);
  await waitFor('#optionList.itemFocused', (n) => n === rows - 1, {
    label: 'UP on the first row wrapped to the bottom',
    timeout: 8000,
  });

  // Back is the only exit, so it has to work from anywhere in the list.
  await press(ecp.Key.Back);
  await waitFor('#jrDialog.id', (v) => v === undefined, {
    label: 'Back dismissed the dialog',
    timeout: 10000,
  });
  await waitFocused((f) => f.node?.id === 'showVideoSourceMenu', {
    label: 'focus restored to the osd button',
    timeout: 8000,
  });

  await stopPlayback();
}, 240000);

// Playback info left the legacy StandardDialog for showInfoDialog. Its body is
// built from a live /Sessions round-trip, so a rendered non-empty report also
// proves the task's structured sections survived the trip into the dialog.
it('osd info button opens the playback-info report; back dismisses it', async () => {
  await pausedOsd();
  await pressOsdButton('showVideoInfoPopup');

  await waitFor('#overviewText.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'playback info rendered',
    timeout: 25000,
  });

  if (CAPTURE) await captureRawUI('playbackInfoDialog');

  await press(ecp.Key.Back);
  await waitFor('#jrDialog.id', (v) => v === undefined, {
    label: 'playback info dismissed',
    timeout: 10000,
  });

  await stopPlayback();
}, 240000);

// REGRESSION. The OSD auto-hides 5s after the last keypress, and hiding used to
// take focus back from whatever held it — including a dialog opened FROM the OSD.
// The dialog stayed on screen but stopped receiving keys, so Back fell through to
// the player and exited playback without ever closing it.
//
// Everything here happens with playback RUNNING: paused, OSD.inactiveCheck
// returns early and the auto-hide never fires at all.
it('a dialog keeps focus when the osd auto-hides underneath it', async () => {
  await playingOsd();
  await pressOsdButton('showVideoInfoPopup');

  await waitFor('#overviewText.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'playback info rendered',
    timeout: 25000,
  });

  // Out-wait the 5s inactivity window WITHOUT touching the remote — a keypress
  // would reset the very timer under test.
  await sleep(9000);

  // The dialog must still own input. Asserted via the focused node rather than
  // "#jrDialog exists": the bug left the dialog on screen and only took its focus,
  // so presence alone would have passed while the dialog was already dead.
  const focused = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
  const keyPath = typeof focused?.keyPath === 'string' ? focused.keyPath : '';
  if (!keyPath.includes('jrDialog'))
    throw new Error(
      `focus left the dialog while the osd auto-hid (focused: ${keyPath || 'unknown'})`,
    );

  // ...and Back still closes the dialog rather than leaving playback.
  await press(ecp.Key.Back);
  await waitFor('#jrDialog.id', (v) => v === undefined, {
    label: 'back closed the dialog after the osd auto-hide window',
    timeout: 10000,
  });

  const mp = await ecp.getMediaPlayer().catch(() => null);
  if (!mp || !PLAYING_STATES.includes(mp.state))
    throw new Error('back exited playback instead of closing the dialog');

  await stopPlayback();
}, 240000);
