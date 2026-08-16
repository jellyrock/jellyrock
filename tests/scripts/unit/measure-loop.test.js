import { describe, it, expect } from 'vitest';
import { runSeries, NavFailedError, formatLaunchLine } from '../../../scripts/measure-loop.js';
import { measurementById } from '../../../scripts/measurements.js';

const SCREEN_LOAD = measurementById('screen-load');

/**
 * One complete `screen-load` sample, in the shape `source/utils/screenReadiness.bs`
 * actually emits it — copied from the fixture in `measurements.test.js` rather than
 * invented, so this file cannot drift from what the parser really accepts.
 */
const triple = (component, variant, paintMs, settledMs) => [
  `INFO file:///x/source/utils/screenReadiness.bs:118 screen-load paint - component ${component} variant ${variant} ms ${paintMs} [debug=false perfTiming=true]  `,
  `INFO file:///x/source/utils/screenReadiness.bs:212 screen-load settled - component ${component} variant ${variant} ms ${settledMs} fills 2 [debug=false perfTiming=true]  `,
  `INFO file:///x/source/utils/screenReadiness.bs:213 screen-load split - component ${component} variant ${variant} content 1 contentMs 1500 slowestContent extras 1500 texture 1 textureMs 200 slowestTexture logo 200  `,
];

const EXIT_MS = 4000;
const BOOT_MS = 10000;
const WINDOW_MS = 45000;

/**
 * How long a series of ONE launch takes when the app never goes quiet, measured from before
 * `runSeries` is called. Spelled out as arithmetic rather than recomputed from the loop, so
 * a change to the deadline formula fails this file instead of silently agreeing with itself:
 * the window opens `exitMs` ahead of the clock, and the deadline is that instant plus the
 * watch budget plus one `bootMs`. The harness's relaunch burns `exitMs + bootMs` on the way,
 * which lands INSIDE that span rather than adding to it.
 */
const FULL_WATCH_NO_NAV = EXIT_MS + WINDOW_MS + BOOT_MS; // 59_000

/**
 * The same, for a launch that also drove a nav taking `navMs`. The nav runs INSIDE the
 * window, so its cost is added to the deadline — as is `bootMs` a second time, since the
 * span already spent (`relaunch` + nav, less the excluded `exitMs`) contains one boot
 * already. That double-count is deliberate and documented in the loop: it can only make a
 * MISBEHAVING device wait longer, because the quiet-break ends a healthy launch early.
 */
const fullWatchWithNav = (navMs) => EXIT_MS + (BOOT_MS + navMs) + WINDOW_MS + BOOT_MS;

/**
 * A fake clock + console. `now` only advances when the loop sleeps or when a harness step
 * says so, which is what makes the window arithmetic assertable at all — on a real device
 * these spans are milliseconds of wall clock nobody can pin.
 *
 * `resetsQuietClock: false` models a reader that publishes the window and keeps NO per-window
 * quiet state — it stamps once when a matching line first arrives and never again, and
 * `openWindow` zeroes nothing. That is a legal implementation of the dependency (the loop
 * demands no reset) and it is the exact caller the loop's docblock used to require, so it is
 * what proves the requirement is now carried by the loop instead of by a rule.
 */
