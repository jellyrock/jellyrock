/**
 * Hardware-free gate on the one part of the deploy that decides WHICH BUILD a measurement
 * arm actually is — see `deployBuild` in `driver.js`.
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device) — distinct from the `.spec.js`
 * files under `specs/`, which drive real hardware.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `driver.js` re-exports the device clients at module scope, so they have to exist for it
// to import at all. Only `odc.getValue` is driven — `shippedRtaFlagMismatch` is pure and
// never reaches any of this.
const getValue = vi.fn();
vi.mock('roku-test-automation', () => ({
  odc: { getValue: (...a) => getValue(...a) },
  ecp: { sendKeypress: vi.fn(), sendLaunchChannel: vi.fn() },
  device: { getCurrentDeviceConfig: () => ({ host: '127.0.0.1' }) },
  utils: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
}));

const { shippedRtaFlagMismatch, waitSceneAnswering, ensureOdcReachable } =
  await import('./driver.js');

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

describe('ensureOdcReachable — refuse the first ODC call rather than hang on it', () => {
  /** Listen on a port and hand back a closer. Real sockets: the probe IS the thing tested. */
  const listening = async (port) => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
  };

  /** A port nothing is on. Bound then released, so it is free rather than merely unlikely. */
  const freePort = async () => {
    const s = await listening(0);
    await s.close();
    return s.port;
  };

  it('returns as soon as the component is answering', async () => {
    const server = await listening(0);
    try {
      await expect(
        ensureOdcReachable({ host: '127.0.0.1', port: server.port, timeoutMs: 5000 }),
      ).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('POLLS a refused port instead of failing on the first answer', async () => {
    // The no-regression property, and the one a one-shot gate would break. `odcIsResident`
    // answers `false` the instant a port is refused, so a device 200 ms from finishing its
    // boot would be reported as having no RTA build at all — turning a slow-but-working
    // launch into a spurious failure. RTA itself retries a refused connect for 10 s, so
    // this gate has to be at least as patient or it fails runs that used to pass.
    const port = await freePort();
    let server;
    const appearing = new Promise((resolve) => {
      setTimeout(async () => {
        server = await listening(port);
        resolve();
      }, 250);
    });
    try {
      await expect(
        ensureOdcReachable({ host: '127.0.0.1', port, timeoutMs: 5000, pollMs: 50 }),
      ).resolves.toBeUndefined();
    } finally {
      await appearing;
      await server?.close();
    }
  });

  it('gives up with the CAUSES, not an elapsed time', async () => {
    // The message is the deliverable: this failure presents as a network problem and is
    // almost never one. Each branch names a thing the reader can go and check.
    const port = await freePort();
    const err = await ensureOdcReachable({
      host: '127.0.0.1',
      port,
      timeoutMs: 150,
      pollMs: 25,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/no ODC/); //   a Rooibos / build:prod build
    expect(err.message).toMatch(/channel is closed/); // the app simply exited
    expect(err.message).toMatch(/device:check/); //   wrong host, or asleep
    expect(err.message).toMatch(/PRECONDITION, not a timeout/);
  });

  it('is BLIND to a port that opens and never answers — which is why reads are bounded too', async () => {
    // Stated as a test because it is the boundary between this gate and
    // `REGISTRY_READ_TIMEOUT_MS`. A socket that accepts and stays silent satisfies this
    // probe in ~1 ms while an ODC call against it hangs unbounded (45 s+, measured
    // 2026-09-06). Neither mechanism is sufficient alone, and a reader who assumes this
    // one covers liveness would drop the other.
    const silent = net.createServer(() => {});
    await new Promise((r) => silent.listen(0, '127.0.0.1', r));
    const { port } = silent.address();
    try {
      await expect(
        ensureOdcReachable({ host: '127.0.0.1', port, timeoutMs: 5000 }),
      ).resolves.toBeUndefined();
    } finally {
      await new Promise((r) => silent.close(r));
    }
  });
});
