/**
 * A scrolling tab strip on a real device: eight long tabs put on Home's overhang over ODC
 * (`tabMode = "scrolling"`), so no test screen ships in the app. Focus walks the strip one
 * tab at a time; each stop is captured and its geometry recorded. A bench, so it runs only
 * when asked for:
 *
 *   RTA_BENCH=1 npm run test:rta -- tab-strip
 *
 * The record lands in `out/rta-captures/tab-strip.json`. What it gates is the rule's shape,
 * not its pixels: every tab sizes, the focused tab is whole inside the slot at every stop,
 * the strip never shows empty space after its last tab, Right from the last tab leaves the
 * strip, and the strip returns to the selected tab when focus leaves.
 *
 * The first two tabs keep Home's own ids and nothing here presses OK, so Home's selection
 * never changes. Skipping the only `it` skips the `beforeAll` too, so a normal run pays
 * nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { ecp, hardRelaunch, odc } from '../lib/driver.js';
import { captureRawUI, RAW_CAPTURE_DIR } from '../capture.js';
import {
  getVal,
  getVals,
  press,
  sleep,
  waitFor,
  waitFocusInside,
  waitHome,
  walkHomeToFirstRow,
} from '../lib/steps.js';

const BENCH_ENABLED = process.env.RTA_BENCH === '1';
const LOCALE = RTA_CONFIG.languages[0];

const TABS = [
  { id: 'home', title: 'Home' },
  { id: 'favorites', title: 'Favorites' },
  { id: 'bench2', title: 'Collections' },
  { id: 'bench3', title: 'Album Artists' },
  { id: 'bench4', title: 'Recently Added' },
  { id: 'bench5', title: 'Continue Watching' },
  { id: 'bench6', title: 'Suggestions' },
  { id: 'bench7', title: 'Playlists' },
];

const TAB = (i) => `#overhang.#tabContainer.${i}`;

/** The strip as it sits now, read in one batch: its offset, the slot, each tab's box and opacity. */
async function readStrip() {
  const perTab = ['boundingRect()', 'opacity', 'isFocused'];
  const values = await getVals([
    '#overhang.#tabContainer.translation',
    '#overhang.#tabClip.clippingRect',
    ...TABS.flatMap((_, i) => perTab.map((field) => `${TAB(i)}.${field}`)),
  ]);
  const [translation, clip, ...rest] = values;
  // An unread strip would compare undefined with undefined below and prove nothing
  if (!translation || !clip) throw new Error('tab-strip: the strip could not be read');
  const tabs = TABS.map((_, i) => {
    const [box, opacity, isFocused] = rest.slice(i * perTab.length, (i + 1) * perTab.length);
    if (!box) throw new Error(`tab-strip: tab ${i} could not be read`);
    return { left: box.x, width: box.width, opacity, isFocused };
  });
  return { offset: 0 - translation[0], slotWidth: clip.width, tabs };
}

/** Wait for tab `index` to take focus, then for the slide it started to end. */
async function waitTabFocused(index) {
  // eslint-disable-next-line jellyrock-rta/wait-justified -- DYN: the tab's index is a run-time value. `isFocused` is assigned directly by JRTabBar.updateFocusedTabVisuals and holds until the next key, so a poll cannot miss it.
  await waitFor(`${TAB(index)}.isFocused`, (v) => v === true, {
    timeout: 8000,
    interval: 200,
    label: `tab ${index} focused`,
  });
  await waitSlideEnded();
}

/**
 * The slide is over. JRTabBar.applyWindow starts it in the same handler that moves focus, so
 * once the focus change is seen the animation has either started or was never needed, and
 * "stopped" then holds until the next key.
 */
async function waitSlideEnded() {
  await waitFor('#overhang.#scrollAnimation.state', (v) => v === 'stopped', {
    timeout: 5000,
    interval: 150,
    label: 'tab strip slide ended',
  });
}

/**
 * Press Right and watch the slide it starts, from the press to the animation stopping. Returns
 * the samples and the time the slide took, so a slide cut short shows as a short time. A loop
 * outside `waitFor`: it reads two keyPaths per tick and records every sample, where `waitFor`
 * polls one keyPath and keeps only the last value.
 */
async function pressRightAndSampleSlide() {
  const start = (await getVal('#overhang.#tabContainer.translation'))[0];
  const samples = [];
  const t0 = Date.now();
  await press(ecp.Key.Right);
  // A press that does not move the strip ends here: the slide has had its time by then
  const deadline = t0 + 2500;
  let moved = false;
  while (Date.now() < deadline) {
    const [translation, state] = await getVals([
      '#overhang.#tabContainer.translation',
      '#overhang.#scrollAnimation.state',
    ]);
    samples.push({ ms: Date.now() - t0, x: translation[0], state });
    moved = translation[0] !== start;
    // "stopped" alone also reads before the animation has started
    if (moved && state === 'stopped') break;
    await sleep(40);
  }
  return { start, samples, moved, ms: Date.now() - t0 };
}

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

