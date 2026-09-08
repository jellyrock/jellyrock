/**
 * RTA device lifecycle: environment setup (from .env), deploy of the
 * RTA-enabled build, and relaunch. Re-exports the RTA client singletons so the
 * rest of the layer imports them from one place.
 *
 * `import 'dotenv/config'` loads .env on import so ROKU_IP / ROKU_PASSWORD are
 * available to any consumer (tests, screenshot script).
 */
import 'dotenv/config';
import fs from 'node:fs';
import { ecp, odc, device, utils } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { ODC_PORT, odcIsResident } from '../../../scripts/lib/odc-probe.js';
import { sleep } from './steps.js';
import { withTimeout } from './timeout.js';

export { ecp, odc, device, utils };
export const BOOT_MS = RTA_CONFIG.bootMs;

/**
 * Apply RTA config to the client singletons (device host/password from .env,
 * ECP launch channel, ODC log level). Throws if creds are missing. Must run in
 * EACH process that talks to the device (Vitest workers run separately from
 * globalSetup), so call it from setupFiles AND globalSetup.
 */
export function setupRtaEnv() {
  const host = process.env.ROKU_IP;
  const password = process.env.ROKU_PASSWORD;
  if (!host || !password) {
    throw new Error('Missing ROKU_IP / ROKU_PASSWORD (set them in .env)');
  }
  utils.setupEnvironmentFromConfig({
    RokuDevice: { devices: [{ host, password, screenshotFormat: 'png' }] },
    ECP: { default: { launchChannelId: 'dev' } },
    OnDeviceComponent: { logLevel: 'info' },
  });
}

/**
 * Sideload `build/`, and say what the device was actually given.
 *
 * ## The two things a deploy decides, which are NOT one thing
 *
 * RTA's `device.deploy` does two separate jobs and only one of them is behind
 * `injectTestingFiles`:
 *
 *  - it stages the on-device component's files (`RTA_OnDeviceComponent.*`,
 *    `RTA_helpers.brs`) — this IS gated, at `RokuDevice.js:63-70`;
 *  - it rewrites `ENABLE_RTA=false` -> `true` in the STAGED manifest — this is
 *    **not** gated. The rewrite lives in the `createPackage` callback
 *    (`RokuDevice.js:71-76`), outside that `if`, so it happens on every deploy.
 *
 * That matters because `#if` is evaluated **on the device at load time** from the
 * shipped manifest, never by `bsc` (see
 * [`home-first-paint-performance.md`](../../../docs/dev/home-first-paint-performance.md)).
 * So `injectTestingFiles: false` alone does not produce a non-RTA build — it produces an
 * `ENABLE_RTA=true` build whose ODC component is missing, which still runs every
 * `#if ENABLE_RTA` block (a `createObject` for a node type that is no longer there, and
 * `m.global.addFields({rtaSkeletonHoldMs: 0})`). Measured against the vendored source
 * 2026-08-17, not inferred: staged both ways and read the manifest back out of RTA's own
 * callback.
 *
 * `enableRta` is therefore its own parameter. It is applied in the `beforeZipCallback`,
 * which RTA invokes LAST (`RokuDevice.js:86-88`), so it wins over the rewrite above.
 *
 * @param {boolean} [options.injectTestingFiles] stage the ODC component's files.
 * @param {boolean} [options.enableRta] what the SHIPPED manifest must end up saying.
 *   Defaults to `injectTestingFiles`, which is the only combination that was reachable
 *   before this parameter existed — an ODC component with the hook that starts it
 *   compiled out is a deploy nobody wants.
 * @returns {Promise<{bsConst: string|null}>} the `bs_const` line as shipped. Returned
 *   rather than assumed so a caller can record what the device was given instead of what
 *   it meant to give it — the same posture as the app's own `[debug=… perfTiming=…]`
 *   bracket, one layer earlier.
 */
