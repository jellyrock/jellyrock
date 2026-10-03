/**
 * RTA functional test: the player's notifications stay down while a dialog is open over it.
 *
 * `VideoPlayerView.onPositionChanged` skips the segment and next-episode checks while a
 * dialog is open. It used to decide that by looking for a node named `dialogBackground`,
 * which only `ItemGridOptions` has, so the check never held and the Next Episode button
 * came up over any dialog.
 *
 * The OSD hides that bug in most cases: both notifications refuse to show while it is up,
 * and a dialog opened FROM the OSD keeps it up. What reaches it is a dialog that opens over
 * a playing video with the OSD down — a Jellyfin "send message", for one. The harness
 * cannot send one: the seeded token keeps the app's socket off every session (see
 * `authenticate` in lib/jellyfin.js), and minting a token under the app's own DeviceId
 * could log the device out of that server. So the spec puts a `JRDialog` under the scene
 * with the shared overlay id, which is exactly what the app's `isDialogOpen` query looks
 * for, and removes it again for the positive control.
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
  stopPlayback,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];

// Pinned so the window below is a fact about this test, not about whatever the device's
// registry held. The button shows once `duration - position` is inside it.
const NEXT_UP_BUTTON_SECONDS = 30;

// Where to seek: inside the button's window, with room for the dialog checks and the
// positive control before the episode ends.
const SECONDS_BEFORE_END = 25;

let session;
let episode;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  episode = await findEpisodeWithNext(session);
  if (!episode) {
    throw new Error(
      `playback-notifications setup: no series on ${session.serverUrl} has two episodes, so there is no next episode to offer`,
    );
  }
});

it('the next-episode button stays down while a dialog is open over the player', async () => {
  const expectedServer = await seedHome(session, LOCALE);
  await odc.writeRegistry({
    values: {
      [session.userId]: { playbackNextUpButtonSeconds: String(NEXT_UP_BUTTON_SECONDS) },
    },
  });
  await hardRelaunch(); // a plain relaunch lets the running app re-persist over the seed
  await assertSeedTookEffect(expectedServer, 'playback-notifications');
  await waitHome();

  const read = readPlayer(episode.id);
  try {
    await ecp.sendInput({ params: { contentId: `id=${episode.id}|action=play` } });
    await waitFor('state', (v) => v === 'playing', {
      timeout: 90000,
      interval: 1000,
      label: `episode playing (${episode.seriesName})`,
      read,
    });

    await odc.createChild({
      base: 'scene',
      keyPath: '',
      subtype: 'JRDialog',
      fields: { id: 'jrDialog', title: 'JellyRock RTA', message: 'playback-notifications spec' },
    });
    await waitFor('#jrDialog.id', (v) => v === 'jrDialog', {
      timeout: 10000,
      label: 'dialog open over the player',
    });
    expect(
      await getVal('#osd.visible'),
      'the OSD must be down, or it hides the button itself',
    ).toBe(false);

    // Seek from the SERVER's runtime, not the player's `duration` — see findEpisodeWithNext.
    const seekTo = episode.runTimeSeconds - SECONDS_BEFORE_END;
    await odc.setValue({ base: 'scene', keyPath: `#${episode.id}.seek`, value: seekTo });

    // Gate on the player having PLAYED a few seconds inside the window, so the position
    // observer has run there more than once with the dialog up. Reading the notification
    // any earlier would pass whether or not the check works.
    await waitFor('position', (v) => typeof v === 'number' && v >= seekTo + 3, {
      timeout: 30000,
      interval: 500,
      label: 'played into the next-episode window',
      read,
    });
    expect(
      await read('#nextEpisodeNotification.state'),
      'the next-episode button came up over an open dialog',
    ).toBe('hidden');

    // Positive control: with the dialog gone the same window shows the button, so the
    // assertion above could have failed.
    await odc.removeNode({ base: 'scene', keyPath: '#jrDialog' });
    await waitDialogClosed('dialog removed');
    await waitFor('#nextEpisodeNotification.state', (v) => v === 'showing', {
      timeout: 8000,
      interval: 500,
      label: 'next-episode button shows once the dialog is closed',
      read,
    });
  } finally {
    await stopPlayback();
  }
}, 300000);
