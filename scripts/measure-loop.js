/**
 * The measurement sampling loop: per sample, one relaunch, one optional navigation, and
 * one console window watched until the measurement goes quiet.
 *
 * ## Why it is not in `measure.js`
 *
 * `measure.js` acquires the device lock at import, so nothing defined inside it can be
 * reached by a test — and by its own header it is "the one layer every defect in this
 * subsystem has been found in". That is the same reason `measure-args.js` and
 * `measure-selection.js` exist, and this file follows them: everything impure arrives
 * as an injected dependency, so the window arithmetic and the quiet-break can be driven
 * with a fake clock and no device.
 *
 * ⚠️ **The second caller this extraction predicted never arrived, and the prediction is
 * corrected here rather than left standing.** It said the multi-device driver and the ODC
 * calibration harness would each otherwise grow their own copy of the replay defense.
 * Both were then built OUT of process (`measure-devices.js` 2026-08-16,
 * `measure-calibration.js` 2026-08-17), each spawning `measure.js` per unit of work —
 * because a series needs far more than this loop (the device lock, the console socket,
 * the tier guards, mount selection, the medians, and the record assembly that tech-debt
 * flags as untested), and re-implementing that around a shared loop would have doubled
 * the subsystem's one untested surface to avoid passing flags to a process that already
 * does the job.
 *
 * So this file has ONE caller. The extraction still earned itself — 16 unit tests over
 * window arithmetic and a quiet-break that had none, in the file every defect in this
 * subsystem has been found in — but it earned it on testability, not on reuse, and a
 * header claiming a caller that does not exist is how the next reader designs around a
 * constraint nobody has.
 *
 * ## The one behavioural change from the inline version
 *
 * A failed navigation THROWS `NavFailedError` instead of closing the run and calling
 * `process.exit`. The error carries the finished operator message, so the entry point
 * refuses with byte-identical text and single-device behaviour is unchanged — but a matrix
 * driver has to be able to lose one device without killing the other two, and an exit
 * inside the loop cannot be caught.
 */
import { assembleSamples, splitWorkload } from './measurements.js';
import { otherMountsIn, selectColdSamples } from './measure-selection.js';

/**
 * A navigation that could not reach its screen.
 *
 * ## Why it carries the operator message rather than the entry point building one
 *
 * The refusal text lives here so it can be asserted. `measure.js` cannot be unit tested —
 * it claims the device on import — so a message assembled there from this error's fields
 * has no gate at all: rename a field and the operator reads `failed on launch undefined`,
 * with nothing red anywhere. Building it at the throw site costs this module one CLI-shaped
 * word (`--nav`), which is a smaller price than an untestable string.
 *
 * @param {number} launchNumber 1-BASED, because its only consumer is a human-facing message.
 *   Deliberately NOT named `launch`: `sample.launch` in this same module is 0-based, and one
 *   name meaning two bases is a defect waiting for the multi-device driver to find.
 * @param {Error} cause the nav's own error — `diagnosedError` has already attached what the
 *   device was showing, so the record survives on `.cause` even though only the message prints.
 * @param {object[]} samples what the series had already collected. Attached because the whole
 *   point of throwing rather than exiting is that a matrix driver survives losing one device;
 *   surviving it while discarding that device's good launches is half a job.
 */
export class NavFailedError extends Error {
  constructor(launchNumber, cause, samples = [], navLabel = '') {
    super(
      `--nav ${navLabel} failed on launch ${launchNumber}: ${cause?.message || String(cause)}\n` +
        '  The series is abandoned rather than retried — a nav that cannot reach its screen\n' +
        '  once will not reach it on the remaining launches.',
    );
    this.name = 'NavFailedError';
    this.launchNumber = launchNumber;
    this.samples = samples;
    this.cause = cause;
  }
}