/**
 * Does the staged `bs_const` disagree with the `ENABLE_RTA` this deploy asked for? Returns
 * the refusal text, or null when it agrees.
 *
 * ## Why the flip is VERIFIED rather than assumed
 *
 * The flip itself is an unanchored string replace against another package's output. If RTA
 * ever changes how it spells its rewrite, that replace becomes a silent no-op — and what
 * comes out is not a mislabeled arm, it is a DIFFERENT ARM: a `plain` deploy shipping
 * `ENABLE_RTA=true` with no component is exactly the `no-component` arm, and nothing
 * downstream can tell them apart (neither has a component, so `odcIsResident` is false and
 * `provenance.enableRta` records `false` for both). The calibration would answer a question
 * nobody asked and refuse nothing.
 *
 * Pure and exported so it has a test, which is not ceremony here: an unverified guard
 * against a silent replace is the same shape as the silent replace. `bs_const` is already
 * read back for the record — this only asks it the one question that makes it evidence.
 *
 * @param {string|null} bsConst the `bs_const=` line as staged.
 * @param {boolean} wantRta what this deploy asked the shipped manifest to say.
 */
export function shippedRtaFlagMismatch(bsConst, wantRta) {
  const shipped = /ENABLE_RTA=(true|false)/.exec(bsConst ?? '');
  if (shipped && (shipped[1] === 'true') === wantRta) return null;
  return (
    `staged manifest says ${shipped ? shipped[0] : 'nothing about ENABLE_RTA'}, but this ` +
    `deploy asked for ENABLE_RTA=${wantRta}. The staged line is: ` +
    `${bsConst ?? '(no bs_const line)'}. RTA rewrites this flag OUTSIDE ` +
    '`injectTestingFiles`, so a change to how it spells that rewrite silently defeats the ' +
    'flip — which would make the calibration\'s "plain" arm indistinguishable from its ' +
    '"no-component" one.'
  );
}

export async function deployBuild({ injectTestingFiles = true, enableRta } = {}) {
  const wantRta = enableRta ?? injectTestingFiles;
  let bsConst = null;
  await withDeployTimeout(
    device.deploy({ rootDir: 'build', injectTestingFiles }, (info) => {
      const manifestPath = `${info.stagingDir}/manifest`;
      let text = fs.readFileSync(manifestPath, 'utf8');
      if (!wantRta) {
        text = text.replace('ENABLE_RTA=true', 'ENABLE_RTA=false');
        fs.writeFileSync(manifestPath, text);
      }
      bsConst = /^bs_const=.*$/m.exec(text)?.[0] ?? null;
      // Thrown from inside the callback deliberately: it runs before the zip and the
      // publish, so a refusal here leaves the device holding what it already had.
      const wrong = shippedRtaFlagMismatch(bsConst, wantRta);
      if (wrong) throw new Error(`${wrong} Nothing was sideloaded.`);
    }),
  );
  await sleep(RTA_CONFIG.bootMs);
  return { bsConst };
}

/**
 * Sideload the dev build with RTA enabled — the deploy every consumer but the ODC
 * calibration wants. The build must already exist (callers run `npm run build` first —
 * the dev build, NOT build:prod, which compiles the #if ENABLE_RTA hook out).
 */
export async function deployRtaBuild() {
  await deployBuild({ injectTestingFiles: true });
}

/**
 * Fail a wedged deploy with its most likely cause instead of waiting forever.
 *
 * `device.deploy({injectTestingFiles: true})` sideloads and then waits for the on-device
 * component to answer — and the ODC lives INSIDE the app, so an app that crashes during
 * launch never answers and the promise never settles. RTA sets no timeout of its own.
 *
 * Measured cost of not having this: two `npm run measure --deploy` runs sat at
 * `deploying (ENABLE_RTA)` for 39 and 9 minutes against a build that crashed at launch
 * (`&hec` out of a roku-log injection), printing nothing and producing no run record. The
 * device console had the backtrace the whole time. The failure is common enough to name:
 * any crash on the launch path presents exactly this way, as a hang rather than an error.
 *
 * The cap is deliberately far above a healthy deploy (~60-90 s here, including `bootMs`),
 * because a slow-but-working sideload must never be turned into a spurious failure — this
 * is a diagnosis for a wedge, not a performance gate.
 */
const DEPLOY_TIMEOUT_MS = 5 * 60 * 1000;

// Re-exported from its own leaf module so `registry.js` and `scripts/measure-signin.js`
// keep their import site. It moved because `diagnostics.js` needs it too and cannot
// import this file — see `timeout.js`.
export { withTimeout };

/**
 * How long to wait for the on-device component to start answering on its port.
 *
 * Deliberately LONGER than the thing it stands in front of: RTA's own `setupClientSocket`
 * retries a refused connect for `defaultTimeout` (10 s) before giving up, so a 30 s budget
 * cannot fail a boot that RTA would have survived. That is the whole no-regression
 * argument for putting a gate here — it is strictly more patient than today, and only the
 * cases that were already lost get a different answer.
 */
