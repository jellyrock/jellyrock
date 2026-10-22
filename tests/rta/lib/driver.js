/**
 * RTA device lifecycle: environment setup (from .env), deploy of the
 * RTA-enabled build, and relaunch. Re-exports the RTA client singletons so the
 * rest of the layer imports them from one place.
 *
 * Importing `scripts/lib/load-env.cjs` loads `.env` and the per-user env file on import,
 * so ROKU_IP / ROKU_PASSWORD are available to any consumer (tests, screenshot script).
 */
import '../../../scripts/lib/load-env.cjs';
import fs from 'node:fs';
import { ecp, odc, device, utils } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { ODC_PORT, odcIsResident } from '../../../scripts/lib/odc-probe.js';
import { recordRecovery } from '../../../scripts/run-record.js';
import { sleep, waitLandingSettled } from './steps.js';
import { withTimeout } from './timeout.js';

export { ecp, odc, device, utils };

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
 * ## The two things a deploy decides, which are not one thing
 *
 * RTA's `device.deploy` does two separate jobs and only one of them is behind
 * `injectTestingFiles`:
 *
 *  - it stages the on-device component's files (`RTA_OnDeviceComponent.*`,
 *    `RTA_helpers.brs`). This is gated, by the `if (injectTestingFiles)` block in
 *    `RokuDevice.createPackage`;
 *  - it rewrites `ENABLE_RTA=false` -> `true` in the staged manifest. This is
 *    **not** gated. The rewrite lives in the `rokuDeploy.createPackage` callback in
 *    `RokuDevice.createPackage`, outside that `if`, so it happens on every deploy.
 *
 * That matters because `#if` is evaluated **on the device at load time** from the
 * shipped manifest, never by `bsc` (see
 * [`home-first-paint-performance.md`](../../../docs/dev/home-first-paint-performance.md)).
 * So `injectTestingFiles: false` alone does not produce a non-RTA build. It produces an
 * `ENABLE_RTA=true` build whose ODC component is missing, which still runs every
 * `#if ENABLE_RTA` block (a `createObject` for a node type that is no longer there, and
 * `m.global.addFields({rtaSkeletonHoldMs: 0})`). Measured against the vendored source
 * 2026-08-17, not inferred: staged both ways and read the manifest back out of RTA's own
 * callback.
 *
 * `enableRta` is therefore its own parameter. It is applied in the `beforeZipCallback`,
 * which RTA invokes last (after its own rewrite, in the same `createPackage` callback),
 * so it wins over the rewrite above.
 *
 * @param {boolean} [options.injectTestingFiles] stage the ODC component's files.
 * @param {boolean} [options.enableRta] what the shipped manifest must end up saying.
 *   Defaults to `injectTestingFiles`, which is the only combination that was reachable
 *   before this parameter existed: an ODC component with the hook that starts it
 *   compiled out is a deploy nobody wants.
 * @returns {Promise<{bsConst: string|null}>} the `bs_const` line as shipped. Returned
 *   rather than assumed so a caller can record what the device was given instead of what
 *   it meant to give it. This is the same posture as the app's own `[debug=… perfTiming=…]`
 *   bracket, one layer earlier.
 */
/**
 * Does the staged `bs_const` disagree with the `ENABLE_RTA` this deploy asked for? Returns
 * the refusal text, or null when it agrees.
 *
 * ## Why the flip is verified rather than assumed
 *
 * The flip itself is an unanchored string replace against another package's output. If RTA
 * ever changes how it spells its rewrite, that replace becomes a silent no-op, and what
 * comes out is not a mislabeled arm, it is a different arm: a `plain` deploy shipping
 * `ENABLE_RTA=true` with no component is exactly the `no-component` arm, and nothing
 * downstream can tell them apart (neither has a component, so `odcIsResident` is false and
 * `provenance.enableRta` records `false` for both). The calibration would answer a question
 * nobody asked and refuse nothing.
 *
 * Pure and exported so it has a test, which is not ceremony here: an unverified guard
 * against a silent replace is the same shape as the silent replace. `bs_const` is already
 * read back for the record; this only asks it the one question that makes it evidence.
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
      // Thrown from inside the callback on purpose: it runs before the zip and the
      // publish, so a refusal here leaves the device holding what it already had.
      const wrong = shippedRtaFlagMismatch(bsConst, wantRta);
      if (wrong) throw new Error(`${wrong} Nothing was sideloaded.`);
    }),
  );
  await sleep(RTA_CONFIG.bootMs);
  return { bsConst };
}

/**
 * Sideload the dev build with RTA enabled, the deploy every consumer but the ODC
 * calibration wants. The build must already exist (callers run `npm run build` first,
 * the dev build and not build:prod, which compiles the #if ENABLE_RTA hook out).
 */
