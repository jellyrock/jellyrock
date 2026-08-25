/**
 * THE MATRIX REPORT — every screen, every RAM tier, workload beside timing.
 *
 *   npm run measure:report                                 the whole ledger
 *   npm run measure:report -- --measurement screen-load    one family
 *   npm run measure:report -- --select arm=rta             one population
 *   npm run measure:report -- --field settledMs            headline a second milestone
 *
 * ## Why a READER over the ledger, and not a report from the run
 *
 * Decided 2026-08-16 — [`matrix-report-is-a-reader`](../docs/decisions.md). A reader can
 * rebuild the matrix from runs taken weeks apart, on devices that were never on the LAN at
 * the same time, because every `measure` invocation appends its own line to
 * `measurements.jsonl`. An in-process report can only ever describe the run that just
 * finished, and no matrix has ever been taken in one run. The consequence is load-bearing
 * for the rest of the subsystem: `measure.js`'s record assembly did NOT have to be
 * extracted for this.
 *
 * Same shape as `flake-baseline.js` — the ledger's other reader — for the same reason,
 * and this one inherits the rule that file was written to enforce: **the exclusions are
 * output, never a silent `filter`.** A matrix is mostly empty cells, so "no number here"
 * has to be able to say WHICH kind of nothing it is.
 *
 * ## The three kinds of nothing, which a table must not blur
 *
 * The Charter asks that "a screen that emits no timing is reported as unmeasurable,
 * never silently averaged and never quietly absent from a report", and there turn out
 * to be three distinguishable states behind one empty cell:
 *
 * - **`—` never measured.** No series in the ledger for that screen on that tier. The
 *   ordinary state of a matrix that is being filled in, and the reason the rows come
 *   from `tests/rta/screens.js` rather than from the ledger: a screen nobody has
 *   measured is exactly the screen that would be missing from a ledger-derived table,
 *   which is the one place a gap must not be able to hide.
 * - **`mixed` un-poolable.** Series exist, but they are more than one population — two
 *   components under one screen name, an RTA build beside a non-RTA one, two servers,
 *   two device models of one RAM tier. A median over those is a well-formed number about
 *   two experiments, so the cell prints what it mixes and the selector that separates
 *   them instead. Which axes those are, and why `commit` is deliberately NOT one of
 *   them, is `PROVENANCE_AXES` below.
 * - **`0 cold` measured and empty.** Series exist and every one of them was refused,
 *   crashed, or produced no cold sample. That is a fact about the app or the run, and
 *   it reads completely differently from "nobody has tried".
 *
 * ## Every figure here comes out of the same machinery `measure:compare` uses
 *
 * Not by convention — by construction. A cell IS an arm: `buildArm` selects it,
 * `mixedPopulations` decides whether it is one population, `summarizeValues` takes the
 * median, `workloadTally` counts the workloads. Nothing in this file computes a
 * statistic of its own.
 *
 * That is deliberate and it is the project's most expensive lesson. A published
 * `+136 ms` in the plan came from an ad-hoc script that took `sorted(...)[len // 2]` —
 * the upper of two middle values, not a median — and it sat in a table beside a figure
 * that HAD come from `measure:compare`, both plausible, neither checkable by eye. The
 * true value was `+153`. A matrix report is nothing but published figures, so the only
 * safe design is one where a second implementation of "median" does not exist to drift.
 *
 * ## It reports; it does not judge
 *
 * Same contract as `measure.js` and `measure:compare`, and for the same reason: the
 * numbers depend on server hardware, library size and network. The exit code says
 * whether a MATRIX COULD BE BUILT, never what it showed.
 */
import fs from 'node:fs';
import path from 'node:path';

import { measurementsLedgerPath, readJsonLines } from './run-record.js';
import { compareRamTiers } from './roku-devices.js';
import { MeasureArgError } from './measure-args.js';
import {
  buildArm,
  coldSamples,
  describeExclusions,
  describeIntegrity,
  describeMixed,
  METHOD_FLOOR,
  mixedPopulations,
  parseSelector,
  selectSeries,
  seriesIntegrity,
  SERIES_KEYS,
  summarizeValues,
  workloadTally,
} from './measure-compare.js';
import {
  fieldsByKind,
  MEASUREMENTS,
  measurementById,
  measurementIds,
  unitFor,
  withUnit,
} from './measurements.js';

/** The ledger, through the module that owns the run kinds. Never a second derivation. */
export const MEASUREMENTS_LEDGER = measurementsLedgerPath();

