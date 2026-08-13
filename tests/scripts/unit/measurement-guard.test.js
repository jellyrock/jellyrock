/**
 * The measurement guard — see `scripts/measurement-guard.js`.
 *
 * The load-bearing case is `sameServer`: tier 1 was CORRECTED to assert
 * `serverUrl` because the demo `/stable` and `/unstable` backends are cloned from
 * one seed database and report an identical `serverId` AND `userId` (measured
 * 2026-08-12). The pair therefore cannot see the likeliest wrong-server mistake,
 * and the pin below is what stops a future "normalise the URL a bit harder"
 * change from re-blinding it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  checkSeriesConsistency,
  checkServerIdentity,
  readAppVersion,
  readBuildFlags,
  sameServer,
} from '../../../scripts/measurement-guard.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-guard-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const writeManifest = (body) => {
  const p = path.join(tmp, `manifest-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(p, body);
  return p;
};

describe('sameServer', () => {
  it('treats a trailing slash and scheme/host case as the same server', () => {
    expect(
      sameServer('https://demo.jellyfin.org/stable', 'https://demo.jellyfin.org/stable/'),
    ).toBe(true);
    expect(sameServer('HTTPS://Demo.Jellyfin.ORG/stable', 'https://demo.jellyfin.org/stable')).toBe(
      true,
    );
  });

  it('does NOT collapse /stable and /unstable', () => {
    // The whole reason tier 1 moved off the serverId/userId pair. These two are
    // different Jellyfin versions behind one hostname, and the path is the only
    // field that separates them.
    expect(
      sameServer('https://demo.jellyfin.org/stable', 'https://demo.jellyfin.org/unstable'),
    ).toBe(false);
  });

  it('leaves the path case alone, where the scheme and host are lowercased', () => {
    // Deliberately shallow normalisation: an over-eager normaliser is how a guard
    // goes quietly blind, so anything past the provably-equivalent spellings is
    // left as a mismatch for a human to look at.
    expect(sameServer('https://host/Stable', 'https://host/stable')).toBe(false);
  });

  it('is false when either side is missing, never vacuously true', () => {
    expect(sameServer(undefined, 'https://x/y')).toBe(false);
    expect(sameServer('https://x/y', undefined)).toBe(false);
    expect(sameServer(undefined, undefined)).toBe(false);
  });

  it('separates two different hosts on the same path', () => {
    expect(sameServer('http://192.168.1.2:8098', 'http://192.168.1.3:8098')).toBe(false);
  });
});

describe('checkServerIdentity (tier 1)', () => {
  const identity = { serverUrl: 'http://192.168.1.2:8098', serverId: 'abc', userId: 'u1' };

  it('passes when the app is on the declared server', () => {
    const v = checkServerIdentity(identity, 'http://192.168.1.2:8098');
    expect(v).toMatchObject({ asserted: true, ok: true });
  });

  it('fails, and names both sides, when it is not', () => {
    const v = checkServerIdentity(identity, 'https://demo.jellyfin.org/stable');
    expect(v.asserted).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('192.168.1.2');
    expect(v.reason).toContain('demo.jellyfin.org/stable');
  });

  it('says explicitly that it did NOT assert when no expectation was declared', () => {
    // "Nobody told me which server to expect" and "the server is the one you
    // expected" must never look alike in the output — the entire value of the
    // tier is the difference between them.
    const v = checkServerIdentity(identity, undefined);
    expect(v.asserted).toBe(false);
    expect(v.ok).toBe(true);
    expect(v.reason).toMatch(/did NOT assert/);
  });

  it('explains why serverId/userId are not the fields to compare', () => {
    const v = checkServerIdentity(identity, 'https://demo.jellyfin.org/unstable');
    expect(v.reason).toMatch(/cloned from one seed DB|identical pair/);
  });
});

describe('checkSeriesConsistency', () => {
  const first = { serverUrl: 'http://a', serverId: 's1', userId: 'u1', serverVersion: '10.11.11' };

  it('passes when nothing moved under the series', () => {
    expect(checkSeriesConsistency(first, { ...first })).toEqual({ ok: true, drifted: [] });
  });

  it('catches a server that changed HALFWAY THROUGH', () => {
    // Different guarantee from the declared expectation, and neither subsumes the
    // other: this fires even when the drift lands on the expected server.
    const v = checkSeriesConsistency(first, { ...first, serverUrl: 'http://b' });
    expect(v.ok).toBe(false);
    expect(v.drifted).toEqual([{ field: 'serverUrl', from: 'http://a', to: 'http://b' }]);
  });

  it('catches a server UPGRADE mid-series, which no URL check would see', () => {
    const v = checkSeriesConsistency(first, { ...first, serverVersion: '12.0.0' });
    expect(v.ok).toBe(false);
    expect(v.drifted[0].field).toBe('serverVersion');
  });

  it('catches a user switch', () => {
    expect(checkSeriesConsistency(first, { ...first, userId: 'u2' }).ok).toBe(false);
  });
});

describe('readAppVersion', () => {
  it('reads the version the DEVICE was given, from the manifest', () => {
    const p = writeManifest(
      'title=JellyRock\nmajor_version=2\nminor_version=25\nbuild_version=0\n',
    );
    expect(readAppVersion(p)).toBe('2.25.0');
  });

  it('returns undefined rather than a partial version', () => {
    const p = writeManifest('title=JellyRock\nmajor_version=2\n');
    expect(readAppVersion(p)).toBeUndefined();
  });

  it('returns undefined for a missing manifest instead of throwing', () => {
    expect(readAppVersion(path.join(tmp, 'nope'))).toBeUndefined();
  });
});

describe('readBuildFlags', () => {
  it('parses bs_const, including the ENABLE_RTA the app never stamps', () => {
    const p = writeManifest('bs_const=debug=false;ENABLE_RTA=false;perfTiming=true\n');
    expect(readBuildFlags(p)).toEqual({ debug: false, ENABLE_RTA: false, perfTiming: true });
  });

  it('keeps a non-boolean value as a string rather than coercing it', () => {
    const p = writeManifest('bs_const=debug=false;someLevel=3\n');
    expect(readBuildFlags(p).someLevel).toBe('3');
  });

  it('returns undefined when there is no bs_const line', () => {
    expect(readBuildFlags(writeManifest('title=JellyRock\n'))).toBeUndefined();
  });

  it('matches the committed manifest, so the recorded flavor is real', () => {
    // Pins the tool against the actual repo state rather than a synthetic string:
    // `perfTiming` must be true or `npm run measure` samples a silent app.
    const flags = readBuildFlags(path.join(process.cwd(), 'manifest'));
    expect(flags.perfTiming).toBe(true);
  });
});