const ODC_REACHABLE_TIMEOUT_MS = 30 * 1000;

/** Cadence of the probe. One TCP round trip, so the interval is the cost, not the probe. */
const ODC_REACHABLE_POLL_MS = 500;

/**
 * Refuse to make the first ODC call of a run until the component is actually THERE.
 *
 * ## Why a precondition and not a timeout on the call
 *
 * An ODC call against a device with no on-device component does not fail cleanly, and it
 * fails three different ways that a single `withTimeout` cannot cover (all measured
 * 2026-09-06 against the real client, no device):
 *
 *  - **port closed** (no RTA build resident, or the channel simply exited): RTA rejects at
 *    10 s and then **hard-crashes the process, `exit 1`**, from an orphaned rejection no
 *    `catch` of ours can reach. See `scripts/lib/odc-probe.js` for the mechanism and the
 *    control that proved it. `withTimeout` cannot help — the crash is not on our promise.
 *  - **host unreachable** (device asleep, wrong `ROKU_IP`, firewall): the connect neither
 *    connects nor errors, `setupClientSocket` never calls `socket.setTimeout`, and the call
 *    hangs unbounded — 40 s+ with no bound in evidence.
 *  - **port open, handshake unanswered**: hangs unbounded too (45 s+). This probe returns
 *    `true` here and is BLIND to it by construction, which is why the registry reads are
 *    also wrapped in `withTimeout` — the two cover different halves and neither is
 *    sufficient alone.
 *
 * So the first two are answered by not making the call at all, which is both faster (~1 ms
 * / 2 s instead of 10 s / forever) and the only thing that avoids the crash.
 *
 * ## What it must NOT do
 *
 * Report a device that is merely still booting. `odcIsResident` answers `false` the instant
 * a port is refused, so a one-shot gate would turn a slow-but-working launch into a
 * spurious failure — the same trap `DEPLOY_TIMEOUT_MS` above is sized against. Hence the
 * poll: callers have already slept `bootMs`, and this adds 30 s of patience on top of it.
 *
 * @param {string} [options.host] device to probe; defaults to the configured one.
 * @param {number} [options.port] the component's port. Only the tests pass this — binding
 *   the real 9000 in a unit test would collide with an actual on-device component.
 */
export async function ensureOdcReachable({
  host = device.getCurrentDeviceConfig().host,
  port = ODC_PORT,
  timeoutMs = ODC_REACHABLE_TIMEOUT_MS,
  pollMs = ODC_REACHABLE_POLL_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await odcIsResident(host, { port })) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `nothing is listening on ${host}:${port} after ${timeoutMs / 1000}s, so the RTA ` +
          'on-device component is not there. It runs INSIDE the app, so this is one of:\n' +
          '  - the resident build has no ODC — a Rooibos test build and a `build:prod` both ' +
          'present exactly this way. Redeploy the dev build.\n' +
          '  - the channel is closed. The port goes quiet the moment the app exits, even ' +
          'with the RTA build still sideloaded.\n' +
          '  - the device is asleep, powered off, or ROKU_IP names another host. Run ' +
          '`npm run device:check`.\n' +
          'This is a PRECONDITION, not a timeout on your call: it is deliberately more ' +
          "patient than RTA's own 10s connect retry, so a slow boot cannot fail here.",
      );
    }
    await sleep(pollMs);
  }
}

const withDeployTimeout = (deployPromise) =>
  withTimeout(
    deployPromise,
    DEPLOY_TIMEOUT_MS,
    `deploy did not finish within ${DEPLOY_TIMEOUT_MS / 1000}s. The sideload itself is ` +
      'rarely the problem: this step also waits for the on-device component, which runs ' +
      'INSIDE the app, so an app that CRASHES during launch never answers and the wait ' +
      'never ends. Check the device debug console (telnet <ROKU_IP> 8085) for a backtrace ' +
      'before re-running — a crash on the launch path presents as this hang, not as an error.',
  );

/**
 * Foreground the dev channel and wait for boot + the RTA on-device component.
 *
 * ⚠️ NOT safe after writing the registry — use `hardRelaunch()` there. This only
 * foregrounds an already-running channel, so the app keeps its in-memory session
 * and re-persists it over anything just seeded. Use this only for relaunches that
 * do NOT depend on registry state having changed.
 */