function harness({
  emit = () => [],
  navFails = false,
  navMs = null,
  resetsQuietClock = true,
  sampleCount = 2,
} = {}) {
  let clock = 1_000_000;
  const opened = [];
  let windowFrom = Infinity;
  let matchAt = 0;
  let stamped = false;
  let navCalls = 0;
  const logs = [];
  const relaunches = [];
  const polls = [];

  const deps = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    relaunch: async () => {
      relaunches.push(clock);
      clock += EXIT_MS + BOOT_MS; // as the real one spends
    },
    nav: navFails
      ? async () => {
          navCalls++;
          throw new Error('tile not found');
        }
      : navMs === null
        ? null
        : async () => {
            navCalls++;
            clock += navMs;
          },
    openWindow: (from) => {
      opened.push(from);
      windowFrom = from;
      if (resetsQuietClock) {
        matchAt = 0;
        stamped = false;
      }
    },
    // The socket stamps `lastMatchAt` when a MATCHING LINE ARRIVES, then stops — the
    // lines stay in the buffer and keep being returned, but the quiet clock does not
    // keep advancing. Modelling that is the whole point: a clock that re-stamped on
    // every poll would never go quiet and the break could never fire.
    linesSince: (from) => {
      // One poll of the watch loop. Counted per launch because "did this launch break early"
      // is not answerable from the sample list — a launch cut short still records whatever
      // it had already assembled, so the only evidence of a truncated watch is the count.
      polls[opened.length - 1] = (polls[opened.length - 1] || 0) + 1;
      const lines = emit(from, clock, opened.length - 1);
      if (lines.length && !stamped && clock >= windowFrom) {
        matchAt = clock;
        stamped = true;
      }
      return lines;
    },
    lastMatchAt: () => matchAt,
    log: (m) => logs.push(m),
  };

  return {
    deps,
    logs,
    opened,
    relaunches,
    clockNow: () => clock,
    navCalls: () => navCalls,
    polls,
    config: {
      sampleCount,
      windowMs: WINDOW_MS,
      quietMs: 1500,
      exitMs: EXIT_MS,
      bootMs: BOOT_MS,
      measurement: SCREEN_LOAD,
      selector: {},
      navLabel: 'settings',
    },
  };
}

