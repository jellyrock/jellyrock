/**
 * A seek in a song still ends the song (#662).
 *
 * Roku can't finish a FLAC it starts mid-file when the file's last frame is shorter than its
 * frame size: it stalls in `playing` a moment before the end, or ends at once with "malformed
 * data". The demo track "Jellyfin" (Leap Fidei) is such a file. A FLAC seek therefore asks
 * the server for a stream that starts at the target (`audioSeek`, `AudioStream`), and when
 * that can't happen the AudioPlayer engine's end guard ends a stuck track. Each case here
 * plays one song, so a song that ends leaves the audio player for the song's details.
 *
 * Measured 2026-10-21 on a Stick 4K, Roku OS 15.3.4, before the fix: a 50% seek in
 * "Jellyfin" froze 13 of 13 times, and a seek into its last 10 s ended it at once 4 of 4.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getJson, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  getGlobalVal,
  press,
  stopPlayback,
  waitFor,
  waitToast,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const FLAC_TRACK = 'Jellyfin';
const MP3_TRACK = 'Thunderdays';
// locale/custom/en_US.json MessageFlacSeekNeedsTranscoding.
const FALLBACK_NOTICE =
  "Seeking in FLAC needs audio transcoding, which this account doesn't allow. The track may end early.";
// Past the end of what is left to play: the guard's stall window and the swap to a server
// stream both fit inside it.
const END_SLACK_MS = 30000;

let session;
let tracks;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  const res = await getJson(
    `${RTA_CONFIG.server.url}/Users/${session.userId}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=MediaSources`,
    tokenHeader(session.token),
  );
  tracks = res.Items;
  // The cases are about these two files; without them the spec would prove nothing.
  for (const [name, container] of [
    [FLAC_TRACK, 'flac'],
    [MP3_TRACK, 'mp3'],
  ]) {
    const track = tracks.find((t) => t.Name === name);
    if (!track || track.MediaSources?.[0]?.Container !== container) {
      throw new Error(`demo fixture changed: no ${container} track named "${name}"`);
    }
  }
});

function track(name) {
  return tracks.find((t) => t.Name === name);
}

/** Cold start on Home, then play one song by casting it, and wait for it to play. */
async function playSong(name) {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'audio-seek');
  await ecp.sendInput({ params: { contentId: `id=${track(name).Id}|action=play` } });
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
    label: `${name} playing`,
  });
}

/**
 * Scrub forward by `steps` ten-second steps and commit with OK, from the scrub bar the
 * player gives focus on Up. Returns where the seek lands, in the whole track.
 */
async function scrubForward(steps, lengthSeconds) {
  const from = await getGlobalVal('audioPlayer.position');
  await press(ecp.Key.Up);
  for (let i = 0; i < steps; i++) await press(ecp.Key.Right);
  await press(ecp.Key.Ok);
  // The scrub bar stops five seconds short of the end (processScrubAction).
  return Math.min(from + steps * 10, lengthSeconds - 5);
}

/** Waits for the one-song queue to end, which leaves the audio player. Returns the wait in ms. */
async function waitSongEnded(label, timeout) {
  const started = Date.now();
  await waitFor('subtype()', (v) => v !== 'AudioPlayerView', {
    read: getActiveVal,
    timeout,
    interval: 250,
    label,
  });
  return Date.now() - started;
}

it('a FLAC seeked to the middle plays to its end and the queue moves on', async () => {
  const flac = track(FLAC_TRACK);
  const length = flac.RunTimeTicks / 1e7;
  await playSong(FLAC_TRACK);
  const target = await scrubForward(Math.floor(length / 20), length);
  const left = (length - target) * 1000;
  const waited = await waitSongEnded('the song ended after a mid-track seek', left + END_SLACK_MS);
  // Ending well before the rest could play would be the "ended early" failure, not a fix.
  expect(waited, 'the rest of the song played').toBeGreaterThan(left - 5000);
});

it('a FLAC seeked into its last seconds plays them, then the queue moves on', async () => {
  const flac = track(FLAC_TRACK);
  const length = flac.RunTimeTicks / 1e7;
  await playSong(FLAC_TRACK);
  // Every step the scrub bar allows: it lands five seconds short of the end.
  const target = await scrubForward(Math.ceil(length / 10) + 1, length);
  const left = (length - target) * 1000;
  const waited = await waitSongEnded('the song ended after a near-end seek', left + END_SLACK_MS);
  expect(waited, 'the last seconds played instead of being skipped').toBeGreaterThan(left - 2000);
});

it('without audio transcoding, a FLAC seek says so once and the song still ends', async () => {
  const flac = track(FLAC_TRACK);
  const length = flac.RunTimeTicks / 1e7;
  await playSong(FLAC_TRACK);
  // An account whose policy forbids audio transcoding, which the demo user can't be made.
  await odc.setValue({
    base: 'global',
    keyPath: 'user.policy.enableAudioPlaybackTranscoding',
    value: false,
  });
  const target = await scrubForward(Math.floor((length * 0.75) / 10), length);
  const seekedAt = Date.now();
  const left = (length - target) * 1000;
  await waitToast(FALLBACK_NOTICE, { label: 'the fallback notice' });
  // The direct stream may stall at its end; the engine's guard ends it.
  await waitSongEnded('the song ended through the fallback', left + END_SLACK_MS);
  // Ending well before the rest could play is the "malformed data" early end, not a fallback.
  expect(Date.now() - seekedAt, 'the rest of the song played').toBeGreaterThan(left - 5000);
});

it('when the server stream for a seek fails, the song still ends', async () => {
  const flac = track(FLAC_TRACK);
  const length = flac.RunTimeTicks / 1e7;
  await playSong(FLAC_TRACK);
  // The next PlaybackInfo is the seek's: the song's own already loaded.
  await failRequests([{ prefix: 'playbackInfo', kind: 'timeout', times: 1 }]);
  const target = await scrubForward(Math.floor((length * 0.75) / 10), length);
  const left = (length - target) * 1000;
  const waited = await waitSongEnded(
    'the song ended after a failed server stream',
    left + END_SLACK_MS,
  );
  expect(waited, 'the rest of the song played').toBeGreaterThan(left - 5000);
});

it('an MP3 seek stays in the stream that is playing', async () => {
  const mp3 = track(MP3_TRACK);
  const length = mp3.RunTimeTicks / 1e7;
  await playSong(MP3_TRACK);
  const sessionBefore = await getGlobalVal('audioPlayer.content.id');
  await scrubForward(3, length);
  await waitFor('audioPlayer.state', (v) => v === 'playing', {
    read: getGlobalVal,
    timeout: 15000,
    interval: 250,
    label: 'the MP3 playing after its seek',
  });
  expect(await getGlobalVal('audioPlayer.content.id'), 'no new stream for an MP3 seek').toBe(
    sessionBefore,
  );
  expect(await getGlobalVal('audioPlayer.content.isServerSeek'), 'not a server stream').toBe(false);
  await stopPlayback();
});
