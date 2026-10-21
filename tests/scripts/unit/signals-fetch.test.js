// Tests for scripts/lib/signals-fetch.cjs.
//
// We test the pure parsers and version helpers (parseJellyfinIndex,
// parseUnstableIndex, parseRokuOsMarkdown, compareSemverBase,
// isReleaseVersionBase, isUnstableVersion), not the network wrappers. Network
// fetching is a thin stdlib glue and is exercised by the live-endpoint smoke
// test that runs when `node scripts/catchup-state.js` itself runs without
// --no-network.

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  fetchRokuOs,
  parseJellyfinIndex,
  parseUnstableIndex,
  parseRokuOsMarkdown,
  compareSemverBase,
  isReleaseVersionBase,
  isUnstableVersion,
} = require('../../../scripts/lib/signals-fetch.cjs');

describe('isReleaseVersionBase', () => {
  it('accepts three-segment and the patchless two-segment labels the 12.0 line publishes', () => {
    expect(isReleaseVersionBase('10.11.8')).toBe(true);
    expect(isReleaseVersionBase('12.0')).toBe(true);
    expect(isReleaseVersionBase('12.0.1')).toBe(true);
  });

  it('rejects a legacy unstable datestamp, which is also MAJOR.MINOR-shaped', () => {
    expect(isReleaseVersionBase('20240207.2')).toBe(false);
    expect(isReleaseVersionBase('20240402201942')).toBe(false);
  });

  it('rejects pre-release suffixes, bare majors, and non-strings', () => {
    expect(isReleaseVersionBase('12.0-rc4')).toBe(false);
    expect(isReleaseVersionBase('12')).toBe(false);
    expect(isReleaseVersionBase('10.11.8.1')).toBe(false);
    expect(isReleaseVersionBase('latest')).toBe(false);
    expect(isReleaseVersionBase(null)).toBe(false);
  });

  it('keeps isUnstableVersion available here (spec-fetch re-exports it)', () => {
    expect(isUnstableVersion('20240207.2')).toBe(true);
    expect(isUnstableVersion('12.0')).toBe(false);
  });
});

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
      // RC for the next minor: counts.
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
    // Numeric ordering on rc number: rc10 > rc2 > rc1.
    expect(parseJellyfinIndex(html).rc).toBe('11.0.0-rc10');
  });

  it('orders versions numerically (10.11.0 > 10.9.0)', () => {
    const html =
      '<a href="jellyfin-openapi-10.9.5.json">x</a>\n' +
      '<a href="jellyfin-openapi-10.11.0.json">x</a>\n' +
      '<a href="jellyfin-openapi-10.10.7.json">x</a>\n';
    expect(parseJellyfinIndex(html).stable).toBe('10.11.0');
  });

  it('sees the patchless RC labels the 12.0 line publishes', () => {
    const html =
      '<a href="jellyfin-openapi-10.11.8.json">stable</a>\n' +
      '<a href="jellyfin-openapi-12.0-rc1.json">rc</a>\n' +
      '<a href="jellyfin-openapi-12.0-rc3.json">rc</a>\n' +
      '<a href="jellyfin-openapi-12.0-rc4.json">rc</a>\n';
    // Three-segment matching made the whole 12.0 line invisible: rc came back null
    // and the tracker never learned the next major had release candidates.
    expect(parseJellyfinIndex(html)).toEqual({ stable: '10.11.8', rc: '12.0-rc4' });
  });

  it('ranks a patchless stable above a three-segment one', () => {
    const html =
      '<a href="jellyfin-openapi-10.11.8.json">x</a>\n' +
      '<a href="jellyfin-openapi-12.0.json">x</a>\n';
    expect(parseJellyfinIndex(html)).toEqual({ stable: '12.0', rc: null });
  });

  it('ignores a legacy unstable datestamp that strays into the stable listing', () => {
    const html =
      '<a href="jellyfin-openapi-10.11.8.json">x</a>\n' +
      // Also MAJOR.MINOR-shaped. Ranked as a version its 8-digit major would beat
      // every real release and pin latestStable to garbage.
      '<a href="jellyfin-openapi-20240207.2.json">x</a>\n';
    expect(parseJellyfinIndex(html)).toEqual({ stable: '10.11.8', rc: null });
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

describe('fetchRokuOs', () => {
  it('reads the release notes from the live GitLab repo, not the archived GitHub copy', async () => {
    // Roku archived the GitHub repo and moved the docs to GitLab. The GitHub copy
    // still serves, so a fetch against it would succeed with frozen data.
    const https = require('node:https');
    const urls = [];
    const spy = vi.spyOn(https, 'get').mockImplementation((url, _opts, cb) => {
      urls.push(url);
      const res = {
        statusCode: 200,
        headers: {},
        resume() {},
        setEncoding() {},
        on(evt, fn) {
          if (evt === 'data') fn('# Release notes\n\n## Roku OS 16.0\n');
          if (evt === 'end') fn();
        },
      };
      cb(res);
      return { on() {}, setTimeout() {}, destroy() {} };
    });
    try {
      const version = await fetchRokuOs();
      expect(urls).toEqual([
        'https://gitlab.com/rokudev/dev-doc/-/raw/v2.0/docs/DEVELOPER/release-notes/index.md',
      ]);
      expect(version).toBe('16.0');
    } finally {
      spy.mockRestore();
    }
  });
});
