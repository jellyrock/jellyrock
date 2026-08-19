/**
 * The matrix report. See `scripts/measure-report.js`.
 *
 * Almost every case here is about a cell that holds NO number, because that is where a
 * matrix lies. The Charter asks that "a screen that emits no timing is reported as
 * unmeasurable, never silently averaged and never quietly absent from a report", and the
 * two defects this suite was written around are both violations of that sentence found
 * by running the tool against the real ledger:
 *
 * - a cell whose series all produced zero cold samples rendered `—`, indistinguishable
 *   from a screen nobody had ever measured. `settings` on 1 GB had thirteen such series.
 * - the detail block published a median for a cell the grid had just refused to average
 *   as `mixed`, which is the well-formed-figure-about-two-experiments this whole
 *   subsystem exists to prevent.
 *
 * Both are pinned below, because neither was visible in a diff and both read as correct
 * output.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCell,
  buildMatrix,
  cellText,
  familiesIn,
  isEmpty,
  parseReportArgs,
  PROVENANCE_AXES,
  provenanceOf,
  renderDetail,
  renderMatrix,
  renderGaps,
  renderGrid,
} from '../../../scripts/measure-report.js';
import { MeasureArgError } from '../../../scripts/measure-args.js';
import { compareRamTiers, RAM_TIERS } from '../../../scripts/roku-devices.js';
import { METHOD_FLOOR, seriesIntegrity } from '../../../scripts/measure-compare.js';
import { mixedPopulations, buildArm, parseSelector } from '../../../scripts/measure-compare.js';

/**
 * One cold sample as `measure.js` writes it.
 *
 * `launch` is deliberately NOT defaulted, exactly as in `measure-compare.test.js`:
 * `series()` assigns it per sample index, and a default here would win the spread and
 * put every sample of a series in launch 0 — where cold selection keeps only one.
 */
const sample = (paintMs, over = {}) => ({
  launchAt: '2026-08-13T10:00:00.000Z',
  indexInLaunch: 0,
  complete: true,
  lines: ['paint', 'settled'],
  buildFlags: { debug: false, perfTiming: true },
  workload: { fills: 3 },
  timings: { paintMs, settledMs: paintMs * 4 },
  ...over,
});

/**
 * A `screen-load` series with everything the report reads, overridable per case.
 *
 * A sample's `dimensions` default from the RECORD's `component` / `screenVariant`,
 * because cold selection matches them against each other: a fixture that overrode the
 * record's component alone would describe a record whose own samples are about a
 * different screen, and every case built on it would silently select zero cold samples.
 */
const series = (over = {}) =>
  rec({
    measurement: 'screen-load',
    title: 'Screen readiness (paint + settle)',
    primary: 'paintMs',
    screen: 'settings',
    component: 'settings',
    screenVariant: 'none',
    arm: null,
    commit: 'abc1234',
    deviceKey: 'dev-a',
    startedAt: '2026-08-13T10:00:00.000Z',
    outcome: 'passed',
    provenance: {
      device: { model: 'Streaming Stick 4K', modelNumber: '3820RW', ramTier: '1GB' },
      enableRta: true,
      server: { url: 'http://192.0.2.10:8096', version: '10.11.11' },
    },
    ...over,
    samples: over.samples ?? [sample(60), sample(70)],
  });

/**
 * Finish a record: stamp each sample with its own launch index and the record's own
 * identity. Split out because both have to happen AFTER the overrides are merged.
 *
 * The launch index matters as much as the dimensions — one series' samples come from
 * different app LAUNCHES and cold selection is per-launch, so leaving them all on
 * launch 0 contributes ONE cold sample per series however many it lists.
 */
function rec(record) {
  return {
    ...record,
    samples: (record.samples || []).map((s, i) => ({
      launch: i,
      dimensions: { component: record.component ?? null, variant: record.screenVariant ?? null },
      ...s,
    })),
  };
}

const REGISTRY = ['home', 'settings', 'search', 'osd'];

const matrixOf = (records, over = {}) =>
  buildMatrix(records, { measurement: 'screen-load', registryScreens: REGISTRY, ...over });

const cellAt = (matrix, screen, tier) => {
  const row = matrix.rows.find((r) => r.screen === screen);
  return row.cells[matrix.tiers.indexOf(tier)];
};