/**
 * The bucket a record with no recorded value falls into.
 *
 * The empty string rather than `null` because that is what `selectSeries` compares
 * against — it stringifies both sides, so `{screen: ''}` selects exactly the records
 * whose screen is null or absent. A row for them is not a nicety: the ledger's two
 * oldest families predate the field, and dropping them would quietly shrink the only
 * copy of every number this project has taken.
 */
export const UNRECORDED = '';

/** How a selection value reads in a heading. Mirrors `measure-compare.js`'s `show`. */
export const label = (value) =>
  value === UNRECORDED || value == null ? '(unrecorded)' : String(value);

/**
 * Which measurement families the selected records actually contain, registry order.
 *
 * Registry order rather than ledger order so two runs of the report over a growing
 * ledger print their tables in the same sequence; a family the registry does not know
 * is still listed (at the end), because an unrecognised family in the ledger is a fact
 * about the ledger and not something a reader may drop.
 */
export function familiesIn(records) {
  const present = new Set(records.map((r) => SERIES_KEYS.measurement(r) ?? UNRECORDED));
  const known = measurementIds().filter((id) => present.has(id));
  const rest = [...present].filter((id) => !known.includes(id)).sort();
  return [...known, ...rest];
}

/**
 * The axes a cell POOLS rather than refuses — disclosed beside the number, never a gate.
 *
 * `POPULATION_AXES` is the refusal set: pooling on one of those changes what the number
 * means ABOUT THE APP — a different screen, a different silicon, a different build flag.
 * These are the other kind. Pooling on one of these changes WHICH VERSION of the app the
 * number is about, and that axis is precisely the one this reader exists to span: the
 * 2026-08-16 decision was that a matrix is rebuilt from runs taken weeks apart, so
 * refusing a cell that spans two commits would refuse nearly every cell and negate the
 * design.
 *
 * So the rule for the next person adding an axis is which side it lands on, not whether
 * it matters: **does pooling change what the number says about the app, or only about
 * which build of it?** The first is a refusal in `POPULATION_AXES`; the second is a line
 * here. Silence is not one of the options — `search · 1GB` publishes a 14-sample median
 * of which ten samples come from series recording no commit at all, and until this line
 * existed the report said nothing about it.
 *
 * `device` earns its place from the refusal set rather than despite it: `model` IS
 * refused, so two DIFFERENT physical devices of one model agree on every refusal axis
 * and pool silently. `deviceKey` is the only field that separates them.
 */
export const PROVENANCE_AXES = Object.freeze([
  { key: 'commit', what: 'commit', hint: '<sha>' },
  { key: 'device', what: 'device', hint: '<key>' },
  { key: 'arm', what: 'arm', hint: '<label>' },
  { key: 'appVersion', what: 'appVersion', hint: '<version>' },
  { key: 'os', what: 'os', hint: '<version>' },
]);

/**
 * What a cell's series say about themselves, per axis, commonest value first.
 *
 * A tally rather than a count, because "7 commits" is not actionable and
 * `8b95eb99 ×2 · (unrecorded) ×5` is — it says at a glance that most of the median came
 * from series whose code version nobody recorded. `(unrecorded)` is a VALUE here for the
 * same reason it is one everywhere else in this subsystem: a field that predates a
 * record is a real state, and folding it in silently is the laundering this project
 * keeps removing.
 */