describe('runSeries', () => {
  it('opens each window in the FUTURE, offset by exitMs from the relaunch', async () => {
    // The replay defense: `relaunch` spends exitMs BEFORE it launches, so a window opened
    // at `now()` would cover a span the PREVIOUS launch can still be emitting into, and
    // `assembleSamples` merges by line — fabricating one run out of halves of two.
    const h = harness({ sampleCount: 3 });
    const startedAt = h.clockNow();
    await runSeries(h.config, h.deps);

    expect(h.opened).toHaveLength(3);
    // First window opens exitMs ahead of the clock at the time it was computed.
    expect(h.opened[0]).toBe(startedAt + 4000);
    // And every window is opened BEFORE its own relaunch, never after.
    h.opened.forEach((from, i) => expect(from).toBeLessThanOrEqual(h.relaunches[i] + 4000));
  });

  it('breaks out of the watch once a complete sample is followed by quietMs of silence', async () => {
    const h = harness({
      sampleCount: 1,
      emit: () => triple('settings', 'none', 57, 297),
    });
    const before = h.clockNow();
    const { samples } = await runSeries(h.config, h.deps);
    const spent = h.clockNow() - before;

    expect(samples.length).toBeGreaterThan(0);
    // Ended on the quiet-break, NOT the 45 s cap — otherwise a healthy launch would cost
    // the full window every time and a 30-sample series would take half an hour longer.
    expect(spent).toBeLessThan(4000 + 10000 + 45000);
  });

  it('runs the full window when nothing ever emits, rather than breaking early', async () => {
    const h = harness({ sampleCount: 1, emit: () => [] });
    const before = h.clockNow();
    const { samples } = await runSeries(h.config, h.deps);

    expect(samples).toEqual([]);
    // A silent app must be given its whole budget — breaking early would report "no
    // sample" for a device that was merely slow. Asserted EXACTLY rather than as a floor:
    // the harness burns exitMs + bootMs inside the window before the watch even starts, so
    // a `>= windowMs` floor is satisfied by a watch that ended 14 s short of its deadline.
    expect(h.clockNow() - before).toBe(FULL_WATCH_NO_NAV);
  });

  it('does not break on quiet alone when the sample is INCOMPLETE', async () => {
    // A partial emission plus silence is not a finished run. Breaking here would publish
    // a half-sample as the launch's result.
    //
    // "Incomplete" for `screen-load` means the REQUIRED line is missing, and `paint` is
    // the ONLY required one — `settled` and `split` are `required: false` in
    // `measurements.js`, because a screen with no async fills legitimately settles at
    // paint (`serverSelect` is exactly that shape). So the incomplete case is a settled
    // line with no paint before it, NOT a paint with nothing after it.
    const h = harness({
      sampleCount: 1,
      emit: () => triple('settings', 'none', 57, 297).slice(1),
    });
    const before = h.clockNow();
    await runSeries(h.config, h.deps);
    expect(h.clockNow() - before).toBe(FULL_WATCH_NO_NAV);
  });

  it('treats a paint-only emission as complete, since paint is the only required line', async () => {
    // Pins the property the test above depends on. A screen whose readiness has one
    // moment emits paint and nothing else, and that is a whole sample — not a truncated
    // one to keep waiting on.
    const h = harness({
      sampleCount: 1,
      emit: () => [triple('serverSelect', 'savedOnly', 1569, 1569)[0]],
    });
    const before = h.clockNow();
    const { samples } = await runSeries(h.config, h.deps);

    expect(samples).toHaveLength(1);
    expect(samples[0].complete).toBe(true);
    expect(h.clockNow() - before).toBeLessThan(4000 + 10000 + 45000);
  });

  it('drives the nav once per launch, inside the window', async () => {
    // The nav branch had no coverage at all while `nav` was either null or throwing: every
    // assertion about the watch was made against a series that never navigated.
    const h = harness({
      sampleCount: 3,
      navMs: 30000,
      emit: () => triple('settings', 'none', 57, 297),
    });
    await runSeries(h.config, h.deps);

    expect(h.navCalls()).toBe(3);
    // Inside, not before: every window was already open when its nav ran.
    h.opened.forEach((from, i) => expect(from).toBeLessThanOrEqual(h.relaunches[i] + EXIT_MS));
  });

  it('lengthens the watch by the time the nav spent inside the window', async () => {
    // An episode detail is four screens deep, and on `.177` that walk alone outlasts the
    // 45 s cap the relaunch-only mode was sized for. The walk is spent INSIDE the window,
    // so charging it against the watch budget would leave a deep screen no budget at all.
    const NAV_MS = 30000;
    const h = harness({ sampleCount: 1, navMs: NAV_MS, emit: () => [] });
    const before = h.clockNow();
    await runSeries(h.config, h.deps);

    expect(h.clockNow() - before).toBe(fullWatchWithNav(NAV_MS));
    // And a slow nav lengthens only its OWN launch — the term is measured per launch rather
    // than assumed once for the series.
    expect(h.clockNow() - before).toBeGreaterThan(FULL_WATCH_NO_NAV);
  });

  it('never ends a launch on a quiet clock that predates its own window', async () => {
    // `openWindow`'s only obligation is to publish the window. Given a reader that keeps no
    // per-window quiet state, launch 2 sees lines it can assemble while the clock still
    // holds launch 1's stamp — and that stamp is already `quietMs` stale, so a loop trusting
    // it would break on the FIRST poll and cut the launch's watch to a single second. The
    // gate on the window instant is what makes that unreachable no matter what the caller
    // does; without it this test ends the series ~44 s early on the second launch.
    const stubborn = harness({
      sampleCount: 2,
      resetsQuietClock: false,
      emit: () => triple('settings', 'none', 57, 297),
    });
    const { samples } = await runSeries(stubborn.config, stubborn.deps);

    // Launch 1 breaks legitimately: it stamped the clock itself, then went quiet — 3 polls
    // (emit, +1 s, +2 s > quietMs).
    expect(stubborn.polls[0]).toBe(3);
    // Launch 2 gets its whole watch. Trusting the stale clock would end it on the FIRST
    // poll — `polls[1] === 1` is exactly the regression this guards, and it is invisible in
    // the sample list, because a launch cut short still records what it had already
    // assembled. 45 = the window budget, one poll per second.
    expect(stubborn.polls[1]).toBe(45);
    expect(samples.map((s) => s.launch)).toEqual([0, 1]);
  });

  it('aborts the whole series on a nav failure instead of retrying, naming the launch', async () => {
    const h = harness({ navFails: true, sampleCount: 5 });
    await expect(runSeries(h.config, h.deps)).rejects.toBeInstanceOf(NavFailedError);
    // Died on launch 1 and did NOT go on to relaunch four more times.
    expect(h.relaunches).toHaveLength(1);
  });

  it('throws rather than exiting, so a matrix driver can lose one device and continue', async () => {
    // The one behavioural difference from the inline loop, and the reason for it.
    const h = harness({ navFails: true, sampleCount: 2 });
    const err = await runSeries(h.config, h.deps).catch((e) => e);
    expect(err).toBeInstanceOf(NavFailedError);
    expect(err.launchNumber).toBe(1);
    expect(err.cause.message).toBe('tile not found');
  });

  it('carries the refusal an operator reads, so the entry point asserts nothing itself', () => {
    // `measure.js` cannot be unit tested — it claims the device on import — so a message
    // assembled THERE out of this error's fields has no gate: rename a field and the
    // operator reads `failed on launch undefined` with nothing red anywhere. Pinned here
    // verbatim because this string IS the product for the person whose run just died.
    const err = new NavFailedError(3, new Error('tile not found'), [], 'osd');
    expect(err.message).toBe(
      '--nav osd failed on launch 3: tile not found\n' +
        '  The series is abandoned rather than retried — a nav that cannot reach its screen\n' +
        '  once will not reach it on the remaining launches.',
    );
  });

  it('hands back the launches taken BEFORE the nav failed, rather than dropping them', async () => {
    // Losing the device is the accepted cost; losing the good samples it already produced
    // is not. Without this a matrix driver survives the failure and still has nothing to
    // show for the two launches that worked.
    const h = harness({ sampleCount: 5, emit: () => triple('settings', 'none', 57, 297) });
    let calls = 0;
    h.deps.nav = async () => {
      if (++calls === 3) throw new Error('tile not found');
    };
    const err = await runSeries(h.config, h.deps).catch((e) => e);

    expect(err).toBeInstanceOf(NavFailedError);
    expect(err.launchNumber).toBe(3);
    // Launches 0 and 1 completed; the series stopped inside launch 2 (`launchNumber` 3).
    expect(err.samples.map((s) => s.launch)).toEqual([0, 1]);
    expect(h.relaunches).toHaveLength(3);
  });

  it('stamps launch, launchAt and indexInLaunch so a warm refresh never merges into the cold sample', async () => {
    // A chained nav mounts two screens in one launch — both loads really happened, and
    // they are told apart by the variant the app stamps.
    const h = harness({
      sampleCount: 1,
      emit: () => [
        ...triple('itemDetails', 'Series', 900, 2400),
        ...triple('itemDetails', 'Season', 700, 1900),
      ],
    });
    const { samples } = await runSeries(h.config, h.deps);

    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.indexInLaunch)).toEqual([0, 1]);
    expect(samples.every((s) => s.launch === 0)).toBe(true);
    // The window instant, not the line's — tier 3's interleave check orders arms by it.
    expect(samples[0].launchAt).toBe(new Date(h.opened[0]).toISOString());
  });

  it('measures the launch itself when no nav is given', async () => {
    const h = harness({ sampleCount: 2 });
    h.deps.nav = null;
    await runSeries(h.config, h.deps);
    expect(h.relaunches).toHaveLength(2);
  });
});

