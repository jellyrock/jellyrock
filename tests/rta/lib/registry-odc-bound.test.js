/**
 * Hardware-free gate on the one property Phase 8 added to the registry path: its ODC reads
 * are bounded, and the reachability check runs BEFORE them.
 *
 * Its own file rather than a block in `registry.test.js`, because it has to mock
 * `./driver.js` and that file imports the real one for `setupRtaEnv`.
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device) — distinct from the `.spec.js`
 * files under `specs/`, which drive real hardware.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let readRegistry = vi.fn();
let gateResult = Promise.resolve();

// `withTimeout` is REAL — it is half of what is under test here. Everything that would
// touch a device is not.
vi.mock('./driver.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    odc: {
      readRegistry: (...a) => {
        calls.push('read');
        return readRegistry(...a);
      },
      writeRegistry: vi.fn(),
      deleteRegistrySections: vi.fn(),
    },
    device: { getCurrentDeviceConfig: () => ({ host: '127.0.0.1' }) },
    hardRelaunch: vi.fn(),
    ensureOdcReachable: () => {
      calls.push('gate');
      return gateResult;
    },
  };
});

const { _internals } = await import('./registry.js');

beforeEach(() => {
  calls.length = 0;
  gateResult = Promise.resolve();
  readRegistry = vi.fn().mockResolvedValue({ values: {} });
});

describe('readRegistryBounded — the first ODC call of a run cannot hang, or crash the run', () => {
  it('checks the component is THERE before it reads', async () => {
    await _internals.readRegistryBounded('the snapshot read');
    // Order, not merely presence. Reading first and bounding afterwards leaves RTA free to
    // reject a connect it cannot complete and take the process down with `exit 1` from an
    // orphaned rejection no `catch` of ours can reach — the failure this ordering exists to
    // prevent, and one a `withTimeout` cannot.
    expect(calls).toEqual(['gate', 'read']);
  });

  it('does not read at all when the component is absent', async () => {
    gateResult = Promise.reject(new Error('nothing is listening on 127.0.0.1:9000'));
    await expect(_internals.readRegistryBounded('the snapshot read')).rejects.toThrow(
      /nothing is listening/,
    );
    expect(calls).toEqual(['gate']);
  });

  it('gives up on a read that never settles, instead of waiting forever', async () => {
    // The measured failure: a socket that accepts and never answers the handshake leaves
    // RTA's cached promise unsettled, so the read has no bound of its own at all — still
    // pending at 45 s in a probe, and 8+ minutes once on `.178`.
    readRegistry = vi.fn(() => new Promise(() => {}));
    const err = await _internals
      .readRegistryBounded('the snapshot read', { timeoutMs: 40 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/never answered the snapshot read/);
  });

  it('names the upstream defect and the recovery, not just the elapsed time', async () => {
    readRegistry = vi.fn(() => new Promise(() => {}));
    const err = await _internals
      .readRegistryBounded('the snapshot read', { timeoutMs: 40 })
      .catch((e) => e);
    expect(err.message).toMatch(/rta-odc-connect-hang/); // where the upstream watch lives
    expect(err.message).toMatch(/npm run test:rta/); //     what to actually do about it
  });

  it('passes a successful read straight through', async () => {
    readRegistry = vi.fn().mockResolvedValue({ values: { JellyRock: { server: 'x' } } });
    await expect(_internals.readRegistryBounded('the snapshot read')).resolves.toEqual({
      values: { JellyRock: { server: 'x' } },
    });
  });

  it('is bounded far above a healthy read, so it diagnoses rather than gates performance', () => {
    // ~10,000x a healthy ODC round trip (~5.4 ms on the slower device). A bound tight
    // enough to be reachable by a working read would trade an unbounded hang for a
    // spurious failure, which is the worse of the two.
    expect(_internals.REGISTRY_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });
});
