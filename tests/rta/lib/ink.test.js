import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { measureInk } from './ink.js';

/** A black RGB capture of `width` x `height` with filled rectangles of the given colors. */
async function capture(width, height, fills) {
  const data = Buffer.alloc(width * height * 3);
  for (const { x, y, w, h, rgb } of fills) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        const i = (row * width + col) * 3;
        [data[i], data[i + 1], data[i + 2]] = rgb;
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

const GRAY = [200, 200, 200];
const BLUE = [40, 110, 230];

describe('measureInk', () => {
  it('finds the ink rows of gray text inside a rect, in design pixels', async () => {
    const png = await capture(1920, 1080, [{ x: 100, y: 50, w: 40, h: 30, rgb: GRAY }]);
    const [row] = await measureInk(png, [{ name: 'text', x: 90, y: 27, width: 60, height: 78 }]);
    expect(row).toEqual({ name: 'text', top: 50, bottom: 80, center: 65 });
  });

  it('leaves out an accent-colored line under the text', async () => {
    const png = await capture(1920, 1080, [
      { x: 100, y: 50, w: 40, h: 30, rgb: GRAY },
      { x: 100, y: 90, w: 40, h: 6, rgb: BLUE },
    ]);
    const [row] = await measureInk(png, [{ name: 'tab', x: 90, y: 27, width: 60, height: 78 }]);
    expect(row.bottom).toBe(80);
  });

  it('counts a colored picture when the target says anyColor', async () => {
    const png = await capture(1920, 1080, [{ x: 100, y: 45, w: 42, h: 42, rgb: BLUE }]);
    const [gray, picture] = await measureInk(png, [
      { name: 'gray only', x: 90, y: 27, width: 60, height: 78 },
      { name: 'avatar', x: 90, y: 27, width: 60, height: 78, anyColor: true },
    ]);
    expect(gray.center).toBeNull();
    expect(picture).toEqual({ name: 'avatar', top: 45, bottom: 87, center: 66 });
  });

  it('reads a 720p capture on the design scale', async () => {
    // Design rows 51 to 81 are capture rows 34 to 54 at two thirds
    const png = await capture(1280, 720, [{ x: 67, y: 34, w: 27, h: 20, rgb: GRAY }]);
    const [row] = await measureInk(png, [{ name: 'text', x: 90, y: 27, width: 60, height: 78 }]);
    expect(row).toEqual({ name: 'text', top: 51, bottom: 81, center: 66 });
  });

  it('ignores ink outside the rect, and reports a rect with none as null', async () => {
    const png = await capture(1920, 1080, [{ x: 500, y: 50, w: 40, h: 30, rgb: GRAY }]);
    const [row] = await measureInk(png, [{ name: 'empty', x: 90, y: 27, width: 60, height: 78 }]);
    expect(row).toEqual({ name: 'empty', top: null, bottom: null, center: null });
  });
});