export async function deployRtaBuild() {
  await deployBuild({ injectTestingFiles: true });
}

/**
 * Fail a wedged deploy with its most likely cause instead of waiting forever.
 *
 * `device.deploy({injectTestingFiles: true})` sideloads and then waits for the on-device
 * component to answer, and the ODC lives inside the app, so an app that crashes during
 * launch never answers and the promise never settles. RTA sets no timeout of its own.
 *
 * Measured cost of not having this: two `npm run measure --deploy` runs sat at
 * `deploying (ENABLE_RTA)` for 39 and 9 minutes against a build that crashed at launch
 * (`&hec` out of a roku-log injection), printing nothing and producing no run record. The
 * device console had the backtrace the whole time. The failure is common enough to name:
 * any crash on the launch path presents exactly this way, as a hang rather than an error.
 *
 * The cap is far above a healthy deploy (~60-90 s here, including `bootMs`), because a
 * slow-but-working sideload must not be turned into a spurious failure. This is a
 * diagnosis for a wedge, not a performance gate.
 */
const DEPLOY_TIMEOUT_MS = 5 * 60 * 1000;

// Re-exported from its own leaf module so `registry.js` and `scripts/measure-signin.js`
// keep their import site. It moved because `diagnostics.js` needs it too and cannot
// import this file (see `timeout.js`).
export { withTimeout };

/**
 * How long to wait for the on-device component to start answering on its port.
 *
 * Longer than the thing it stands in front of, on purpose: RTA's own `setupClientSocket`
 * retries a refused connect for `defaultTimeout` (10 s) before giving up, so a 30 s budget
 * cannot fail a boot that RTA would have survived. That is the whole no-regression
 * argument for putting a gate here: it is strictly more patient than today, and only the
 * cases that were already lost get a different answer.
 */
const ODC_REACHABLE_TIMEOUT_MS = 30 * 1000;

/** Cadence of the probe. One TCP round trip, so the interval is the cost, not the probe. */
const ODC_REACHABLE_POLL_MS = 500;

/**
 * Refuse to make the first ODC call of a run until the component is actually there.
 *
 * ## Why a precondition and not a timeout on the call
 *
 * An ODC call against a device with no on-device component does not fail cleanly, and it
 * fails three different ways that a single `withTimeout` cannot cover (all measured
 * 2026-09-06 against the real client, no device):
 *
 *  - **port closed** (no RTA build resident, or the channel exited): RTA rejects at
 *    10 s and then **hard-crashes the process, `exit 1`**, from an orphaned rejection no
 *    `catch` of ours can reach. See `scripts/lib/odc-probe.js` for the mechanism and the
 *    control that proved it. `withTimeout` cannot help: the crash is not on our promise.
 *  - **host unreachable** (device asleep, wrong `ROKU_IP`, firewall): the connect neither
 *    connects nor errors, `setupClientSocket` never calls `socket.setTimeout`, and the call
 *    hangs unbounded (40 s+ with no bound in evidence).
 *  - **port open, handshake unanswered**: hangs unbounded too (45 s+). This probe returns
 *    `true` here and is blind to it by construction, which is why the registry reads are
 *    also wrapped in `withTimeout`. The two cover different halves and neither is
 *    sufficient alone.
 *
 * So the first two are answered by not making the call at all, which is both faster (~1 ms
 * / 2 s instead of 10 s / forever) and the only thing that avoids the crash.
 *
 * ## What it must not do
 *
 * Report a device that is merely still booting. `odcIsResident` answers `false` the instant
 * a port is refused, so a one-shot gate would turn a slow-but-working launch into a
 * spurious failure, the same trap `DEPLOY_TIMEOUT_MS` above is sized against. Hence the
 * poll: callers have already slept `bootMs`, and this adds 30 s of patience on top of it.
 *
 * @param {string} [options.host] device to probe; defaults to the configured one.
 * @param {number} [options.port] the component's port. Only the tests pass this, because binding
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
 * Launch the dev channel and sleep `bootMs`.
 *
 * ⚠️ After a registry write, use `hardRelaunch()`, not this. What a launch does to a
 * channel that is already running is the OS's choice, and this confirms nothing: it
 * waits for no exit and checks no screen. Measured 2026-10-20, it restarted a running
 * app cold on a Stick 4K (Roku OS 15.3.4, 10 of 10) and on an Ultra (16.0.4, 20 of 20):
 * an `m.global` marker set before the launch was gone after it, and the app held a
 * landing view written to the registry in between. That contradicts the note this
 * replaced, which said it "only foregrounds" a running channel; no measurement behind
 * that note was recorded. `hardRelaunch()` confirms the exit itself, and
 * `assertSeedTookEffect()` proves the result, so neither depends on which is true.
 *
 * Kept for callers that only need the channel up, including builds with no on-device
 * component, where there is nothing to poll.
 */
