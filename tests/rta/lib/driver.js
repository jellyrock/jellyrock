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
import { sleep } from './steps.js';

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

/**
 * Race `promise` against a wall clock, so an unbounded wait fails with a DIAGNOSIS.
 *
 * Exported because the deploy is not the only step here that can wait forever, and the
 * second caller proved the shape general rather than deploy-specific. RTA's own timeouts
 * do not cover this class: `sendRequest` races the request against `getTimeOut(options)`,
 * but it `await`s `setupClientSocket()` FIRST — and that promise only self-rejects on
 * `ECONNREFUSED`/`EPIPE`. A connect to port 9000 that neither connects nor errors leaves
 * it unsettled, and `clientSocketPromise` is cached, so it stays that way. Read out of
 * `client/dist/OnDeviceComponent.js` on 2026-08-16, not inferred from a symptom.
 *
 * So a caller that needs a bound on "the on-device component answers at all" has to put
 * it OUTSIDE the ODC call. That is what this is for.
 *
 * @param {Promise} promise the work to bound.
 * @param {number} ms the cap.
 * @param {string} message what to throw — say the likely CAUSE, not just the elapsed time.
 */
export async function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    // Never hold the process open on the timer alone.
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
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
