/**
 * An action pressed on a screen holds the keys while it waits, and Back cancels it (ADR 0053).
 *
 *  - A details Refresh is an app wait (`LoadingKind.ACTION`): the details screen is hidden under
 *    the spinner, other keys are ignored, Back cancels the refresh and shows the screen again,
 *    and a refresh left alone lands and shows it again.
 *  - An audio seek that loads a new stream is the player's own wait (`LoadingKind.BUFFERING`):
 *    the player stays on show, ignores every key but Back, and Back leaves it, as before.
 *  - A slideshow is a playback start: Back cancels it and shows details again, and a slideshow
 *    left alone opens the photo viewer.
 *
 * On the code before these waits, a Refresh and a seek hid their screen under the plain
 * spinner while keys still reached it: Back left details mid-refresh, and the player
 * disappeared during a seek. Each case slows the one request it waits on (`rtaFailRequests`,
 * `slow`).
 *
 *  - Viewing one photo is a playback start too, which the photo viewer takes and ends once the
 *    photo shows; Back from the viewer shows details again with the remote live.
 *
 * The photo cases need a server with photos, and the slideshow cases one with a photo album,
 * which the demo server does not have, so they skip there (RTA_SERVER_URL / RTA_SERVER_USER /
 * RTA_SERVER_PASS).
 */
import { beforeAll, expect, it } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import {
  authenticate,
  getHero,
  getJson,
  getLibraries,
  libraryIdFor,
  tokenHeader,
} from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { focusDetailButton, navMovieDetails } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  getActiveVals,
  getGlobalVal,
  getVal,
  press,
  sleep,
  stopPlayback,
  waitFocusInside,
  waitFor,
  waitFocused,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// locale/custom/en_US.json ButtonRefresh.
const REFRESH_LABEL = 'Refresh';
// The details item fetch, which a Refresh repeats (LoadItemsTask metaDataDetails).
const DETAILS_READ = 'itemMetaData';
// Far longer than any case waits, so only Back can take the wait down.
const HELD_MS = 90000;
// Long enough to press keys into the wait, short enough to wait out.
const BRIEF_MS = 8000;
// Time for a key press to reach the player and act, had it acted.
const KEYS_LAND_MS = 1500;

let session;
let libraries;
let hero;
let flacTrack;
let mp3Track;
let album;
let photo;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
  hero = await getHero(session, libraryIdFor(libraries, 'movies'));
  const audio = await getJson(
    `${RTA_CONFIG.server.url}/Users/${session.userId}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources`,
    tokenHeader(session.token),
  );
  flacTrack = audio.Items.find((t) => t.MediaSources?.[0]?.Container === 'flac') ?? null;
  mp3Track = audio.Items.find((t) => t.MediaSources?.[0]?.Container === 'mp3') ?? null;
  const albums = await getJson(
    `${RTA_CONFIG.server.url}/Users/${session.userId}/Items?IncludeItemTypes=PhotoAlbum&Recursive=true&Limit=1`,
    tokenHeader(session.token),
  );
  album = albums.Items[0] ?? null;
  const photos = await getJson(
    `${RTA_CONFIG.server.url}/Users/${session.userId}/Items?IncludeItemTypes=Photo&Recursive=true&Limit=1`,
    tokenHeader(session.token),
  );
  photo = photos.Items[0] ?? null;
});

async function freshApp(label) {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label);
}

function waitHeld(count, label) {
  return waitFor('rtaHeldRequests', (v) => v === count, {
    read: getGlobalVal,
    timeout: 10000,
    interval: 250,
    label,
  });
}

function waitActive(subtype, label, timeout = 15000) {
  return waitFor('subtype()', (v) => v === subtype, {
    read: getActiveVal,
    timeout,
    interval: 250,
    label,
  });
}

function waitSpinner(visible, label, timeout = 5000) {
  return waitFor('#spinner.visible', (v) => v === visible, { timeout, interval: 250, label });
}

/** The active screen can be seen: neither hidden (`visible`) nor faded out (`opacity`). */
async function activeScreenShows() {
  const [visible, opacity] = await getActiveVals(['visible', 'opacity']);
  return visible === true && opacity === 1;
}

/** An app wait hides the active screen under the spinner and holds the remote focus. */
async function expectHeldUnderSpinner(subtype) {
  expect(await getActiveVal('subtype()')).toBe(subtype);
  expect(await activeScreenShows(), `${subtype} hidden while the action waits`).toBe(false);
  expect(await getVal('#spinner.visible'), 'the spinner is up while the action waits').toBe(true);
  await waitFocused((f) => f.node?.subtype === 'AppWaitHost', {
    label: 'the wait holds the remote focus',
    timeout: 3000,
  });
}