export function provenanceOf(series) {
  const axes = PROVENANCE_AXES.map((axis) => {
    const counts = new Map();
    for (const r of series) {
      const v = SERIES_KEYS[axis.key](r) ?? null;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return {
      ...axis,
      values: [...counts].sort((x, y) => y[1] - x[1]),
      pooled: counts.size > 1,
    };
  });
  // Dated SEPARATELY from the axes because it is a fact about the tally itself: the
  // legacy series that record no commit record no `startedAt` either, so a range taken
  // over what is present would report seven series as one afternoon.
  const dates = series
    .map((r) => r.startedAt)
    .filter(Boolean)
    .sort();
  return {
    series: series.length,
    dated: dates.length,
    from: dates.length ? String(dates[0]).slice(0, 10) : null,
    to: dates.length ? String(dates[dates.length - 1]).slice(0, 10) : null,
    axes,
    pooled: axes.filter((a) => a.pooled),
  };
}

/**
 * One cell: the arm at (screen, tier), and the verdict on whether it is one population.
 *
 * `fields` carries EVERY timing the cell's samples recorded, not just the headline one.
 * That is the Charter's "every measurement declares which readiness moment it means"
 * made visible: `screen-load` records a paint AND a settle, and a table that showed only
 * the paint would be the single number that hides the second async fill — the exact
 * failure the milestone split exists to prevent.
 */
export function buildCell(records, selector, field) {
  // The family, so a workload-valued field reads as a count rather than as `ms`.
  const family = measurementById(selector.measurement);
  const arm = buildArm(
    `${label(selector.screen)} · ${label(selector.tier)}`,
    records,
    selector,
    field,
  );
  const mixed = arm.series.length ? mixedPopulations(arm) : [];

  const timingKeys = [
    ...new Set(
      arm.series.flatMap((r) => coldSamples(r).flatMap((s) => Object.keys(s.timings || {}))),
    ),
  ];
  // The HEADLINE field earns a row even when it is not a timing. `--field items` headlines
  // a workload count, which lives in `sample.workload` rather than `sample.timings` — so
  // the grid published `28 ×5` while the detail block listed only durations, showing no
  // row for the number the table was built around and marking nothing with `←`. The
  // workload line tallies per-sample VALUES; it never states the median or its range.
  const detailKeys = field && !timingKeys.includes(field) ? [...timingKeys, field] : timingKeys;
  // Through `buildArm` per field rather than by reaching into the samples here, so every
  // number in the detail block is selected by the same rule as the headline one.
  const fields = detailKeys
    .map((key) => {
      const summary = summarizeValues(buildArm(arm.label, records, selector, key).values);
      // A duration cannot be negative, so a negative value is a SENTINEL rather than a
      // timing — `item-grid` initialises `firstPaintMs` to -1 and only assigns it on the
      // genre-skeleton path, so a plain grid load (`genreFetches: 0`) reports -1 five times
      // out of five. Publishing that as `median -1 ms` beside real medians is precisely the
      // well-formed-but-wrong figure this subsystem refuses; it is flagged rather than
      // dropped, because "the app never reached this milestone" is itself the finding.
      return {
        key,
        unit: unitFor(key, family),
        sentinel: summary.median !== null && summary.median < 0,
        ...summary,
      };
      // A headline field no sample in THIS cell carried resolves to n=0. Dropped rather
      // than printed as `median — ×0`, which would read as a milestone the app failed to
      // reach; the cell's own `—` already says nothing was measured here.
    })
    .filter((f) => f.n > 0);

  return {
    selector,
    label: arm.label,
    screen: selector.screen,
    tier: selector.tier,
    series: arm.series.length,
    // The records that matched this cell and produced NOTHING usable. Taken from
    // `buildArm`'s own exclusions, which count only among records the selector matched —
    // so these are per-cell numbers, not the ledger-wide `notSelected`.
    //
    // Carried because without them a cell cannot tell its two emptiest states apart.
    // `settings` on 1GB has thirteen PASSED series in the ledger that yielded zero cold
    // samples, and `selectSeries` drops them before `arm.series`; a cell reading only
    // `series.length` therefore printed "never measured" for a screen that had been
    // measured thirteen times and emitted nothing. That is the Charter's unmeasurable
    // screen going quietly absent from the report that exists to name it.
    blocked: arm.excluded.notASample,
    noCold: arm.excluded.noColdSamples,
    nonSampleOutcomes: arm.nonSampleOutcomes,
    mixed,
    workloads: workloadTally(arm),
    // What the surviving series are, for the axes this reader pools instead of refusing.
    // Taken from `arm.series` — the ones that actually fed the median, not every record
    // the selector matched.
    provenance: provenanceOf(arm.series),
    // Facts about the SERIES that weaken what this cell's median can claim — a dirty
    // tree, a build nobody attributed, a server never asserted. Shared with
    // `measure:compare` so the two readers cannot disagree about when one fires; on the
    // real ledger a dirty tree covers 37% of records and the report said nothing.
    integrity: seriesIntegrity(arm.series),
    field,
    unit: unitFor(field, family),
    fields,
    ...summarizeValues(arm.values),
  };
}

/**
 * The matrix for ONE measurement family.
 *
 * One family per table is not a presentation choice — `measurement` is a refusal axis in
 * `POPULATION_AXES`, so a table spanning two families would be pooling populations in
 * exactly the way a cell is forbidden to. The families also headline different fields
 * (`totalMs`, `taskMs`, `paintMs`), and a column of numbers that are not the same
 * quantity is the well-formed-but-wrong shape this subsystem exists to refuse.
 *
 * @param records every line read from the ledger.
 * @param options.measurement the family id this table is about.
 * @param options.registryScreens screen names from `tests/rta/screens.js`, in registry
 *   order. Passed in rather than imported for the reason `measure-args.js` gives: that
 *   module pulls the whole nav/ODC stack into what is otherwise a pure reader.
 * @param options.select an extra selector applied to every cell (`arm=rta`, `commit=…`).
 * @param options.field the timing to headline, instead of the family's primary.
 */
export function buildMatrix(
  records,
  { measurement, registryScreens = [], select = {}, field } = {},
) {
  const family = measurementById(measurement);
  const base = { ...select, measurement };
  const inFamily = records.filter((r) =>
    Object.entries(base).every((e) => String(SERIES_KEYS[e[0]](r) ?? '') === String(e[1])),
  );

  // Resolved ONCE for the whole table. Left to `buildArm`'s per-arm fallback it would be
  // read off whichever series each cell happened to select first, so two cells in one
  // column could headline different quantities under one heading.
  const primary = field || family?.primary || inFamily[0]?.primary || null;

  // Registry screens ALWAYS appear, measured or not — that is the whole point of taking
  // the rows from the registry. Ledger screens the registry does not know are appended
  // rather than dropped: `--screen` is free text, and a name nobody can place is still a
  // population somebody recorded.
  const fromLedger = [...new Set(inFamily.map((r) => SERIES_KEYS.screen(r) ?? UNRECORDED))];
  const screens = [
    ...registryScreens,
    ...fromLedger.filter((s) => !registryScreens.includes(s)).sort(),
  ];
  const tiers = [...new Set(inFamily.map((r) => SERIES_KEYS.tier(r) ?? UNRECORDED))].sort(
    compareRamTiers,
  );

  const rows = screens.map((screen) => ({
    screen,
    inRegistry: registryScreens.includes(screen),
    cells: tiers.map((tier) => buildCell(records, { ...base, screen, tier }, primary)),
  }));

  // Family-level accounting, taken in ONE pass rather than summed over the cells: a cell
  // counts every record outside it as `notSelected`, so adding those up would report
  // eighty-odd times the size of the ledger.
  const accounting = selectSeries(records, base);

  return {
    measurement,
    title: family?.title ?? null,
    primary,
    unit: unitFor(primary, family),
    select,
    tiers,
    rows,
    accounting,
    // Cells this report will actually PRINT a number for, so the caller can say
    // "6 of 87" without re-walking. A mixed cell has samples and
    // is deliberately not one of them, so counting it here would advertise coverage the
    // table does not have.
    measuredCells: rows.flatMap((r) => r.cells).filter((c) => c.n > 0 && !c.mixed.length).length,
    totalCells: rows.length * tiers.length,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** Pad to a column width, never truncating: a clipped screen name is a different screen. */
const pad = (text, width, align = 'left') => {
  const s = String(text);
  const fill = ' '.repeat(Math.max(0, width - s.length));
  return align === 'right' ? fill + s : s + fill;
};

/** A number as a table prints it — no decimals a device cannot resolve. */
const round = (v) => (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '—');

/**
 * What ONE cell says in the grid. The three kinds of nothing are three different
 * strings, and none of them is a blank.
 */
export function cellText(cell) {
  if (cell.mixed.length) return 'mixed';
  // Same rule as the detail block: a negative median is a sentinel the app never assigned,
  // and a grid cell is the LEAST recoverable place to print one — it has no room to say so.
  if (cell.n && cell.median < 0) return 'sentinel';
  if (cell.n) return `${round(cell.median)} ×${cell.n}`;
  if (cell.series || cell.blocked || cell.noCold) return '0 cold';
  return '—';
}

/** The grid: screens down, RAM tiers across, the headline timing in the cells. */
export function renderGrid(matrix) {
  // `†` marks a screen the registry does not know, so the two kinds of row stay
  // distinguishable at a glance without a second table.
  const rowName = (row) => (row.inRegistry ? row.screen : `${label(row.screen)} †`);
  const nameWidth = Math.max(6, ...matrix.rows.map((r) => rowName(r).length));
  const cols = matrix.tiers.map((tier, i) =>
    Math.max(label(tier).length, ...matrix.rows.map((r) => cellText(r.cells[i]).length)),
  );

  const head = `  ${pad('screen', nameWidth)}  ${matrix.tiers
    .map((t, i) => pad(label(t), cols[i], 'right'))
    .join('  ')}`;
  const lines = [head, `  ${'─'.repeat(head.length - 2)}`];
  for (const row of matrix.rows) {
    lines.push(
      `  ${pad(rowName(row), nameWidth)}  ${row.cells
        .map((c, i) => pad(cellText(c), cols[i], 'right'))
        .join('  ')}`,
    );
  }
  return lines;
}

/**
 * The detail: every measured cell, with its workload BESIDE its timing and every
 * milestone the samples carried rather than only the headline one.
 *
 * A separate view from the grid rather than a wider grid, because a workload string is
 * unbounded (`contentFills=3 fills=6 textureFills=3`) and the only way to fit one in a
 * column is to truncate it — and a truncated workload is precisely the silent claim
 * that two arms did the same work, which is the thing tier 3 was built to stop anyone
 * having to take on trust.
 */
export function renderDetail(matrix) {
  const lines = [];
  for (const row of matrix.rows) {
    for (const cell of row.cells) {
      // A MIXED cell is skipped here, not just marked in the grid. It has an `n` and a
      // median like any other, and printing them under a heading naming one screen is
      // precisely the well-formed figure about two experiments that the grid just
      // refused — the refusal has to hold in every view or it is decoration.
      if (!cell.n || cell.mixed.length) continue;
      lines.push(`  ${cell.label}`);
      // The fixed labels below are part of this column too — a cell whose field names are
      // all short (`items`, `taskMs`) left `provenance` and `integrity` hanging one
      // character past every other row.
      const keyWidth = Math.max(
        ...DETAIL_LABELS.map((l) => l.length),
        ...cell.fields.map((f) => f.key.length),
      );
      for (const f of cell.fields) {
        const headline = f.key === matrix.primary ? ' ←' : '';
        if (f.sentinel) {
          lines.push(
            `    ${pad(f.key, keyWidth)}  not reached — ${round(f.median)} is a sentinel, not a ` +
              `duration  ×${f.n}${headline}`,
          );
          continue;
        }
        lines.push(
          `    ${pad(f.key, keyWidth)}  median ${withUnit(f.median, f.unit)}  ×${f.n}  ` +
            `range ${round(f.min)}–${round(f.max)}${headline}`,
        );
      }
      const workloads = cell.workloads.map(([w, n]) => `${w} ×${n}`).join(' · ');
      lines.push(
        `    ${pad('workload', keyWidth)}  ${workloads || '(none recorded)'}` +
          (cell.workloads.length > 1
            ? `   ⚠ ${cell.workloads.length} distinct workloads — the samples did not all do the same work`
            : ''),
      );
      for (const line of provenanceLines(cell.provenance, keyWidth)) lines.push(line);
      // What this cell's number was taken OUT of. A cell can publish a median and still
      // have dropped most of its series — `settings` on 1GB carries four usable samples
      // from nineteen candidate series — and `flake-baseline.js` names that failure
      // exactly: a median over what survived reads identically to a median over what was
      // taken. The yield goes beside the number, not in a footnote.
      if (cell.blocked || cell.noCold) {
        lines.push(
          `    ${pad('yield', keyWidth)}  ${cell.series} of ` +
            `${cell.series + cell.blocked + cell.noCold} series usable — ` +
            [
              cell.noCold ? `${cell.noCold} produced no cold sample` : null,
              cell.blocked ? `${cell.blocked} not a sample` : null,
            ]
              .filter(Boolean)
              .join(', '),
        );
      }
      for (const line of integrityLines(cell, keyWidth)) lines.push(line);
      lines.push('');
    }
  }
  return lines;
}

/** The fixed row labels in a detail block, so the key column is wide enough for them. */
const DETAIL_LABELS = Object.freeze(['workload', 'provenance', 'samples', 'integrity', 'yield']);

/**
 * What weakens this cell's median, beside the number rather than in a footnote.
 *
 * Two different kinds of caveat, deliberately printed together because a reader weighing
 * a number needs both at once:
 *
 * - **The sample floor.** `n` is already visible, but the number it has to be read
 *   against is not: the recorded method wants n≥5 and only resolves ~120 ms at n=30 per
 *   arm. Six of the nine cells this report currently publishes sit below that floor, and
 *   `movieDetails · 1GB` publishes a median of ONE sample. A matrix that prints a
 *   one-sample median without saying so invites exactly the comparison it cannot support.
 * - **Series integrity.** A dirty tree, a build nobody attributed to a checkout, a server
 *   never asserted. `measure:compare` has warned about most of these since it existed and
 *   the report warned about none, so the same series could be disclosed by one reader and
 *   silently averaged by the other.
 *
 * Never a refusal. Every one of these describes a number that is still the best evidence
 * available — the failure mode is publishing it as though it were unqualified.
 */
export function integrityLines(cell, keyWidth) {
  const lines = [];
  if (cell.n < METHOD_FLOOR.minSamples) {
    lines.push(
      `    ${pad('samples', keyWidth)}  ⚠ n=${cell.n}, below the method's floor of ` +
        `n≥${METHOD_FLOOR.minSamples} — this median is not yet evidence`,
    );
  } else if (cell.n < METHOD_FLOOR.resolvingN) {
    lines.push(
      `    ${pad('samples', keyWidth)}  n=${cell.n}; ~${METHOD_FLOOR.resolvesMs} ms resolution ` +
        `is measured at n=${METHOD_FLOOR.resolvingN}, so smaller differences cannot be called`,
    );
  }
  for (const fact of cell.integrity) {
    lines.push(`    ${pad('integrity', keyWidth)}  ⚠ ${describeIntegrity(fact, cell.series)}`);
  }
  return lines;
}

/**
 * WHICH runs this cell's median came out of, for the axes the report pools.
 *
 * One line when the cell is a single population on every axis — the ordinary case, and
 * it must stay cheap or it will not be read. The pooled axes break out onto their own
 * line with a tally and the selector that separates them, because that is the case worth
 * a reader's attention and `⚠ pooled` in a run of single values would not survive one.
 *
 * `n dated` is stated whenever it is not the whole cell, and that is not pedantry: the
 * legacy series that record no commit record no `startedAt` either, so `7 series,
 * 2026-08-14` would date seven series off two of them.
 */
export function provenanceLines(p, keyWidth) {
  if (!p || !p.series) return [];
  const indent = ' '.repeat(4 + keyWidth + 2);
  // Three distinct states, and the middle one is the reason this is not a plain range:
  // a cell whose dates come from two of its seven series must not print those two dates
  // as if they bounded all seven.
  const span = p.from === p.to ? p.from : `${p.from}→${p.to}`;
  const when = !p.dated
    ? 'none carrying a date'
    : p.dated === p.series
      ? span
      : `${p.dated} of them dated ${span}`;
  const settled = p.axes
    .filter((a) => !a.pooled)
    .map((a) => `${a.what} ${label(a.values[0]?.[0])}`)
    .join(' · ');

  const lines = [
    `    ${pad('provenance', keyWidth)}  ${p.series} series, ${when}` +
      (settled ? ` · ${settled}` : ''),
  ];
  if (!p.pooled.length) return lines;

  for (const axis of p.pooled) {
    lines.push(
      `${indent}⚠ ${axis.values.length} ${axis.what}s pooled into this median: ` +
        axis.values.map(([v, n]) => `${label(v)} ×${n}`).join(' · '),
    );
  }
  lines.push(
    `${indent}  narrow it: --select ` + p.pooled.map((a) => `${a.key}=${a.hint}`).join(','),
  );
  return lines;
}

/** The cells that hold no number, each attributed to WHICH kind of nothing it is. */
export function renderGaps(matrix) {
  const lines = [];
  const mixed = matrix.rows.flatMap((r) => r.cells.filter((c) => c.mixed.length));
  if (mixed.length) {
    lines.push(`  ${mixed.length} cell(s) pool more than one population and are NOT averaged:`);
    for (const cell of mixed) {
      for (const axis of cell.mixed) lines.push(`    ${describeMixed(cell.label, axis)}`);
      // Only axes that ARE selection keys can be narrowed by name. `enableRta` and the
      // build-flavor bracket are refusal axes with no selector — printing
      // `--select enableRta=…` would hand the operator a command `parseSelector` rejects,
      // so those say what actually separates them instead.
      const selectable = cell.mixed.filter((m) => SERIES_KEYS[m.key]);
      const unselectable = cell.mixed.filter((m) => !SERIES_KEYS[m.key]);
      if (selectable.length) {
        lines.push(
          `      narrow it: --select ${selectable.map((m) => `${m.key}=<value>`).join(',')}`,
        );
      }
      for (const m of unselectable) {
        lines.push(
          `      ${m.what} is not a selection key — separate those series by the run they came ` +
            'from, with --select arm=<label> or --select commit=<sha>.',
        );
      }
    }
    lines.push('');
  }

  const empty = matrix.rows.flatMap((r) =>
    r.cells.filter((c) => !c.n && !c.mixed.length && (c.series || c.blocked || c.noCold)),
  );
  if (empty.length) {
    lines.push(
      `  ${empty.length} cell(s) were measured and yielded no usable number — that is a fact about ` +
        'the app or the run, NOT an unmeasured screen:',
    );
    for (const cell of empty) {
      const why = [
        cell.noCold ? `${cell.noCold} series with no cold sample` : null,
        cell.blocked
          ? `${cell.blocked} not a sample (${Object.entries(cell.nonSampleOutcomes)
              .map(([k, n]) => `${n} ${k}`)
              .join(', ')})`
          : null,
      ].filter(Boolean);
      lines.push(`    ${cell.label} — ${why.join(' · ')}`);
    }
    lines.push('');
  }

  const never = matrix.rows.filter(
    (r) => r.inRegistry && r.cells.every((c) => !c.series && !c.blocked && !c.noCold),
  );
  if (never.length) {
    lines.push(
      `  ${never.length} of ${matrix.rows.filter((r) => r.inRegistry).length} registry screens have never been ` +
        `measured in this family:`,
    );
    lines.push(`    ${never.map((r) => r.screen).join(', ')}`);
    lines.push('');
  }
  return lines;
}

/** Whether this table has any series behind it at all. */
export const isEmpty = (matrix) => matrix.tiers.length === 0;

/** One family's whole section: heading, grid, gaps, detail, accounting. */
export function renderMatrix(matrix) {
  const heading = [
    `${matrix.measurement}${matrix.title ? ` — ${matrix.title}` : ''}`,
    // The unit is parenthesised only when there IS one: a workload-valued headline
    // (`--field items`) is a count, and `items ()` is an empty promise of a unit.
    `  headline ${matrix.primary ?? '(none)'}${matrix.unit ? ` (${matrix.unit})` : ''} · ` +
      `${matrix.measuredCells} of ${matrix.totalCells} cells measured` +
      (Object.keys(matrix.select).length
        ? ` · selected ${Object.entries(matrix.select)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')}`
        : ''),
    '',
  ];

  // A selection that matched nothing has no tier columns, and rendering the grid anyway
  // produces thirty-odd screen names beside a blank column — a table that LOOKS like a
  // finding of "nothing measured anywhere" when it is really a selector that matched no
  // series. `flake-baseline.js` makes the same refusal for the same reason: a zero-sample
  // selection must not be able to render as a result.
  if (isEmpty(matrix)) {
    return [
      ...heading,
      '  no series matched — this is a selection that found nothing, NOT a screen nobody',
      '  has measured. Check the selector against what the ledger holds:',
      `    ledger accounting: ${describeExclusions(matrix.accounting)}`,
      '    npm run measure:compare        lists every value available to select on',
      '',
    ];
  }

  return [
    ...heading,
    ...renderGrid(matrix),
    '',
    ...renderGaps(matrix),
    ...renderDetail(matrix),
    `  ledger accounting: ${describeExclusions(matrix.accounting)}`,
    '',
  ];
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = [
  'Usage:',
  '  npm run measure:report                              every family in the ledger',
  '  npm run measure:report -- --measurement screen-load one family',
  '  npm run measure:report -- --select arm=rta,tier=1GB narrow every cell',
  '  npm run measure:report -- --field settledMs         headline a second milestone',
  '',
  'Flags:',
  '  --measurement  one family id, instead of every family present',
  '  --select       a selector applied to every cell, same grammar as measure:compare',
  '  --field        the timing to headline, instead of the family primary',
  `  --file         read a ledger other than ${MEASUREMENTS_LEDGER}`,
  '',
  'A cell reads `median ×n`, or `mixed` (more than one population — narrow --select),',
  'or `0 cold` (series exist, none produced a cold sample), or `—` (never measured).',
].join('\n');

/** Strict, for the reason `measure-args.js` documents: a dropped flag is a silent lie. */
export function parseReportArgs(argv = []) {
  const flags = new Map([
    ['--measurement', 'measurement'],
    ['--select', 'select'],
    ['--field', 'field'],
    ['--file', 'file'],
  ]);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const key = flags.get(name);
    if (!key) {
      throw new MeasureArgError(
        `unknown argument ${JSON.stringify(arg)}. Known flags: ${[...flags.keys()].join(', ')}`,
      );
    }
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === '') throw new MeasureArgError(`${name} needs a value`);
    args[key] = value;
  }
  if (args.measurement && !measurementIds().includes(args.measurement)) {
    throw new MeasureArgError(
      `unknown measurement ${JSON.stringify(args.measurement)}. Registered: ${measurementIds().join(', ')}`,
    );
  }
  args.select = args.select ? parseSelector(args.select) : {};
  // `--measurement` and `--select measurement=…` are the same statement, and letting both
  // through would let them disagree — the table heading saying one family while the cells
  // selected another.
  if (args.select.measurement && args.measurement && args.select.measurement !== args.measurement) {
    throw new MeasureArgError(
      `--measurement ${JSON.stringify(args.measurement)} contradicts --select measurement=${args.select.measurement}.`,
    );
  }
  if (args.select.measurement) args.measurement = args.select.measurement;
  delete args.select.measurement;

  // Checked LAST, because `--select measurement=` above can be what decides the family.
  //
  // A field is validated for the same reason a selector key is, and the failure it
  // prevents is worse than a dropped flag: an unknown field resolves on no sample, so
  // every cell that HAS series renders `0 cold` and the gaps block asserts they "were
  // measured and yielded no usable number — that is a fact about the app or the run".
  // A typo therefore produced a confident, exit-0 report blaming the app. Validated
  // against what the registry DECLARES rather than what the ledger happens to hold: a
  // family that declares `instrumentUs` and has never observed one must still be
  // reportable as absent, which is `declaredFields`' own stated contract.
  //
  // A DIMENSION is rejected separately, and by name, because it fails the same way a typo
  // does while being spelled correctly: `buildArm` reads `timings` / `workload` and never
  // `dimensions`, so `--field slowestContent` resolved on no sample and published a cell
  // that reads as a milestone the app failed to reach. Declared-but-unheadlinable is a
  // third state, so it gets a third message rather than being folded into "unknown".
  if (args.field) {
    const families = args.measurement ? [measurementById(args.measurement)] : MEASUREMENTS;
    const kinds = families.map((m) => [m, fieldsByKind(m)]);
    if (!kinds.some(([, k]) => k.numeric.includes(args.field))) {
      const asDimension = kinds.filter(([, k]) => k.dimensions.includes(args.field));
      throw new MeasureArgError(
        asDimension.length
          ? `${JSON.stringify(args.field)} is a DIMENSION of ` +
              `${asDimension.map(([m]) => m.id).join(', ')}, not a timing — it labels which ` +
              'sample this was, and a median of labels means nothing. Headline a numeric ' +
              'field and read the dimension off the sample.\n' +
              kinds.map(([m, k]) => `  ${m.id}: ${k.numeric.join(' ')}`).join('\n')
          : `unknown field ${JSON.stringify(args.field)}. Fields the registry declares:\n` +
              kinds.map(([m, k]) => `  ${m.id}: ${k.numeric.join(' ')}`).join('\n'),
      );
    }
  }
  return args;
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  let args;
  try {
    args = parseReportArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof MeasureArgError)) throw e;
    console.error(`[measure:report] ${e.message}\n\n${USAGE}`);
    process.exit(1);
  }

  const file = args.file || MEASUREMENTS_LEDGER;
  // `readJsonLines` returns [] for a file that is not there, which is right for the
  // DEFAULT ledger — nobody has measured yet — and wrong for a `--file` the operator
  // named, where it would answer a mistyped path with "take a measurement".
  if (!fs.existsSync(file)) {
    console.error(
      `[measure:report] no such file: ${file}\n` +
        `  The default ledger is ${MEASUREMENTS_LEDGER}; --file takes a copy of one.`,
    );
    process.exit(1);
  }
  const records = readJsonLines(file);
  console.log(`${file} — ${records.length} line(s)`);
  if (!records.length) {
    console.log(
      '  empty — no measurement series has been recorded yet. Take one with `npm run measure`.',
    );
    process.exit(1);
  }

  // Imported HERE and not at module scope: `tests/rta/screens.js` pulls in the nav and
  // ODC stack, and everything above this line is a pure reader over a JSON Lines file.
  const { SCREENS } = await import('../tests/rta/screens.js');
  // `capture` is the filter, not `SCREENS.length`. The registry also holds measurement
  // navs that are round trips rather than screens (`homeReturn`, `homeReturnAfterDetails`,
  // `searchReturn`), and the Charter's set is the 29 that carry a capture.
  const registryScreens = SCREENS.filter((s) => s.capture).map((s) => s.name);

  const families = args.measurement ? [args.measurement] : familiesIn(records);
  console.log('');
  let built = 0;
  for (const measurement of families) {
    const matrix = buildMatrix(records, {
      measurement,
      registryScreens,
      select: args.select,
      field: args.field,
    });
    if (!isEmpty(matrix)) built++;
    for (const line of renderMatrix(matrix)) console.log(line);
  }
  // The contract this shares with `measure` and `measure:compare`: the exit code says
  // whether a matrix could be BUILT, never what it showed. Every table empty means the
  // selection found nothing, which is an operator error worth a non-zero status; a table
  // full of honest `—` cells is a successful report about an unmeasured matrix.
  process.exit(built ? 0 : 1);
}