describe('RAM tier ordering', () => {
  it('orders tiers by the RAM the hardware table records, not by their spelling', () => {
    // The point of deriving the order from `ramMb`: as strings these sort 1GB, 1.5GB,
    // 2GB, 256MB, 512MB — every megabyte tier after every gigabyte one.
    expect(['2GB', '512MB', '1GB', '256MB', '1.5GB'].sort(compareRamTiers)).toEqual([
      '256MB',
      '512MB',
      '1GB',
      '1.5GB',
      '2GB',
    ]);
    expect(RAM_TIERS[0]).toBe('256MB');
  });

  it('sorts a tier the table cannot place LAST rather than dropping it', () => {
    expect(['4GB', '1GB'].sort(compareRamTiers)).toEqual(['1GB', '4GB']);
  });
});

describe('the row set — where a gap could hide', () => {
  it('gives every registry screen a row even when the ledger is empty of them', () => {
    const matrix = matrixOf([series({ screen: 'settings' })]);
    expect(matrix.rows.map((r) => r.screen)).toEqual(expect.arrayContaining(REGISTRY));
    // The whole reason rows come from the registry rather than the ledger: a screen
    // nobody has measured is exactly the one a ledger-derived table cannot show.
    expect(cellText(cellAt(matrix, 'osd', '1GB'))).toBe('—');
  });

  it('appends a ledger screen the registry does not know, marked rather than dropped', () => {
    const matrix = matrixOf([series({ screen: 'itemDetails' })]);
    const row = matrix.rows.find((r) => r.screen === 'itemDetails');
    expect(row.inRegistry).toBe(false);
    expect(renderGrid(matrix).join('\n')).toMatch(/itemDetails †/);
  });

  it('keeps a row for series that recorded no screen at all', () => {
    const matrix = matrixOf([series({ screen: null })]);
    const row = matrix.rows.find((r) => r.screen === '');
    expect(row).toBeDefined();
    expect(row.cells[0].n).toBe(2);
    expect(renderGrid(matrix).join('\n')).toMatch(/\(unrecorded\) †/);
  });
});

describe('the three kinds of nothing', () => {
  it('reads `—` only when nothing was ever recorded for that screen and tier', () => {
    const matrix = matrixOf([series()]);
    expect(cellText(cellAt(matrix, 'search', '1GB'))).toBe('—');
  });

  it('reads `0 cold` when series exist and none produced a cold sample', () => {
    // The regression this pins: `selectSeries` drops a zero-cold series before
    // `arm.series`, so a cell counting only survivors called thirteen real measurement
    // runs "never measured".
    const matrix = matrixOf([series({ samples: [] }), series({ samples: [] })]);
    const cell = cellAt(matrix, 'settings', '1GB');
    expect(cell.series).toBe(0);
    expect(cell.noCold).toBe(2);
    expect(cellText(cell)).toBe('0 cold');
    expect(renderGaps(matrix).join('\n')).toMatch(/measured and yielded no usable number/);
  });

  it('counts a refused run as measured-and-empty too, naming its outcome', () => {
    const matrix = matrixOf([series({ outcome: 'blocked' })]);
    const cell = cellAt(matrix, 'settings', '1GB');
    expect(cell.blocked).toBe(1);
    expect(cellText(cell)).toBe('0 cold');
    expect(renderGaps(matrix).join('\n')).toMatch(/1 not a sample \(1 blocked\)/);
  });

  it('reads `mixed` when the cell pools more than one population', () => {
    const matrix = matrixOf([
      series({ component: 'itemDetails' }),
      series({ component: 'videoPlayer' }),
    ]);
    const cell = cellAt(matrix, 'settings', '1GB');
    expect(cell.mixed.map((m) => m.key)).toContain('component');
    expect(cellText(cell)).toBe('mixed');
  });

  it('lists a never-measured registry screen by name rather than leaving it to the eye', () => {
    const gaps = renderGaps(matrixOf([series()])).join('\n');
    expect(gaps).toMatch(/3 of 4 registry screens have never been measured/);
    expect(gaps).toMatch(/home, search, osd/);
  });
});

