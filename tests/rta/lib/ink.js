/**
 * Where the visible ink of each overhang element sits, measured from a capture, so "the row
 * lines up" is a table of numbers instead of a judgment by eye.
 *
 * A node's bounding rect says where its box is, not where its pixels are: a label's box keeps
 * room for descenders, and a glyph's canvas carries transparent padding. So the rect only
 * says where to look. Inside it, a row counts as ink when it holds a bright pixel that is
 * close to gray (text and glyphs are drawn in the theme's text colors), which leaves out the
 * selected tab's underline, a focus ring and the "Dev" badge, all drawn in theme accents.
 * An avatar is a picture, so its target counts every bright pixel instead.
 *
 * Results are in design pixels (1920x1080) at any capture resolution, so a 720p capture
 * reads on the same scale as a 1080p one, to the two-thirds pixel it can resolve.
 *
 * Home draws its backdrop image behind the row. Inside an element's small rect that is dim
 * and colored, so the brightness floor and the gray filter leave it out; a bright, gray
 * backdrop under an element would read as ink, so check a surprising number against the
 * capture.
 * It reports and never asserts: a run prints the table, and the operator or the agent
 * compares two runs (before and after a layout change).
 *
 * Usage, from a spec on a screen that shows the overhang:
 *
 *   const rows = await measureOverhangInk('home-rest', HOME_INK_TARGETS);
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { captureRawUI } from '../capture.js';
import { getVal } from './steps.js';

const DESIGN_HEIGHT = 1080;

/** Brightest channel at or above this counts as ink (the backdrop under the row is dim). */
const INK_MIN_BRIGHTNESS = 96;
/** Highest minus lowest channel at or below this counts as gray (text, glyphs). */
const INK_MAX_CHROMA = 48;

/** Home at rest: the logo, both tabs, the user dropdown, the cluster and the clock. */
export const HOME_INK_TARGETS = [
  { name: 'logo', keyPath: '#overhang.#logo' },
  { name: 'tab 0 glyph', keyPath: '#overhang.#tabContainer.0.#buttonIcon' },
  { name: 'tab 0 text', keyPath: '#overhang.#tabContainer.0.#buttonText' },
  { name: 'tab 1 glyph', keyPath: '#overhang.#tabContainer.1.#buttonIcon' },
  { name: 'tab 1 text', keyPath: '#overhang.#tabContainer.1.#buttonText' },
  { name: 'avatar', keyPath: '#overhang.#userDropdown.#triggerIcon', anyColor: true },
  { name: 'user name', keyPath: '#overhang.#userDropdown.#triggerLabel' },
  { name: 'chevron', keyPath: '#overhang.#userDropdown.#triggerChevron' },
  { name: 'search', keyPath: '#overhang.#cluster.#searchIcon.#buttonIcon' },
  { name: 'settings', keyPath: '#overhang.#cluster.#settingsIcon.#buttonIcon' },
  { name: 'clock', keyPath: '#overhang.#clock.#clockGroup' },
];

/** A screen with no tabs: the title in their place, the dropdown if it shows one, and the clock. */
export const TITLE_INK_TARGETS = [
  { name: 'title', keyPath: '#overhang.#title' },
  { name: 'avatar', keyPath: '#overhang.#userDropdown.#triggerIcon', anyColor: true },
  { name: 'user name', keyPath: '#overhang.#userDropdown.#triggerLabel' },
  { name: 'chevron', keyPath: '#overhang.#userDropdown.#triggerChevron' },
  { name: 'clock', keyPath: '#overhang.#clock.#clockGroup' },
];

/**
 * The ink extents inside each rect of a PNG. Pure: no device.
 *
 * @param {string|Buffer} png - the capture, a path or the encoded bytes
 * @param {{ name: string, x: number, y: number, width: number, height: number, anyColor?: boolean }[]} rects
 *   in design pixels
 * @returns {Promise<{ name: string, top: number|null, bottom: number|null, center: number|null }[]>}
 *   design pixels; `bottom` is the edge below the last ink row; null where the rect holds no ink
 */
export async function measureInk(png, rects) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.height / DESIGN_HEIGHT;
  const toDesign = (px) => Math.round((px / scale) * 10) / 10;

  return rects.map(({ name, x, y, width, height, anyColor = false }) => {
    const left = Math.max(0, Math.floor(x * scale));
    const right = Math.min(info.width, Math.ceil((x + width) * scale));
    const top = Math.max(0, Math.floor(y * scale));
    const bottom = Math.min(info.height, Math.ceil((y + height) * scale));

    let first = -1;
    let last = -1;
    for (let row = top; row < bottom; row++) {
      for (let col = left; col < right; col++) {
        const i = (row * info.width + col) * info.channels;
        const hi = Math.max(data[i], data[i + 1], data[i + 2]);
        const lo = Math.min(data[i], data[i + 1], data[i + 2]);
        if (hi >= INK_MIN_BRIGHTNESS && (anyColor || hi - lo <= INK_MAX_CHROMA)) {
          if (first < 0) first = row;
          last = row;
          break;
        }
      }
    }

    if (first < 0) return { name, top: null, bottom: null, center: null };
    const inkTop = toDesign(first);
    const inkBottom = toDesign(last + 1);
    return {
      name,
      top: inkTop,
      bottom: inkBottom,
      center: Math.round(((inkTop + inkBottom) / 2) * 10) / 10,
    };
  });
}

/**
 * Read each target's rect from the device, capture the screen as `<captureName>`, and print
 * and return the ink table. The table is also written beside the capture as
 * `<captureName>.ink.json`, so two runs compare with a diff. A target whose node is missing
 * or hidden reports no ink.
 */
export async function measureOverhangInk(captureName, targets) {
  const rects = [];
  for (const target of targets) {
    // getVal reads a missing node as undefined, so a target the screen lacks reports no ink
    const visible = await getVal(`${target.keyPath}.visible`);
    const r = visible ? await getVal(`${target.keyPath}.sceneBoundingRect()`) : undefined;
    rects.push(
      r
        ? { ...target, x: r.x, y: r.y, width: r.width, height: r.height }
        : { ...target, x: 0, y: 0, width: 0, height: 0 },
    );
  }
  const png = await captureRawUI(captureName);
  const rows = await measureInk(png, rects);
  const table = rows.map((row, i) => {
    const r = rects[i];
    return { ...row, box: r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null };
  });
  fs.writeFileSync(png.replace(/\.png$/, '.ink.json'), `${JSON.stringify(table, null, 2)}\n`);
  console.log(`[ink] ${captureName}`);
  for (const [i, row] of rows.entries()) {
    const r = rects[i];
    const box = r.width ? `box y ${r.y}..${r.y + r.height}` : 'not shown';
    const ink =
      row.center === null ? 'no ink' : `ink ${row.top}..${row.bottom}, center ${row.center}`;
    console.log(`  ${row.name.padEnd(12)} ${box.padEnd(18)} ${ink}`);
  }
  return rows;
}
