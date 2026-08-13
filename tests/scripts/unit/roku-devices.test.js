/**
 * The Roku device dictionary's READ side — see `scripts/roku-devices.js`.
 *
 * What these pin is the lookup CONTRACT, not the data: that a model number Roku never
 * published still resolves through its family, that a letter-prefixed model number
 * resolves at all (the regression the generated dataset exists for), that an unknown
 * device comes back `null` rather than as the commonest tier, and that a model number
 * upstream lists as two physical devices is never collapsed to one. The data itself is
 * checked in `roku-hardware.test.js`, against the generator that produced it.
 */
import { describe, expect, it } from 'vitest';

import {
  cannotRunApps,
  describeDevice,
  deviceFor,
  ramTierFor,
} from '../../../scripts/roku-devices.js';

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
