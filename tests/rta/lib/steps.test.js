/**
 * Hardware-free gate on `getActiveVals`' failure semantics.
 *
 * The batch helper exists to cut a one-shot assertion's device round trips from ~112
 * to 2, but the property worth gating is not the count — it is that a DEAD BATCH and
 * a MISSING FIELD stay distinguishable.
 *
 * The single-read `getActiveVal` swallows to `undefined`, which is correct for a poll
 * (callers retry; a persistent miss ends in a diagnosed timeout). Copying that into a
 * batch would be the `lib/jellyfin.js` defect one layer up: an ODC failure would make
 * every keyPath read `undefined` at once, and the assertion consuming them would
 * report "this screen has no rows" — a confident false statement about the app,
 * produced by an infrastructure failure.
 *
 * `odc` is stubbed rather than driven, deliberately: the behaviours under test are
 * "the transport rejected" and "the device answered `found: false`", and both are
 * shapes at the module boundary. What needs a real Roku is whether a given keyPath
 * resolves — that stays hardware-verified via `npm run test:rta`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getValues = vi.fn();
const getFocusedNode = vi.fn();
vi.mock('roku-test-automation', () => ({
  odc: {
    getValues: (...a) => getValues(...a),
    getValue: vi.fn(),
    getFocusedNode: (...a) => getFocusedNode(...a),
  },
  ecp: { sendKeypress: vi.fn() },
}));

const { getActiveVals } = await import('./steps.js');

beforeEach(() => {
  // NOTE the coupling these defaults model: the throw path runs through
  // `diagnosedError`, which calls `captureFailureState`, which issues its OWN
  // `getFocusedNode` + `getValues` against the same device. So a test that makes the
  // batch fail must fail only the FIRST call (`mockRejectedValueOnce`) and leave the
  // diagnostic capture able to answer — otherwise it is testing a device that has
  // gone away entirely, not a failed batch. Both must return promises for the same
  // reason: the capture `.catch()`es them.
  getValues.mockReset().mockResolvedValue({ results: {} });
  getFocusedNode.mockReset().mockResolvedValue(null);
});

describe('getActiveVals', () => {
  it('returns values positionally aligned with the keyPaths given', () => {
    getValues.mockResolvedValue({
      results: { k0: { found: true, value: 'Action' }, k1: { found: true, value: 3 } },
    });
    return expect(getActiveVals(['#a.title', '#a.getChildCount()'])).resolves.toEqual([
      'Action',
      3,
    ]);
  });

  it('reads a NOT-FOUND keyPath as undefined, matching the single-read form', async () => {
    // The device answered about this keyPath and did not find it. That is a fact, and
    // it must stay reportable as absence.
    getValues.mockResolvedValue({
      results: { k0: { found: true, value: 'Action' }, k1: { found: false } },
    });
    await expect(getActiveVals(['#a.title', '#a.missing'])).resolves.toEqual(['Action', undefined]);
  });

  it('THROWS when the batch itself fails, rather than reporting every field missing', async () => {
    // THE case. Swallowing here would hand an assertion a screen that appears
    // completely empty, and the assertion would blame the app.
    getValues.mockRejectedValueOnce(new Error('odc timeout'));
    await expect(getActiveVals(['#a.title'])).rejects.toThrow(/odc timeout/);
  });

  it('THROWS when the response carries no results at all', async () => {
    // A malformed answer is not an answer. Same reasoning as the rejection above:
    // anything other than a real batch must not become a screenful of undefined.
    getValues.mockResolvedValueOnce({});
    await expect(getActiveVals(['#a.title'])).rejects.toThrow(/not with a batch/);
  });

  it('sends ONE batch for many keyPaths, each scoped to the active routed view', async () => {
    // The round-trip saving is the reason this exists; and the `activeRoutedView.`
    // prefix is what keeps it reading the screen the user is on rather than a
    // suspended keepAlive view (see getActiveVal).
    getValues.mockResolvedValue({ results: { k0: { found: true, value: 1 } } });
    await getActiveVals(['#a.x', '#b.y', '#c.z']);

    expect(getValues).toHaveBeenCalledTimes(1);
    const { requests } = getValues.mock.calls[0][0];
    expect(Object.keys(requests)).toHaveLength(3);
    for (const r of Object.values(requests)) {
      expect(r.base).toBe('global');
      expect(r.keyPath).toMatch(/^activeRoutedView\./);
    }
  });

  it('keys requests positionally, so a duplicate keyPath cannot collapse', async () => {
    // Keying by the keyPath itself would silently merge these into one request and
    // return a short array — a miscount inside the thing that reports counts.
    getValues.mockResolvedValue({
      results: { k0: { found: true, value: 'x' }, k1: { found: true, value: 'x' } },
    });
    await expect(getActiveVals(['#a.title', '#a.title'])).resolves.toEqual(['x', 'x']);
    expect(Object.keys(getValues.mock.calls[0][0].requests)).toHaveLength(2);
  });

  it('makes no device call at all for an empty list', async () => {
    await expect(getActiveVals([])).resolves.toEqual([]);
    expect(getValues).not.toHaveBeenCalled();
  });
});