/**
 * Run one series and return its samples.
 *
 * @param {object} config
 * @param {number} config.sampleCount   how many launches to take
 * @param {number} config.windowMs      per-launch watch budget
 * @param {number} config.quietMs       silence after a complete sample that ends the watch
 * @param {number} config.exitMs        what `relaunch` spends BEFORE it launches anything
 * @param {number} config.bootMs        what `relaunch` spends waiting for the app
 * @param {object} config.measurement   the family from `measurements.js`
 * @param {object} config.selector      the mount selector, per `measure-selection.js`
 * @param {string} [config.navLabel]    what to call the nav in a refusal — the `--nav` value
 * @param {object} deps                 everything impure
 * @param {() => number} deps.now
 * @param {(ms:number) => Promise<void>} deps.sleep
 * @param {() => Promise<void>} deps.relaunch
 * @param {(() => Promise<void>)|null} deps.nav  drive to the screen, or null to measure the launch
 * @param {(from:number) => void} deps.openWindow  publish this launch's window to the console
 *   reader, so it can gate its own `lastMatchAt` writes on the same instant the samples are
 *   filtered by. NO obligation to reset the quiet clock: the watch below ignores any stamp
 *   older than this window, so a reader that leaves the previous launch's value in place
 *   cannot cut this launch's watch short. That was once a rule stated here and obeyed by one
 *   caller; it is now a property of the loop, which is the version a second caller inherits.
 * @param {(from:number) => string[]} deps.linesSince
 * @param {() => number} deps.lastMatchAt  when the reader last saw a line of THIS measurement
 * @param {(msg:string) => void} deps.log
 * @returns {Promise<{samples: object[]}>}
 */
export async function runSeries(
  { sampleCount, windowMs, quietMs, exitMs, bootMs, measurement, selector, navLabel = '' },
  { now, sleep, relaunch, nav, openWindow, linesSince, lastMatchAt, log },
) {
  const samples = [];

  for (let i = 0; i < sampleCount; i++) {
    // The window opens at the LAUNCH, not at the keypress. `relaunch` presses Home and
    // sleeps `exitMs` before it launches anything, so a window that opened at `now()`
    // would cover a span in which the PREVIOUS launch can still be emitting.
    // `assembleSamples` merges by line, not by launch, so a straggler landing there is
    // absorbed into this launch's sample and the record fabricates one run out of halves
    // of two — exactly what `measurements.js` refuses to do with an incomplete sample.
    // Filtering by a future instant is safe: lines are stamped as they arrive, so nothing
    // before it can ever be eligible.
    //
    // Usually masked by the quiet-break below, which will not fire until the console has
    // been silent for `quietMs`. Not masked on the deadline path — i.e. exactly when the
    // device is already misbehaving.
    const from = now() + exitMs;
    openWindow(from);
    await relaunch();

    // Drive to the screen INSIDE the window, not before it. The nav's final gate waits on
    // a node the screen paints, so it necessarily returns AFTER the paint line has been
    // emitted — a window opened when the nav returns would start by missing the very
    // thing it was opened to catch.
    //
    // The intermediate screens a chained nav passes through emit their own lines and are
    // filed as their own samples, told apart by the `variant` the app stamps. That is the
    // shape, not a defect: reaching a Season means loading its Series first, and both
    // loads really happened.
    if (nav) {
      try {
        await nav();
      } catch (e) {
        // Aborts the SERIES rather than counting a failed launch and trying again: a nav
        // that cannot reach its screen once will not reach it on the next four attempts,
        // and n launches of a screen that never loaded is a long way to travel to record
        // nothing. `diagnosedError` has already attached what the device was showing.
        //
        // The launches taken BEFORE this one ride along on the error. They are real samples
        // of a real device and the only thing that made them unusable was a later failure;
        // a matrix driver that has to drop this device should not also have to drop them.
        throw new NavFailedError(i + 1, e, samples, navLabel);
      }
    }

    // Watch until the console goes quiet after a complete sample, or the cap. `from`
    // already excludes `exitMs`, so the deadline adds only the boot it still has to wait
    // through plus the watch budget itself.
    //
    // The time already spent getting here is added on top, because it is spent INSIDE the
    // window and would otherwise eat the watch budget: an episode detail is four screens
    // deep, and on `.177` that walk alone outlasts the 45 s cap the relaunch-only mode was
    // sized for. Note this span is the RELAUNCH plus the nav (less `exitMs`, which `from`
    // already excluded), not the nav alone — and the deadline adds `bootMs` again below.
    // Both make the window longer than strictly needed, which is the safe direction: the
    // quiet-break ends a healthy launch early anyway, so the only thing a generous cap
    // changes is how long a MISBEHAVING device is given before being reported.
    // Measured from this launch rather than assumed, so a slow nav lengthens only its own
    // window.
    const spentReachingScreen = nav ? now() - from : 0;
    const deadline = from + spentReachingScreen + windowMs + bootMs;
    let assembled = [];
    while (now() < deadline) {
      await sleep(1000);
      assembled = assembleSamples(measurement, linesSince(from));
      const complete = assembled.filter((s) => s.complete);
      // Only THIS launch's silence may end the watch. Nothing clears the reader's clock
      // between launches, so gating on the window instant makes that a property of the loop
      // rather than a rule the caller has to remember — a second caller inherits it. Stale
      // stamps are always strictly below `from`, which is computed after the previous
      // launch's last line; `>=` rather than `>` because a stamp landing exactly on the
      // window's first millisecond belongs to this launch.
      const quietSince = lastMatchAt();
      if (complete.length && quietSince >= from && now() - quietSince > quietMs) break;
    }

    assembled.forEach((sample, indexInLaunch) => {
      const { workload, timings, dimensions } = splitWorkload(measurement, sample.fields);
      samples.push({
        launch: i,
        // WHEN this sample's window opened. Per sample rather than per series, because
        // tier 3's interleave check needs to order two arms' samples against each other:
        // an A,B,A,B experiment and an all-A-then-all-B one produce identical series
        // records and are not equally trustworthy. The window instant, not the line's,
        // since `assembleSamples` merges by line and has no timestamps to hand back.
        launchAt: new Date(from).toISOString(),
        // 0 is the cold first paint; 1+ are the refreshes that follow it in the same
        // launch. Recorded, never averaged together — see trap 3.
        indexInLaunch,
        complete: sample.complete,
        lines: sample.lines,
        buildFlags: sample.buildFlags,
        workload,
        timings,
        // What the app said this sample WAS — its screen, and which variant of it. Empty
        // for a sample carrying only numbers, which is every `item-grid` one and every
        // `home-latest-rows` one from a build without the recompute attribution. This is the only
        // thing that can tell two samples from the same launch apart: a chained
        // navigation mounts one screen several times (a Season is reached through its
        // Series), so `indexInLaunch` orders them but cannot say which is which.
        dimensions,
      });
    });

    log(formatLaunchLine({ launch: i, sampleCount, samples, selector, measurement }));
  }

  return { samples };
}

