/**
 * Hardware-free gate on the one part of the deploy that decides WHICH BUILD a measurement
 * arm actually is (see `deployBuild` in `driver.js`).
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device) is distinct from the `.spec.js`
 * files under `specs/`, which drive real hardware.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `driver.js` re-exports the device clients at module scope, so they have to exist for it
// to import at all. `odc.getValue` and the ECP calls are driven by the restart tests;
// `shippedRtaFlagMismatch` is pure and never reaches any of this.
const getValue = vi.fn();
const getActiveApp = vi.fn();
const sendKeypress = vi.fn();
const sendLaunchChannel = vi.fn();
vi.mock('roku-test-automation', () => ({
  odc: { getValue: (...a) => getValue(...a) },
  ecp: {
    sendKeypress: (...a) => sendKeypress(...a),
    sendLaunchChannel: (...a) => sendLaunchChannel(...a),
    getActiveApp: (...a) => getActiveApp(...a),
  },
  device: { getCurrentDeviceConfig: () => ({ host: '127.0.0.1' }) },
  utils: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
}));

// The TCP probe stays REAL unless a test swaps it: the `ensureOdcReachable` cases below test
// real sockets on purpose, while the restart cases need to say when the port opens.
const probe = { impl: null };
vi.mock('../../../scripts/lib/odc-probe.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, odcIsResident: (...a) => (probe.impl ?? real.odcIsResident)(...a) };
});

// The fixed path sleeps `exitMs` and `bootMs`; at their real 14 s a unit test would wait
// them out.
vi.mock('../config.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, RTA_CONFIG: { ...real.RTA_CONFIG, exitMs: 5, bootMs: 5 } };
});

// A re-sent Home press is recorded as a recovery, which writes into the run record outside a
// run; a spy keeps it out of the repo and lets the tests read what was recorded.
const recordRecovery = vi.fn();
vi.mock('../../../scripts/run-record.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordRecovery: (...a) => recordRecovery(...a),
}));

// The landing half lives in `steps.js` and has its own tests there; here it only has to
// run last.
const waitLandingSettled = vi.fn();
vi.mock('./steps.js', async (importOriginal) => ({
  ...(await importOriginal()),
  waitLandingSettled: (...a) => waitLandingSettled(...a),
}));

const {
  shippedRtaFlagMismatch,
  waitSceneAnswering,
  ensureOdcReachable,
  waitChannelExited,
  hardRelaunch,
} = await import('./driver.js');

describe('shippedRtaFlagMismatch — did the ENABLE_RTA flip actually take?', () => {
  const RTA = 'bs_const=debug=false;ENABLE_RTA=true;perfTiming=true';
  const PLAIN = 'bs_const=debug=false;ENABLE_RTA=false;perfTiming=true';

  it('passes when the staged manifest says what the deploy asked for', () => {
    expect(shippedRtaFlagMismatch(RTA, true)).toBeNull();
    expect(shippedRtaFlagMismatch(PLAIN, false)).toBeNull();
  });

  it('REFUSES the failure that matters: a `plain` deploy whose flip silently no-opped', () => {
    // The flip is an unanchored string replace against RTA's own output. If it ever stops
    // matching, what ships is `ENABLE_RTA=true` with no component, which is the
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
    // every deploy, so if this line's SHAPE ever changes, the guard that depends on
    // matching it fails here rather than on a device mid-calibration.
    const manifest = fs.readFileSync(path.join(process.cwd(), 'manifest'), 'utf8');
    const bsConst = /^bs_const=.*$/m.exec(manifest)?.[0];
    expect(bsConst).toBeDefined();
    expect(shippedRtaFlagMismatch(bsConst, false)).toBeNull();
    expect(shippedRtaFlagMismatch(bsConst, true)).toMatch(/asked for ENABLE_RTA=true/);
  });
});

/**
 * `waitSceneAnswering`: the scene wait two specs had each written out.
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
    // The transport failing IS the expected state early on: the app is not up, so the
    // request has nothing to reach. Letting it escape would turn the normal case into a
    // crash, and swallowing it into `found: true` would pass the wait on a dead device.
    getValue.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue({ found: true });
    await expect(waitSceneAnswering({ timeout: 2000, interval: 10 })).resolves.toBeUndefined();
    expect(getValue).toHaveBeenCalledTimes(2);
  });

  it('names what to check, so the message is actionable without a device dump', async () => {
    // It cannot use `diagnosedError` (that reads the device that is not answering), so
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
    // boot would be reported as having no RTA build at all, turning a slow-but-working
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
    expect(err.message).toMatch(/channel is closed/); // the app exited
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

/** ECP's answer while the Roku home screen is in front: it carries a title and no id. */
const HOME_SCREEN = { app: { title: 'Roku' } };
/** ECP's answer while the dev channel is in front. */
const DEV_CHANNEL = { app: { id: 'dev', title: 'JellyRock' } };

/**
 * `waitChannelExited` decides whether the launch after it starts the app COLD, which is the
 * only way a seed reaches it. So the property gated is that it never says "exited" early: not
 * while the channel is still in front, not while its port is still open, and not on an ECP
 * read that failed.
 */
