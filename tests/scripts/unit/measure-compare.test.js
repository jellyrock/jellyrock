/**
 * Tier 3 — the paired comparison. See `scripts/measure-compare.js`.
 *
 * Two kinds of gate live here, and they fail differently:
 *
 * - The COMPARABILITY rules, which decide whether two series are two arms of one
 *   experiment or two experiments. Every one of them is a case that would otherwise
 *   print a confident delta about nothing — a different server, a different device, a
 *   `debug=true` build worth +121 ms on its own.
 * - The STATISTICS, pinned against results computed by hand in
 *   `docs/dev/home-first-paint-performance.md`, because the whole reason they moved
 *   into code is that every recorded p-value in that doc was produced outside the
 *   repo and cannot be re-derived from it.
 */
import { describe, expect, it } from 'vitest';

import {
  buildArm,
  comparability,
  completeSeparation,
  coldSamples,
  describeMeasurements,
  interleaving,
  mannWhitney,
  median,
  parseCompareArgs,
  parseSelector,
  reportComparison,
  selectSeries,
  workloadTally,
} from '../../../scripts/measure-compare.js';
import { MeasureArgError } from '../../../scripts/measure-args.js';

/**
 * One cold sample, as `measure.js` writes it.
 *
 * `launch` is deliberately NOT defaulted here — `series()` assigns it per sample index,
 * because `measure.js` writes `launch: i` and one series' samples come from DIFFERENT app
 * launches. This fixture used to hardcode `launch: 0` on every sample, which no assertion
 * could see while cold selection ignored the field; it became visible the moment
 * selection became per-launch. Pass `launch` explicitly to put two samples in ONE launch,
 * which is what a warm refresh beside a cold paint actually is.
 */
const sample = (totalMs, over = {}) => ({
  launchAt: '2026-08-13T10:00:00.000Z',
  indexInLaunch: 0,
  complete: true,
  lines: ['total', 'orchestrator'],
  buildFlags: { debug: false, perfTiming: true },
  workload: { rows: 10 },
  timings: { totalMs },
  ...over,
});

/** A measurement series with everything a comparison needs, overridable per case. */
const series = (over = {}) => ({
  measurement: 'home-latest-rows',
  title: 'Home first paint (latest-rows)',
  grounded: true,
  primary: 'totalMs',
  screen: 'home',
  arm: 'before',
  run: 'measure',
  variant: 'measure',
  commit: 'abc1234',
  dirty: false,
  deviceKey: 'dev-a',
  startedAt: '2026-08-13T10:00:00.000Z',
  endedAt: '2026-08-13T10:05:00.000Z',
  crossedHourBoundary: false,
  outcome: 'passed',
  tier1: { asserted: true, ok: true },
  seriesConsistency: { ok: true, drifted: [] },
  provenance: {
    device: {
      model: 'Streaming Stick 4K',
      modelNumber: '3820RW',
      ramTier: '1GB',
      osVersion: '15.3.4',
    },
    enableRta: true,
    checkout: { appVersion: '2.25.0', manifestFlags: { debug: false, perfTiming: true } },
    server: { url: 'http://192.0.2.10:8096', version: '10.11.11' },
  },
  requested: 3,
  coldSamples: 3,
  median: 2600,
  ...over,
  // One series' samples come from different app LAUNCHES, so give each the launch index
  // `measure.js` would have written — unless a case pinned one deliberately, which is how
  // a warm refresh beside a cold paint is expressed.
  samples: (over.samples ?? [sample(2500), sample(2600), sample(2700)]).map((s, i) => ({
    launch: i,
    ...s,
  })),
});

/** Both arms of a healthy comparison, interleaved. */
const armsFrom = (records, field) => {
  const a = buildArm('before', records, parseSelector('before'), field);
  const b = buildArm('after', records, parseSelector('after'), field || a.primary);
  return [a, b];
};

