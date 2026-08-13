/**
 * The Roku hardware dataset and the parsers that derive it — see
 * `scripts/generate/roku-hardware.js`.
 *
 * Two kinds of check, and they fail for different reasons. The INVARIANTS run against
 * the committed dataset with the same function the generator runs on every fetch, so
 * upstream cannot introduce a violation without failing the sync — including the one
 * assumption family-keying rests on, shown failing against a tampered copy. The CELL
 * NORMALIZERS pin every spelling Roku's table actually uses: the document glues numbers
 * onto names (`4K60fps`, `ARM11`) and carries footnote markers into data cells, both of
 * which broke the first cut of these parsers.
 *
 * The read API those feed is tested in `roku-devices.test.js`.
 */
import { describe, expect, it } from 'vitest';

import { ROKU_HARDWARE } from '../../../scripts/roku-devices.js';
import {
  assertInvariants,
  checksum,
  parseCpuArch,
  parseHdr,
  parseRam,
  parseResolution,
  parseTables,
  ramTierLabel,
  tierForTable,
} from '../../../scripts/generate/roku-hardware.js';

describe('the device dictionary invariants', () => {
  // These replace a test that asserted `new Set(Object.keys(TABLE)).size ===
  // Object.keys(TABLE).length` — which can never fail, because object keys cannot
  // repeat. Its stated purpose was to check the assumption family-keying rests on;
  // that claim is about Roku's published table, and only a check against the parsed
  // table can make it. `assertInvariants` is the same function the generator runs on
  // every fetch, so upstream cannot introduce a violation without failing the sync.
  it('holds for the committed dataset', () => {
    expect(assertInvariants(ROKU_HARDWARE)).toEqual([]);
  });

  it('has not been edited by hand — the checksum still matches the data', () => {
    expect(checksum(ROKU_HARDWARE)).toBe(ROKU_HARDWARE._checksum);
  });

  it('WOULD fail if a family ever carried two RAM sizes', () => {
    // The check that matters, shown failing. If Roku ships a 2 GB revision under an
    // existing family prefix, `familyOf` stops being a safe lookup and this is what
    // says so — at sync time, loudly, instead of quietly mislabelling an arm.
    // A JSON round-trip rather than `structuredClone`: the repo's ESLint config
    // targets Node >=16, where it is not available.
    const tampered = JSON.parse(JSON.stringify(ROKU_HARDWARE));
    const [model, entry] = Object.entries(tampered.models).find(
      ([, e]) => tampered.families[e.family].models.length > 1,
    );
    entry.ramMb = entry.ramMb * 2;
    entry.ramTier = ramTierLabel(entry.ramMb);
    const problems = assertInvariants(tampered);
    expect(problems.join(' ')).toMatch(/different RAM sizes/);
    expect(problems.join(' ')).toContain(model);
  });

  it('covers every device Roku currently manufactures', () => {
    // A dataset that quietly lost the `current` tier would still pass every check
    // above, and would be useless.
    const current = Object.values(ROKU_HARDWARE.models).filter((m) => m.supportTier === 'current');
    expect(current.length).toBeGreaterThan(15);
    expect(new Set(Object.values(ROKU_HARDWARE.models).map((m) => m.supportTier))).toEqual(
      new Set(['current', 'updatable', 'legacy']),
    );
  });
});