describe('a mixed cell is refused in EVERY view, not just the grid', () => {
  const mixed = [series({ component: 'itemDetails' }), series({ component: 'videoPlayer' })];

  it('does not publish a median for it in the detail block', () => {
    // The cell has an `n` and a median like any other; printing them under a heading
    // naming one screen is the figure-about-two-experiments the grid just refused.
    const matrix = matrixOf(mixed);
    expect(cellAt(matrix, 'settings', '1GB').n).toBe(4);
    expect(renderDetail(matrix).join('\n')).not.toMatch(/settings · 1GB/);
  });

  it('does not count it as a measured cell in the heading', () => {
    expect(matrixOf(mixed).measuredCells).toBe(0);
  });

  it('suggests a --select only for axes that ARE selection keys', () => {
    const gaps = renderGaps(matrixOf(mixed)).join('\n');
    expect(gaps).toMatch(/narrow it: --select component=<value>/);

    // `enableRta` is a refusal axis with no selector, so offering
    // `--select enableRta=…` would hand over a command `parseSelector` rejects.
    const rta = matrixOf([
      series(),
      series({ provenance: { ...series().provenance, enableRta: false } }),
    ]);
    const rtaGaps = renderGaps(rta).join('\n');
    expect(rtaGaps).not.toMatch(/--select enableRta/);
    expect(rtaGaps).toMatch(/ENABLE_RTA state is not a selection key/);
    expect(() => parseSelector('enableRta=true')).toThrow(MeasureArgError);
  });
});

describe('the numbers', () => {
  it('takes every figure through the same arm machinery `measure:compare` uses', () => {
    const records = [series({ samples: [sample(50), sample(60), sample(70)] })];
    const matrix = matrixOf(records);
    const cell = cellAt(matrix, 'settings', '1GB');
    const arm = buildArm('x', records, parseSelector('screen=settings'), 'paintMs');
    expect(cell.median).toBe(60);
    expect(cell.median).toBe(
      // Same records, same field, through `buildArm` directly — the report may not have
      // a median of its own to disagree with.
      arm.values.sort((a, b) => a - b)[1],
    );
  });

  it('headlines the family primary once for the whole table, not per cell', () => {
    // Left to `buildArm`'s per-arm fallback, two cells could headline different
    // quantities under one column heading.
    const matrix = matrixOf([series(), series({ screen: 'search', primary: 'settledMs' })]);
    expect(matrix.primary).toBe('paintMs');
    expect(cellAt(matrix, 'search', '1GB').field).toBe('paintMs');
  });

  it('carries every milestone the samples recorded, not only the headline one', () => {
    // The Charter's second-milestone criterion: a table showing only the paint is the
    // single number that hides the async fill behind it.
    const cell = cellAt(matrixOf([series()]), 'settings', '1GB');
    expect(cell.fields.map((f) => f.key).sort()).toEqual(['paintMs', 'settledMs']);
    expect(cell.fields.find((f) => f.key === 'settledMs').median).toBe(260);
  });

  it('states the yield beside a number taken from partly-unusable series', () => {
    const matrix = matrixOf([series(), series({ samples: [] }), series({ outcome: 'blocked' })]);
    expect(renderDetail(matrix).join('\n')).toMatch(
      /yield\s+1 of 3 series usable — 1 produced no cold sample, 1 not a sample/,
    );
  });

  it('flags a cell whose samples did not all do the same work', () => {
    const matrix = matrixOf([
      series({
        samples: [sample(60, { workload: { fills: 3 } }), sample(70, { workload: { fills: 9 } })],
      }),
    ]);
    expect(renderDetail(matrix).join('\n')).toMatch(/⚠ 2 distinct workloads/);
  });
});

describe('a sentinel is not a duration', () => {
  // `item-grid` initialises `firstPaintMs` to -1 and assigns it only on the genre-skeleton
  // path, so a plain grid load reports -1 on every sample. Measured on device 2026-08-19:
  // five of five. A duration cannot be negative, so publishing `median -1 ms` beside real
  // medians is a figure that looks measured and is not.
  const withSentinel = [
    series({
      samples: [
        sample(60, { timings: { paintMs: 60, firstPaintMs: -1 } }),
        sample(70, { timings: { paintMs: 70, firstPaintMs: -1 } }),
      ],
    }),
  ];

  it('flags the field rather than printing it as a median', () => {
    const out = renderDetail(matrixOf(withSentinel)).join('\n');
    expect(out).toMatch(/firstPaintMs\s+not reached — -1 is a sentinel, not a duration\s+×2/);
    expect(out).not.toMatch(/firstPaintMs\s+median/);
  });

  it('still publishes the real timings in the same cell', () => {
    expect(renderDetail(matrixOf(withSentinel)).join('\n')).toMatch(/paintMs\s+median 65 ms/);
  });

  it('never lets a sentinel become the headline number in the grid', () => {
    // The grid cell has no room to explain itself, so it must not show `-1 ×2`.
    const matrix = matrixOf(withSentinel, { field: 'firstPaintMs' });
    expect(cellText(cellAt(matrix, 'settings', '1GB'))).toBe('sentinel');
  });
});