/** `before` at 2500/2600/2700 and `after` at 2000/2100/2200, alternating in time. */
const twoArms = (overA = {}, overB = {}) => {
  const at = (n) => `2026-08-13T10:${String(n).padStart(2, '0')}:00.000Z`;
  return [
    series({
      arm: 'before',
      samples: [sample(2500, { launchAt: at(0) }), sample(2600, { launchAt: at(4) })],
      ...overA,
    }),
    series({
      arm: 'after',
      commit: 'def5678',
      samples: [sample(2000, { launchAt: at(2) }), sample(2100, { launchAt: at(6) })],
      ...overB,
    }),
  ];
};

describe('selecting an arm', () => {
  it('reads a bare selector as an arm label', () => {
    expect(parseSelector('before')).toEqual({ arm: 'before' });
    expect(parseSelector('commit=abc1234,device=dev-a')).toEqual({
      commit: 'abc1234',
      device: 'dev-a',
    });
  });

  it('refuses an unknown selector key rather than ignoring it', () => {
    // The `--sever` lesson, one layer up: a dropped selector compares something
    // other than what the operator asked for, and says nothing about it.
    expect(() => parseSelector('devcie=dev-a')).toThrow(MeasureArgError);
    expect(() => parseSelector('arm=')).toThrow(MeasureArgError);
  });

  it('excludes a series that never reached a verdict, and attributes it', () => {
    const records = [series(), series({ outcome: 'blocked' }), series({ outcome: undefined })];
    const sel = selectSeries(records, { arm: 'before' });
    expect(sel.series).toHaveLength(1);
    expect(sel.excluded.notASample).toBe(2);
    expect(sel.nonSampleOutcomes).toEqual({ blocked: 1, unrecorded: 1 });
  });

  it('pools only the cold first paints, never the refresh runs beside them', () => {
    // All three in ONE launch — that is what a refresh run IS. Pinned explicitly, because
    // the default fixture spreads samples across launches like a real series does.
    const warm = sample(900, { launch: 0, indexInLaunch: 1 });
    const incomplete = sample(800, { launch: 0, complete: false });
    const record = series({ samples: [sample(2500, { launch: 0 }), warm, incomplete] });
    expect(coldSamples(record)).toHaveLength(1);
    expect(buildArm('before', [record], { arm: 'before' }).values).toEqual([2500]);
  });

  it('reads the mount the RECORD says it is about, not the first one in each launch', () => {
    // The 8x defect. A playback nav mounts the details screen it walks THROUGH at index 0
    // and the player at index 1, so selecting by position read `itemDetails` out of a
    // record that published `videoPlayer`: `measure` printed 2135 ms and this read the
    // same record back as 254 ms. Six samples, all the wrong screen, silently.
    const mount = (launch, i, component, paintMs) =>
      sample(paintMs, {
        launch,
        indexInLaunch: i,
        dimensions: { component, variant: 'Movie' },
        timings: { totalMs: paintMs },
      });
    const record = series({
      screen: 'osd',
      component: 'videoPlayer',
      screenVariant: 'Movie',
      samples: [
        mount(0, 0, 'itemDetails', 267),
        mount(0, 1, 'videoPlayer', 2811),
        mount(1, 0, 'itemDetails', 333),
        mount(1, 1, 'videoPlayer', 3471),
      ],
    });
    expect(coldSamples(record).map((c) => c.timings.totalMs)).toEqual([2811, 3471]);
    expect(buildArm('before', [record], { arm: 'before' }).values).toEqual([2811, 3471]);
  });

  it('still selects by position for a family that stamps no dimensions', () => {
    // `home-latest-rows` (bare `npm run measure`) and `item-grid` emit purely numeric
    // lines, so `splitWorkload` gives them no dimensions to match on. Honouring a record
    // field against unstamped samples would select none and read as an empty series.
    const record = series({ screenVariant: 'Movie' });
    expect(coldSamples(record)).toHaveLength(3);
  });

  it('honours --field over the family primary', () => {
    const record = series({
      samples: [sample(2500, { timings: { totalMs: 2500, emitMs: 1300 } })],
    });
    expect(buildArm('before', [record], { arm: 'before' }, 'emitMs').values).toEqual([1300]);
  });
});