it.skipIf(!BENCH_ENABLED)('scrolls a strip of eight tabs by the rule', async () => {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'tab-strip');
  await waitHome();

  // A library shows no logo, so its tabs start at the left edge: hide Home's for the same slot
  await odc.setValue({ base: 'scene', keyPath: '#overhang.isLogoVisible', value: false });
  await odc.setValue({ base: 'scene', keyPath: '#overhang.tabMode', value: 'scrolling' });
  await odc.setValue({ base: 'scene', keyPath: '#overhang.tabs', value: TABS });
  await waitFor('#overhang.#tabBar.isReady', (v) => v === true, {
    timeout: 10000,
    interval: 250,
    label: 'every tab sized',
  }).catch(async (error) => {
    // Which tabs did not size, and what the renderer said of them: a tab sizes only once it
    // reports renderTracking "full"
    const fields = ['isReady', 'renderTracking', 'sceneBoundingRect()'];
    const values = await getVals(TABS.flatMap((_, i) => fields.map((f) => `${TAB(i)}.${f}`)));
    const rows = TABS.map((_, i) => JSON.stringify(values.slice(i * 3, i * 3 + 3)));
    error.message += `\n        ↳ tabs [isReady, renderTracking, box]:\n          ${rows.join('\n          ')}`;
    throw error;
  });

  const record = { resolution: await getVal('currentDesignResolution'), stops: [] };
  const stop = async (name) => {
    const strip = await readStrip();
    await captureRawUI(`tab-strip-${name}`);
    record.stops.push({ name, ...strip });
    return strip;
  };

  // At rest: Home is selected, so the strip sits at its start, and every tab has a real width
  const rest = await stop('rest');
  expect(rest.slotWidth).toBeGreaterThan(0);
  for (const tab of rest.tabs) expect(tab.width).toBeGreaterThan(60);
  const last = rest.tabs[rest.tabs.length - 1];
  const total = last.left + last.width;
  // The bench proves nothing unless the strip overflows its slot
  expect(total).toBeGreaterThan(rest.slotWidth);
  expect(rest.offset).toBe(0);

  await walkHomeToFirstRow();
  await press(ecp.Key.Up);
  await waitFocusInside('tabBar', { label: 'focus in the tab bar' });
  await waitTabFocused(0);

  // The first press that moves the strip runs slowed, and its slide must last: a slide cut
  // short by a tab sizing again mid-way stops and jumps to its end
  const shippedSeconds = await getVal('#overhang.#scrollAnimation.duration');
  const slowSeconds = 1;
  await odc.setValue({
    base: 'scene',
    keyPath: '#overhang.#scrollAnimation.duration',
    value: slowSeconds,
  });
  let slideChecked = false;

  for (let i = 0; i < TABS.length; i++) {
    if (i > 0) {
      if (!slideChecked) {
        const slide = await pressRightAndSampleSlide();
        if (slide.moved) {
          record.slide = slide;
          const startX = slide.start;
          const endX = slide.samples[slide.samples.length - 1].x;
          // Some sample is part-way, so the strip slid and did not jump
          expect(
            slide.samples.some((p) => (p.x - startX) * (p.x - endX) < 0),
            'a sample strictly between start and end',
          ).toBe(true);
          // And the slide ran its length
          expect(slide.ms, 'the slide ran its length').toBeGreaterThanOrEqual(slowSeconds * 800);
          slideChecked = true;
          await odc.setValue({
            base: 'scene',
            keyPath: '#overhang.#scrollAnimation.duration',
            value: shippedSeconds,
          });
        }
      } else {
        await press(ecp.Key.Right);
      }
      await waitTabFocused(i);
    }
    const strip = await stop(`focus-${i}`);
    const tab = strip.tabs[i];
    // The focused tab is whole inside the slot, and never dimmed
    expect(tab.left).toBeGreaterThanOrEqual(strip.offset);
    expect(tab.left + tab.width).toBeLessThanOrEqual(strip.offset + strip.slotWidth);
    expect(tab.opacity).toBe(1);
    // Never past the last tab
    expect(strip.offset).toBeLessThanOrEqual(total - strip.slotWidth);
    expect(strip.offset % 3).toBe(0);
  }

  // The bench proves nothing about the slide unless a press moved the strip
  expect(slideChecked).toBe(true);

  // Right from the last tab leaves the strip for the next element in the row, and the strip
  // goes back to the selected tab
  await press(ecp.Key.Right);
  await waitFocusInside('userDropdown', { label: 'Right from the last tab reached the dropdown' });
  await waitSlideEnded();
  const left = await stop('left-the-strip');
  expect(left.offset).toBe(0);

  // Back to a fixed bar, as on the way from a library to Home: the clip comes off and the tabs
  // draw whole again
  await odc.setValue({ base: 'scene', keyPath: '#overhang.tabMode', value: 'fixed' });
  await odc.setValue({ base: 'scene', keyPath: '#overhang.tabs', value: TABS.slice(0, 2) });
  await waitFor('#overhang.#tabBar.isReady', (v) => v === true, {
    timeout: 10000,
    interval: 250,
    label: 'the fixed tabs sized',
  });
  await captureRawUI('tab-strip-fixed-again');
  const [clip, tracking0, tracking1, opacity0] = await getVals([
    '#overhang.#tabClip.clippingRect',
    `${TAB(0)}.renderTracking`,
    `${TAB(1)}.renderTracking`,
    `${TAB(0)}.opacity`,
  ]);
  record.fixedAgain = { clip, tracking0, tracking1, opacity0 };
  // Not an empty clip: that stops the tabs drawing (seen on a Roku Stick, 2026-11-12)
  expect(clip.width).toBeGreaterThan(left.slotWidth);
  expect([tracking0, tracking1]).toEqual(['full', 'full']);
  expect(opacity0).toBe(1);

  fs.writeFileSync(
    path.join(RAW_CAPTURE_DIR, 'tab-strip.json'),
    `${JSON.stringify(record, null, 2)}\n`,
  );
});