describe('integrity — what weakens a median, beside the number', () => {
  // `measure:compare` has warned about most of these since it existed and the report
  // warned about none, so the SAME series could be disclosed by one reader and silently
  // averaged by the other. The predicates are now shared; only the wording differs.
  const clean = () => ({
    dirty: false,
    tier1: { asserted: true, ok: true },
    crossedHourBoundary: false,
    provenance: { ...series().provenance, checkout: { deployedFromCheckout: true } },
  });

  it('discloses a dirty tree, which covers 37% of the real ledger', () => {
    const out = renderDetail(matrixOf([series({ ...clean(), dirty: true })])).join('\n');
    expect(out).toMatch(/integrity\s+⚠ 1 of 1 series taken on a dirty tree/);
  });

  it('discloses a build nobody attributed to a checkout', () => {
    // The WEAKER claim beside a dirty tree: not "the commit is incomplete" but "the
    // commit may describe code that never ran".
    const out = renderDetail(
      matrixOf([
        series({
          ...clean(),
          provenance: { ...series().provenance, checkout: { deployedFromCheckout: false } },
        }),
      ]),
    ).join('\n');
    expect(out).toMatch(/nobody attributed to a checkout/);
  });

  it('accepts a build a caller vouched for with --deployed-by', () => {
    // `measure-calibration` deploys and then runs, so `deployedFromCheckout` is false on
    // 75 real records that ARE attributable. Treating those as unattributed would make
    // the warning fire on most of the ledger and be ignored.
    const out = renderDetail(
      matrixOf([
        series({
          ...clean(),
          provenance: {
            ...series().provenance,
            checkout: { deployedFromCheckout: false, deployedBy: 'measure-calibration' },
          },
        }),
      ]),
    ).join('\n');
    expect(out).not.toMatch(/nobody attributed/);
  });

  it('discloses a server that was never asserted', () => {
    const out = renderDetail(
      matrixOf([series({ ...clean(), tier1: { asserted: false, ok: true } })]),
    ).join('\n');
    expect(out).toMatch(/never asserted its server/);
  });

  it('says nothing when every series is clean', () => {
    expect(renderDetail(matrixOf([series(clean())])).join('\n')).not.toMatch(/integrity/);
  });

  it('uses the SAME predicates measure:compare uses', () => {
    // The whole point of sharing them. If this drifts, one reader discloses and the
    // other averages silently — which is what shipped before.
    const dirty = [series({ ...clean(), dirty: true })];
    const cell = cellAt(matrixOf(dirty), 'settings', '1GB');
    expect(cell.integrity.map((f) => f.key)).toEqual(
      seriesIntegrity(cell.provenance ? dirty : []).map((f) => f.key),
    );
  });
});

describe('the sample floor — n is visible, what it must be read against was not', () => {
  it('warns that a median below n≥5 is not yet evidence', () => {
    // 6 of the 9 cells the real report publishes are below this floor, including a
    // ONE-sample median. Printing it unqualified invites a comparison it cannot support.
    const one = [series({ samples: [sample(60)] })];
    expect(renderDetail(matrixOf(one)).join('\n')).toMatch(
      /samples\s+⚠ n=1, below the method's floor of n≥5 — this median is not yet evidence/,
    );
  });

  it('states the resolution point for a cell above the floor but below n=30', () => {
    const six = [series({ samples: Array.from({ length: 6 }, (_, i) => sample(60 + i)) })];
    const out = renderDetail(matrixOf(six)).join('\n');
    expect(out).toMatch(/samples\s+n=6; ~120 ms resolution is measured at n=30/);
    expect(out).not.toMatch(/not yet evidence/);
  });

  it('takes the floor from the shared constant, not a retyped number', () => {
    expect(METHOD_FLOOR).toEqual({ minSamples: 5, resolvingN: 30, resolvesMs: 120 });
  });
});

