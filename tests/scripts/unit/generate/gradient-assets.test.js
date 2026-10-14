// Tests for scripts/generate/gradient-assets.js.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/generate/gradient-assets.js';

const ASSET_NAMES = ['fade-v.png', 'fade-v180.png', 'fade-h.png', 'fade-h180.png'];

async function readRaw(path) {
  const img = sharp(path);
  const { width, height } = await img.metadata();
  const data = await img.ensureAlpha().raw().toBuffer();
  return { width, height, data };
}

describe('gradient-assets', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes all four ramp assets with the expected dimensions', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-gradient-assets-'));
    const { exitCode } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    for (const name of ASSET_NAMES) {
      expect(existsSync(join(dir, 'images', 'gradients', name))).toBe(true);
    }
  });

  it('generates white pixels with a full-range monotonic alpha ramp', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-gradient-assets-'));
    spawnScript(SCRIPT, [dir]);

    const { width, height, data } = await readRaw(join(dir, 'images', 'gradients', 'fade-v.png'));
    expect(width).toBe(4);
    expect(height).toBe(270);

    // Column 0's alpha per row: starts opaque, ends transparent, never rises.
    let prev = Infinity;
    for (let y = 0; y < height; y++) {
      const i = (y * width + 0) * 4;
      expect(data[i]).toBe(255); // R
      expect(data[i + 1]).toBe(255); // G
      expect(data[i + 2]).toBe(255); // B
      const alpha = data[i + 3];
      expect(alpha).toBeLessThanOrEqual(prev);
      prev = alpha;
    }
    expect(data[3]).toBe(255); // top row fully opaque
    expect(data[(height - 1) * width * 4 + 3]).toBe(0); // bottom row fully transparent
  });

  it('the 180 variant is the reversed ramp', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-gradient-assets-'));
    spawnScript(SCRIPT, [dir]);

    const v = await readRaw(join(dir, 'images', 'gradients', 'fade-v.png'));
    const v180 = await readRaw(join(dir, 'images', 'gradients', 'fade-v180.png'));
    for (const y of [0, 100, 269]) {
      const a = v.data[y * v.width * 4 + 3];
      const b = v180.data[(v180.height - 1 - y) * v180.width * 4 + 3];
      expect(a).toBe(b);
    }
  });

  it('is idempotent and --check passes on a fresh build', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-gradient-assets-'));
    spawnScript(SCRIPT, [dir]);
    const first = readFileSync(join(dir, 'images', 'gradients', 'fade-v.png'));

    const rerun = spawnScript(SCRIPT, [dir]);
    expect(rerun.exitCode).toBe(0);
    expect(rerun.stdout).toContain('already up to date');
    expect(readFileSync(join(dir, 'images', 'gradients', 'fade-v.png')).equals(first)).toBe(true);

    const check = spawnScript(SCRIPT, [dir, '--check']);
    expect(check.exitCode).toBe(0);
  });

  it('--check fails on missing or drifted assets without writing', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-gradient-assets-'));

    const missing = spawnScript(SCRIPT, [dir, '--check']);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('missing');
    expect(existsSync(join(dir, 'images', 'gradients', 'fade-v.png'))).toBe(false);

    spawnScript(SCRIPT, [dir]);
    const target = join(dir, 'images', 'gradients', 'fade-h.png');
    writeFileSync(target, Buffer.from('not a png'));
    const drift = spawnScript(SCRIPT, [dir, '--check']);
    expect(drift.exitCode).toBe(1);
    expect(drift.stderr).toContain('content drift');
    expect(readFileSync(target).toString()).toBe('not a png'); // check mode never writes
  });

  // Same escape hatch, same reason, as icons-build.js's --force: write mode
  // leaves a pixel-identical asset alone, so without this the committed bytes
  // are frozen on whatever encoder produced them.
  it('--force re-encodes a pixel-identical asset that write mode would skip', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-gradient-assets-'));
    spawnScript(SCRIPT, [dir]);

    const target = join(dir, 'images', 'gradients', 'fade-v.png');
    const canonical = readFileSync(target);
    const reencoded = await sharp(canonical).png({ compressionLevel: 0 }).toBuffer();
    writeFileSync(target, reencoded);
    expect(reencoded.equals(canonical)).toBe(false);

    // Write mode leaves it alone; --force restores the canonical encoding.
    spawnScript(SCRIPT, [dir]);
    expect(readFileSync(target).equals(reencoded)).toBe(true);

    expect(spawnScript(SCRIPT, [dir, '--force']).exitCode).toBe(0);
    expect(readFileSync(target).equals(canonical)).toBe(true);
  });

  it('--check ignores --force and never writes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-gradient-assets-'));
    spawnScript(SCRIPT, [dir]);

    const target = join(dir, 'images', 'gradients', 'fade-v.png');
    const reencoded = await sharp(readFileSync(target)).png({ compressionLevel: 0 }).toBuffer();
    writeFileSync(target, reencoded);

    expect(spawnScript(SCRIPT, [dir, '--check', '--force']).exitCode).toBe(0);
    expect(readFileSync(target).equals(reencoded)).toBe(true);
  });

  it('committed assets match the generator (repo drift gate)', () => {
    const check = spawnScript(SCRIPT, ['--check']);
    expect(check.exitCode).toBe(0);
  });
});