/**
 * The per-launch progress line.
 *
 * Uses the SAME rule the medians use, through the same function — not a second copy that
 * can silently come to mean something else. Hardcoding the first mount here printed 260 ms
 * (the details screen a playback nav walks THROUGH) while the summary printed the mount
 * actually named: two numbers 8x apart, one tool, one output, both `osd`.
 *
 * `selectColdSamples` also filters on `complete`, which this line used not to do — it took
 * the first MATCHING sample and only then asked whether it was complete, so a launch whose
 * target mount emitted an incomplete sample ahead of a complete one printed "no complete
 * sample" while the summary counted it.
 */
export function formatLaunchLine({ launch, sampleCount, samples, selector, measurement }) {
  const ofThisLaunch = samples.filter((s) => s.launch === launch);
  const cold = selectColdSamples(ofThisLaunch, selector)[0];
  // The OTHER mounts this launch produced, named — see `otherMountsIn`, which is where the
  // rule and its test live. Passed the pushed `samples`, not the assembled ones: the push
  // re-shapes each into a different object, and this compares against `cold` by identity,
  // so the assembled list would match nothing and count the selected sample as an other.
  const others = otherMountsIn(ofThisLaunch, cold);
  return (
    `[measure] ${launch + 1}/${sampleCount}  ` +
    (cold
      ? `${measurement.primary}=${cold.timings[measurement.primary] ?? cold.workload[measurement.primary]} ` +
        `workload=${JSON.stringify(cold.workload)}`
      : '⚠ no complete sample in the window') +
    (others.length
      ? `  (+${others.length} other run${others.length > 1 ? 's' : ''} in this launch, ` +
        `recorded separately: ${others.join(', ')})`
      : '')
  );
}
