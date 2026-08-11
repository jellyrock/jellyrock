/**
 * Hardware-free gate on the failure-kind registry.
 *
 * `kind` is the key the flake baseline aggregates by, and a bucket goes wrong in
 * two directions. Two names for one class SPLITS the count — guarded at runtime by
 * `kindUnknown`, which the run summary reports. One name for two classes MERGES it
 * — a copy-pasted entry, invisible in review and invisible at runtime, because
 * both sites look perfectly valid. That second one is what these assert.
 *
 * The device-side capture itself is not testable here (it needs a real Roku); it
 * is verified by forcing failures on hardware. See `docs/dev/rta-tests.md`.
 */
import { describe, it, expect } from 'vitest';
import { FAILURE_KINDS, isUnknownKind } from './diagnostics.js';

describe('FAILURE_KINDS', () => {
  const entries = Object.entries(FAILURE_KINDS);

  it('maps every name to a distinct slug', () => {
    // The silent-merge case: a copy-pasted entry that reuses a slug would fold two
    // failure classes into one bucket, and nothing at runtime could tell.
    const slugs = entries.map(([, slug]) => slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses kebab-case slugs throughout', () => {
    // Consistency is what lets the baseline group without normalising, and a
    // one-off `detail_row` would aggregate as its own bucket forever.
    for (const [name, slug] of entries) {
      expect(slug, `${name} -> "${slug}"`).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('is frozen, so a typo cannot quietly add a member at runtime', () => {
    expect(Object.isFrozen(FAILURE_KINDS)).toBe(true);
  });

  it('recognises its own members and rejects anything else', () => {
    for (const slug of Object.values(FAILURE_KINDS)) expect(isUnknownKind(slug)).toBe(false);
    expect(isUnknownKind('detail-rows-missing')).toBe(true);
    // A typo'd property reads as undefined — it must not pass as registered.
    expect(isUnknownKind(FAILURE_KINDS.DETAIL_ROW_NOT_FOND)).toBe(true);
    expect(isUnknownKind(undefined)).toBe(true);
  });
});