describe('a workload headline earns a row of its own', () => {
  it('gives the headline field a median row and the ← marker', () => {
    // `--field items` headlines a workload count, which lives in `sample.workload` rather
    // than `sample.timings` — so the grid published `28 ×5` while the detail block showed
    // no row for it and marked nothing. The workload line tallies per-sample VALUES; it
    // never states the median or the range.
    // `fills` is a workload field the `screen-load` family actually DECLARES. That is what
    // makes `unitFor` drop the unit: only the family knows a count from a duration, so a
    // key it does not list still reads as milliseconds.
    const recs = [
      series({
        samples: [sample(60, { workload: { fills: 3 } }), sample(70, { workload: { fills: 5 } })],
      }),
    ];
    const out = renderDetail(matrixOf(recs, { field: 'fills' })).join('\n');
    expect(out).toMatch(/fills\s+median 4 {2}×2 {2}range 3–5 ←/);
    // No unit on a count.
    expect(out).not.toMatch(/fills\s+median 4 ms/);
  });

  it('drops a headline field no sample in this cell carried', () => {
    // n=0 would render `median — ×0`, which reads as a milestone the app failed to reach.
    const cell = cellAt(matrixOf([series()], { field: 'nothingCarriesThis' }), 'settings', '1GB');
    expect(cell.fields.map((f) => f.key)).not.toContain('nothingCarriesThis');
  });
});

describe('one table per family', () => {
  it('lists the families present in registry order, unknown ones last', () => {
    const records = [
      series({ measurement: 'screen-load' }),
      series({ measurement: 'home-latest-rows' }),
      series({ measurement: 'zzz-experimental' }),
    ];
    expect(familiesIn(records)).toEqual(['home-latest-rows', 'screen-load', 'zzz-experimental']);
  });

  it('never lets one table span two families', () => {
    const matrix = matrixOf([
      series(),
      series({ measurement: 'home-latest-rows', primary: 'totalMs' }),
    ]);
    expect(
      matrix.rows
        .flatMap((r) => r.cells)
        .every((c) => !c.mixed.some((m) => m.key === 'measurement')),
    ).toBe(true);
    expect(cellAt(matrix, 'settings', '1GB').n).toBe(2);
  });
});

describe('two devices of one RAM tier are a refusal, not a pooled column', () => {
  // CHOSEN, not inherited. `model` and `tier` both arrived in `POPULATION_AXES` when the
  // axes were extracted out of `comparability()`, and for the paired comparison that was
  // obviously right. For a table whose COLUMNS are tiers it is a real decision, because
  // it means the tier axis cannot pool the thing it is named after: a RAM tier is a
  // memory label, not a hardware class — a 1 GB Express 4K and a 1 GB Stick 4K differ in
  // SoC — and this project's own 512 MB result is a +130.5 ms inversion with no
  // established mechanism, which is the evidence that sub-tier differences are not
  // understood well enough to average across.
  //
  // The failure modes decide it: a refusal is recoverable with `--select model=`, and a
  // wrong median is not recoverable at all.
  //
  // It has never fired — the ledger is one model per tier — so this test is the only
  // thing standing between the decision and a future reader "simplifying" it away.
  const twoModelsOneTier = [
    series(),
    series({
      provenance: {
        ...series().provenance,
        device: { model: 'Express 4K+', modelNumber: '3941X', ramTier: '1GB' },
      },
    }),
  ];

  it('refuses rather than averaging across two models of one tier', () => {
    const matrix = matrixOf(twoModelsOneTier);
    const cell = cellAt(matrix, 'settings', '1GB');
    expect(cell.mixed.map((m) => m.key)).toContain('model');
    expect(cellText(cell)).toBe('mixed');
  });

  it('names the selector that recovers it, since model IS a selection key', () => {
    expect(renderGaps(matrixOf(twoModelsOneTier)).join('\n')).toMatch(
      /narrow it: --select .*model=<value>/,
    );
  });

  it('still pools two series from ONE model, which is the ordinary case', () => {
    const cell = cellAt(matrixOf([series(), series()]), 'settings', '1GB');
    expect(cell.mixed).toEqual([]);
    expect(cell.n).toBe(4);
  });
});

describe('the cell IS an arm', () => {
  it('reuses `mixedPopulations` rather than re-deciding what counts as mixed', () => {
    const records = [
      series(),
      series({ provenance: { ...series().provenance, enableRta: false } }),
    ];
    const cell = buildCell(
      records,
      { measurement: 'screen-load', screen: 'settings', tier: '1GB' },
      'paintMs',
    );
    const arm = buildArm(
      'x',
      records,
      { measurement: 'screen-load', screen: 'settings' },
      'paintMs',
    );
    expect(cell.mixed.map((m) => m.key)).toEqual(mixedPopulations(arm).map((m) => m.key));
  });
});

