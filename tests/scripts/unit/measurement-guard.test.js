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
  buildFlagsAgree,
  checkSeriesConsistency,
  checkServerIdentity,
  IDENTITY_FATAL_FIELDS,
  missingIdentityFields,
  readAppVersion,
  readCheckoutBuildFlags,
  sameServer,
} from '../../../scripts/measurement-guard.js';
import {
  cannotRunApps,
  describeDevice,
  deviceFor,
  ramTierFor,
  ROKU_HARDWARE,
} from '../../../scripts/roku-devices.js';
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
  it('reads the version THIS CHECKOUT would build, from the manifest', () => {
    // Not "what the device is running" — `npm run measure` defaults to measuring a
    // build it did not deploy. The record files this under `checkout` and carries
    // `deployedFromCheckout` beside it for exactly that reason.
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

describe('readCheckoutBuildFlags', () => {
  it('parses bs_const', () => {
    const p = writeManifest('bs_const=debug=false;perfTiming=true\n');
    expect(readCheckoutBuildFlags(p)).toEqual({ debug: false, perfTiming: true });
  });

  it('REFUSES to report ENABLE_RTA, which the checkout cannot know', () => {
    // The committed value is always `false`; RTA's deploy flips it to `true` in the
    // STAGED build dir only. Reading it here reported `ENABLE_RTA: false` on every
    // run, including runs that had just deployed with it on and recorded
    // `enableRta: true` two fields away — one record, two answers, and the
    // contradiction manufactured by reading a file that cannot know. It is derived
    // from a responding ODC instead.
    const p = writeManifest('bs_const=debug=false;ENABLE_RTA=false;perfTiming=true\n');
    expect(readCheckoutBuildFlags(p)).not.toHaveProperty('ENABLE_RTA');
    expect(readCheckoutBuildFlags(p)).toEqual({ debug: false, perfTiming: true });
  });

  it('keeps a non-boolean value as a string rather than coercing it', () => {
    const p = writeManifest('bs_const=debug=false;someLevel=3\n');
    expect(readCheckoutBuildFlags(p).someLevel).toBe('3');
  });

  it('returns undefined when there is no bs_const line', () => {
    expect(readCheckoutBuildFlags(writeManifest('title=JellyRock\n'))).toBeUndefined();
  });

  it('matches the committed manifest, so the recorded flavor is real', () => {
    // Pins the tool against the actual repo state rather than a synthetic string:
    // `perfTiming` must be true or `npm run measure` samples a silent app.
    const flags = readCheckoutBuildFlags(path.join(process.cwd(), 'manifest'));
    expect(flags.perfTiming).toBe(true);
  });
});

describe('buildFlagsAgree — is the device running THIS checkout?', () => {
  it('is true when the app bracket matches the checkout', () => {
    expect(
      buildFlagsAgree({ debug: false, perfTiming: true }, { debug: false, perfTiming: true }),
    ).toBe(true);
  });

  it('is false when the running build was compiled differently', () => {
    // The only available evidence that a non-deploy run measured something other
    // than what this checkout would build — which is exactly the case where the
    // record's appVersion and commit describe the wrong artifact.
    expect(
      buildFlagsAgree({ debug: true, perfTiming: true }, { debug: false, perfTiming: true }),
    ).toBe(false);
  });

  it('is NULL, never true, when there is nothing to compare', () => {
    // "The flags match" and "no flags were seen" must not look alike — the same
    // rule that keeps `asserted: false` from looking like a tier-1 pass.
    expect(buildFlagsAgree(undefined, { debug: false })).toBeNull();
    expect(buildFlagsAgree({ debug: false }, undefined)).toBeNull();
    expect(buildFlagsAgree({ somethingElse: true }, { debug: false })).toBeNull();
  });

  it('ignores checkout flags the app does not stamp', () => {
    // The checkout declares more than the bracket carries; an absent key is not a
    // disagreement.
    expect(buildFlagsAgree({ debug: false }, { debug: false, perfTiming: true })).toBe(true);
  });
});

describe('missingIdentityFields — the quiet half of a failed read', () => {
  const full = {
    serverUrl: 'http://a',
    serverId: 's1',
    serverVersion: '10.11.11',
    apiVersion: 2,
    userId: 'u1',
  };

  it('reports nothing when the batch answered every field', () => {
    expect(missingIdentityFields(full)).toEqual([]);
  });

  it('names a field ODC answered but could not find', () => {
    // `readIdentity` throws when the BATCH fails — the loud case. This is the quiet
    // one: ODC answers and reports `found: false`, which otherwise becomes
    // `serverUrl: undefined` in a written record. That is the laundering the throw
    // exists to prevent, one layer down.
    expect(missingIdentityFields({ ...full, serverUrl: undefined })).toEqual(['serverUrl']);
  });

  it('treats an empty string as absent, not as a value', () => {
    // `JellyfinServer.serverUrl` defaults to `""`, so a not-signed-in app reports
    // found-but-empty rather than not-found.
    expect(missingIdentityFields({ ...full, serverUrl: '' })).toEqual(['serverUrl']);
  });

  it('makes serverUrl the fatal one, because tier 1 rests on it', () => {
    expect(IDENTITY_FATAL_FIELDS).toContain('serverUrl');
    expect(IDENTITY_FATAL_FIELDS).not.toContain('apiVersion');
  });
});

describe('the RAM tier lookup', () => {
  it('resolves the three local devices, including a model number Roku never published', () => {
    // `.177` reports `3820RW`, which appears in no Roku table — the family does
    // (`3820X`, `3820X2`, both 1 GB), which is why the key is the model FAMILY.
    expect(ramTierFor('3600X')).toBe('512MB');
    expect(ramTierFor('3820RW')).toBe('1GB');
    expect(ramTierFor('4850X')).toBe('2GB');
  });

  it('resolves the Roku TVs and the Projector, which the old four-DIGIT key could not', () => {
    // The regression this dataset exists for: `/^(\d{4})/` returned null for every
    // letter-prefixed model number — sixteen families from 512 MB to 2 GB, and the
    // largest device class Roku ships.
    expect(ramTierFor('J000X')).toBe('2GB'); // 4K Roku TV (Trinidad)
    expect(ramTierFor('K8PXX')).toBe('512MB'); // Projector (Avery)
    expect(ramTierFor('A000X')).toBe('1.5GB'); // 4K Roku TV (Reno)
    expect(ramTierFor('C000GB')).toBe('1GB'); // 4K Roku TV (EU) — a six-char model number
  });

  it('returns null for a family it does not know, rather than the commonest value', () => {
    // A guess here would let a comparison pair a 512 MB Stick against an Ultra and
    // print a delta that is entirely hardware.
    expect(ramTierFor('9999X')).toBeNull();
    expect(ramTierFor(undefined)).toBeNull();
    expect(ramTierFor('')).toBeNull();
  });

  it('says whether it matched the exact model or only its family', () => {
    // A family match can answer RAM and nothing else, because nothing else is
    // invariant across a family — `3820X` and `3820X2` differ in code name and year.
    expect(deviceFor('3820X2').matchedBy).toBe('model');
    expect(deviceFor('3820X2').variants[0].codeName).toBe('Logan');
    const loose = deviceFor('3820RW');
    expect(loose.matchedBy).toBe('family');
    expect(loose.ramTier).toBe('1GB');
    expect(loose.variants).toBeUndefined();
  });

  it('never collapses a model number that upstream lists as two devices', () => {
    // `8000X` is both "Roku TV" (Midland, 2019) and "Roku TV (Brazil)" (El Paso,
    // 2020), with different playback resolutions. A device reporting it could be
    // either, so picking the first would be inventing provenance.
    const both = deviceFor('8000X');
    expect(both.variants.map((v) => v.codeName).sort()).toEqual(['El Paso', 'Midland']);
    expect(describeDevice('8000X')).toMatch(/Roku TV \/ Roku TV \(Brazil\)/);
    // …but the field the measurement guard needs is asserted equal across them.
    expect(both.ramTier).toBe('512MB');
  });

  it('knows which devices cannot run JellyRock at all', () => {
    // Roku's legacy table says outright that those models "cannot be used to run IDK
    // apps". Recorded rather than omitted — "cannot run" and "not in the table" are
    // different facts, and the second sends someone hunting for a missing entry.
    expect(cannotRunApps('N1000')).toBe(true); // Roku DVP, capped at Roku OS 3.1
    expect(cannotRunApps('3820X2')).toBe(false);
    expect(cannotRunApps('9999X')).toBe(false); // unknown is not the same as legacy
  });
});

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
