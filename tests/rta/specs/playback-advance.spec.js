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
import { beforeAll, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, findEpisodeWithNext } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import { waitFor, waitHome, readPlayer, stopPlayback } from '../lib/steps.js';

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