describe('provenance — the axes a cell POOLS instead of refusing', () => {
  // The counterpart to the refusal set, and the distinction is the design: pooling on a
  // `POPULATION_AXES` entry changes what the number says ABOUT THE APP and is refused;
  // pooling on one of these changes only WHICH BUILD of the app it is about, and that is
  // the axis this reader exists to span — refusing it would refuse nearly every cell.
  //
  // What is not an option is silence, which is what shipped before this: on the real
  // ledger `search · 1GB` publishes a 14-sample median where five of its seven series
  // record no commit, no device and no `startedAt` at all.
  const twoCommits = [
    series({ commit: 'aaa1111', deviceKey: 'dev-a' }),
    series({ commit: 'bbb2222', deviceKey: 'dev-b' }),
  ];

  it('covers the axes that move a number and are NOT refused', () => {
    expect(PROVENANCE_AXES.map((a) => a.key)).toEqual([
      'commit',
      'device',
      'arm',
      'appVersion',
      'os',
    ]);
  });

  it('states one line and no warning when the cell is a single population', () => {
    const out = renderDetail(matrixOf([series()])).join('\n');
    expect(out).toMatch(/provenance\s+1 series, 2026-08-13 · commit abc1234 · device dev-a/);
    expect(out).not.toMatch(/pooled into this median/);
  });

  it('breaks a pooled axis out with a TALLY, not a count', () => {
    // "2 commits" is not actionable; which commits and how many samples each is.
    const out = renderDetail(matrixOf(twoCommits)).join('\n');
    expect(out).toMatch(/⚠ 2 commits pooled into this median: aaa1111 ×1 · bbb2222 ×1/);
    expect(out).toMatch(/⚠ 2 devices pooled into this median: dev-a ×1 · dev-b ×1/);
    expect(out).toMatch(/narrow it: --select commit=<sha>,device=<key>/);
  });

  it('treats a missing value as `(unrecorded)` rather than folding it in silently', () => {
    // The ledger's oldest series predate `commit` entirely. Counting them as an absent
    // value would report "1 commit" for a median that is mostly of unknown provenance.
    const out = renderDetail(matrixOf([series({ commit: 'aaa1111' }), series({ commit: null })]));
    expect(out.join('\n')).toMatch(/2 commits pooled into this median: .*\(unrecorded\) ×1/);
  });

  it('never dates a whole cell off the subset of series that carry a date', () => {
    // The series with no `commit` have no `startedAt` either, so a plain range would
    // report both series as one afternoon.
    const p = provenanceOf([
      { startedAt: '2026-08-14T10:00:00.000Z' },
      { startedAt: null },
      { startedAt: null },
    ]);
    expect(p.series).toBe(3);
    expect(p.dated).toBe(1);
    expect(renderDetail(matrixOf([series(), series({ startedAt: null })])).join('\n')).toMatch(
      /2 series, 1 of them dated 2026-08-13/,
    );
  });

  it('says so plainly when no series carries a date at all', () => {
    const out = renderDetail(matrixOf([series({ startedAt: null })])).join('\n');
    expect(out).toMatch(/1 series, none carrying a date/);
    expect(out).not.toMatch(/dated null|→null/);
  });

  it('describes the series that fed the median, not every record the selector saw', () => {
    // A blocked series is excluded from the arm, so it must not appear in the tally that
    // says where the published number came from — `yield` is the line that owns dropouts.
    const out = renderDetail(
      matrixOf([series({ commit: 'aaa1111' }), series({ commit: 'ccc3333', outcome: 'blocked' })]),
    ).join('\n');
    expect(out).toMatch(/provenance\s+1 series/);
    expect(out).not.toMatch(/ccc3333/);
  });

  it('is not printed for a cell the report refused to average', () => {
    const mixed = [series({ component: 'itemDetails' }), series({ component: 'videoPlayer' })];
    expect(renderDetail(matrixOf(mixed)).join('\n')).not.toMatch(/provenance/);
  });
});

