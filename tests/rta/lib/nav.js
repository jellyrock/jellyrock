/**
 * In-app navigation to each screen, driven from a seeded "home" state with
 * remote keypresses + odc node-waits (NOT fixed sleeps) so each step proceeds
 * the moment the UI is actually ready. The `waitFor` gates inside each nav ARE
 * the "screen loaded" assertions — if a screen fails to render, the nav throws.
 *
 * `ctx` carries { heroIndex, heroId } (from getHero). The osd backdrop injection
 * is intentionally NOT here — it's a screenshot-only concern handled by the
 * store orchestrator after nav, so the functional test for osd stays free of
 * ffmpeg/backdrop logic.
 */
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { press, getVal, waitFor, waitFocused, waitHome, hasChildren, sleep } from './steps.js';

/** home -> OK on focused "Movies" tile -> Movies library grid. */
export async function navLibraryGrid() {
  await waitHome();
  await press(ecp.Key.Ok);
  await waitFor('#itemGrid.content.getChildCount()', hasChildren, {
    label: 'movies grid',
    timeout: 20000,
  });
  await sleep(1200); // let posters paint before capture
}

/** grid -> focus the hero tile (Right x heroIndex) -> OK -> ItemDetails. */
export async function navMovieDetails(ctx) {
  await navLibraryGrid();
  const target = ctx?.heroIndex || 0;
  if (target > 0) {
    // Press Right until the grid reports the hero tile focused (robust to a
    // dropped keypress — only presses while focus is still short of the target).
    await waitFor('#itemGrid.itemFocused', (v) => v === target, {
      timeout: 15000,
      interval: 500,
      action: async () => {
        const cur = await getVal('#itemGrid.itemFocused');
        if (typeof cur === 'number' && cur < target) await press(ecp.Key.Right);
      },
      label: `grid focus -> tile ${target}`,
    });
  }
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'details title',
    timeout: 20000,
  });
  await sleep(1500); // let backdrop + logo paint
}

/** details -> OK on default Play/Resume button -> playback begins. */
export async function startPlayback(ctx) {
  await navMovieDetails(ctx);
  // The title label renders before the button row is interactive; wait until
  // focus actually lands inside the details button group (Play or Resume,
  // depending on watch state) before pressing OK, else the press lands too
  // early and playback never starts.
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#buttons'), {
    label: 'details play/resume button',
  });
  await press(ecp.Key.Ok);
}

/**
 * Playback -> paused OSD overlay at the exact target position. OSD only appears
 * once the player reaches a playable state (`stateAllowsOSD`), so we retry Up
 * until it shows, then Play to PAUSE + re-show it (matches the reference's
 * play-button state and freezes the position so it never auto-hides), then seek
 * to the exact target. The store orchestrator injects the in-film backdrop after
 * this returns.
 */
export async function navOsd(ctx) {
  await startPlayback(ctx);
  // Confirm the player reached a playable state (OSD only shows when it has).
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 90000,
    interval: 2000,
    action: () => press(ecp.Key.Up),
    label: 'osd visible',
  });
  // Hide the OSD (focus -> player), then Play to PAUSE + re-show the OSD.
  await press(ecp.Key.Back);
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await press(ecp.Key.Play); // pause + show OSD
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'osd visible (paused)',
  });
  // Seek the player (found by its id == the item id) to the exact target while
  // paused, so the OSD shows that exact timestamp with no playback drift.
  if (ctx?.heroId) {
    await odc
      .setValue({ base: 'scene', keyPath: `#${ctx.heroId}.seek`, value: RTA_CONFIG.seekSeconds })
      .catch(() => {});
  }
  await sleep(2500); // let the (paused) seek settle + frame render
}

/**
 * Playback -> trickplay seek strip positioned on the target. Use the OSD as the
 * "playback ready" gate, hide it (Back; OSD consumes it as a hide, does NOT
 * stop playback), seek one trickplay interval (10s) BEFORE the target, then
 * Right to open trickplay — which jumps forward one thumbnail, landing the
 * scrub on seekSeconds.
 */
export async function navTrickplay(ctx) {
  await startPlayback(ctx);
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 90000,
    interval: 2000,
    action: () => press(ecp.Key.Up),
    label: 'playback ready (osd)',
  });
  await press(ecp.Key.Back);
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await odc
    .setValue({ base: 'focusedNode', keyPath: 'seek', value: RTA_CONFIG.seekSeconds - 10 })
    .catch(() => {});
  await sleep(3000); // let the seek settle
  await press(ecp.Key.Right); // open trickplay; jumps ~one thumbnail forward to the target
  await waitFor('#trickplayCarousel.isVisible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'trickplay visible',
  });
  await sleep(2500); // let trickplay thumbnails load
}
