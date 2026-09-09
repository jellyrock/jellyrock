// Tests for scripts/lib/png-compare.js — the pixel-vs-bytes comparison shared by
// the icon and gradient asset generators.

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { matchesRenderedOutput } from '../../../../scripts/lib/png-compare.js';

function solid(width, height, color) {
  return sharp({ create: { width, height, channels: 4, background: color } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const RED = { r: 255, g: 0, b: 0, alpha: 1 };
const BLUE = { r: 0, g: 0, b: 255, alpha: 1 };

describe('matchesRenderedOutput', () => {
  it('matches a buffer against itself', async () => {
    const png = await solid(8, 8, RED);
    expect(await matchesRenderedOutput(png, png)).toBe(true);
  });

  // The whole reason this module exists: a sharp upgrade re-encodes the same
  // pixels into different bytes, and that must not read as drift.
  it('matches when the bytes differ but the pixels do not', async () => {
    const original = await solid(8, 8, RED);
    const reencoded = await sharp(original).png({ compressionLevel: 0 }).toBuffer();

    // Guard against a vacuous test.
    expect(reencoded.equals(original)).toBe(false);
    expect(await matchesRenderedOutput(reencoded, original)).toBe(true);
  });

  it('does NOT match when the pixels differ', async () => {
    expect(await matchesRenderedOutput(await solid(8, 8, RED), await solid(8, 8, BLUE))).toBe(
      false,
    );
  });

  it('does NOT match when the dimensions differ', async () => {
    expect(await matchesRenderedOutput(await solid(8, 8, RED), await solid(16, 16, RED))).toBe(
      false,
    );
  });

  // Reported as drift so the caller regenerates it, rather than throwing and
  // taking the whole check down.
  it('does NOT match, and does not throw, when the existing file is not a PNG', async () => {
    expect(await matchesRenderedOutput(Buffer.from('not a png'), await solid(8, 8, RED))).toBe(
      false,
    );
  });

  it('does NOT match an empty existing file', async () => {
    expect(await matchesRenderedOutput(Buffer.alloc(0), await solid(8, 8, RED))).toBe(false);
  });

  // Asymmetric on purpose. An undecodable EXISTING file is drift — the caller
  // regenerates it. An undecodable FRESH buffer is a bug in the generator, and
  // swallowing it would report that bug as "content drift" in a committed asset
  // the user never touched, then rewrite every asset from a broken render.
  it('THROWS when the freshly rendered buffer is undecodable', async () => {
    await expect(
      matchesRenderedOutput(await solid(8, 8, RED), Buffer.from('not a png')),
    ).rejects.toThrow();
  });
});