describe('waitChannelExited — the restart launches only after the app is gone', () => {
  beforeEach(() => {
    getActiveApp.mockReset();
    sendKeypress.mockReset();
    recordRecovery.mockReset();
    probe.impl = vi.fn();
  });
  afterEach(() => {
    probe.impl = null;
  });

  const wait = (opts = {}) => waitChannelExited({ timeoutMs: 500, pollMs: 5, ...opts });

  it('returns once another app is in front AND the port has closed', async () => {
    getActiveApp.mockResolvedValue(HOME_SCREEN);
    probe.impl.mockResolvedValue(false);
    await expect(wait()).resolves.toBeUndefined();
    expect(getActiveApp).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting while the dev channel is still in front', async () => {
    getActiveApp
      .mockResolvedValueOnce(DEV_CHANNEL)
      .mockResolvedValueOnce(DEV_CHANNEL)
      .mockResolvedValue(HOME_SCREEN);
    probe.impl.mockResolvedValue(false);
    await wait();
    expect(getActiveApp).toHaveBeenCalledTimes(3);
  });

  it('keeps waiting while the port is still open, whatever ECP says is in front', async () => {
    // ECP says what is in front; only the port says the app's process has gone.
    getActiveApp.mockResolvedValue(HOME_SCREEN);
    probe.impl.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    await wait();
    expect(probe.impl).toHaveBeenCalledTimes(3);
  });

  it('treats an ECP read that failed as "not yet", never as "exited"', async () => {
    getActiveApp.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue(HOME_SCREEN);
    probe.impl.mockResolvedValue(false);
    await wait();
    expect(getActiveApp).toHaveBeenCalledTimes(2);
  });

  it('does not read an answer with no app in it as "exited"', async () => {
    getActiveApp.mockResolvedValue({});
    probe.impl.mockResolvedValue(false);
    await expect(wait({ timeoutMs: 40 })).rejects.toThrow(/had not exited/);
  });

  it('re-sends a Home press the device lost, and records that it did', async () => {
    // Seen on the first restart after a fresh deploy: the channel stayed in front, port open.
    let presses = 0;
    sendKeypress.mockImplementation(async () => presses++);
    getActiveApp.mockImplementation(async () => (presses > 0 ? HOME_SCREEN : DEV_CHANNEL));
    probe.impl.mockImplementation(async () => presses === 0);
    await wait({ resendMs: 20 });
    expect(sendKeypress).toHaveBeenCalledWith('Home');
    expect(recordRecovery).toHaveBeenCalledTimes(1);
  });

  it('never re-sends Home on a reading it could not make', async () => {
    getActiveApp.mockRejectedValue(new Error('ECONNRESET'));
    probe.impl.mockResolvedValue(true);
    await wait({ timeoutMs: 80, resendMs: 10 }).catch(() => {});
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('gives up with what it saw, as a plain Error (ODC is down, so no device dump)', async () => {
    getActiveApp.mockRejectedValue(new Error('ECONNRESET'));
    probe.impl.mockResolvedValue(true);
    const err = await wait({ timeoutMs: 40 }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/ECP did not answer/);
    expect(err.message).toMatch(/ODC port still open/);
  });
});

describe('hardRelaunch — a confirmed cold start, then the landing', () => {
  let log;
  let launched;

  beforeEach(() => {
    log = [];
    launched = false;
    sendKeypress.mockReset().mockImplementation(async (key) => log.push(`key:${key}`));
    sendLaunchChannel.mockReset().mockImplementation(async () => {
      launched = true;
      log.push('launch');
    });
    getActiveApp.mockReset().mockImplementation(async () => {
      log.push('front');
      return launched ? DEV_CHANNEL : HOME_SCREEN;
    });
    probe.impl = vi.fn(async () => {
      log.push(launched ? 'port-open' : 'port-closed');
      return launched;
    });
    getValue.mockReset().mockImplementation(async () => {
      log.push('scene');
      return { found: true };
    });
    waitLandingSettled.mockReset().mockImplementation(async () => log.push('landing'));
  });
  afterEach(() => {
    probe.impl = null;
  });

  it('presses Home, confirms the exit, launches, then waits for port, scene and landing', async () => {
    await hardRelaunch();

    const first = (step) => log.indexOf(step);
    for (const step of ['key:Home', 'front', 'port-closed', 'launch', 'port-open', 'scene']) {
      expect(log).toContain(step);
    }
    expect(log.at(-1)).toBe('landing');
    expect(first('key:Home')).toBe(0);
    // The launch comes only after the exit was confirmed, by both readings.
    expect(first('front')).toBeLessThan(first('launch'));
    expect(first('port-closed')).toBeLessThan(first('launch'));
    expect(first('launch')).toBeLessThan(first('port-open'));
    expect(first('port-open')).toBeLessThan(first('scene'));
  });

  it("with timing: 'fixed', sleeps instead and polls nothing", async () => {
    // For builds with no on-device component, where polling would burn every timeout.
    await hardRelaunch({ timing: 'fixed' });

    expect(log).toEqual(['key:Home', 'launch']);
    expect(waitLandingSettled).not.toHaveBeenCalled();
  });

  it('refuses an unknown timing before it presses anything', async () => {
    await expect(hardRelaunch({ timing: 'fast' })).rejects.toThrow(/timing must be/);
    expect(sendKeypress).not.toHaveBeenCalled();
  });
});