describe('formatLaunchLine', () => {
  const sample = (over = {}) => ({
    launch: 0,
    complete: true,
    timings: { paintMs: 57 },
    workload: { fills: 1 },
    dimensions: { component: 'settings', variant: '' },
    ...over,
  });

  it('reports the selected mount, not the first one the launch happened to emit', () => {
    const samples = [
      sample({
        dimensions: { component: 'itemDetails', variant: 'Series' },
        timings: { paintMs: 260 },
      }),
      sample({
        dimensions: { component: 'videoPlayer', variant: 'Movie' },
        timings: { paintMs: 2049 },
      }),
    ];
    const line = formatLaunchLine({
      launch: 0,
      sampleCount: 5,
      samples,
      selector: { component: 'videoPlayer' },
      measurement: SCREEN_LOAD,
    });
    // The defect this guards: hardcoding the first mount printed the screen the nav walked
    // THROUGH while the summary printed the one named — two numbers 8x apart, one output.
    expect(line).toContain('paintMs=2049');
    expect(line).toContain('1/5');
    expect(line).toContain('other run');
  });

  it('says so plainly when the launch produced no complete sample', () => {
    const line = formatLaunchLine({
      launch: 2,
      sampleCount: 3,
      samples: [sample({ launch: 2, complete: false })],
      selector: {},
      measurement: SCREEN_LOAD,
    });
    expect(line).toContain('3/3');
    expect(line).toContain('no complete sample');
  });
});