describe('comparability — what is refused', () => {
  const refuse = (overA, overB) => comparability(...armsFrom(twoArms(overA, overB))).refusals;

  it('refuses two different servers, using tier 1s own normalizer', () => {
    const other = {
      provenance: {
        ...series().provenance,
        server: { url: 'https://demo.jellyfin.org/unstable', version: '12.0.0' },
      },
    };
    expect(refuse({}, other).join(' ')).toMatch(/different servers/);
    // …but a trailing slash is the same server, not a refusal.
    const slash = {
      provenance: {
        ...series().provenance,
        server: { url: 'http://192.0.2.10:8096/', version: '10.11.11' },
      },
    };
    expect(refuse({}, slash)).toEqual([]);
  });

  it('refuses two device models, and two RAM tiers', () => {
    const ultra = {
      provenance: {
        ...series().provenance,
        device: { model: 'Ultra', modelNumber: '4850X', ramTier: '2GB', osVersion: '15.3.4' },
      },
    };
    const refusals = refuse({}, ultra).join(' ');
    expect(refusals).toMatch(/different device models/);
    expect(refusals).toMatch(/different device RAM tiers/);
  });

  it('refuses arms built with different flags — a `debug=true` build is +121 ms on its own', () => {
    const at = (n) => `2026-08-13T10:${String(n).padStart(2, '0')}:00.000Z`;
    const debugSamples = {
      samples: [
        sample(2000, { launchAt: at(2), buildFlags: { debug: true, perfTiming: true } }),
        sample(2100, { launchAt: at(6), buildFlags: { debug: true, perfTiming: true } }),
      ],
    };
    expect(refuse({}, debugSamples).join(' ')).toMatch(/built differently/);
  });

  it('refuses an arm that mixes two workload families or screens within itself', () => {
    const mixed = {
      samples: [sample(2000), sample(2100, { launchAt: '2026-08-13T10:06:00.000Z' })],
    };
    // Same arm label on two series that disagree about the screen.
    const records = [
      series({ arm: 'after', screen: 'home', ...mixed }),
      series({ arm: 'after', screen: 'movies-grid', ...mixed }),
      series({ arm: 'before' }),
    ];
    expect(comparability(...armsFrom(records)).refusals.join(' ')).toMatch(/mixes 2 screens/);
  });

  it('refuses two item VARIANTS of one component — the gap a component-level family opens', () => {
    // `screen` alone is too coarse once one component backs many screens: an
    // `itemDetails` Movie series and an `itemDetails` Series series agree on component,
    // measurement, model and tier, and would have passed every gate cleanly. `variant`
    // is what separates them, and it had been read here since this file was written
    // while nothing ever wrote it.
    const records = [
      series({ arm: 'before', screen: 'movieDetails', screenVariant: 'Movie' }),
      series({ arm: 'after', screen: 'seriesDetails', screenVariant: 'Series' }),
    ];
    const refusals = comparability(...armsFrom(records)).refusals.join(' ');
    expect(refusals).toMatch(/different item variants/);
  });

  it('refuses an arm that mixes two variants within itself', () => {
    const mixed = {
      samples: [sample(2000), sample(2100, { launchAt: '2026-08-13T10:06:00.000Z' })],
    };
    const records = [
      series({ arm: 'after', screenVariant: 'Series', ...mixed }),
      series({ arm: 'after', screenVariant: 'Season', ...mixed }),
      series({ arm: 'before' }),
    ];
    expect(comparability(...armsFrom(records)).refusals.join(' ')).toMatch(/mixes 2 item variants/);
  });

  it('keeps the run-script `variant` and the screen `screenVariant` apart', () => {
    // They are unrelated senses of one word and the record carries BOTH: `variant` is
    // `process.env.npm_lifecycle_event` from `runProvenance()`, `screenVariant` is the
    // item type the app stamped. Caught on hardware — an earlier cut named the second one
    // `variant`, and because `runProvenance()` is spread BELOW it in the record literal,
    // every record read `variant: "measure"` while its samples plainly said Series/Season.
    const records = [
      series({ arm: 'before', variant: 'measure', screenVariant: 'Movie' }),
      series({ arm: 'after', variant: 'measure', screenVariant: 'Movie' }),
    ];
    // Same npm script on both arms is normal and must not refuse; same item type too.
    expect(comparability(...armsFrom(records)).refusals).toEqual([]);
    // And the item type is what the gate actually reads.
    const mixed = [
      series({ arm: 'before', variant: 'measure', screenVariant: 'Movie' }),
      series({ arm: 'after', variant: 'measure', screenVariant: 'Series' }),
    ];
    expect(comparability(...armsFrom(mixed)).refusals.join(' ')).toMatch(/different item variants/);
  });

  it('refuses two arms that are two different COMPONENTS', () => {
    // Until measurement reached a playback screen, `screen` implied the component and the
    // gate did not need this. A nav that walks through another instrumented screen breaks
    // the implication: an `itemDetails` arm and a `videoPlayer` arm can BOTH carry
    // `screen: osd`, agree on every other key here, and be compared without a word —
    // while the workload line prints "identical: not a run that did less work".
    const records = [
      series({ arm: 'before', screen: 'osd', component: 'itemDetails' }),
      series({ arm: 'after', screen: 'osd', component: 'videoPlayer' }),
    ];
    expect(comparability(...armsFrom(records)).refusals.join(' ')).toMatch(/different components/);
  });

  it('refuses two arms that opened different LIBRARIES', () => {
    // On the server that motivated `--library` (four movie libraries) two arms can
    // agree on screen, variant, device and server while measuring different content.
    const records = [
      series({ arm: 'before', library: 'lib-a' }),
      series({ arm: 'after', library: 'lib-b' }),
    ];
    expect(comparability(...armsFrom(records)).refusals.join(' ')).toMatch(/different library ids/);
  });

  it('refuses when both selectors resolve to the same series', () => {
    const records = [series({ arm: 'before' })];
    const a = buildArm('a', records, { arm: 'before' });
    const b = buildArm('b', records, { commit: 'abc1234' });
    expect(comparability(a, b).refusals.join(' ')).toMatch(/SAME series/);
  });

  it('refuses PARTIALLY overlapping arms, which is the shape an operator reaches', () => {
    // Measuring an UNCOMMITTED change leaves both arms on one commit — the documented
    // common case, and the reason `--arm` exists at all — so `--a commit=<sha>`
    // swallows the `after` arm whole while `--b after` names it again. Reproduced
    // against this repo's own ledger before this refusal existed: it printed a
    // confident `Δ -45.5 ms (-2.5%)`, a p, and a twelve-entry `order` line built from
    // eight distinct samples, with B's four counted on both sides.
    const records = twoArms({}, { commit: 'abc1234' });
    const a = buildArm('commit=abc1234', records, { commit: 'abc1234' });
    const b = buildArm('after', records, { arm: 'after' });
    expect(a.series).toHaveLength(2); // both arms
    expect(b.series).toHaveLength(1); // one of the two A already has
    const verdict = comparability(a, b);
    expect(verdict.refusals.join(' ')).toMatch(/1 of commit=abc1234's 2 series is ALSO in after/);
    expect(verdict.refusals.join(' ')).toMatch(/counted on both sides/);
    // Named so the operator can act on it — the ledger is append-only, so an index
    // would mean nothing, but `measure:compare` with no arguments prints these.
    expect(verdict.refusals.join(' ')).toMatch(/arm after @ 2026-08-13/);
    // …and never as a delta. Probed on the statistic itself rather than the words
    // "rank test", which the refusal's own message contains.
    expect(reportComparison(a, b, verdict).join('\n')).not.toMatch(/Mann-Whitney U =/);
  });

  it('refuses an arm that mixes ENABLE_RTA states within itself, not just across arms', () => {
    const nonRta = { provenance: { ...series().provenance, enableRta: false } };
    const records = [
      series({ arm: 'before' }),
      series({ arm: 'after', ...nonRta }),
      series({ arm: 'after', commit: 'def5678' }),
    ];
    expect(comparability(...armsFrom(records)).refusals.join(' ')).toMatch(
      /mixes 2 ENABLE_RTA states/,
    );
  });

  it('refuses an empty arm rather than reporting a median over nothing', () => {
    const [a, b] = armsFrom([series({ arm: 'before' })]);
    expect(comparability(a, b).refusals.join(' ')).toMatch(/selected no usable series/);
  });

  it('refuses arms that differ in ENABLE_RTA — the calibration this cannot assume', () => {
    const nonRta = { provenance: { ...series().provenance, enableRta: false } };
    expect(refuse({}, nonRta).join(' ')).toMatch(/ENABLE_RTA/);
  });
});

describe('comparability — what is only said out loud', () => {
  const warn = (overA, overB) =>
    comparability(...armsFrom(twoArms(overA, overB))).warnings.join(' ');

  it('does NOT refuse a workload difference — it is the case a human must see', () => {
    const fewer = {
      samples: [
        sample(2000, { workload: { rows: 9 }, launchAt: '2026-08-13T10:02:00.000Z' }),
        sample(2100, { workload: { rows: 9 }, launchAt: '2026-08-13T10:06:00.000Z' }),
      ],
    };
    const [a, b] = armsFrom(twoArms({}, fewer));
    const verdict = comparability(a, b);
    expect(verdict.refusals).toEqual([]);
    expect(reportComparison(a, b, verdict).join('\n')).toMatch(/DID NOT DO THE SAME WORK/);
  });

  it('warns when an arm mixes workloads within itself', () => {
    const mixed = {
      samples: [
        sample(2000, { workload: { rows: 10 }, launchAt: '2026-08-13T10:02:00.000Z' }),
        sample(2100, { workload: { rows: 12 }, launchAt: '2026-08-13T10:06:00.000Z' }),
      ],
    };
    expect(warn({}, mixed)).toMatch(/mixes 2 workloads/);
  });

  it('warns when a series never asserted its server', () => {
    expect(warn({}, { tier1: { asserted: false, ok: true } })).toMatch(/did NOT assert its server/);
  });

  it('warns about a dirty tree, a crossed hour, and a drifted identity', () => {
    expect(warn({}, { dirty: true })).toMatch(/DIRTY tree/);
    expect(warn({}, { crossedHourBoundary: true })).toMatch(/crossed the top of the hour/);
    expect(warn({}, { crossedHourBoundary: undefined })).toMatch(/did not record the flag/);
    expect(warn({}, { seriesConsistency: { ok: false, drifted: [] } })).toMatch(/identity drifted/);
  });

  it('warns on two units of the same model, which is not the same device', () => {
    expect(warn({}, { deviceKey: 'dev-b' })).toMatch(/two different physical devices/);
  });

  it('says out loud how many series it DROPPED, on the path that prints a delta', () => {
    // `selectSeries`'s contract is that exclusions are output, not a silent filter —
    // and the failure it names (a median over three samples when you took ten) lands
    // on the success path, not on the refusal path where this used to be printed.
    const records = [
      ...twoArms(),
      series({ arm: 'before', outcome: 'blocked' }),
      series({ arm: 'before', outcome: 'blocked' }),
      series({ arm: 'before', outcome: undefined }),
      series({ arm: 'before', samples: [] }),
    ];
    const [a, b] = armsFrom(records);
    const verdict = comparability(a, b);
    expect(verdict.refusals).toEqual([]);
    const text = reportComparison(a, b, verdict).join('\n');
    expect(text).toMatch(/rank test/); // it still reports…
    expect(text).toMatch(/arm before matched 5 series but is using 1/); // …and says what it dropped
    expect(text).toMatch(/2 blocked, 1 unrecorded/);
    expect(text).toMatch(/1 produced no cold sample/);
    // The arm that dropped nothing says nothing — a per-arm line, not a banner.
    expect(text).not.toMatch(/arm after matched/);
  });
});

describe('the interleave check', () => {
  it('reports alternation as blocks, and flags all-A-then-all-B', () => {
    const at = (n) => `2026-08-13T10:${String(n).padStart(2, '0')}:00.000Z`;
    const [a, b] = armsFrom(twoArms());
    expect(interleaving(a, b).sequence).toBe('ABAB');
    expect(interleaving(a, b).blocks).toBe(4);

    const blocked = armsFrom(
      twoArms(
        { samples: [sample(2500, { launchAt: at(0) }), sample(2600, { launchAt: at(2) })] },
        { samples: [sample(2000, { launchAt: at(4) }), sample(2100, { launchAt: at(6) })] },
      ),
    );
    expect(interleaving(...blocked).blocks).toBe(2);
    expect(reportComparison(...blocked, comparability(...blocked)).join('\n')).toMatch(
      /were NOT interleaved/,
    );
  });

  it('does not demand interleaving of arms that cannot be interleaved', () => {
    // One sample each: `AB` is the only sequence available, so telling the operator to
    // alternate is advice they cannot take. The n<5 warning already covers this case.
    const at = (n) => `2026-08-13T10:0${n}:00.000Z`;
    const one = armsFrom(
      twoArms(
        { samples: [sample(2500, { launchAt: at(0) })] },
        { samples: [sample(2000, { launchAt: at(2) })] },
      ),
    );
    expect(interleaving(...one).blocks).toBe(2);
    const text = reportComparison(...one, comparability(...one)).join('\n');
    expect(text).not.toMatch(/were NOT interleaved/);
    expect(text).toMatch(/has 1 sample\(s\)/);
  });

  it('reports a short span in seconds rather than rounding it to `0 min`', () => {
    const [a, b] = armsFrom(
      twoArms(
        { samples: [sample(2500, { launchAt: '2026-08-13T10:00:00.000Z' })] },
        { samples: [sample(2000, { launchAt: '2026-08-13T10:00:40.000Z' })] },
      ),
    );
    expect(reportComparison(a, b, comparability(a, b)).join('\n')).toMatch(/over 40 s/);
  });

  it('never reads a missing timestamp as ordered', () => {
    const [a, b] = armsFrom(
      twoArms(
        { samples: [sample(2500, { launchAt: undefined })] },
        { samples: [sample(2000, { launchAt: undefined })] },
      ),
    );
    const order = interleaving(a, b);
    expect([order.sequence, order.blocks, order.unknown]).toEqual(['', 0, 2]);
    expect(reportComparison(a, b, comparability(a, b)).join('\n')).toMatch(/order\s+unknown/);
  });
});

describe('the statistics', () => {
  it('takes a median of an even and an odd sample count', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('reproduces BOTH methods for the batched-attach comparison, which used the approximation', () => {
    // `home-first-paint-performance.md` records "Mann-Whitney U = 0.0, p = 0.0002" for
    // n=10 per arm with complete separation. That p is the NORMAL approximation with a
    // continuity correction (z = 3.742); the exact value is 2/C(20,10) = 1.08e-5. The
    // doc did not say which method it used, and the sibling comparison below used the
    // other one — so both are pinned here, and the doc now says so too.
    //
    // Complete separation is the only per-sample property the doc records, and it is
    // what fixes U at 0, so any two separated 10-sample arms reproduce the statistic.
    const before = [2600, 2610, 2620, 2630, 2640, 2650, 2660, 2670, 2680, 2690];
    const after = [2100, 2110, 2120, 2130, 2140, 2150, 2160, 2170, 2180, 2190];
    const test = mannWhitney(before, after);
    expect(test.u).toBe(0);
    expect(test.method).toBe('exact');
    expect(test.p).toBeCloseTo(1.083e-5, 8);
    expect(completeSeparation(before, after)).toBe(true);

    const approximate = mannWhitney(before, after, { method: 'normal' });
    expect(approximate.method).toBe('normal');
    expect(approximate.p).toBeCloseTo(0.0002, 4);
  });

  it('reproduces the exact p recorded for the apiPipeline migration (n=5 vs n=6)', () => {
    // "Every after sample is faster than every before sample — complete separation,
    // exact Mann-Whitney p≈0.004."
    const before = [1050, 1060, 1070, 1080, 1090];
    const after = [590, 600, 610, 620, 630, 640];
    const test = mannWhitney(before, after);
    expect(test.u).toBe(0);
    expect(test.p).toBeCloseTo(0.004, 3);
  });

  it('does not call a difference that sits inside the spread', () => {
    const a = [2500, 2600, 2700, 2800, 2900];
    const b = [2450, 2650, 2750, 2850, 2950];
    const test = mannWhitney(a, b);
    expect(test.p).toBeGreaterThan(0.05);
    expect(completeSeparation(a, b)).toBe(false);
  });

  it('falls back to the tie-corrected approximation, and says which it used', () => {
    const a = [2500, 2500, 2500, 2600];
    const b = [2500, 2500, 2700, 2800];
    const test = mannWhitney(a, b);
    expect(test.method).toBe('normal');
    expect(test.ties).toBe(true);
    expect(test.p).toBeGreaterThan(0);
    expect(test.p).toBeLessThanOrEqual(1);
  });

  it('is symmetric in its arms', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [6, 7, 8, 9, 10];
    expect(mannWhitney(a, b).p).toBeCloseTo(mannWhitney(b, a).p, 12);
  });
});

describe('the report', () => {
  it('prints the workload line ABOVE the timing line', () => {
    const [a, b] = armsFrom(twoArms());
    const text = reportComparison(a, b, comparability(a, b)).join('\n');
    expect(text.indexOf('workload')).toBeLessThan(text.indexOf('rank test'));
    expect(text).toMatch(/identical: the delta below is not a run that did less work/);
    expect(text).toMatch(/Δ -500 ms \(-19.6%\)/);
  });

  it('says what it refused and stops, rather than printing a delta anyway', () => {
    const ultra = {
      provenance: {
        ...series().provenance,
        device: { model: 'Ultra', modelNumber: '4850X', ramTier: '2GB', osVersion: '15.3.4' },
      },
    };
    const [a, b] = armsFrom(twoArms({}, ultra));
    const text = reportComparison(a, b, comparability(a, b)).join('\n');
    expect(text).toMatch(/REFUSED/);
    expect(text).not.toMatch(/rank test/);
  });

  it('describes the ledger by every key an operator has to supply', () => {
    const text = describeMeasurements(twoArms()).join('\n');
    expect(text).toMatch(/arm\s+before ×1\s+after ×1/);
    expect(text).toMatch(/Streaming Stick 4K dev-a/);
  });

  it('tallies workloads commonest-first', () => {
    const arm = buildArm(
      'before',
      [series({ samples: [sample(1), sample(2), sample(3, { workload: { rows: 9 } })] })],
      {
        arm: 'before',
      },
    );
    expect(workloadTally(arm)).toEqual([
      ['rows=10', 2],
      ['rows=9', 1],
    ]);
  });
});

describe('the command line', () => {
  it('refuses an unknown flag and a half-declared comparison', () => {
    expect(() => parseCompareArgs(['--aa', 'before'])).toThrow(MeasureArgError);
    expect(() => parseCompareArgs(['--a'])).toThrow(MeasureArgError);
    expect(() => parseCompareArgs(['--a', 'before'])).toThrow(/both --a and --b/);
  });

  it('accepts both spellings of a value flag', () => {
    expect(parseCompareArgs(['--a', 'before', '--b=after'])).toEqual({ a: 'before', b: 'after' });
  });
});
