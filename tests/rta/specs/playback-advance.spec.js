/**
 * RTA functional test: an episode that plays to its natural end hands over to the next
 * episode in the queue.
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
import { beforeAll, expect, it } from 'vitest';
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

it('an episode that ends naturally advances to the next episode', async () => {
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

  try {
    await ecp.sendInput({ params: { contentId: `id=${episode.id}|action=play` } });

    await waitFor('state', (v) => v === 'playing', {
      timeout: 90000,
      interval: 1000,
      label: `first episode playing (${episode.seriesName})`,
      read: readPlayer(episode.id),
    });

    // Seek from the SERVER's runtime, not the player's `duration`; see findEpisodeWithNext.
    await odc.setValue({
      base: 'scene',
      keyPath: `#${episode.id}.seek`,
      value: episode.runTimeSeconds - SECONDS_BEFORE_END,
    });

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

// Cinema Mode plays an intro in the launched episode's own queue slot and keeps the episode
// behind it, so the slot has to go once the episode plays: left in, the queue reads
// [episode, episode, next], Previous is enabled on the episode and goes back to a copy of
// it, and a repeat of the queue plays the episode twice per loop (QueueManager.advanceTo
// drops the slot). Needs a server whose Intros plugin answers for the episode; the public
// demo does not, so the case skips there with the server named.
it('an episode behind a Cinema Mode intro has no stale slot before it', async (testCtx) => {
  const introsUrl = `${session.serverUrl}/Users/${session.userId}/Items/${episode.id}/Intros`;
  const intros = (await getJson(introsUrl, tokenHeader(session.token)))?.Items ?? [];
  if (intros.length === 0) testCtx.skip(`${session.serverUrl} serves no intro for the episode`);
  const introId = intros[0].Id;
  // The loader asks for an intro only on a play from the start (jellyfin-web draws the same
  // line), and the advance case above leaves the episode with a resume position, so reset
  // it on the server first. The route is 10.9 and later, which a server with the plugin is.
  await postJson(
    `${session.serverUrl}/UserItems/${episode.id}/UserData?userId=${session.userId}`,
    { ...tokenHeader(session.token), 'Content-Type': 'application/json' },
    { PlaybackPositionTicks: 0, Played: false },
  );

  const expectedServer = await seedHome(session, LOCALE);
  await odc.writeRegistry({
    values: {
      [session.userId]: { playbackPlayNextEpisode: 'enabled', playbackCinemaMode: 'true' },
    },
  });
  await hardRelaunch(); // never plain relaunch: only hardRelaunch confirms the cold start
  await assertSeedTookEffect(expectedServer, 'playback-advance cinema mode');
  await waitHome();

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
