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
 * Two callers beyond the entry point need this loop and would otherwise each grow their
 * own copy of the replay defense: the multi-device driver (tech-debt
 * `measure-single-device-only`) and the ODC calibration harness, which drives the same
 * logic across two build arms (`docs/progress.md`, step 1 of the calibration followup).
 *
 * ## The one behavioural change from the inline version
 *
 * A failed navigation THROWS `NavFailedError` instead of closing the run and calling
 * `process.exit`. The entry point catches it and refuses with the same message, so
 * single-device behaviour is unchanged — but a matrix driver has to be able to lose one
 * device without killing the other two, and an exit inside the loop cannot be caught.
 */
import { assembleSamples, splitWorkload } from './measurements.js';
import { otherMountsIn, selectColdSamples } from './measure-selection.js';

/** A navigation that could not reach its screen. Carries the launch it died on. */
export class NavFailedError extends Error {
  constructor(launch, cause) {
    super(cause?.message || String(cause));
    this.name = 'NavFailedError';
    this.launch = launch;
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
 * @param {object} deps                 everything impure
 * @param {() => number} deps.now
 * @param {(ms:number) => Promise<void>} deps.sleep
 * @param {() => Promise<void>} deps.relaunch
 * @param {(() => Promise<void>)|null} deps.nav  drive to the screen, or null to measure the launch
 * @param {(from:number) => void} deps.openWindow  publish this launch's window to the console
 *   reader. MUST also reset the quiet clock — the reader gates its own `lastMatchAt` write on
 *   this window, and a clock left at the previous launch's value would satisfy the quiet-break
 *   before this launch had emitted anything.
 * @param {(from:number) => string[]} deps.linesSince
 * @param {() => number} deps.lastMatchAt  when the reader last saw a line of THIS measurement
 * @param {(msg:string) => void} deps.log
 * @returns {Promise<{samples: object[]}>}
 */
export async function runSeries(
  { sampleCount, windowMs, quietMs, exitMs, bootMs, measurement, selector },
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
        throw new NavFailedError(i + 1, e);
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
      const quietSince = lastMatchAt();
      if (complete.length && quietSince && now() - quietSince > quietMs) break;
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
        // for the two legacy families, which emit no non-numeric field. This is the only
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