/** The action ended: no spinner, and `subtype` is on show again with the focus back. */
async function expectShownAgain(subtype, label) {
  await waitSpinner(false, `no spinner once ${label}`);
  expect(await getActiveVal('subtype()'), `still on ${subtype}`).toBe(subtype);
  expect(await activeScreenShows(), `${subtype} shown again`).toBe(true);
  expect(await getVal('isRemoteDisabled'), 'the remote is live').toBe(false);
  await waitFocused((f) => f.node?.subtype !== 'AppWaitHost', {
    label: `${subtype} has the focus back`,
    timeout: 3000,
  });
}

/** The ids of the details buttons on show, in order. */
async function detailButtonIds() {
  const ids = [];
  for (let i = 0; i < 12; i++) {
    const id = await getActiveVal(`#buttons.${i}.id`);
    if (id === undefined) break;
    ids.push(id);
  }
  return ids;
}

/** On details: press Refresh, from the button row or from the More menu it overflowed into. */
async function pressRefresh() {
  const ids = await detailButtonIds();
  if (ids.includes('refreshButton')) {
    await focusDetailButton('refreshButton');
    await press(ecp.Key.Ok);
    return;
  }
  await focusDetailButton('moreButton');
  await press(ecp.Key.Ok);
  await waitFocusInside('#optionList', { label: 'the More menu focused', timeout: 5000 });
  const items = await getVal('#jrDialog.items');
  const row = Array.isArray(items) ? items.indexOf(REFRESH_LABEL) : -1;
  expect(row, `Refresh in the More menu (${JSON.stringify(items)})`).toBeGreaterThan(-1);
  for (let i = await getVal('#optionList.itemFocused'); i < row; i++) await press(ecp.Key.Down);
  await waitFor('#optionList.itemFocused', (n) => n === row, {
    label: 'Refresh focused in the More menu',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);
}

async function refreshHeld(ms) {
  await freshApp('in-screen-action-waits refresh');
  await navMovieDetails({ libraries, heroIndex: hero.index });
  await failRequests([{ prefix: DETAILS_READ, kind: 'slow', ms, times: 1 }]);
  await pressRefresh();
  await waitHeld(1, 'the refresh fetch is on a pool slot');
}

it('Refresh: Back cancels it and shows details again', async () => {
  await refreshHeld(HELD_MS);
  await expectHeldUnderSpinner('ItemDetails');

  await press(ecp.Key.Back);
  await expectShownAgain('ItemDetails', 'Back cancelled the refresh');
});

it('Refresh: other keys wait, and the refresh lands', async () => {
  await refreshHeld(BRIEF_MS);
  await expectHeldUnderSpinner('ItemDetails');

  await press(ecp.Key.Down);
  await press(ecp.Key.Ok);
  await waitSpinner(false, 'the refresh landed', BRIEF_MS + 10000);
  await expectShownAgain('ItemDetails', 'the refresh landed');
});

/** Cold start, then play `track` by casting it, and wait for it to play. */
async function playTrack(track) {
  await freshApp('in-screen-action-waits seek');
  await ecp.sendInput({ params: { contentId: `id=${track.Id}|action=play` } });
  await waitActive('AudioPlayerView', 'the audio player opened', 30000);
  await waitFor('audioPlayer.state', (v) => v === 'playing', {
    read: getGlobalVal,
    timeout: 30000,
    interval: 250,
    label: 'the song playing',
  });
}

/** Scrub forward three steps from the scrub bar the player focuses on Up, and commit. */
async function scrubAndCommit() {
  await press(ecp.Key.Up);
  for (let i = 0; i < 3; i++) await press(ecp.Key.Right);
  await press(ecp.Key.Ok);
}

/** Play the FLAC track, then commit a scrub whose new stream is held for `ms`. */
async function seekHeld(ms) {
  await playTrack(flacTrack);
  // A FLAC seek asks the server for a stream that starts at the target (audioSeek).
  await failRequests([{ prefix: 'playbackInfo', kind: 'slow', ms, times: 1 }]);
  await scrubAndCommit();
  await waitHeld(1, 'the seek stream is on a pool slot');
}

it('seek: the player stays on show and ignores keys but Back, which leaves it', async (testCtx) => {
  if (!flacTrack) testCtx.skip('server has no FLAC track');
  await seekHeld(HELD_MS);
  expect(await getActiveVal('subtype()')).toBe('AudioPlayerView');
  expect(await activeScreenShows(), 'the player stays on show during a seek').toBe(true);
  expect(await getVal('#spinner.visible'), 'the spinner is up during the seek').toBe(true);

  // The old stream is paused while the new one loads; OK would resume it, and Down would move
  // the focus off the scrub bar.
  const focusedBefore = (await odc.getFocusedNode({ includeNode: true }))?.keyPath;
  expect(focusedBefore, 'the focus was read').toBeTruthy();
  expect(await getGlobalVal('audioPlayer.state'), 'the old stream paused').toBe('paused');
  await press(ecp.Key.Down);
  await press(ecp.Key.Ok);
  await press(ecp.Key.Right);
  // Keys the player ignores change nothing a field could report, so give them time to land.
  await sleep(KEYS_LAND_MS);
  expect((await odc.getFocusedNode({ includeNode: true }))?.keyPath, 'the focus did not move').toBe(
    focusedBefore,
  );
  expect(await getGlobalVal('audioPlayer.state'), 'OK did not resume the old stream').toBe(
    'paused',
  );
  expect(await getVal('#spinner.visible'), 'the seek still waits').toBe(true);

  await press(ecp.Key.Back);
  await waitFor('subtype()', (v) => v !== 'AudioPlayerView', {
    read: getActiveVal,
    timeout: 10000,
    interval: 250,
    label: 'Back left the player',
  });
  await waitSpinner(false, 'no spinner once Back left the player');
  expect(await getVal('isRemoteDisabled')).toBe(false);
});

// A native seek on a paused song never moves the position, so a wait on it would never end and
// would hold every key but Back. A native seek opens none.
it('seek: a paused MP3 seek does not leave the keys held', async (testCtx) => {
  if (!mp3Track) testCtx.skip('server has no MP3 track');
  await playTrack(mp3Track);
  await press(ecp.Key.Play);
  await waitFor('audioPlayer.state', (v) => v === 'paused', {
    read: getGlobalVal,
    timeout: 10000,
    interval: 250,
    label: 'the song paused',
  });
  await scrubAndCommit();
  // Play is a key a seek wait would hold; it must reach the player.
  await press(ecp.Key.Play);
  await waitFor('audioPlayer.state', (v) => v === 'playing', {
    read: getGlobalVal,
    timeout: 10000,
    interval: 250,
    label: 'Play resumed the song after the seek',
  });
  await stopPlayback();
});

/** Open the album's details, slow its photo read, and press Slideshow. */
async function slideshowHeld(ms) {
  await freshApp('in-screen-action-waits slideshow');
  await ecp.sendInput({ params: { contentId: album.Id } });
  await waitActive('ItemDetails', 'the album details opened', 30000);
  await failRequests([{ prefix: 'qp_photoAlbum', kind: 'slow', ms, times: 1 }]);
  await focusDetailButton('slideshowButton');
  await press(ecp.Key.Ok);
  await waitHeld(1, 'the album read is on a pool slot');
}

it('slideshow: Back cancels it and shows the album again', async (testCtx) => {
  if (!album) testCtx.skip('server has no photo album');
  await slideshowHeld(HELD_MS);
  await expectHeldUnderSpinner('ItemDetails');

  await press(ecp.Key.Back);
  await expectShownAgain('ItemDetails', 'Back cancelled the slideshow');
});

it('slideshow: left alone, it opens the photo viewer', async (testCtx) => {
  if (!album) testCtx.skip('server has no photo album');
  await slideshowHeld(BRIEF_MS);
  await expectHeldUnderSpinner('ItemDetails');

  await waitActive('PhotoDetails', 'the photo viewer opened', BRIEF_MS + 15000);
  await waitSpinner(false, 'no spinner over the photo');
  expect(await getVal('isRemoteDisabled')).toBe(false);
});

it('photo: View opens the viewer, the start ends there, and Back shows details again', async (testCtx) => {
  if (!photo) testCtx.skip('server has no photo');
  await freshApp('in-screen-action-waits photo');
  await ecp.sendInput({ params: { contentId: photo.Id } });
  await waitActive('ItemDetails', 'the photo details opened', 30000);
  await focusDetailButton('viewPhotoButton');
  await press(ecp.Key.Ok);
  await waitActive('PhotoDetails', 'the photo viewer opened');
  await waitSpinner(false, 'no spinner over the photo');
  expect(await activeScreenShows(), 'the viewer is on show').toBe(true);
  expect(await getVal('isRemoteDisabled')).toBe(false);

  await press(ecp.Key.Back);
  await waitActive('ItemDetails', 'Back from the viewer');
  await expectShownAgain('ItemDetails', 'Back left the viewer');
});
