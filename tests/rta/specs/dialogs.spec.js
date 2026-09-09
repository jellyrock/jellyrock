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
import { beforeAll, afterAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { relaunch, hardRelaunch, ecp, odc } from '../lib/driver.js';
import { navSeriesDetails, navMovieDetails } from '../lib/nav.js';
import {
  waitFor,
  waitDialogClosed,
  waitFocused,
  waitFocusInside,
  walkFocusInto,
  walkFocusUntil,
  focusIsInside,
  waitHome,
  waitMediaPlaying,
  waitOsdUp,
  stopPlayback,
  PLAYING_STATES,
  getVal,
  getActiveVals,
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

// Cleanup does not depend on a later spec in this file happening to call
// pausedOsd() again. Without this, the 1 Mbps cap seeded by the two transcode
// specs below only gets cleared as a side effect of the next test's own setup —
// and if this file's last test is one of the transcode specs, the cap survives
// into screens.spec.js's store: true capture screens.
afterAll(async () => {
  // A failed beforeAll still runs this. `session` is undefined until authenticate()
  // resolves, and seedPlaybackSettings reads session.userId — so without this guard a
  // server that refused the connection reports "Cannot read properties of undefined"
  // from the hook, burying the real setup error. Nothing was seeded in that case
  // either, so there is nothing to clean up.
  if (!session) return;
  await seedPlaybackSettings(null);
});

/**
 * Playback settings a spec in this file seeds to force a particular server
 * decision. Listed here because they have to be CLEARED again: seedHome resets
 * only the sticky `display.*` keys, so anything else written into the user's
 * section survives into every later test in the run.
 *
 * That matters more than it looks. `rta-run.js` snapshots and restores the whole
 * registry around the RUN, so nothing leaks between runs — but within one run a
 * leaked 1 Mbps cap reaches `screens.spec.js`, whose `osd` and `trickplay`
 * entries are `store: true` capture screens. A forced transcode underneath the
 * screenshots that ship to the Roku store listing is not a test-only problem.
 */
const PLAYBACK_SETTING_KEYS = ['playbackBitrateMaxLimited', 'playbackBitrateLimit'];

/** Seed the given playback settings, clearing any this file left behind. */
async function seedPlaybackSettings(userSettings) {
  const values = {};
  for (const key of PLAYBACK_SETTING_KEYS) values[key] = null; // null = delete the key
  Object.assign(values, userSettings ?? {});
  await odc.writeRegistry({ values: { [session.userId]: values } });

  // READ BACK when we asked for a clean slate. Without this the clearing half is
  // untested — a test seeding a cap runs first and leaves it behind, and every
  // later test inherits it while still passing, which is exactly how this got
  // shipped the first time. Asserting the absence is what makes the reset real.
  if (userSettings) return;
  const reg = await odc.readRegistry();
  const section = reg?.values?.[session.userId] ?? {};
  for (const key of PLAYBACK_SETTING_KEYS) {
    expect(
      section[key],
      `${key} survived the reset and will leak into later specs`,
    ).toBeUndefined();
  }
}

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
async function pausedOsd(userSettings = null) {
  const expectedServer = await seedHome(session, LOCALE);
  await seedPlaybackSettings(userSettings);
  await hardRelaunch(); // a plain relaunch lets the running app re-persist over the seed
  await assertSeedTookEffect(expectedServer, 'pausedOsd');
  await waitHome();

  // Cast rather than walk the grid: this spec is about the dialogs, and every
  // press between Home and the player is a chance to fail for another reason.
  await ecp.sendInput({ params: { contentId: `id=${heroId}|action=play` } });
  // Both gates, because they answer different questions. `waitMediaPlaying` reads the OS
  // media player over ECP and reports `media-player-not-started` — "did a stream open at
  // all". `waitOsdUp` then reads the APP's own `state`, which is what `stateAllowsOSD()`
  // consults before it will open the OSD for an Up. Dropping the first would report a
  // stream that never opened as an OSD timeout.
  await waitMediaPlaying('osd dialogs');
  await waitOsdUp('osd visible', { itemId: heroId });
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
async function osdHasButton(buttonId) {
  return (await getVal(`#${buttonId}.id`)) === buttonId;
}

async function pressOsdButton(buttonId) {
  if (!(await osdHasButton(buttonId))) {
    throw new Error(
      `OSD has no #${buttonId} — the item this spec plays no longer has enough streams/sources for it`,
    );
  }
  // Same origin gate as `navSearch`'s walk: press Right only while focus is still inside
  // the active routed view. The hand-rolled form pressed wherever focus was, which on the
  // player means driving whatever took focus instead of the OSD.
  const arrivedAtButton = (f) => f.node?.id === buttonId;
  await waitFocused(arrivedAtButton, {
    timeout: 20000,
    action: walkFocusUntil(ecp.Key.Right, arrivedAtButton),
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
async function playingOsd(userSettings = null) {
  const expectedServer = await seedHome(session, LOCALE);
  await seedPlaybackSettings(userSettings);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'playingOsd');
  await waitHome();

  await ecp.sendInput({ params: { contentId: `id=${heroId}|action=play` } });
  await waitMediaPlaying('osd auto-hide');
  await waitOsdUp('osd visible (playing)', { itemId: heroId });
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

  // WALKED, not teleported. `ItemDetails.bs:281-285` focuses the button group on a fresh
  // mount, so the guard normally presses NOTHING and this is just the gate below. What it
  // is not is a source-proven precondition: `openFirstGridTileDetail` gates on the title
  // rendering, never on focus, and the group is mutated asynchronously as data lands
  // (`removeChild` of the loading/trailer/resume buttons). Down is the recovery from the
  // description or a track dropdown; recovering with a real press beats asserting the
  // app's focus behaviour from reading it.
  //
  // Gate on FOCUS ARRIVING, not on `buttonFocused` being readable. The obvious wait —
  // poll until `#buttons.buttonFocused` is a number — cannot fail: `JRButtonGroup.bs`
  // sets it to 0 in `init()`, so it answers long before the teleport lands and the wait
  // returns on its first tick having proven nothing. That is the north star's "succeeding
  // too early", and the read below would then describe the group's PREVIOUS index.
  // `onGroupFocusChanged` is what re-asserts the index, and it runs on the group taking
  // focus — so focus being inside `#buttons` is the state that makes the read meaningful.
  await waitFocusInside('#buttons', {
    label: 'detail button group focused (pre-index read)',
    timeout: 8000,
    interval: 300,
    action: walkFocusInto(ecp.Key.Down, '#buttons'),
  });
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
  // What we were standing on WHEN WE PRESSED. The throw-time dump cannot answer this:
  // it is taken 10s later, by which point the button group has settled and focus reads
  // `#watchedButton` whether or not that is where the press landed — which is exactly
  // the dump every occurrence of this failure has produced, and why two different
  // explanations both fitted it.
  const pressedOn = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
  const pressedIndex = await getVal('#buttons.buttonFocused');
  await press(ecp.Key.Ok);

  // The JRDialog overlay mounts on the scene with two TextButtons under the panel.
  // #buttonRow is a child id (recursive findNode), not a field — don't chain it off #jrDialog.
  await waitFor('#buttonRow.getChildCount()', (n) => n === 2, {
    label: 'confirm dialog button row',
    timeout: 10000,
    // No confirm appeared. `onWatchedButtonPressed` opens one for ANY `item.type =
    // "Series"`, so there are only two ways here: the press did not land on
    // `watchedButton`, or this detail is not a Series and `toggleWatched()` ran
    // silently. Both produce an identical dump, and a Movie detail has a
    // `#watchedButton` too — so read the TYPE, which separates them outright.
    // `#extrasGrid` carries it (`ExtrasRowList.loadParts` sets `m.top.type`), scoped to
    // the active view because every ItemDetails has one.
    observed: async () => {
      const [type, parentId, title] = await getActiveVals([
        '#extrasGrid.type',
        '#extrasGrid.parentId',
        '#videoTitle.text',
      ]);
      return {
        detailType: type,
        detailId: parentId,
        detailTitle: title,
        pressedOnId: pressedOn?.node?.id,
        pressedOnSubtype: pressedOn?.node?.subtype,
        pressedIndex,
        wantedIndex: watchedIndex,
      };
    },
  });

  if (CAPTURE) await captureRawUI('confirmDialog');

  // Identify the buttons by their rendered labels rather than hardcoding the
  // translated strings. ODC can read a field off an indexed child, but not call a
  // method on one, so focus is asserted via the focused NODE (waitFocused).
  const cancelLabel = await getVal('#buttonRow.0.text');
  const confirmLabel = await getVal('#buttonRow.1.text');

  // Both labels asserted READ, and asserted DIFFERENT, before anything is compared to
  // them — otherwise every wait below is vacuous. An absent read answers `undefined`, and
  // a focused node with no `text` field reads `undefined` too, so `f.node?.text ===
  // confirmLabel` would be satisfied by focus sitting on ANY node without text: all three
  // waits pass on their first tick and the wrap behaviour is never exercised. Two labels
  // that merely matched each other would break the wrap assertion the same way. Same guard
  // the colour comparison at the bottom of this file carries, and the one
  // `demos/takes/server-switch.js` carries over the identical pair of reads.
  expect(
    cancelLabel,
    'dialog button labels must be readable or the waits below prove nothing',
  ).toBeTruthy();
  expect(
    confirmLabel,
    'dialog button labels must be readable or the waits below prove nothing',
  ).toBeTruthy();
  expect(cancelLabel, 'the two labels must differ or focus cannot be told apart').not.toBe(
    confirmLabel,
  );

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
  await waitDialogClosed('confirm dialog dismissed', { timeout: 10000 });

  // Focus is restored to the opener — asserted as a POSITIVE signal, which is also what
  // makes the wait honest. A poll for "focus is no longer on the dialog" would be
  // satisfied by focus being nowhere in particular, so it could pass on the very state it
  // is meant to catch; waiting for focus to arrive back in the detail button group can
  // only pass by the restoration actually happening, and fails as a diagnosed timeout
  // naming this step when it does not.
  await waitFocusInside('#buttons', {
    label: 'focus restored to the opener after dismiss',
    timeout: 8000,
  });
  // Kept as well as the wait: the wait proves focus ARRIVED, this proves it did not stay
  // on a dismissed overlay that is somehow still in the chain. Different failures.
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
  // WALKED up the ladder, not teleported. Up from the button group targets an interactive
  // track dropdown if there is one and falls through to the description if there is not
  // (`ItemDetails.bs:4271`); Up from a CLOSED dropdown gets there via `requestFocusReturn`
  // -> `onDropdownRequestUp` (`ItemDetails.bs:3898`). So the rung count is a property of
  // the fixture's tracks, and a fixed number of presses would be wrong on one server or
  // the other — pressing until focus ARRIVES is right on both, which is why this is a
  // guarded walk rather than a counted one.
  //
  // 8000/500 rather than the 5000 a teleport was happy with: this now spends a tick per
  // rung, and the budget has to cover the presses (see `walkFocusInto`).
  await waitFocused((f) => f.node?.id === 'itemDescription', {
    label: 'item description focused',
    timeout: 8000,
    interval: 500,
    action: walkFocusInto(ecp.Key.Up, '#itemDescription'),
  });

  await press(ecp.Key.Ok);

  // The SHARED id is the point: the hand-rolled path never set it.
  await waitFor('#jrDialog.id', (v) => v === 'jrDialog', {
    label: 'overview overlay mounted with the shared id',
    timeout: 10000,
  });

  if (CAPTURE) await captureRawUI('overviewDialog');

  await press(ecp.Key.Back);
  await waitDialogClosed('overview overlay dismissed', { timeout: 10000 });

  // returnFocusTo was passed explicitly as the FocusableOverview itself.
  await waitFocused((f) => f.node?.id === 'itemDescription', {
    label: 'focus restored to the item description',
    timeout: 5000,
  });
});

// THE OPENING FOCUS, on a body that actually scrolls — the one property no unit
// spec in this repo can reach.
//
// A rooibos spec cannot see it: `m.wait()` blocks the render thread, so a wrapped
// label never finishes laying out and the dialog is still measuring when the
// assertions run. Measured on a Stick 4K — a 5000-character overview still
// reported a 218px label and `scrollTrack.visible = false` after 3s of waiting.
// So this is the only place the question can be asked.
//
// It is worth asking because the answer was wrong and everything stayed green:
// OverviewDialog latched its opening focus on the layout pass that runs inside
// init(), before a single field is set, which sent every scrolling dialog to the
// OK button. `down` on the OK button is swallowed, so the description the user
// is looking straight at would not scroll until they pressed UP first.
//
// The overview is FORCED rather than taken from the fixture: no item on the demo
// server has a description long enough to scroll (the hero's fits with ~350px to
// spare), so a content-dependent version of this test would silently assert the
// non-scrolling branch — which is the branch that passes either way.
it('a scrolling overview overlay opens focused on the text, not on OK', async () => {
  await seedHome(session, LOCALE);
  await seedLibraryLanding(session, libraryIdFor(libraries, 'movies'), 'Movies');
  await relaunch();
  await navMovieDetails({ libraries });

  const overview = await getVal('#itemDescription.text');
  if (typeof overview !== 'string' || overview.length === 0)
    throw new Error(
      `hero movie has no overview on this fixture (#itemDescription.text = ${overview})`,
    );

  // App-memory only — the next relaunch resets it, so no restore step is needed.
  const long = `${overview} `.repeat(40);
  await odc.setValue({ base: 'scene', keyPath: '#itemDescription.text', value: long });

  // WALKED up the ladder, not teleported. Up from the button group targets an interactive
  // track dropdown if there is one and falls through to the description if there is not
  // (`ItemDetails.bs:4271`); Up from a CLOSED dropdown gets there via `requestFocusReturn`
  // -> `onDropdownRequestUp` (`ItemDetails.bs:3898`). So the rung count is a property of
  // the fixture's tracks, and a fixed number of presses would be wrong on one server or
  // the other — pressing until focus ARRIVES is right on both, which is why this is a
  // guarded walk rather than a counted one.
  //
  // 8000/500 rather than the 5000 a teleport was happy with: this now spends a tick per
  // rung, and the budget has to cover the presses (see `walkFocusInto`).
  await waitFocused((f) => f.node?.id === 'itemDescription', {
    label: 'item description focused',
    timeout: 8000,
    interval: 500,
    action: walkFocusInto(ecp.Key.Up, '#itemDescription'),
  });
  await press(ecp.Key.Ok);

  await waitFor('#jrDialog.id', (v) => v === 'jrDialog', {
    label: 'overview overlay mounted',
    timeout: 10000,
  });

  // Guard the premise before asserting on it: if this body did not scroll, the
  // focus assertion below would be asserting the wrong branch (tests/rta/CLAUDE.md).
  await waitFor('#scrollTrack.visible', (v) => v === true, {
    label: 'overview body scrolls',
    timeout: 10000,
  });

  await waitFocused((f) => f.node?.id === 'textClip', {
    label: 'opening focus on the scroll area',
    timeout: 5000,
  });

  // And it holds: `down` scrolls rather than being swallowed by a focused OK.
  await press(ecp.Key.Down);
  await waitFor('#scrollContent.translation', (t) => Array.isArray(t) && t[1] < 0, {
    label: 'down scrolled the body',
    timeout: 5000,
  });

  await press(ecp.Key.Back);
  await waitDialogClosed('overview overlay dismissed', { timeout: 10000 });
});

// The playback-time pickers moved off SceneManager's shared returnData onto
// JRListDialog, whose result is per-instance. This drives the one picker the demo
// server can populate and proves the overlay opens over the player, lists the real
// options, and cancels cleanly without disturbing playback.
it('osd video-source button opens the list dialog; back cancels it', async (testCtx) => {
  await pausedOsd();

  // The ONE button in this file whose presence is a FIXTURE precondition rather than an
  // app invariant: `OSD.bs` removes #showVideoSourceMenu when `numVideoSources < 2`, so a
  // single-source item correctly has no button and there is nothing for this test to drive.
  // Skipped rather than failed, on the same grounds as quick-connect's
  // `server reports Quick Connect disabled` — a precondition the server has to supply is
  // not an app defect, and a red suite that means "the demo library changed" is the
  // run-to-run inconsistency this suite exists to remove.
  //
  // Verified 2026-09-08: the demo server's hero (`Dracula`) reports 1 MediaSource, and
  // 0 of its 11 movies carry more than one — so this is not retunable to another item.
  // `pressOsdButton` still THROWS for the four #showVideoInfoPopup callers below, which
  // have no content precondition and where a missing button is a real defect.
  if (!(await osdHasButton('showVideoSourceMenu'))) {
    testCtx.skip('demo item has a single video source — the OSD correctly drops the button');
  }
  await pressOsdButton('showVideoSourceMenu');

  // The overlay mounts on the SCENE (not on the player), with one row per source.
  await waitFor('#optionList.content.getChildCount()', (n) => typeof n === 'number' && n > 1, {
    label: 'video-source dialog rows',
    timeout: 10000,
  });

  if (CAPTURE) await captureRawUI('videoSourceDialog');

  // Focus opens ON the list — the picker's job is picking, and there is no
  // footer button to compete for it.
  await waitFocusInside('#optionList', {
    label: 'list focused on open',
    timeout: 5000,
    interval: 500,
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
  await waitDialogClosed('Back dismissed the dialog', { timeout: 10000 });
  await waitFocused((f) => f.node?.id === 'showVideoSourceMenu', {
    label: 'focus restored to the osd button',
    timeout: 8000,
  });

  await stopPlayback();
}, 240000);

// The playback-info report is built from a live /Sessions round-trip merged with
// the cached PlaybackInfo, so a rendered non-empty report proves the whole chain:
// task fetch -> render-thread composition -> structured body -> laid-out rows.
//
// It asserts the MODEL on the dialog rather than a blob of text. The old report
// was one string in #overviewText; this one is `sections`, and checking that the
// rows actually arrived is the part a screenshot cannot tell you.
it('osd info button opens the playback-info report; back dismisses it', async () => {
  await pausedOsd();
  await pressOsdButton('showVideoInfoPopup');

  await waitFor('#jrDialog.sections', (v) => Array.isArray(v) && v.length > 0, {
    label: 'playback info report reached the dialog',
    timeout: 25000,
  });

  const sections = await getVal('#jrDialog.sections');
  const rows = sections.flatMap((s) => s.rows ?? []);

  // Every row carries a stable id — that is what lets a refresh rewrite the live
  // figures in place instead of rebuilding the body under the user's scroll.
  const ids = rows.map((r) => r.id);
  expect(ids.length).toBeGreaterThan(3);
  expect(new Set(ids).size).toBe(ids.length);

  // Presence-based rendering: no row is ever a placeholder for missing data.
  for (const row of rows) {
    expect(row.value, `row ${row.id} rendered an empty value`).toBeTruthy();
  }

  // The status line ("Direct playing" / "Direct streaming" / "Transcoding") goes
  // in the tagline slot, and is what the opening screen-reader announcement reads
  // first.
  // An EMPTY status is now meaningful rather than merely absent: the report leaves
  // it blank when the /Sessions fetch returned nothing, precisely so a dropped
  // request can never render as "Direct playing". So this assertion doubles as a
  // gate that the session actually arrived.
  const status = await getVal('#jrDialog.tagline');
  expect(typeof status).toBe('string');
  expect(
    status.length,
    'blank status line — the report never received a session from /Sessions',
  ).toBeGreaterThan(0);

  // REGRESSION. A scrolling report opens with focus on the SCROLL AREA, and the
  // OK button must not merely lack focus — it must not LOOK focused either.
  //
  // Both halves are needed because the bug had them apart: focus was correctly on
  // #textClip while the OK button rendered its `focusBorder` ring, so the dialog
  // opened appearing to have two focused things and read as unresponsive. It came
  // from init()'s layout pass, which runs before any field is set, deriving
  // `scrolls = false` from an empty body and focusing OK on the strength of it.
  // Every other gate passed on this — nothing asserted opening focus APPEARANCE.
  const focused = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
  expect(focused?.keyPath, 'a scrolling report opens focused on the scroll area').toBe(
    '#jrDialog.#textClip',
  );

  // Compare against the button's OWN colour fields rather than a literal — the
  // theme is user-overridable, so a hard-coded colour would assert the default
  // palette rather than the focus state.
  const ring = await getVal('#jrDialog.#okButton.#buttonBorder.blendColor');
  const focusBorder = await getVal('#jrDialog.#okButton.focusBorder');
  const idleBorder = await getVal('#jrDialog.#okButton.border');
  expect(ring, 'the unfocused OK button must not paint its focus ring').not.toBe(focusBorder);
  expect(ring, 'the unfocused OK button paints its idle border').toBe(idleBorder);

  if (CAPTURE) await captureRawUI('playbackInfoDialog');

  await press(ecp.Key.Back);
  await waitDialogClosed('playback info dismissed', { timeout: 10000 });

  await stopPlayback();
}, 240000);

// The TRANSCODING half of the report, which is the half that exists for a reason —
// arrows, a Reasons section, and the one thing no server can tell you: that the
// constraint came from a switch in our own settings screen.
//
// A 1 Mbps cap forces it. That doubles as the only functional coverage of the
// Maximum Bitrate setting actually reaching the device profile: until it was
// fixed, the user's number was discarded and this would have direct-played.
it('a user-capped bitrate transcodes, and the report says which setting did it', async () => {
  await pausedOsd({ playbackBitrateMaxLimited: 'true', playbackBitrateLimit: '1' });
  await pressOsdButton('showVideoInfoPopup');

  await waitFor('#jrDialog.sections', (v) => Array.isArray(v) && v.length > 0, {
    label: 'playback info report reached the dialog',
    timeout: 25000,
  });

  const status = await getVal('#jrDialog.tagline');
  expect(status, 'a 1 Mbps cap must not direct play').not.toBe('Direct playing');

  const sections = await getVal('#jrDialog.sections');
  const reasons = sections.find((sec) => sec.id === 'reasons');
  expect(reasons, 'a transcode must report why').toBeTruthy();

  // The server's code passes through verbatim — we do not maintain its vocabulary.
  const codes = reasons.rows.map((r) => r.label);
  expect(codes.some((c) => c.includes('Bitrate') || c.includes('BitRate'))).toBe(true);

  // ...and the row for the bitrate reason names the setting responsible, spelled
  // exactly as the Settings screen spells it.
  const bitrateRow = reasons.rows.find((r) => r.label === 'VideoBitrateNotSupported');
  if (bitrateRow) {
    expect(bitrateRow.value).toContain('Maximum Bitrate');
  }

  // An arrow appears only where something actually changed, so a transcode must
  // produce at least one.
  const values = sections.flatMap((sec) => sec.rows).map((r) => r.value);
  expect(
    values.some((v) => v.includes('\u2192')),
    'a transcode must show a source -> target arrow',
  ).toBe(true);

  // The live section only exists during a real transcode, so this is the only
  // place its rows can be proven to render at all.
  const rowIds = sections.flatMap((sec) => sec.rows).map((r) => r.id);
  expect(rowIds).toContain('transcode.speed');
  expect(rowIds).toContain('transcode.progress');
  // The encoder's lead over the playhead — what explains a frozen progress figure
  // when the server races ahead and its throttle parks ffmpeg.
  expect(rowIds).toContain('transcode.ahead');

  if (CAPTURE) await captureRawUI('playbackInfoTranscoding');

  // Let at least one refresh land. Reconciliation must rewrite values in place —
  // if it rebuilt instead, the row set would churn under the user's scroll.
  await sleep(7000);
  const refreshed = await getVal('#jrDialog.sections');
  const refreshedIds = refreshed.flatMap((sec) => sec.rows).map((r) => r.id);
  expect(refreshedIds, "a refresh must not change the report's shape").toEqual(rowIds);
  expect(await getVal('#jrDialog.id'), 'the dialog must survive its own refresh').toBe('jrDialog');

  await press(ecp.Key.Back);
  await waitDialogClosed('playback info dismissed', { timeout: 10000 });

  await stopPlayback();
}, 240000);

// The report's KEY MODEL, driven for real rather than inspected. The focus-ring
// fix above is about appearance; this asserts the dialog actually WORKS — that it
// scrolls, that focus reaches the button, and that OK does not close the dialog
// from the scroll area. None of that was covered, which is how a dialog that
// looked broken shipped through every gate.
it('the playback report scrolls, hands focus to OK, and only closes from the button', async () => {
  await pausedOsd({ playbackBitrateMaxLimited: 'true', playbackBitrateLimit: '1' });
  await pressOsdButton('showVideoInfoPopup');

  await waitFor('#jrDialog.sections', (v) => Array.isArray(v) && v.length > 0, {
    label: 'playback info report reached the dialog',
    timeout: 25000,
  });

  // Only meaningful on a body that actually overflows.
  expect(await getVal('#jrDialog.#scrollThumb.visible'), 'this report must scroll').toBe(true);
  expect(await getVal('#jrDialog.#scrollContent.translation')).toEqual([0, 0]);

  // 1. DOWN scrolls the body.
  await press(ecp.Key.Down);
  await waitFor('#jrDialog.#scrollContent.translation', (t) => Array.isArray(t) && t[1] < 0, {
    label: 'down scrolled the body',
    timeout: 8000,
  });

  // Resolve both colours ONCE, up front. They must not be read inside a waitFor
  // predicate: an async predicate returns a Promise, which is always truthy, and
  // the assertion passes vacuously — the exact trap tests/rta/CLAUDE.md names.
  const focusColor = await getVal('#jrDialog.#okButton.focusBorder');
  const idleColor = await getVal('#jrDialog.#okButton.border');
  expect(focusColor, 'focus and idle colours must differ or nothing below is meaningful').not.toBe(
    idleColor,
  );

  // 2. OK from the SCROLL AREA moves focus to the button and does NOT close.
  await press(ecp.Key.Ok);
  await waitFor('#jrDialog.#okButton.#buttonBorder.blendColor', (c) => c === focusColor, {
    label: 'OK moved focus to the button',
    timeout: 8000,
  });
  expect(await getVal('#jrDialog.id'), 'OK from the scroll area must NOT close the dialog').toBe(
    'jrDialog',
  );
  const focusedOnButton = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
  expect(focusedOnButton?.keyPath).toBe('#jrDialog.#okButton');

  // 3. UP hands focus back to the scroll area (only because this body scrolls).
  await press(ecp.Key.Up);
  await waitFor('#jrDialog.#okButton.#buttonBorder.blendColor', (c) => c === idleColor, {
    label: 'up returned focus to the scroll area',
    timeout: 8000,
  });

  // 4. OK twice from the scroll area: first focuses the button, second closes.
  await press(ecp.Key.Ok);
  await waitFor('#jrDialog.#okButton.#buttonBorder.blendColor', (c) => c === focusColor, {
    label: 'first OK re-focused the button',
    timeout: 8000,
  });
  expect(await getVal('#jrDialog.id'), 'still open after the focusing press').toBe('jrDialog');

  await press(ecp.Key.Ok);
  await waitDialogClosed('OK from the button closed the dialog', { timeout: 10000 });

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

  // The report's body is `sections`, not the string label it used to be — this
  // only needs the dialog to be UP and populated before the auto-hide window.
  await waitFor('#jrDialog.sections', (v) => Array.isArray(v) && v.length > 0, {
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
  // Through the shared predicate rather than a local `includes`, so this one-shot check
  // reads focus the same way every waiting gate does (`#jrDialog` is a whole keyPath
  // segment; the `#` is normalised in).
  if (!focusIsInside(keyPath, 'jrDialog'))
    throw new Error(
      `focus left the dialog while the osd auto-hid (focused: ${keyPath || 'unknown'})`,
    );

  // ...and Back still closes the dialog rather than leaving playback.
  await press(ecp.Key.Back);
  await waitDialogClosed('back closed the dialog after the osd auto-hide window', {
    timeout: 10000,
  });

  const mp = await ecp.getMediaPlayer().catch(() => null);
  if (!mp || !PLAYING_STATES.includes(mp.state))
    throw new Error('back exited playback instead of closing the dialog');

  await stopPlayback();
}, 240000);
