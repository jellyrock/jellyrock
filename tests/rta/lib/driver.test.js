/**
 * Hardware-free gate on the one part of the deploy that decides WHICH BUILD a measurement
 * arm actually is — see `deployBuild` in `driver.js`.
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device) — distinct from the `.spec.js`
 * files under `specs/`, which drive real hardware.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `driver.js` re-exports the device clients at module scope, so they have to exist for it
// to import at all. Only `odc.getValue` is driven — `shippedRtaFlagMismatch` is pure and
// never reaches any of this.
const getValue = vi.fn();
vi.mock('roku-test-automation', () => ({
  odc: { getValue: (...a) => getValue(...a) },
  ecp: { sendKeypress: vi.fn(), sendLaunchChannel: vi.fn() },
  device: {},
  utils: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
}));

const { shippedRtaFlagMismatch, waitSceneAnswering } = await import('./driver.js');

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

/**
 * `waitSceneAnswering` — the scene wait two specs had each written out.
 *
 * The property gated is the one the two copies DISAGREED about: what happens on timeout.
 * One threw; the other ran a bounded `for` and fell through, so a scene that never
 * answered went on to `createChild` anyway and failed there, blaming the child for the app
 * not being up. A silent fall-through is invisible in a green run and misattributes the
 * failure in a red one, which is why it is asserted rather than reviewed.
 */
describe('waitSceneAnswering — the app being up is not something to fall through', () => {
  beforeEach(() => getValue.mockReset());

  it('returns as soon as the scene answers', async () => {
    getValue.mockResolvedValue({ found: true });
    await expect(waitSceneAnswering({ timeout: 500, interval: 10 })).resolves.toBeUndefined();
    expect(getValue).toHaveBeenCalledTimes(1);
  });

  it('keeps polling while the scene is not there yet', async () => {
    getValue
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValueOnce({ found: false })
      .mockResolvedValue({ found: true });
    await waitSceneAnswering({ timeout: 2000, interval: 10 });
    expect(getValue).toHaveBeenCalledTimes(3);
  });

  it('THROWS on timeout rather than falling through — the defect the duplicate carried', async () => {
    getValue.mockResolvedValue({ found: false });
    await expect(waitSceneAnswering({ timeout: 60, interval: 10 })).rejects.toThrow(
      /scene never answered/,
    );
  });

  it('treats a rejected read as "not yet", not as an answer', async () => {
    // The transport failing IS the expected state early on — the app is not up, so the
    // request has nothing to reach. Letting it escape would turn the normal case into a
    // crash, and swallowing it into `found: true` would pass the wait on a dead device.
    getValue.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue({ found: true });
    await expect(waitSceneAnswering({ timeout: 2000, interval: 10 })).resolves.toBeUndefined();
    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it('names what to check, so the message is actionable without a device dump', async () => {
    // It cannot use `diagnosedError` — that reads the device that is not answering — so
    // the message is the whole diagnostic.
    getValue.mockResolvedValue({ found: false });
    const err = await waitSceneAnswering({ timeout: 60, interval: 10 }).catch((e) => e);
    expect(err.message).toMatch(/is the app running/);
    expect(err.message).toMatch(/ENABLE_RTA/);
  });
});
