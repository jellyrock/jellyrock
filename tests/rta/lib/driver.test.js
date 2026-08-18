/**
 * Hardware-free gate on the one part of the deploy that decides WHICH BUILD a measurement
 * arm actually is — see `deployBuild` in `driver.js`.
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device) — distinct from the `.spec.js`
 * files under `specs/`, which drive real hardware.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { shippedRtaFlagMismatch } from './driver.js';

describe('shippedRtaFlagMismatch — did the ENABLE_RTA flip actually take?', () => {
  const RTA = 'bs_const=debug=false;ENABLE_RTA=true;perfTiming=true';
  const PLAIN = 'bs_const=debug=false;ENABLE_RTA=false;perfTiming=true';

  it('passes when the staged manifest says what the deploy asked for', () => {
    expect(shippedRtaFlagMismatch(RTA, true)).toBeNull();
    expect(shippedRtaFlagMismatch(PLAIN, false)).toBeNull();
  });

  it('REFUSES the failure that matters: a `plain` deploy whose flip silently no-opped', () => {
    // The flip is an unanchored string replace against RTA's own output. If it ever stops
    // matching, what ships is `ENABLE_RTA=true` with no component — which IS the
    // `no-component` arm, and nothing downstream can tell the two apart: neither has an
    // ODC, so `odcIsResident` is false and `provenance.enableRta` records `false` for
    // both. The calibration would compare the wrong pair and refuse nothing.
    const refusal = shippedRtaFlagMismatch(RTA, false);
    expect(refusal).toMatch(/ENABLE_RTA=true/);
    expect(refusal).toMatch(/asked for ENABLE_RTA=false/);
    expect(refusal).toMatch(/no-component/);
  });

  it('refuses the other direction too, so `deployRtaBuild` cannot ship a plain build', () => {
    expect(shippedRtaFlagMismatch(PLAIN, true)).toMatch(/asked for ENABLE_RTA=true/);
  });

  it('refuses a manifest that says NOTHING about the flag, rather than passing it', () => {
    // Absent is not false. A `bs_const` that lost the key is a build nobody can attribute,
    // and reading silence as agreement is exactly how a guard goes quietly blind.
    expect(shippedRtaFlagMismatch('bs_const=debug=false;perfTiming=true', false)).toMatch(
      /nothing about ENABLE_RTA/,
    );
    expect(shippedRtaFlagMismatch(null, false)).toMatch(/nothing about ENABLE_RTA/);
    expect(shippedRtaFlagMismatch(null, true)).toMatch(/nothing about ENABLE_RTA/);
  });

  it('reads the REAL committed manifest, so the guard cannot drift from the build', () => {
    // Against the repo's actual `bs_const` rather than a synthetic string. The committed
    // value is `ENABLE_RTA=false` and RTA rewrites it to `true` in the staged copy on
    // every deploy — so if this line's SHAPE ever changes, the guard that depends on
    // matching it fails here rather than on a device mid-calibration.
    const manifest = fs.readFileSync(path.join(process.cwd(), 'manifest'), 'utf8');
    const bsConst = /^bs_const=.*$/m.exec(manifest)?.[0];
    expect(bsConst).toBeDefined();
    expect(shippedRtaFlagMismatch(bsConst, false)).toBeNull();
    expect(shippedRtaFlagMismatch(bsConst, true)).toMatch(/asked for ENABLE_RTA=true/);
  });
});
