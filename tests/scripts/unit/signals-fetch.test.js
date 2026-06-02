// Tests for scripts/lib/signals-fetch.cjs.
//
// We test the pure parsers (parseJellyfinIndex, parseRokuOsMarkdown,
// compareSemverBase) — not the network wrappers. Network fetching is a thin
// stdlib glue and is exercised by the live-endpoint smoke test that runs
// when `node scripts/catchup-state.js` itself runs without --no-network.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseJellyfinIndex,
  parseUnstableIndex,
  parseRokuOsMarkdown,
  compareSemverBase,
} = require('../../../scripts/lib/signals-fetch.cjs');

describe('parseJellyfinIndex', () => {
  it('returns latest stable + null rc when only stable filenames exist', () => {
    const html =
      '<a href="jellyfin-openapi-10.10.7.json">jellyfin-openapi-10.10.7.json</a>\n' +
      '<a href="jellyfin-openapi-10.11.0.json">jellyfin-openapi-10.11.0.json</a>\n' +
      '<a href="jellyfin-openapi-10.11.8.json">jellyfin-openapi-10.11.8.json</a>\n';
    expect(parseJellyfinIndex(html)).toEqual({ stable: '10.11.8', rc: null });
  });

  it('returns rc only when its base version exceeds the latest stable', () => {
    const html =
      '<a href="jellyfin-openapi-10.11.8.json">stable</a>\n' +
      // RCs whose base is <= latest stable are historical and ignored.
      '<a href="jellyfin-openapi-10.11.0-rc1.json">old rc</a>\n' +
      '<a href="jellyfin-openapi-10.11.0-rc6.json">old rc</a>\n' +
      // RC for the next minor → counts.
      '<a href="jellyfin-openapi-10.12.0-rc1.json">new rc</a>\n' +
      '<a href="jellyfin-openapi-10.12.0-rc2.json">new rc</a>\n';
    expect(parseJellyfinIndex(html)).toEqual({ stable: '10.11.8', rc: '10.12.0-rc2' });
  });

  it('picks the highest rc number when several share the same base version', () => {
    const html =
      '<a href="jellyfin-openapi-10.11.8.json">stable</a>\n' +
      '<a href="jellyfin-openapi-11.0.0-rc1.json">rc</a>\n' +
      '<a href="jellyfin-openapi-11.0.0-rc10.json">rc</a>\n' +
      '<a href="jellyfin-openapi-11.0.0-rc2.json">rc</a>\n';
    // Numeric ordering on rc number — rc10 > rc2 > rc1.
    expect(parseJellyfinIndex(html).rc).toBe('11.0.0-rc10');
  });

  it('orders versions numerically (10.11.0 > 10.9.0)', () => {
    const html =
      '<a href="jellyfin-openapi-10.9.5.json">x</a>\n' +
      '<a href="jellyfin-openapi-10.11.0.json">x</a>\n' +
      '<a href="jellyfin-openapi-10.10.7.json">x</a>\n';
    expect(parseJellyfinIndex(html).stable).toBe('10.11.0');
  });

  it('throws when no jellyfin-openapi-*.json filenames are present', () => {
    expect(() => parseJellyfinIndex('<html>nothing here</html>')).toThrow(/no jellyfin-openapi/);
  });

  it('throws when only prerelease filenames exist (no stable)', () => {
    const html = '<a href="jellyfin-openapi-1.0.0-rc1.json">x</a>\n';
    expect(() => parseJellyfinIndex(html)).toThrow(/no non-prerelease versions/);
  });
});

describe('parseUnstableIndex', () => {
  it('returns the newest 14-digit datestamp from a master-build listing', () => {
    const html =
      '<a href="jellyfin-openapi-20240326101620.json">x</a>\n' +
      '<a href="jellyfin-openapi-20240402201942.json">x</a>\n' +
      '<a href="jellyfin-openapi-20240331204745.json">x</a>\n';
    expect(parseUnstableIndex(html)).toBe('20240402201942');
  });

  it('ignores legacy <YYYYMMDD>.<N> builds when modern stamps are present', () => {
    const html =
      '<a href="jellyfin-openapi-20240207.2.json">legacy</a>\n' +
      '<a href="jellyfin-openapi-20240226.1.json">legacy</a>\n' +
      '<a href="jellyfin-openapi-20240325170309.json">modern</a>\n';
    expect(parseUnstableIndex(html)).toBe('20240325170309');
  });

  it('falls back to legacy builds when no modern stamps exist', () => {
    const html =
      '<a href="jellyfin-openapi-20240207.2.json">x</a>\n' +
      '<a href="jellyfin-openapi-20240214.1.json">x</a>\n';
    expect(parseUnstableIndex(html)).toBe('20240214.1');
  });

  it('throws when no datestamped filenames are present', () => {
    expect(() => parseUnstableIndex('<html>nothing</html>')).toThrow(/no jellyfin-openapi/);
  });
});

describe('parseRokuOsMarkdown', () => {
  it('returns the first `## Roku OS X.Y` heading version', () => {
    const md =
      '# Roku OS developer release notes\n\n' +
      '## Roku OS 15.2\n\nbody\n\n' +
      '## Roku OS 15.1\n\nbody\n\n' +
      '## Roku OS 15.0\n\nbody\n';
    expect(parseRokuOsMarkdown(md)).toBe('15.2');
  });

  it('accepts X.Y.Z (three-component) versions', () => {
    const md = '## Roku OS 15.1.0\n\nbody\n';
    expect(parseRokuOsMarkdown(md)).toBe('15.1.0');
  });

  it('throws when no `## Roku OS` heading is present', () => {
    expect(() => parseRokuOsMarkdown('# Other heading\n\nNo Roku OS heading here.\n')).toThrow(
      /no .*Roku OS.* heading/,
    );
  });
});

describe('compareSemverBase', () => {
  it('orders versions numerically (not lexicographically)', () => {
    expect(compareSemverBase('10.11.8', '10.11.7')).toBeGreaterThan(0);
    expect(compareSemverBase('10.11.0', '10.9.0')).toBeGreaterThan(0);
    expect(compareSemverBase('10.11.0', '10.11.0')).toBe(0);
  });
});