describe('the spec cell normalizers', () => {
  // Every case below is a real spelling from Roku's table. The document glues numbers
  // onto names (`4K60fps`, `ARM11`) and carries footnote markers into data cells, both
  // of which broke the first cut of these parsers.
  it('reads every spelling of a RAM cell', () => {
    expect(parseRam('512 MB')).toBe(512);
    expect(parseRam('512MB')).toBe(512); // one row omits the space
    expect(parseRam('1 GB')).toBe(1024);
    expect(parseRam('1.5 GB')).toBe(1536);
    expect(ramTierLabel(1536)).toBe('1.5GB');
    expect(ramTierLabel(512)).toBe('512MB');
    expect(() => parseRam('lots')).toThrow();
  });

  it('reads every spelling of a resolution cell, footnotes and all', () => {
    expect(parseResolution('720p')).toEqual({ resolution: '720p', fps: null, hdr: false });
    expect(parseResolution('1920X1080')).toEqual({ resolution: '1080p', fps: null, hdr: false });
    expect(parseResolution('1280X720')).toEqual({ resolution: '720p', fps: null, hdr: false });
    expect(parseResolution('1080p/60fps')).toEqual({ resolution: '1080p', fps: 60, hdr: false });
    expect(parseResolution('4K60fps, HDR')).toEqual({ resolution: '4K', fps: 60, hdr: true });
    expect(parseResolution('4K UHD, 60fps')).toEqual({ resolution: '4K', fps: 60, hdr: false });
    expect(parseResolution('3,840 x 2,160')).toEqual({ resolution: '4K', fps: null, hdr: false });
    expect(parseResolution('4K144fps, HDR')).toEqual({ resolution: '4K', fps: 144, hdr: true });
    // The footnote digit glued to the frame rate — `parseInt` would read 603 fps.
    expect(parseResolution('1920x1080, 60fps3***')).toEqual({
      resolution: '1080p',
      fps: 60,
      hdr: false,
    });
  });

  it('REFUSES a resolution it does not know, rather than nulling the device', () => {
    // The safety property of the whole pipeline: upstream inventing a spelling — or
    // shipping an 8K playback row, which does not exist today — fails the weekly sync
    // instead of silently dropping a device into unknown-tier.
    expect(() => parseResolution('7680x4320')).toThrow(/unrecognized resolution/);
  });

  it('collapses fifteen HDR spellings onto four formats', () => {
    expect(parseHdr('n/a')).toEqual({ formats: [], variesByModel: false });
    expect(parseHdr('No')).toEqual({ formats: [], variesByModel: false });
    expect(parseHdr('HDR 10').formats).toEqual(['HDR10']); // the space is upstream's
    expect(parseHdr('HDR10/10+, HLG').formats).toEqual(['HDR10', 'HDR10+', 'HLG']);
    expect(parseHdr('HDR10/10+, HLG, and DolbyVision').formats).toEqual([
      'HDR10',
      'HDR10+',
      'HLG',
      'DolbyVision',
    ]);
    expect(
      parseHdr('HDR10, HDR10+ Adaptive, Dolby Vision IQ, HLG supported, varies by model'),
    ).toEqual({
      formats: ['HDR10', 'HDR10+', 'HLG', 'DolbyVision'],
      variesByModel: true,
    });
  });

  it('reads an architecture off a CPU cell that glues its number on', () => {
    expect(parseCpuArch('ARM Cortex A55')).toBe('ARM');
    expect(parseCpuArch('ARM11 600 MHz')).toBe('ARM'); // no word boundary after ARM
    expect(parseCpuArch('MIPS 400 MHz')).toBe('MIPS');
    expect(() => parseCpuArch('Transputer')).toThrow();
  });

  it('keys a table by its column HEADERS, which is what stops a resolution reading as a model', () => {
    // `A000X`'s Max-UI-Resolution cell is literally `1920X1080`, which has the shape
    // of a model number. A positional or shape-matching read takes it for one — that
    // mistake was made against this very table.
    const [table] = parseTables(
      [
        'The following models are currently being manufactured and are supported:',
        '',
        '| Device Name | roDeviceInfo.GetModel() | CPU | RAM | Max UI Resolution |',
        '| :---------- | :---------------------- | :-- | :-- | :---------------- |',
        '| 4K Roku TV  | A000X                   | ARM | 1.5 GB | 1920X1080      |',
      ].join('\n'),
    );
    expect(table.rows[0]['roDeviceInfo.GetModel()']).toBe('A000X');
    expect(table.rows[0]['Max UI Resolution']).toBe('1920X1080');
    expect(tierForTable(table)).toBe('current');
  });
});