describe('a unit is a claim, and a count has none', () => {
  it('does not call a workload field milliseconds', () => {
    // `unitFor` derives `ms` from a name suffix, which is right for a duration and wrong
    // for a count — `--field items` headlined an item count as `median 28 ms`. Only the
    // family can say which a field is, so the report hands it over.
    const matrix = matrixOf([series()], { measurement: 'item-grid' });
    expect(matrix.unit).toBe('ms');
    const counts = buildMatrix([], { measurement: 'item-grid', field: 'items' });
    expect(counts.unit).toBe('');
  });

  it('omits the empty parenthesis rather than printing `items ()`', () => {
    const heading = renderMatrix(
      buildMatrix([series({ measurement: 'item-grid', primary: 'items' })], {
        measurement: 'item-grid',
        registryScreens: REGISTRY,
        field: 'items',
      }),
    ).join('\n');
    expect(heading).toMatch(/headline items ·/);
    expect(heading).not.toMatch(/items \(\)/);
  });
});

describe('a selection that matched nothing', () => {
  it('refuses to render a grid rather than printing blank columns beside every screen', () => {
    // Thirty screen names beside an empty column reads as "nothing has been measured
    // anywhere", which is a finding. It is really a selector that matched no series.
    const matrix = matrixOf([series()], { select: { arm: 'nope' } });
    expect(isEmpty(matrix)).toBe(true);
    const out = renderMatrix(matrix).join('\n');
    expect(out).toMatch(/no series matched/);
    expect(out).not.toMatch(/settings/);
  });

  it('still renders the grid when the matrix is genuinely all gaps', () => {
    // The opposite case, and it must NOT be refused: series exist, every registry screen
    // is simply unmeasured. That is a successful report about an empty matrix.
    const matrix = matrixOf([series({ screen: 'settings' })]);
    expect(isEmpty(matrix)).toBe(false);
    expect(renderMatrix(matrix).join('\n')).toMatch(/home\s+—/);
  });
});

describe('the command line', () => {
  it('refuses an unknown flag rather than ignoring it', () => {
    expect(() => parseReportArgs(['--nope', 'x'])).toThrow(MeasureArgError);
  });

  it('refuses an unknown measurement family by name', () => {
    expect(() => parseReportArgs(['--measurement', 'not-a-family'])).toThrow(/unknown measurement/);
  });

  it('accepts `measurement` inside --select and folds it into the family', () => {
    const args = parseReportArgs(['--select', 'measurement=screen-load,arm=rta']);
    expect(args.measurement).toBe('screen-load');
    // Removed from the selector so it cannot be applied twice.
    expect(args.select).toEqual({ arm: 'rta' });
  });

  it('refuses a --select measurement that contradicts --measurement', () => {
    expect(() =>
      parseReportArgs(['--measurement', 'screen-load', '--select', 'measurement=item-grid']),
    ).toThrow(/contradicts/);
  });

  it('refuses a selector key that does not exist, through the shared grammar', () => {
    expect(() => parseReportArgs(['--select', 'nonsense=1'])).toThrow(MeasureArgError);
  });

  it('refuses an unknown --field rather than blaming the app for a typo', () => {
    // The worst of the three unvalidated-flag failures, because it does not merely drop
    // the flag: an unknown field resolves on no sample, so every cell holding series
    // renders `0 cold` and the gaps block asserts they "were measured and yielded no
    // usable number — that is a fact about the app or the run". A typo produced a
    // confident, exit-0 report blaming the app for the operator's slip.
    expect(() => parseReportArgs(['--field', 'paintMsTypo'])).toThrow(/unknown field/);
    expect(() => parseReportArgs(['--measurement', 'item-grid', '--field', 'paintMs'])).toThrow(
      /unknown field/,
    );
  });

  it('validates --field against what the registry DECLARES, not what the ledger holds', () => {
    // `declaredFields`' own contract: a family that declares `instrumentUs` and has never
    // observed one must still be reportable as absent. Validating against observed fields
    // would turn "never emitted" into "no such field".
    expect(() =>
      parseReportArgs(['--measurement', 'screen-load', '--field', 'instrumentUs']),
    ).not.toThrow();
  });

  it('validates --field after --select measurement has decided the family', () => {
    // Order matters: `--select measurement=item-grid` is what makes `items` valid.
    expect(() =>
      parseReportArgs(['--select', 'measurement=item-grid', '--field', 'items']),
    ).not.toThrow();
    expect(() =>
      parseReportArgs(['--select', 'measurement=screen-load', '--field', 'items']),
    ).toThrow(/unknown field/);
  });
});