export async function relaunch() {
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false });
  await sleep(RTA_CONFIG.bootMs);
}

/**
 * Wait until the scene answers, not until Home is ready, and not for a field.
 *
 * An empty keyPath resolves to the base node, so this asks the one question that has a
 * meaningful answer before the app has a screen: is there a scene there at all. Callers
 * are the render-thread benches, which need a render-owned parent to `createChild` under
 * and nothing else: no server, no library, no signed-in user. Gating them on `waitHome()`
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
 * (see *The loops that are not `waitFor`* in `tests/rta/CLAUDE.md`).
 *
 * ## Why it is shared, and why it throws
 *
 * Two specs had each written this out. They were recorded as byte-identical duplicates
 * and were not: `task-ledger-bench.spec.js` threw on timeout, while
 * `gaa-thread-scope.spec.js` ran a bounded `for` and fell through, so a scene
 * that never answered went on to `createChild` anyway and failed there, blaming the
 * child. Sharing the version that throws is the point of sharing it; the difference was
 * in the one property a duplicate is most likely to get wrong.
 *
 * **It replaces `bootMs` only in `hardRelaunch()`'s polled path,** after
 * `ensureOdcReachable()` has shown the port open. `relaunch()` and
 * `hardRelaunch({ timing: 'fixed' })` keep sleeping, because they also run against
 * `ENABLE_RTA=false` builds, where ODC never answers at all and polling would burn the full
 * timeout on every call instead of sleeping once.
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
    // Deadline checked after a read, so the full budget is spent on reads rather than
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
 * Ceiling on the channel exiting after the Home press. A Limit: the slowest exit measured
 * was 0.78 s (Stick 4K, 20 samples, 2026-10-20), so this only ever fires on a channel that
 * did not exit at all.
 */
const CHANNEL_EXIT_TIMEOUT_MS = 10 * 1000;

/** Cadence of the exit poll: one ECP read and one TCP connect per tick. */
const CHANNEL_EXIT_POLL_MS = 100;

/**
 * How long the dev channel may stay in front after a Home press before the press counts as
 * lost and is sent again: about 2.5x the slowest exit measured (0.78 s, 2026-10-20).
 */
const CHANNEL_EXIT_RESEND_MS = 2 * 1000;

/**
 * Ceiling on the scene answering once the component's port is open. The scene answered
 * within tens of milliseconds of the port opening in every sample (2026-10-20), so this
 * only bounds a component that accepts connections and never serves them.
 */
const SCENE_ANSWER_TIMEOUT_MS = 10 * 1000;

/** The app ECP names while the dev channel is in front. */
const frontAppId = (res) => (res?.app ? (res.app.id ?? res.app.title ?? '') : null);

/**
 * Wait until the dev channel has exited after a Home press.
 *
 * Two readings must agree: ECP's `query/active-app` names something other than the dev
 * channel, and nothing listens on the ODC port, which the on-device component holds open
 * for as long as the app runs. The first says what is in front; only the second says the
 * app's process has gone, and a cold start needs the process gone.
 *
 * An ECP read that fails counts as "not yet", never as "exited". The poll reads ECP and TCP
 * only, never ODC: the component is going away by design here, and an ODC call against a
 * closed port crashes the process (see `ensureOdcReachable`). That is also why it throws a
 * plain `Error` rather than through `diagnosedError`, which reads ODC to build its dump.
 *
 * **A Home press can be lost, so it is sent again.** On 2026-10-20 the first restart after a
 * fresh deploy left the dev channel in front, port open, for the whole 10 s. The old fixed
 * sleep never noticed, because it launched regardless. This re-sends Home while ECP still
 * names the dev channel `resendMs` after the last press, and only then: an unknown reading
 * sends nothing. Each re-press is recorded, because a recovery nobody sees hides how often it
 * happens.
 *
 * @param {object} [options]
 * @param {string} [options.host] device to probe; defaults to the configured one.
 * @param {number} [options.port] the component's port. Only the tests pass this.
 */