export async function relaunch() {
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false });
  await sleep(RTA_CONFIG.bootMs);
}

/**
 * Wait until the scene ANSWERS — not until Home is ready, and not for a field.
 *
 * An empty keyPath resolves to the base node, so this asks the one question that has a
 * meaningful answer before the app has a screen: is there a scene there at all. Callers
 * are the render-thread benches, which need a render-owned parent to `createChild` under
 * and nothing else — no server, no library, no signed-in user. Gating them on `waitHome()`
 * would make a measurement depend on seeded demo content it never reads, and make it
 * unrunnable on its own (`npm run test:rta -- task-ledger-bench`), which is how a
 * measurement actually gets re-taken.
 *
 * ## Why this is a hand-rolled loop and not a `waitFor`
 *
 * `waitFor` throws through `diagnosedError`, which READS THE DEVICE to attach a state
 * dump. That is exactly what cannot be assumed here: the thing being waited for is the
 * device becoming answerable, so the diagnostic would fail on the same condition as the
 * wait and replace a clear "the scene never answered" with a transport error. Every other
 * loop in the suite that stays hand-rolled has a structural reason of this kind
 * (`tests/rta/CLAUDE.md` → *The loops that are not `waitFor`*).
 *
 * ## Why it is shared, and why it THROWS
 *
 * Two specs had each written this out. They were recorded as byte-identical duplicates
 * and were not: `task-ledger-bench.spec.js` threw on timeout, while
 * `gaa-thread-scope.spec.js` ran a bounded `for` and simply fell through — so a scene
 * that never answered went on to `createChild` anyway and failed there, blaming the
 * child. Sharing the version that throws is the point of sharing it; the difference was
 * in the one property a duplicate is most likely to get wrong.
 *
 * **Not a replacement for `bootMs`.** `relaunch()` is also used against `ENABLE_RTA=false`
 * builds, where ODC never answers at all — polling there would burn the full timeout on
 * every call instead of sleeping once. The lifecycle sleeps stay.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeout] how long to wait for the scene to answer
 * @param {number} [opts.interval] poll cadence
 */
export async function waitSceneAnswering({ timeout = 60000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const res = await odc.getValue({ base: 'scene', keyPath: '' }).catch(() => ({ found: false }));
    if (res.found) return;
    // Deadline checked AFTER a read, so the full budget is spent on reads rather than
    // ending on a sleep that is never followed by an attempt.
    if (Date.now() > deadline) {
      // A plain `Error`, not `diagnosedError`: the diagnostic reads the very device that
      // is not answering, so it would fail on the same condition and replace this message
      // with a transport error. The message carries the two things worth checking.
      throw new Error(
        `scene never answered within ${timeout} ms — is the app running, and is this an ` +
          'ENABLE_RTA build?',
      );
    }
    await sleep(interval);
  }
}

/**
 * Restart the channel FOR REAL: exit to the Roku home screen first, then launch.
 *
 * An ECP `/launch/dev` against an ALREADY-RUNNING channel only foregrounds it —
 * the app's in-memory session survives untouched. That is how a seeded demo
 * session outlived a "relaunch" and re-persisted itself over a restored
 * registry, leaving devices signed into `demo.jellyfin.org`. Exiting first
 * forces a cold start that actually re-reads the registry.
 *
 * **Every relaunch that follows a registry write must use this**, not `relaunch()`
 * — restore AND all seeding. An earlier revision applied that rule to the restore
 * path only, reasoning that mid-test relaunches wanted the cheap foreground path.
 * That was wrong in a way that hid for weeks: seeds were silently re-persisted
 * away, so the suite drove an app pointed at the operator's own server using
 * demo-server ids. Fixing the restore leak is what exposed it — before that,
 * devices were routinely left on the demo server, so the seed happened to agree
 * with what was already there. See `assertSeedTookEffect` in seed.js, which now
 * fails loudly instead.
 *
 * Cost is `exitMs` (~4s) per call. That is the price of the seed actually taking.
 */
export async function hardRelaunch() {
  await ecp.sendKeypress('Home');
  await sleep(RTA_CONFIG.exitMs);
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false });
  await sleep(RTA_CONFIG.bootMs);
}
