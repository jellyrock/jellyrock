/**
 * RTA functional test: an episode that plays to its natural end hands over to the next
 * episode in the queue, or, on Repeat One, plays again from its start.
 *
 * The advance is owned by `PlayerHostView.onPlayerStateChange`, which only acts when it
 * hears the player's `finished`. #898 broke that without a single failing test: the
 * player's own `m.top.unobserveField("state")` also removed the HOST's observer (pinned in
 * tests/source/unit/platform/ObserverRegistry.spec.bs), so every natural end left a
 * stopped player on a black screen. Nothing else in the suite plays anything to its end.
 *
 * The episode is resolved at runtime by capability (`findEpisodeWithNext`), never by
 * name, so this runs against whichever server `RTA_SERVER_*` points at (#910).
 *
 * Requires a reachable device + .env (ROKU_IP / ROKU_PASSWORD), same as screens.spec.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import {
  authenticate,
  findEpisodeWithNext,
  getJson,
  postJson,
  tokenHeader,
} from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import { waitFor, waitHome, waitOsdUp, readPlayer, stopPlayback } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];

// How far before the end to seek. Long enough for Roku to accept the seek and resume
// playing before the stream runs out, short enough that the wait below is not spent
// watching an episode.
const SECONDS_BEFORE_END = 10;

// Budget for the whole handover once the seek lands: the remaining seconds of the first
// episode, the host tearing that player down, the next player's metadata fetch against a
// remote server, and its stream start (measured ~5-7 s on every device; tests/rta/CLAUDE.md).
const ADVANCE_TIMEOUT_MS = 120000;

let session;
let episode;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  episode = await findEpisodeWithNext(session);
  if (!episode) {
    throw new Error(
      `playback-advance setup: no series on ${session.serverUrl} has two episodes, so there is nothing to advance to`,
    );
  }
});

// The settings these cases pin outlive the file otherwise: the registry is restored only once
// the whole run ends, so every spec after this one would queue the next episode and play a
// Cinema Mode intro first. Delete the keys (null) so they start from the defaults.
afterAll(async () => {
  if (session) {
    await odc.writeRegistry({
      values: { [session.userId]: { playbackPlayNextEpisode: null, playbackCinemaMode: null } },
    });
  }
});

// Plays the episode with the next one in its queue, and returns once it is playing.
async function playEpisodeWithNextQueued() {
  const expectedServer = await seedHome(session, LOCALE);
  // Auto-advance only happens when the queue holds the next episode, and
  // LoadVideoContentTask only queues it when this setting allows. Its default
  // ("webclient") defers to a per-user SERVER setting, which would make the result a
  // fact about the fixture rather than the app, so pin it. rta-run.js restores the
  // whole registry afterwards.
  await odc.writeRegistry({ values: { [session.userId]: { playbackPlayNextEpisode: 'enabled' } } });
  await hardRelaunch(); // never plain relaunch: only hardRelaunch confirms the cold start
  await assertSeedTookEffect(expectedServer, 'playback-advance');
  await waitHome();

  await ecp.sendInput({ params: { contentId: `id=${episode.id}|action=play` } });
  await waitFor('state', (v) => v === 'playing', {
    timeout: 90000,
    interval: 1000,
    label: `first episode playing (${episode.seriesName})`,
    read: readPlayer(episode.id),
  });
}

// Seeks to SECONDS_BEFORE_END before the end and returns the position sought. Seek from the
// SERVER's runtime, not the player's `duration`; see findEpisodeWithNext.
async function seekNearEnd() {
  const seekTo = episode.runTimeSeconds - SECONDS_BEFORE_END;
  await odc.setValue({ base: 'scene', keyPath: `#${episode.id}.seek`, value: seekTo });
  return seekTo;
}

// The id of the first intro the server serves for an item, or undefined when it serves none
// (the public demo has no Intros plugin).
async function introIdFor(itemId) {
  const introsUrl = `${session.serverUrl}/Users/${session.userId}/Items/${itemId}/Intros`;
  const intros = (await getJson(introsUrl, tokenHeader(session.token)))?.Items ?? [];
  return intros[0]?.Id;
}

// Sets an item's resume position on the server. The loader asks for an intro only on a play
// from the start (jellyfin-web draws the same line). The route is 10.9 and later, which a
// server with the Intros plugin is.
async function setPlaybackPosition(itemId, positionTicks) {
  await postJson(
    `${session.serverUrl}/UserItems/${itemId}/UserData?userId=${session.userId}`,
    { ...tokenHeader(session.token), 'Content-Type': 'application/json' },
    { PlaybackPositionTicks: positionTicks, Played: false },
  );
}

// Seeds Home with Cinema Mode on and the next episode queued, cold-starts the app so it reads
// the seed, and returns on Home.
async function relaunchWithCinemaMode(label) {
  const expectedServer = await seedHome(session, LOCALE);
  await odc.writeRegistry({
    values: {
      [session.userId]: { playbackPlayNextEpisode: 'enabled', playbackCinemaMode: 'true' },
    },
  });
  await hardRelaunch(); // never plain relaunch: only hardRelaunch confirms the cold start
  await assertSeedTookEffect(expectedServer, label);
  await waitHome();
}

it('an episode that ends naturally advances to the next episode', async () => {
  try {
    await playEpisodeWithNextQueued();
    await seekNearEnd();
    await waitFor('state', (v) => v === 'playing', {
      timeout: ADVANCE_TIMEOUT_MS,
      interval: 2000,
      label: `advanced to the next episode (${episode.nextId})`,
      read: readPlayer(episode.nextId),
    });
  } finally {
    await stopPlayback();
  }
}, 300000);

// Repeat One wins over the advance: the queue holds the next episode, and the end plays this
// one again from its start (queueRepeat.nextIndex). The mode is set by writing the OSD's pick
// field, which runs the handler a gear pick runs; dialogs.spec.js walks the gear itself.
it('an episode on Repeat One plays again from its start instead of advancing', async () => {
  try {
    await playEpisodeWithNextQueued();
    await odc.setValue({ base: 'scene', keyPath: '#osd.repeatModePick', value: 'RepeatOne' });
    // The gear lights once the queue holds the mode (VideoPlayerView.onRepeatModePicked).
    await waitFor('#showPlaybackSettings.isButtonSelected', (v) => v === true, {
      timeout: 10000,
      label: 'Repeat One recorded on the queue',
    });

    const seekTo = await seekNearEnd();
    // The seek has landed, so the position can fall below seekTo only through a remount.
    await waitFor('position', (v) => typeof v === 'number' && v >= seekTo - 1, {
      timeout: 30000,
      interval: 1000,
      label: 'seek landed near the end',
      read: readPlayer(episode.id),
    });
    await waitFor('position', (v) => typeof v === 'number' && v < seekTo - SECONDS_BEFORE_END, {
      timeout: ADVANCE_TIMEOUT_MS,
      interval: 2000,
      label: `played ${episode.id} again from its start`,
      read: readPlayer(episode.id),
    });
  } finally {
    await stopPlayback();
  }
}, 300000);

// Cinema Mode plays an intro in the launched episode's own queue slot and keeps the episode
// behind it, so the slot has to go once the episode plays: left in, the queue reads
// [episode, episode, next], Previous is enabled on the episode and goes back to a copy of
// it, and a repeat of the queue plays the episode twice per loop (QueueManager.advanceTo
// drops the slot). Needs a server whose Intros plugin answers for the episode; the public
// demo does not, so the case skips there with the server named.
it('an episode behind a Cinema Mode intro has no stale slot before it', async (testCtx) => {
  const introId = await introIdFor(episode.id);
  if (!introId) testCtx.skip(`${session.serverUrl} serves no intro for the episode`);
  // The advance case above leaves the episode with a resume position, so reset it first.
  await setPlaybackPosition(episode.id, 0);

  await relaunchWithCinemaMode('playback-advance cinema mode');

  try {
    await ecp.sendInput({ params: { contentId: `id=${episode.id}|action=play` } });
    // The player node carries the queue item's id while it plays the intro; its videoId
    // carries the intro's. Both mounts are read by the episode's id.
    await waitFor('videoId', (v) => v === introId, {
      timeout: 90000,
      interval: 1000,
      label: `intro playing before ${episode.seriesName}`,
      read: readPlayer(episode.id),
    });
    // A reload during the intro (a retry, or a track or gear change) loads the intro again,
    // not the episode with the intro's version, which the server refuses. A gear pick is the
    // reload a viewer can make, with a cap too high to change the intro's direct play, and
    // every load answers with a new PlaySessionId.
    const introSession = await readPlayer(episode.id)('PlaySessionId');
    await odc.setValue({
      base: 'scene',
      keyPath: '#osd.playbackCapsPick',
      value: { field: 'maxBitrateMbps', value: 120 },
    });
    await waitFor('PlaySessionId', (v) => Boolean(v) && v !== introSession, {
      timeout: 30000,
      interval: 1000,
      label: `intro reloaded by a gear pick (${episode.seriesName})`,
      read: readPlayer(episode.id),
    });
    expect(await readPlayer(episode.id)('videoId'), 'the reload loads the intro again').toBe(
      introId,
    );
    await waitFor('videoId', (v) => v === episode.id, {
      timeout: ADVANCE_TIMEOUT_MS,
      interval: 2000,
      label: `episode playing after its intro (${episode.seriesName})`,
      read: readPlayer(episode.id),
    });
    await waitOsdUp('osd up on the episode', { itemId: episode.id });
    const [hasPrevious, hasNext] = await Promise.all([
      odc.getValue({ base: 'scene', keyPath: '#itemBack.isEnabled' }).then((r) => r.value),
      odc.getValue({ base: 'scene', keyPath: '#itemNext.isEnabled' }).then((r) => r.value),
    ]);
    expect(hasPrevious, 'nothing before the episode once its intro slot is gone').toBe(false);
    expect(hasNext, 'the next episode is still queued behind it').toBe(true);
  } finally {
    await stopPlayback();
  }
}, 300000);

// A Repeat One pick while the intro plays used to leave the launched item twice in the queue:
// the intro's end replayed index 0, the slot the intro played in, which loaded as the episode
// while the tagged copy stayed behind it (QueueManager.advanceTo drops the slot on arrival).
// Needs a server whose Intros plugin answers for the episode, so the case skips elsewhere.
it('a Repeat One pick during a Cinema Mode intro plays the episode once, with no slot before it', async (testCtx) => {
  const introId = await introIdFor(episode.id);
  if (!introId) testCtx.skip(`${session.serverUrl} serves no intro for the episode`);
  await setPlaybackPosition(episode.id, 0);

  await relaunchWithCinemaMode('playback-advance cinema mode repeat one');

  try {
    await ecp.sendInput({ params: { contentId: `id=${episode.id}|action=play` } });
    await waitFor('videoId', (v) => v === introId, {
      timeout: 90000,
      interval: 1000,
      label: `intro playing before ${episode.seriesName}`,
      read: readPlayer(episode.id),
    });
    await odc.setValue({ base: 'scene', keyPath: '#osd.repeatModePick', value: 'RepeatOne' });
    await waitFor('#showPlaybackSettings.isButtonSelected', (v) => v === true, {
      timeout: 10000,
      label: 'Repeat One recorded on the queue',
    });
    await waitFor('videoId', (v) => v === episode.id, {
      timeout: ADVANCE_TIMEOUT_MS,
      interval: 2000,
      label: `episode playing after its intro (${episode.seriesName})`,
      read: readPlayer(episode.id),
    });
    await odc.setValue({ base: 'scene', keyPath: '#osd.repeatModePick', value: 'RepeatNone' });
    await waitFor('#showPlaybackSettings.isButtonSelected', (v) => v === false, {
      timeout: 10000,
      label: 'Repeat off recorded on the queue',
    });
    await waitOsdUp('osd up on the episode', { itemId: episode.id });
    const [hasPrevious, hasNext] = await Promise.all([
      odc.getValue({ base: 'scene', keyPath: '#itemBack.isEnabled' }).then((r) => r.value),
      odc.getValue({ base: 'scene', keyPath: '#itemNext.isEnabled' }).then((r) => r.value),
    ]);
    expect(hasPrevious, 'nothing before the episode once its intro slot is gone').toBe(false);
    expect(hasNext, 'the next episode is still queued behind it').toBe(true);
    // The stale slot sits at position 1, so Previous reads false either way. It shows when the
    // episode ends: the queue moves to that copy and replays the episode, never reaching the next.
    await seekNearEnd();
    await waitFor('state', (v) => v === 'playing', {
      timeout: ADVANCE_TIMEOUT_MS,
      interval: 2000,
      label: `advanced to the next episode, not a second copy (${episode.nextId})`,
      read: readPlayer(episode.nextId),
    });
  } finally {
    await stopPlayback();
  }
}, 300000);

// Cinema Mode is spent by the first load of a queue, intro or not (jellyfin-web decides once
// per play request, for the first item only, and returns no intros on a resume). A resumed
// launch plays no intro, so the flag must not wait for the next item: left armed, the next
// episode the queue reaches plays an intro mid-binge. Needs a server whose Intros plugin
// answers for the next episode, so the case skips elsewhere with the server named.
it('a resumed launch spends Cinema Mode, so the next episode plays no intro', async (testCtx) => {
  if (!(await introIdFor(episode.nextId)))
    testCtx.skip(`${session.serverUrl} serves no intro for the next episode`);
  // Resume the launched episode near its end, and play the next one from the start, so the
  // only reason the next episode could get an intro is a Cinema Mode flag left armed.
  await setPlaybackPosition(episode.id, (episode.runTimeSeconds - 20) * 10000000);
  await setPlaybackPosition(episode.nextId, 0);

  await relaunchWithCinemaMode('playback-advance cinema mode resume');

  try {
    // The deep link resumes from the saved position, so no intro plays first.
    await ecp.sendInput({ params: { contentId: `id=${episode.id}|action=play` } });
    await waitFor('videoId', (v) => v === episode.id, {
      timeout: 90000,
      interval: 1000,
      label: `resumed episode playing with no intro (${episode.seriesName})`,
      read: readPlayer(episode.id),
    });
    await waitFor('videoId', (v) => Boolean(v), {
      timeout: ADVANCE_TIMEOUT_MS,
      interval: 2000,
      label: `next episode loaded (${episode.nextId})`,
      read: readPlayer(episode.nextId),
    });
    expect(
      await readPlayer(episode.nextId)('videoId'),
      'the next episode plays itself, not a Cinema Mode intro',
    ).toBe(episode.nextId);
  } finally {
    await stopPlayback();
  }
}, 300000);
