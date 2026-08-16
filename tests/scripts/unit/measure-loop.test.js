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

/**
 * A fake clock + console. `now` only advances when the loop sleeps or when a harness step
 * says so, which is what makes the window arithmetic assertable at all — on a real device
 * these spans are milliseconds of wall clock nobody can pin.
 */
function harness({ emit = () => [], navFails = false, sampleCount = 2 } = {}) {
  let clock = 1_000_000;
  const opened = [];
  let windowFrom = Infinity;
  let matchAt = 0;
  let stamped = false;
  const logs = [];
  const relaunches = [];

  const deps = {
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    relaunch: async () => {
      relaunches.push(clock);
      clock += 4000 + 10000; // exitMs + bootMs, as the real one spends
    },
    nav: navFails
      ? async () => {
          throw new Error('tile not found');
        }
      : null,
    openWindow: (from) => {
      opened.push(from);
      windowFrom = from;
      matchAt = 0; // the reset the real reader relies on
      stamped = false;
    },
    // The socket stamps `lastMatchAt` when a MATCHING LINE ARRIVES, then stops — the
    // lines stay in the buffer and keep being returned, but the quiet clock does not
    // keep advancing. Modelling that is the whole point: a clock that re-stamped on
    // every poll would never go quiet and the break could never fire.
    linesSince: (from) => {
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
    config: {
      sampleCount,
      windowMs: 45000,
      quietMs: 1500,
      exitMs: 4000,
      bootMs: 10000,
      measurement: SCREEN_LOAD,
      selector: {},
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
    // sample" for a device that was merely slow.
    expect(h.clockNow() - before).toBeGreaterThanOrEqual(45000);
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
    expect(h.clockNow() - before).toBeGreaterThanOrEqual(45000);
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
    expect(err.launch).toBe(1);
    expect(err.message).toContain('tile not found');
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
