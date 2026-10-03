/**
 * RTA functional test: "Are you still watching?" (#982).
 *
 * When the queue moves on by itself after enough unattended videos, the next video plays
 * under a centred prompt that any key answers. With no answer in 30 s the video pauses with
 * its OSD up. Reaching the real trigger takes an hour or more of playback, so the spec turns
 * on the RTA-only `rtaForceStillWatching` hook (source/utils/globals.bs), which makes every
 * automatic advance ask. What the hook skips — when to ask — is unit-tested in
 * tests/source/unit/utils/stillWatching.spec.bs.
 *
 * The episode is resolved at runtime by capability (`findEpisodeWithNext`), never by
 * name, so this runs against whichever server `RTA_SERVER_*` points at (#910).
 *
 * Requires a reachable device + .env (ROKU_IP / ROKU_PASSWORD), same as screens.spec.
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, findEpisodeWithNext } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import {
  waitFor,
  waitHome,
  waitDialogClosed,
  getVal,
  readPlayer,
  press,
  stopPlayback,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];

// Same budgets as playback-advance.spec.js: seek this close to the end, then allow for the
// handover to the next episode against a remote server.
const SECONDS_BEFORE_END = 10;
const ADVANCE_TIMEOUT_MS = 120000;

// The prompt waits 30 s (STILL_WATCHING_RESPONSE_SECONDS); the pause lands on the next tick.
const PROMPT_TIMEOUT_MS = 45000;

let session;
let episode;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  episode = await findEpisodeWithNext(session);
  if (!episode) {
    throw new Error(
      `still-watching setup: no series on ${session.serverUrl} has two episodes, so nothing advances`,
    );
  }
});

/** Play an episode to its end with the hook on, and wait for the prompt over the next one. */
async function advanceIntoPrompt() {
  const expectedServer = await seedHome(session, LOCALE);
  // Auto-advance needs the next episode queued; pin the setting that queues it (see
  // playback-advance.spec.js). rta-run.js restores the whole registry afterwards.
  await odc.writeRegistry({
    values: { [session.userId]: { playbackPlayNextEpisode: 'enabled' } },
  });
  await hardRelaunch(); // a plain relaunch lets the running app re-persist over the seed
  await assertSeedTookEffect(expectedServer, 'still-watching');
  await waitHome();
  await odc.setValue({ base: 'global', keyPath: 'rtaForceStillWatching', value: true });

  await ecp.sendInput({ params: { contentId: `id=${episode.id}|action=play` } });
  await waitFor('state', (v) => v === 'playing', {
    timeout: 90000,
    interval: 1000,
    label: `first episode playing (${episode.seriesName})`,
    read: readPlayer(episode.id),
  });
  // Seek from the SERVER's runtime, not the player's `duration` — see findEpisodeWithNext.
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
  await waitFor('#jrDialog.id', (v) => v === 'jrDialog', {
    timeout: 10000,
    label: 'still-watching prompt over the next episode',
  });
}

it('any key answers the prompt and the next episode keeps playing', async () => {
  try {
    await advanceIntoPrompt();
    expect(await getVal('#jrDialog.subheading'), 'the prompt counts down').toMatch(/\d/);

    // Down, not OK: any key answers, and the answer is all it does — on a bare player Down
    // would open the OSD.
    await press(ecp.Key.Down);
    await waitDialogClosed('a key answered the still-watching prompt');
    expect(await getVal('#osd.visible'), 'the answering key also opened the OSD').toBe(false);
    expect(await readPlayer(episode.nextId)('state')).toBe('playing');
  } finally {
    await stopPlayback();
  }
}, 300000);

it('with no answer the video pauses with its OSD up', async () => {
  try {
    await advanceIntoPrompt();

    await waitFor('state', (v) => v === 'paused', {
      timeout: PROMPT_TIMEOUT_MS,
      interval: 1000,
      label: 'no answer paused the next episode',
      read: readPlayer(episode.nextId),
    });
    await waitDialogClosed('the unanswered prompt closed');
    expect(await getVal('#osd.visible'), 'the paused player shows its OSD').toBe(true);
  } finally {
    await stopPlayback();
  }
}, 300000);
