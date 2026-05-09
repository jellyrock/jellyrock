// Tests for scripts/generate/icons-build.js.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/generate/icons-build.js';

// 24×24 viewBox SVG — a filled black square. Tiny and deterministic.
const SQUARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" fill="#000000"/></svg>`;

// 24×24 viewBox SVG with an 8×8 black glyph centered (8 units of transparent
// padding all around). Models Material Symbols' design-grid padding so we can
// verify the trim + glyphSize pipeline.
const PADDED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="8" y="8" width="8" height="8" fill="#000000"/></svg>`;

const MALFORMED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect`;

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function setupTree({ svgs = {}, iconsJson = null, existingPngs = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-icons-build-'));
  mkdirSync(join(dir, 'resources', 'icons'), { recursive: true });
  mkdirSync(join(dir, 'images', 'icons'), { recursive: true });
  mkdirSync(join(dir, 'images'), { recursive: true });

  for (const [name, content] of Object.entries(svgs)) {
    writeFileSync(join(dir, 'resources', 'icons', name), content);
  }
  if (iconsJson !== null) {
    writeFileSync(join(dir, 'resources', 'icons', 'icons.json'), JSON.stringify(iconsJson));
  }
  for (const [relPath, buffer] of Object.entries(existingPngs)) {
    const fullPath = join(dir, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, buffer);
  }
  return dir;
}

async function makeSquarePng(size) {
  return sharp(Buffer.from(SQUARE_SVG), { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

describe('icons-build', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('renders an SVG to default _fhd + _hd output paths', () => {
    dir = setupTree({ svgs: { 'play.svg': SQUARE_SVG } });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(existsSync(join(dir, 'images', 'icons', 'play_fhd.png'))).toBe(true);
    expect(existsSync(join(dir, 'images', 'icons', 'play_hd.png'))).toBe(true);
    expect(stdout).toMatch(/wrote: .*play_fhd\.png/);
    expect(stdout).toMatch(/wrote: .*play_hd\.png/);
  });

  it('renders FHD at default 96px and HD at 64px when no existing PNG', async () => {
    dir = setupTree({ svgs: { 'play.svg': SQUARE_SVG } });
    spawnScript(SCRIPT, [dir]);
    const fhdMeta = await sharp(join(dir, 'images', 'icons', 'play_fhd.png')).metadata();
    const hdMeta = await sharp(join(dir, 'images', 'icons', 'play_hd.png')).metadata();
    expect(fhdMeta.width).toBe(96);
    expect(hdMeta.width).toBe(64);
  });

  it('auto-detects FHD size from a pre-migration single-res PNG', async () => {
    const existing = await makeSquarePng(120);
    dir = setupTree({
      svgs: { 'play.svg': SQUARE_SVG },
      existingPngs: { 'images/icons/play.png': existing },
    });
    spawnScript(SCRIPT, [dir]);
    const fhdMeta = await sharp(join(dir, 'images', 'icons', 'play_fhd.png')).metadata();
    const hdMeta = await sharp(join(dir, 'images', 'icons', 'play_hd.png')).metadata();
    expect(fhdMeta.width).toBe(120);
    expect(hdMeta.width).toBe(80); // round(120 * 2/3) = 80
  });

  it('preserves FHD size from an existing _fhd.png across regenerations', async () => {
    const existing = await makeSquarePng(150);
    dir = setupTree({
      svgs: { 'play.svg': SQUARE_SVG },
      existingPngs: { 'images/icons/play_fhd.png': existing },
    });
    spawnScript(SCRIPT, [dir]);
    const fhdMeta = await sharp(join(dir, 'images', 'icons', 'play_fhd.png')).metadata();
    expect(fhdMeta.width).toBe(150);
  });

  it('honors icons.json outputDir override', () => {
    dir = setupTree({
      svgs: { 'spinner.svg': SQUARE_SVG },
      iconsJson: { spinner: { outputDir: 'images' } },
    });
    spawnScript(SCRIPT, [dir]);
    expect(existsSync(join(dir, 'images', 'spinner_fhd.png'))).toBe(true);
    expect(existsSync(join(dir, 'images', 'spinner_hd.png'))).toBe(true);
    expect(existsSync(join(dir, 'images', 'icons', 'spinner_fhd.png'))).toBe(false);
  });

  it('honors icons.json sizeFhd override', async () => {
    dir = setupTree({
      svgs: { 'play.svg': SQUARE_SVG },
      iconsJson: { play: { sizeFhd: 200 } },
    });
    spawnScript(SCRIPT, [dir]);
    const fhdMeta = await sharp(join(dir, 'images', 'icons', 'play_fhd.png')).metadata();
    expect(fhdMeta.width).toBe(200);
  });

  it('trims Material design padding so the rendered glyph matches glyphSize', async () => {
    // PADDED_SVG has an 8×8 glyph in a 24×24 viewBox (66% padding around the
    // glyph). With glyphSize=40 in a canvas=64, the rendered glyph should
    // occupy ~40×40 of the 64×64 canvas, NOT scale linearly with the viewBox.
    dir = setupTree({
      svgs: { 'square.svg': PADDED_SVG },
      iconsJson: { square: { sizeFhd: 64, glyphSize: 40 } },
    });
    spawnScript(SCRIPT, [dir]);
    const fhdPath = join(dir, 'images', 'icons', 'square_fhd.png');
    const meta = await sharp(fhdPath).metadata();
    expect(meta.width).toBe(64);
    const trimmed = await sharp(fhdPath)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
      .toBuffer({ resolveWithObject: true });
    expect(trimmed.info.width).toBe(40);
    expect(trimmed.info.height).toBe(40);
  });

  it('auto-detects glyphSize from existing PNG max dim (preserves density across rebuilds)', async () => {
    // Existing PNG: 64×64 canvas with a 40×40 visible square (24px transparent
    // padding split evenly). After rebuild with PADDED_SVG, the new render
    // should preserve the 40×40 glyph size.
    const existingFhd = await sharp({
      create: { width: 64, height: 64, channels: 4, background: TRANSPARENT },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 40,
              height: 40,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 1 },
            },
          })
            .png()
            .toBuffer(),
          left: 12,
          top: 12,
        },
      ])
      .png()
      .toBuffer();
    dir = setupTree({
      svgs: { 'square.svg': PADDED_SVG },
      existingPngs: { 'images/icons/square_fhd.png': existingFhd },
    });
    spawnScript(SCRIPT, [dir]);
    const trimmed = await sharp(join(dir, 'images', 'icons', 'square_fhd.png'))
      .trim({ background: TRANSPARENT, threshold: 1 })
      .toBuffer({ resolveWithObject: true });
    // Aspect-preserved: 40 in the larger dim, ±1 antialiasing tolerance.
    expect(trimmed.info.width).toBeGreaterThanOrEqual(39);
    expect(trimmed.info.width).toBeLessThanOrEqual(41);
    expect(trimmed.info.height).toBeGreaterThanOrEqual(39);
    expect(trimmed.info.height).toBeLessThanOrEqual(41);
  });

  it('falls back to glyphSize default when no override and no existing PNG', async () => {
    // PADDED_SVG with no overrides → default glyphSize of 54 inside default
    // canvas of 96. Glyph should occupy 54×54 (square, since PADDED_SVG glyph
    // is square).
    dir = setupTree({ svgs: { 'fresh.svg': PADDED_SVG } });
    spawnScript(SCRIPT, [dir]);
    const fhdPath = join(dir, 'images', 'icons', 'fresh_fhd.png');
    const meta = await sharp(fhdPath).metadata();
    expect(meta.width).toBe(96);
    const trimmed = await sharp(fhdPath)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
      .toBuffer({ resolveWithObject: true });
    expect(trimmed.info.width).toBe(54);
    expect(trimmed.info.height).toBe(54);
  });

  it('preserves natural aspect ratio when glyphSize is square but glyph is not', async () => {
    // Tall-narrow 4×16 glyph in 24×24 viewBox. With glyphSize=40 (square),
    // the rendered glyph should be bounded by 40 in the larger dim and
    // proportionally smaller in the other (preserving aspect).
    const TALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="10" y="4" width="4" height="16" fill="#000000"/></svg>`;
    dir = setupTree({
      svgs: { 'tall.svg': TALL_SVG },
      iconsJson: { tall: { sizeFhd: 64, glyphSize: 40 } },
    });
    spawnScript(SCRIPT, [dir]);
    const trimmed = await sharp(join(dir, 'images', 'icons', 'tall_fhd.png'))
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
      .toBuffer({ resolveWithObject: true });
    // Source aspect 4:16 = 1:4. Bounded by 40 in the larger dim → height ~40,
    // width ~10 (preserving 1:4 aspect, ±1 antialiasing tolerance).
    expect(trimmed.info.height).toBeGreaterThanOrEqual(39);
    expect(trimmed.info.height).toBeLessThanOrEqual(41);
    expect(trimmed.info.width).toBeGreaterThanOrEqual(9);
    expect(trimmed.info.width).toBeLessThanOrEqual(11);
  });

  it('--check exits 0 when PNGs are in sync', () => {
    dir = setupTree({ svgs: { 'play.svg': SQUARE_SVG } });
    spawnScript(SCRIPT, [dir]); // write
    const { exitCode } = spawnScript(SCRIPT, [dir, '--check']);
    expect(exitCode).toBe(0);
  });

  it('--check exits 1 when an output PNG is missing', () => {
    dir = setupTree({ svgs: { 'play.svg': SQUARE_SVG } });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir, '--check']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/out of sync/);
    expect(stderr).toMatch(/missing/);
  });

  it('--check exits 1 when an output PNG is byte-different', () => {
    dir = setupTree({ svgs: { 'play.svg': SQUARE_SVG } });
    spawnScript(SCRIPT, [dir]); // write a clean baseline
    // Corrupt one of the outputs
    writeFileSync(join(dir, 'images', 'icons', 'play_fhd.png'), Buffer.from('not a png'));
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir, '--check']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/content drift/);
  });

  it('is idempotent — second run produces no writes', () => {
    dir = setupTree({ svgs: { 'play.svg': SQUARE_SVG } });
    spawnScript(SCRIPT, [dir]);
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/already in sync/);
  });

  it('renders byte-identical output across runs (deterministic)', () => {
    dir = setupTree({ svgs: { 'play.svg': SQUARE_SVG } });
    spawnScript(SCRIPT, [dir]);
    const first = readFileSync(join(dir, 'images', 'icons', 'play_fhd.png'));
    rmSync(join(dir, 'images', 'icons', 'play_fhd.png'));
    rmSync(join(dir, 'images', 'icons', 'play_hd.png'));
    spawnScript(SCRIPT, [dir]);
    const second = readFileSync(join(dir, 'images', 'icons', 'play_fhd.png'));
    expect(first.equals(second)).toBe(true);
  });

  it('exits with a clear error on malformed SVG', () => {
    dir = setupTree({ svgs: { 'broken.svg': MALFORMED_SVG } });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/failed to render broken\.svg/);
  });

  it('reports zero-work when resources/icons/ is empty', () => {
    dir = setupTree({});
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/no SVG sources/);
  });

  it('reports zero-work when resources/icons/ does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-icons-empty-'));
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/not found/);
    rmSync(dir, { recursive: true, force: true });
  });
});
