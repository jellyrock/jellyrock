/**
 * A paused player keeps the server's view of it true (#1281), the video player and the audio
 * player alike.
 *
 * Jellyfin ends a playing session that sent no report of its own for more than 5 minutes,
 * paused or not, and it can lose a pause report to the "still playing" copies it makes of the
 * last report once a second. So each player reads its session back after a pause report and
 * sends the pause again if it was lost, and keeps reporting while the stream is open
 * (`source/utils/playbackCheckIn.bs`). Each case pauses, waits for the server to show the
 * pause, then waits for a newer check-in while the player stays paused: that check-in is what
 * keeps the server from ending the session.
 *
 * The read-back's resend can't be forced from here (the loss depends on server timing), so
 * `playbackCheckIn.spec.bs` covers that rule; these cases cover the reports reaching the server.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, firstMovie, getJson, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import {
  getActiveVal,
  getGlobalVal,
  press,
  readPlayer,
  stopPlayback,
  waitFor,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// An MP3 on the demo server, long enough to sit paused in (audio-seek.spec.js checks it is there).
const SONG = 'Thunderdays';
// The keepalive (playbackCheckIn.KEEPALIVE_SECONDS, 60 s) plus room for the report to land.
const CHECK_IN_WAIT_MS = 90000;

let session;
let deviceId;
let movie;
let songId;

/** This Roku's session on the server, read the way the app reads it back. */
async function appSessionNow() {
  const query = new URLSearchParams({ deviceId });
  const sessions = await getJson(
    `${session.serverUrl}/Sessions?${query}`,
    tokenHeader(session.token),
  );
  return (sessions || []).find((s) => s.DeviceId === deviceId);
}
const readSession = async (keyPath) => {
  const s = await appSessionNow();
  if (keyPath === 'session.PlayState.IsPaused') return s?.PlayState?.IsPaused;
  if (keyPath === 'session.LastPlaybackCheckIn') return s?.LastPlaybackCheckIn;
  return undefined;
};

/** The server shows the pause, then a newer check-in arrives while the player stays paused. */
async function expectPausedCheckIns(what, readPlayerState) {
  await waitFor('session.PlayState.IsPaused', (v) => v === true, {
    read: readSession,
    timeout: 15000,
    interval: 1000,
    label: `the server shows the ${what} paused`,
  });
  const since = Date.parse(await readSession('session.LastPlaybackCheckIn'));
  expect(Number.isNaN(since), 'the session carries a check-in time').toBe(false);
  await waitFor('session.LastPlaybackCheckIn', (v) => Date.parse(v) > since, {
    read: readSession,
    timeout: CHECK_IN_WAIT_MS,
    interval: 2000,
    label: `a newer check-in from the paused ${what}`,
  });
  expect(await readPlayerState(), `the ${what} stayed paused`).toBe('paused');
  expect(await readSession('session.PlayState.IsPaused'), 'the server still shows it paused').toBe(
    true,
  );
}

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  movie = await firstMovie(session);
  expect(movie.id, 'a movie to play').toBeTruthy();
  const songs = await getJson(
    `${session.serverUrl}/Users/${session.userId}/Items?IncludeItemTypes=Audio&Recursive=true`,
    tokenHeader(session.token),
  );
  songId = (songs?.Items ?? []).find((t) => t.Name === SONG)?.Id;
  expect(songId, `the demo song "${SONG}"`).toBeTruthy();
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'playback-check-in');
  deviceId = await getGlobalVal('device.serverDeviceName');
  expect(deviceId, "the app's DeviceId").toBeTruthy();
});

it('a paused video keeps checking in, and the server keeps it paused', async () => {
  const read = readPlayer(movie.id);
  try {
    await ecp.sendInput({ params: { contentId: `id=${movie.id}|action=play` } });
    await waitFor('state', (v) => v === 'playing', {
      read,
      timeout: 90000,
      interval: 1000,
      label: `${movie.name} playing`,
    });
    await press(ecp.Key.Play);
    await waitFor('state', (v) => v === 'paused', {
      read,
      timeout: 10000,
      label: `${movie.name} paused by the Play key`,
    });
    await expectPausedCheckIns('video', () => read('state'));
  } finally {
    await stopPlayback();
  }
});

it('a paused song keeps checking in, and the server keeps it paused', async () => {
  const readState = () => getGlobalVal('audioPlayer.state');
  try {
    await ecp.sendInput({ params: { contentId: `id=${songId}|action=play` } });
    await waitFor('subtype()', (v) => v === 'AudioPlayerView', {
      read: getActiveVal,
      timeout: 30000,
      interval: 250,
      label: 'the audio player opened',
    });
    await waitFor('audioPlayer.state', (v) => v === 'playing', {
      read: getGlobalVal,
      timeout: 30000,
      interval: 250,
      label: `${SONG} playing`,
    });
    await press(ecp.Key.Play);
    await waitFor('audioPlayer.state', (v) => v === 'paused', {
      read: getGlobalVal,
      timeout: 10000,
      label: `${SONG} paused by the Play key`,
    });
    await expectPausedCheckIns('song', readState);
  } finally {
    await stopPlayback();
  }
});