export async function waitChannelExited({
  host = device.getCurrentDeviceConfig().host,
  port = ODC_PORT,
  timeoutMs = CHANNEL_EXIT_TIMEOUT_MS,
  pollMs = CHANNEL_EXIT_POLL_MS,
  resendMs = CHANNEL_EXIT_RESEND_MS,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let resendAt = Date.now() + resendMs;
  let resends = 0;
  for (;;) {
    const [front, resident] = await Promise.all([
      ecp.getActiveApp({ retryCount: 0 }).then(frontAppId, () => null),
      odcIsResident(host, { port }),
    ]);
    if (front !== null && front !== 'dev' && !resident) return;
    if (front === 'dev' && Date.now() >= resendAt && Date.now() < deadline) {
      resends += 1;
      recordRecovery({
        at: new Date().toISOString(),
        what: 'Home press lost on restart',
        detail:
          `the dev channel was still in front ${resendMs} ms after the Home press, so the ` +
          `press was taken as lost and sent again (resend ${resends} in this restart).`,
        observed: { front, resident, resends },
      });
      await ecp.sendKeypress('Home');
      resendAt = Date.now() + resendMs;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `the dev channel had not exited ${timeoutMs / 1000}s after the Home press ` +
          `(in front: ${front === null ? 'unknown, ECP did not answer' : JSON.stringify(front)}; ` +
          `ODC port ${resident ? 'still open' : 'closed'}). A Home press the device never ` +
          'received leaves the app running, and launching it then would not start it cold.',
      );
    }
    await sleep(pollMs);
  }
}

/**
 * Restart the channel cold: exit to the Roku home screen, confirm the exit, launch, and
 * return once the first screen is up (and settled, when that screen is Home).
 *
 * **Every relaunch that follows a registry write must use this**, not `relaunch()`, for the
 * restore and for all seeding: the app reads the registry only when it starts, so the seed
 * reaches it only through a cold start. Exiting first and confirming the exit makes the
 * cold start something this function checks, not a behavior of the OS it relies on (see
 * `relaunch()`). `assertSeedTookEffect` in seed.js then proves the seed was read. An
 * earlier revision applied this rule to the restore path only, and seeds were lost
 * silently for weeks: the suite drove an app pointed at the operator's own server using
 * demo-server ids.
 *
 * ## Why it polls
 *
 * It used to sleep `exitMs` and then `bootMs`, 14 s a call, and a default `test:rta` makes
 * about 130 calls. Measured 2026-10-20 on a Stick 4K (20 samples): the app had exited 0.5 s
 * after the Home press, its port was open 1.5 s after the launch, and Home's rows stopped
 * changing 6.6 s after the press (8.1 s at worst). So each step now waits for its own
 * signal: `waitChannelExited()`, then `ensureOdcReachable()` and `waitSceneAnswering()`,
 * then `waitLandingSettled()`.
 *
 * The last step keeps the state every caller got from the sleep. After 14 s Home had long
 * settled (the `waitHome()` that followed returned in 20 ms), while a polled restart reaches
 * Home about 2.5 s before its rows stop changing. Returning then would start every walk
 * inside the window the north star in `tests/rta/CLAUDE.md` describes.
 *
 * ## `timing: 'fixed'`
 *
 * The old sleeps, for the callers the polled path does not fit:
 *  - builds with no on-device component (`measure`'s calibration arms, a Rooibos or
 *    `build:prod` install), where there is no port to poll;
 *  - `scripts/measure.js`'s sample loop, which opens its window `exitMs` after it calls this;
 *  - the registry restore, which hands back the user's own registry: its server may be slow
 *    or unreachable, so no screen is promised to land.
 *
 * ## `params`
 *
 * ECP launch parameters, passed through to the launch. A `contentId` makes it a cold-start
 * deep link, the same launch the companion plugin sends to wake a closed app (ADR 0023).
 *
 * @param {object} [options]
 * @param {'polled'|'fixed'} [options.timing]
 * @param {Record<string, string>} [options.params]
 */
export async function hardRelaunch({ timing = 'polled', params } = {}) {
  if (timing !== 'polled' && timing !== 'fixed') {
    throw new Error(
      `hardRelaunch: timing must be 'polled' or 'fixed', not ${JSON.stringify(timing)}`,
    );
  }
  await ecp.sendKeypress('Home');
  if (timing === 'fixed') {
    await sleep(RTA_CONFIG.exitMs);
    await ecp.sendLaunchChannel({ channelId: 'dev', params, verifyLaunch: false });
    await sleep(RTA_CONFIG.bootMs);
    return;
  }
  await waitChannelExited();
  await ecp.sendLaunchChannel({ channelId: 'dev', params, verifyLaunch: false });
  await ensureOdcReachable();
  await waitSceneAnswering({ timeout: SCENE_ANSWER_TIMEOUT_MS, interval: 200 });
  await waitLandingSettled();
}
