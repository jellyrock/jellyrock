/**
 * Tier 3 — compare two arms of a measurement, and print the WORKLOAD delta beside
 * the timing delta.
 *
 *   npm run measure:compare                                describe the ledger
 *   npm run measure:compare -- --a before --b after        two labeled arms
 *   npm run measure:compare -- --a commit=91363ce5 --b commit=4ee85e15
 *   npm run measure:compare -- --a before --b after --field emit
 *
 * ## The question this answers, and why a tool answers it
 *
 * A perf claim is two numbers and one unstated assumption: that both arms did the
 * SAME WORK. [#799](https://github.com/jellyrock/jellyrock/pull/799) states it by
 * hand — *"both arms end at 9 rows, so the win is not a run that rendered less"* —
 * and `home-first-paint-performance.md` states it again, per comparison, as a thing
 * the author remembered to check ("verified non-vacuous", "one before sample is
 * excluded because it opened a 12-genre library"). Every one of those is a human
 * doing a mechanical join between two series and then writing a sentence about it.
 *
 * So this reads `measurements.jsonl` the way `flake-baseline.js` reads `runs.jsonl`,
 * and prints the workload delta on the line above the timing delta — not in a
 * caveat underneath it, and not only when someone thought to look.
 *
 * ## What it refuses, and what it merely says out loud
 *
 * The split is the guard's, one tier up: **identity is asserted, everything else is
 * recorded.** A comparison across two different screens, servers, device models or
 * build flavors is not a slow arm and a fast arm — it is two different experiments,
 * so it is REFUSED. Content drift is not: two arms that rendered 10 rows and 9 rows
 * are still worth looking at, as long as nobody can miss that they differ. That is
 * printed, loudly, beside the delta.
 *
 * ## It reports; it does not judge
 *
 * No threshold, no exit code that means "regression", no CI. Same reasoning as
 * `measure.js`: the numbers depend on server hardware, library size and network, so
 * a gate cannot separate a regression from a busy server. The exit code says whether
 * a COMPARISON COULD BE MADE, never what it showed.
 *
 * The statistics are the ones the doc already prescribes — *"use a rank test, not a
 * median difference"* — computed rather than assembled by hand: an exact
 * Mann-Whitney p where the sample sizes allow one, and the normal approximation with
 * a tie correction where they do not. A p-value here is a description of the spread,
 * not a verdict; the doc's own floor (~120 ms at n=30 per arm) is printed with it so
 * a small delta is read against what this method can actually resolve.
 */
import path from 'node:path';

import { readJsonLines, runDir, SAMPLE_OUTCOMES } from './run-record.js';
import { sameServer } from './measurement-guard.js';
// From the dictionary directly, not through the guard: the guard imports the ODC
// client, and this tool only ever reads a JSON Lines file off disk.
import { ramTierFor } from './roku-devices.js';
import { MeasureArgError } from './measure-args.js';
// The SAME selection rule the publisher uses. Not a copy — a copy is what produced the
// 8x disagreement between what `measure` printed and what this read back.
import { selectColdSamples } from './measure-selection.js';
import { unitFor } from './measurements.js';

/**
 * The measurement accumulator. Derived from `runDir('measure')` rather than written
 * out, so there is no second mapping to drift — exactly as `flake-baseline.js`
 * derives its own ledger path.
 */
export const MEASUREMENTS_LEDGER = path.join(
  '.device-runs',
  path.basename(runDir('measure')),
  'measurements.jsonl',
);

/**
 * The selection keys, flattened out of the record.
 *
 * A record is nested (`provenance.device.model`), and an operator naming an arm on a
 * command line should not have to know that. Every key here is something a series
 * can be SELECTED by; the comparability rules below read the same accessors, so a
 * key cannot be selectable and invisible to the gates at the same time.
 */
export const SERIES_KEYS = Object.freeze({
  arm: (r) => r?.arm ?? null,
  measurement: (r) => r?.measurement ?? null,
  screen: (r) => r?.screen ?? null,
  commit: (r) => r?.commit ?? null,
  device: (r) => r?.deviceKey ?? null,
  model: (r) => r?.provenance?.device?.model ?? null,
  // Recorded from `readDeviceProvenance` since this change; resolved from the model
  // number for lines written before it, so an older series is still comparable
  // rather than being unknown-tier forever.
  tier: (r) =>
    r?.provenance?.device?.ramTier ?? ramTierFor(r?.provenance?.device?.modelNumber) ?? null,
  os: (r) => r?.provenance?.device?.osVersion ?? null,
  server: (r) => r?.provenance?.server?.url ?? null,
  serverVersion: (r) => r?.provenance?.server?.version ?? null,
  appVersion: (r) => r?.provenance?.checkout?.appVersion ?? null,
  // WHICH NPM SCRIPT launched the run (`process.env.npm_lifecycle_event`), written by
  // `runProvenance()`. NOT the item type — see `screenVariant` below, and do not merge
  // the two: they are unrelated senses of one word and the record carries both.
  variant: (r) => r?.variant ?? null,
  // WHICH kind of thing the screen loaded — the item type for `itemDetails`, the library
  // type for a grid. This is the field that separates two screens backed by ONE component,
  // and without it `screen` alone is too coarse for a component-level family.
  screenVariant: (r) => r?.screenVariant ?? null,
  // WHICH component emitted the lines. One component backs many screens (`itemDetails`
  // backs all nine `*Details` entries), so this is deliberately NOT `screen`.
  component: (r) => r?.component ?? null,
  library: (r) => r?.library ?? null,
});

/** `[debug=… perfTiming=…]` as the running build stamped it, as a stable string. */
const flagsOf = (sample) =>
  sample?.buildFlags
    ? Object.keys(sample.buildFlags)
        .sort()
        .map((k) => `${k}=${sample.buildFlags[k]}`)
        .join(' ')
    : null;

/**
 * Parse `--a before` / `--a arm=before` / `--a commit=abc,device=def`.
 *
 * A bare word is an ARM LABEL, because that is the common case by a wide margin and
 * `--a arm=before` reads like ceremony. Anything with an `=` is explicit.
 *
 * @throws {MeasureArgError} on an unknown key — never ignored, for the reason
 *   `measure-args.js` documents at length: a dropped selector produces a confident
 *   comparison of something other than what the operator asked for.
 */
export function parseSelector(text) {
  const selector = {};
  for (const part of String(text).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const key = eq > 0 ? trimmed.slice(0, eq).trim() : 'arm';
    const value = eq > 0 ? trimmed.slice(eq + 1).trim() : trimmed;
    if (!SERIES_KEYS[key]) {
      throw new MeasureArgError(
        `unknown selector key ${JSON.stringify(key)}. Known keys: ${Object.keys(SERIES_KEYS).join(', ')}`,
      );
    }
    if (!value) throw new MeasureArgError(`selector ${JSON.stringify(key)} needs a value`);
    selector[key] = value;
  }
  if (!Object.keys(selector).length) throw new MeasureArgError('an arm selector cannot be empty');
  return selector;
}

/**
 * Pick the series an arm is made of, and attribute every line that did not make it.
 *
 * Same contract as `selectBaseline`: exclusions are OUTPUT, not a silent `filter`.
 * The ordinary failure of a strict selection is selecting fewer lines than you think
 * — and a median over three samples when you took ten reads exactly like a result.
 */
export function selectSeries(records, selector = {}) {
  const excluded = { notSelected: 0, notASample: 0, noColdSamples: 0 };
  const nonSampleOutcomes = {};
  const series = [];

  for (const r of records || []) {
    const matches = Object.entries(selector).every(
      (entry) => String(SERIES_KEYS[entry[0]](r) ?? '') === String(entry[1]),
    );
    if (!matches) excluded.notSelected++;
    // A record written before `outcome` existed reads as `unrecorded` rather than as
    // a pass — the two earliest series in the ledger predate the field, and treating
    // an absent verdict as a good one is the laundering this project keeps removing.
    else if (!SAMPLE_OUTCOMES.has(r.outcome)) {
      excluded.notASample++;
      const key = r.outcome ?? 'unrecorded';
      nonSampleOutcomes[key] = (nonSampleOutcomes[key] || 0) + 1;
    } else if (!coldSamples(r).length) excluded.noColdSamples++;
    else series.push(r);
  }
  return { series, excluded, nonSampleOutcomes };
}

/**
 * The cold first paints of one series — the mount the RECORD says it is about.
 *
 * Through the shared `selectColdSamples`, because this is the same question `measure.js`
 * answers when it publishes, and the two must not answer it differently. They did: this
 * filtered on `indexInLaunch === 0` regardless of what the record said it was about, and
 * index 0 of a playback launch is the `itemDetails` mount the nav walked THROUGH — so
 * every sample of such a record read back as the wrong screen, while the workload line
 * called it "identical" to an arm that genuinely was `itemDetails`.
 *
 * Note the field-name mapping: a SAMPLE carries `dimensions.variant`, a RECORD carries
 * `screenVariant` (the rename exists because `runProvenance()` already spreads a
 * `variant` of its own). Normalising here is what keeps the shared module ignorant of
 * both shapes.
 *
 * A record with neither field set — the two dimension-less legacy families, or a run
 * whose selection was refused — falls back to first-mount, which is what every
 * single-mount series has always meant.
 */
export function coldSamples(record) {
  return selectColdSamples(record?.samples || [], {
    component: record?.component ?? null,
    variant: record?.screenVariant ?? null,
  });
}

/**
 * Assemble one arm: its series, its individual samples, and the facts the
 * comparability gates read.
 *
 * `field` is the timing being headlined. It falls back to the sample's WORKLOAD when
 * the field is not a timing, which is how a workload-valued primary (an item count,
 * say) would still resolve — the same fallback `measure.js` uses when it prints a
 * series summary.
 */
export function buildArm(label, records, selector, field) {
  const { series, excluded, nonSampleOutcomes } = selectSeries(records, selector);
  const primary = field || series[0]?.primary || null;
  const samples = [];
  for (const record of series) {
    for (const s of coldSamples(record)) {
      const value = s.timings?.[primary] ?? s.workload?.[primary];
      samples.push({
        value: Number.isFinite(value) ? value : null,
        workload: s.workload || {},
        at: s.launchAt || null,
        flags: flagsOf(s),
      });
    }
  }
  return {
    label,
    selector,
    series,
    excluded,
    nonSampleOutcomes,
    primary,
    samples,
    values: samples.map((s) => s.value).filter((v) => Number.isFinite(v)),
  };
}

/** The distinct values an arm's series carry for one selection key. */
const distinct = (series, read) => [...new Set(series.map(read).map((v) => v ?? null))];

/**
 * A selection value as a message says it. `null` becomes "(not recorded)" rather than
 * an empty gap: a line written before a field existed is a real state a reader has to
 * be able to tell from a line that recorded an empty value.
 */
const show = (value) =>
  value === null || value === undefined || value === '' ? '(not recorded)' : String(value);

/**
 * Name one series the way an operator can act on it: its arm label and when it was
 * taken. Not the array index — the ledger is append-only and a reader cannot see
 * positions, but `npm run measure:compare` with no arguments prints exactly these.
 */
const describeSeries = (r) =>
  `arm ${show(SERIES_KEYS.arm(r))} @ ${r?.startedAt ? String(r.startedAt).slice(0, 16).replace('T', ' ') : 'unknown time'}`;

/** `rows=10` for one sample's workload, so two workloads compare as strings. */
const workloadKey = (workload) =>
  Object.keys(workload || {})
    .sort()
    .map((k) => `${k}=${workload[k]}`)
    .join(' ') || '(none)';

/** How many samples carried each distinct workload, commonest first. */
export function workloadTally(arm) {
  const counts = {};
  for (const s of arm.samples) {
    const key = workloadKey(s.workload);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/**
 * Can these two arms be compared at all?
 *
 * REFUSALS are the axes on which two series are not a slow arm and a fast arm but
 * two different experiments. WARNINGS are everything the guard's tier 2 records: a
 * difference that changes what the number MEANS without making the comparison
 * meaningless, which the reader must see rather than be protected from.
 *
 * The asymmetry is deliberate and it is the tier-3 design: *drift is made visible
 * rather than refused.* A workload difference is the loudest thing this tool prints
 * and it is still not a refusal — because the run that rendered 9 rows instead of 10
 * is exactly the case a human needs to look at, and a tool that swallowed it would
 * have nothing to say about the failure it exists for.
 */
export function comparability(a, b) {
  const refusals = [];
  const warnings = [];

  for (const arm of [a, b]) {
    if (!arm.series.length) {
      refusals.push(
        `arm ${arm.label} selected no usable series (${describeExclusions(arm)}). A comparison ` +
          'against nothing is not a comparison.',
      );
    } else if (!arm.values.length) {
      refusals.push(
        `arm ${arm.label} has no sample carrying \`${arm.primary}\` — check --field against the ` +
          "family's recorded fields.",
      );
    }
  }
  if (refusals.length) return { refusals, warnings };

  // ANY shared series is a refusal, not just a total overlap. A series cannot be
  // evidence for both sides of a comparison against itself.
  //
  // The total case is a typo with a plausible output — a delta of zero and a p of 1,
  // which reads as "no difference found". The PARTIAL case is worse, and it is the one
  // an operator actually reaches: `--a commit=<sha> --b after` on an uncommitted change
  // selects every arm on that commit as A, including all of B. Measured against this
  // repo's own ledger, that printed `Δ -45.5 ms (-2.5%)`, a p, and an `order` line of
  // twelve entries built from eight distinct samples — with B's four values counted on
  // both sides, and nothing anywhere saying so. The only visible tell was that both arms
  // reported the same min and max.
  //
  // Both arms carrying the same `commit` is the DOCUMENTED common case (see `--arm` in
  // `measure-args.js`: an uncommitted change leaves the two builds indistinguishable in
  // every recorded field but the label), so a commit selector overlapping an arm
  // selector is a shape to expect rather than an exotic mistake.
  const overlap = a.series.filter((r) => b.series.includes(r));
  if (overlap.length) {
    const total = overlap.length === a.series.length && overlap.length === b.series.length;
    refusals.push(
      total
        ? 'both arms selected the SAME series — the delta below would be a series compared ' +
            'against itself. Check the selectors; `npm run measure:compare` with no arguments ' +
            'lists what is in the ledger.'
        : `${overlap.length} of ${a.label}'s ${a.series.length} series ${overlap.length === 1 ? 'is' : 'are'} ` +
            `ALSO in ${b.label} (${overlap.map(describeSeries).join(', ')}) — those samples would be ` +
            'counted on both sides, in both medians and in the rank test. Narrow one selector; ' +
            'two arms of one experiment share no series.',
    );
  }

  // Mixed WITHIN an arm is checked before differing ACROSS arms, because a mixed arm
  // makes the cross-arm question meaningless rather than merely wrong.
  for (const [key, what] of [
    ['measurement', 'measurement family'],
    ['screen', 'screen'],
    // A component-level family makes `screen` alone too coarse: `itemDetails` backs nine
    // screens, so a Movie series and a Series series agree on component and would agree
    // on every other key here. `variant` is the field that separates them, and it is
    // checked at BOTH levels — mixed within an arm, and differing across arms — for the
    // same reason `screen` is.
    ['screenVariant', 'item variant'],
    // WHICH component emitted the lines. Until measurement reached a playback screen,
    // `screen` implied this — one screen, one component — so the gate did not need it.
    // A nav that walks through another instrumented screen breaks that implication: an
    // `itemDetails` arm and a `videoPlayer` arm can BOTH carry `screen: osd`, pass every
    // other key here, and be compared without a word. Worse than silent — the workload
    // line then prints "identical: the delta below is not a run that did less work",
    // which is a positive reassurance that two different components are comparable.
    ['component', 'component'],
    // On a server with several libraries of one type, two arms that opened different
    // ones are two workloads wearing one name. Nothing else in the record can say.
    ['library', 'library id'],
    ['model', 'device model'],
    ['tier', 'device RAM tier'],
  ]) {
    for (const arm of [a, b]) {
      const values = distinct(arm.series, SERIES_KEYS[key]);
      if (values.length > 1) {
        refusals.push(
          `arm ${arm.label} mixes ${values.length} ${what}s (${values.map(show).join(', ')}) — that is two ` +
            'populations in one arm, not a series.',
        );
      }
    }
    const av = distinct(a.series, SERIES_KEYS[key]);
    const bv = distinct(b.series, SERIES_KEYS[key]);
    if (av.length === 1 && bv.length === 1 && av[0] !== bv[0]) {
      refusals.push(
        `the arms are on different ${what}s (${a.label}: ${show(av[0])} · ${b.label}: ${show(bv[0])}) — ` +
          'that is two experiments, not two arms of one.',
      );
    }
  }

  // The server is compared with tier 1's own normalizer, so a trailing slash is not a
  // refusal and `/stable` vs `/unstable` is.
  const serverA = distinct(a.series, SERIES_KEYS.server);
  const serverB = distinct(b.series, SERIES_KEYS.server);
  for (const arm of [a, b]) {
    const urls = distinct(arm.series, SERIES_KEYS.server);
    if (urls.length > 1) {
      refusals.push(
        `arm ${arm.label} mixes ${urls.length} servers (${urls.map(show).join(', ')}).`,
      );
    }
  }
  if (serverA.length === 1 && serverB.length === 1 && !sameServer(serverA[0], serverB[0])) {
    refusals.push(
      `the arms measured different servers (${a.label}: ${serverA[0]} · ${b.label}: ${serverB[0]}) ` +
        '— different content, different hardware, so the delta is not about the app.',
    );
  }

  // Build flavor, as the RUNNING build stamped it. `debug=true` alone is +121 ms on a
  // Stick 4K (measured, and recorded in `home-first-paint-performance.md`), which is
  // larger than most changes anyone measures.
  const flagsA = [...new Set(a.samples.map((s) => s.flags))];
  const flagsB = [...new Set(b.samples.map((s) => s.flags))];
  for (const [arm, flags] of [
    [a, flagsA],
    [b, flagsB],
  ]) {
    if (flags.length > 1) {
      refusals.push(
        `arm ${arm.label} mixes build flavors (${flags.map((f) => f ?? 'unstamped').join(' · ')}).`,
      );
    }
  }
  if (flagsA.length === 1 && flagsB.length === 1 && flagsA[0] !== flagsB[0]) {
    refusals.push(
      `the arms were built differently (${a.label}: ${flagsA[0] ?? 'unstamped'} · ${b.label}: ` +
        `${flagsB[0] ?? 'unstamped'}) — a build flag can move a first paint more than the change ` +
        'under test.',
    );
  }
  if (flagsA[0] === null && flagsB[0] === null) {
    warnings.push(
      'neither arm carries a `[debug=… perfTiming=…]` bracket, so the build flavor they ran ' +
        'under is unknown on both sides.',
    );
  }

  // ENABLE_RTA is the third compile-time flag that can move a measurement, and it is
  // DERIVED from ODC answering rather than read from a manifest — see the guard.
  //
  // Checked WITHIN an arm as well as across, like every other refusal axis above. It
  // was the one axis without the within-arm half, which would have let a single arm
  // pool an RTA build and a non-RTA one and then compare that mixture confidently
  // against the other side — the failure the cross-arm check exists to stop, hidden
  // one level down.
  const rta = (arm) => distinct(arm.series, (r) => r?.provenance?.enableRta ?? null);
  for (const arm of [a, b]) {
    const values = rta(arm);
    if (values.length > 1) {
      refusals.push(
        `arm ${arm.label} mixes ${values.length} ENABLE_RTA states (${values.map(show).join(', ')}) — ` +
          'that is two populations in one arm, not a series.',
      );
    }
  }
  if (rta(a).length === 1 && rta(b).length === 1 && rta(a)[0] !== rta(b)[0]) {
    refusals.push(
      `the arms differ in ENABLE_RTA (${a.label}: ${show(rta(a)[0])} · ${b.label}: ${show(rta(b)[0])}) — a ` +
        'resident ODC component is an unmeasured variable, which is the calibration this ' +
        'comparison would need to have already done.',
    );
  }

  if (refusals.length) return { refusals, warnings };

  // ── Recorded, not refused ────────────────────────────────────────────────────
  // A line the selector MATCHED and the gates then dropped. Said out loud on the
  // success path too, not only inside a refusal, because `selectSeries`'s whole
  // contract is that exclusions are output rather than a silent `filter` — and the
  // failure it names ("a median over three samples when you took ten reads exactly
  // like a result") happens on the path that prints a delta, not on the one that
  // refuses. Only the gate-dropped counts appear here: `notSelected` is every other
  // line in the ledger and is noise until there is nothing left to compare, which is
  // why the refusal branch prints that one and this does not.
  for (const arm of [a, b]) {
    const dropped = arm.excluded.notASample + arm.excluded.noColdSamples;
    if (!dropped) continue;
    const why = [];
    if (arm.excluded.notASample) {
      why.push(
        `${arm.excluded.notASample} never reached a verdict (${Object.entries(arm.nonSampleOutcomes)
          .map(([k, n]) => `${n} ${k}`)
          .join(', ')})`,
      );
    }
    if (arm.excluded.noColdSamples) {
      why.push(`${arm.excluded.noColdSamples} produced no cold sample`);
    }
    warnings.push(
      `arm ${arm.label} matched ${arm.series.length + dropped} series but is using ${arm.series.length}: ` +
        `${why.join(' · ')}. Those runs happened; they are not in the numbers below.`,
    );
  }
  if (distinct(a.series, SERIES_KEYS.screen)[0] === null) {
    warnings.push(
      'neither series recorded a screen (the `item-grid` family backs every library grid), so ' +
        'nothing here can prove both arms were on the same one. Pass `--screen` when taking them.',
    );
  }
  for (const arm of [a, b]) {
    const tally = workloadTally(arm);
    if (tally.length > 1) {
      warnings.push(
        `arm ${arm.label} mixes ${tally.length} workloads (${tally
          .map(([k, n]) => `${k} ×${n}`)
          .join(' · ')}) — its median is over two populations. The recorded precedent is a ` +
          'grid sample that opened a 12-genre library in an 8-genre series; that is a different ' +
          'workload, not a slow sample.',
      );
    }
    if (arm.series.some((r) => r.tier1?.asserted !== true)) {
      warnings.push(
        `arm ${arm.label} contains a series that did NOT assert its server (no --server). The ` +
          'server it recorded is what the app reported, not what anyone declared.',
      );
    }
    if (arm.series.some((r) => r.seriesConsistency && r.seriesConsistency.ok === false)) {
      warnings.push(
        `arm ${arm.label} contains a series whose identity drifted or could not be re-read at the ` +
          'end — those samples are not provably one population.',
      );
    }
    if (arm.values.length < 5) {
      warnings.push(
        `arm ${arm.label} has ${arm.values.length} sample(s). The recorded method wants n≥5 and ` +
          'resolves ~120 ms and up at n=30 per arm; below that a delta cannot be called either way.',
      );
    }
  }
  for (const [key, what] of [
    ['os', 'Roku OS version'],
    ['serverVersion', 'Jellyfin server version'],
    ['appVersion', 'app version'],
  ]) {
    const av = distinct(a.series, SERIES_KEYS[key]);
    const bv = distinct(b.series, SERIES_KEYS[key]);
    if (av.length === 1 && bv.length === 1 && av[0] !== bv[0]) {
      warnings.push(
        `the arms ran on different ${what}s (${a.label}: ${show(av[0])} · ${b.label}: ${show(bv[0])}).`,
      );
    }
  }
  const devicesA = distinct(a.series, SERIES_KEYS.device);
  const devicesB = distinct(b.series, SERIES_KEYS.device);
  if (devicesA.length === 1 && devicesB.length === 1 && devicesA[0] !== devicesB[0]) {
    warnings.push(
      'the arms ran on two different physical devices of the same model — same tier, but not the ' +
        'same unit, and unit-to-unit variation has never been measured here.',
    );
  }
  const crossed = [...a.series, ...b.series].filter((r) => r.crossedHourBoundary === true).length;
  const unknownHour = [...a.series, ...b.series].filter(
    (r) => r.crossedHourBoundary == null,
  ).length;
  if (crossed || unknownHour) {
    const parts = [];
    if (crossed) parts.push(`${crossed} series crossed the top of the hour`);
    if (unknownHour) parts.push(`${unknownHour} did not record the flag`);
    warnings.push(
      `${parts.join('; ')} — a fixture that resets mid-series changes the workload underneath it.`,
    );
  }
  const dirty = [...a.series, ...b.series].filter((r) => r.dirty === true);
  if (dirty.length) {
    warnings.push(
      `${dirty.length} series ran against a DIRTY tree, so its commit does not pin the code that ` +
        'produced the numbers. Only the arm label distinguishes the two builds.',
    );
  }
  return { refusals, warnings };
}

/** `4 not selected · 1 not a sample (1 blocked)` — every excluded line attributed. */
export function describeExclusions(arm) {
  const parts = [];
  if (arm.excluded.notSelected) parts.push(`${arm.excluded.notSelected} not selected`);
  if (arm.excluded.notASample) {
    parts.push(
      `${arm.excluded.notASample} not a sample (${Object.entries(arm.nonSampleOutcomes)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')})`,
    );
  }
  if (arm.excluded.noColdSamples) parts.push(`${arm.excluded.noColdSamples} with no cold sample`);
  return parts.join(' · ') || 'nothing excluded';
}

// ── Statistics ───────────────────────────────────────────────────────────────

/** The median of a list of numbers, or `null` when there is nothing to take one of. */
export function median(values) {
  if (!values?.length) return null;
  const v = [...values].sort((x, y) => x - y);
  const mid = v.length / 2;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[mid - 1] + v[mid]) / 2;
}

/** n, median and the full range — the range because a median alone hides the spread. */
export function summarizeValues(values) {
  return {
    n: values.length,
    median: median(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };
}

/** Mid-ranks, so ties do not silently favor whichever arm was listed first. */
function midRanks(sorted) {
  const ranks = new Array(sorted.length);
  let i = 0;
  const tieGroups = [];
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[sorted[k].index] = rank;
    if (j > i) tieGroups.push(j - i + 1);
    i = j + 1;
  }
  return { ranks, tieGroups };
}

/** Φ(z) via the Abramowitz–Stegun 7.1.26 error function — good to ~1.5e-7. */
function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * The exact null distribution of U for sizes `m`, `n`, as counts indexed by U.
 *
 * `N(m, n, u) = N(m-1, n, u-n) + N(m, n-1, u)` — the standard recurrence, carried in
 * doubles and normalized by its own total, so no factorial is ever formed.
 */
function uDistribution(m, n) {
  // rows[j] holds the distribution for (i, j); only the previous i is needed.
  let prev = Array.from({ length: n + 1 }, () => Float64Array.from([1]));
  for (let i = 1; i <= m; i++) {
    const row = [Float64Array.from([1])];
    for (let j = 1; j <= n; j++) {
      const size = i * j + 1;
      const out = new Float64Array(size);
      const fromLeft = row[j - 1]; // (i, j-1)
      const fromAbove = prev[j]; // (i-1, j)
      for (let u = 0; u < fromLeft.length; u++) out[u] += fromLeft[u];
      for (let u = 0; u < fromAbove.length; u++) {
        if (u + j < size) out[u + j] += fromAbove[u];
      }
      row.push(out);
    }
    prev = row;
  }
  return prev[n];
}

/** Above this many pairs the exact distribution is skipped for the approximation. */
const EXACT_MAX_PAIRS = 2500;

/**
 * Mann-Whitney U, two-sided.
 *
 * The doc is explicit that this is the test to use — *"a median gap that looks
 * decisive can sit well inside the spread"* — and every recorded p in it was computed
 * by hand outside the repo. Exact where the sample sizes allow it and there are no
 * ties; otherwise the normal approximation WITH the tie correction, and the result
 * says which was used, because "p = 0.03, exact" and "p = 0.03, approximate at n=4"
 * are not the same claim.
 *
 * ## That distinction is not academic — it is already in the doc, unlabeled
 *
 * Re-deriving the two recorded p-values while writing this found they were computed
 * two different ways. The `apiPipeline` pair (n=5 vs 6, complete separation) records
 * *"exact Mann-Whitney p≈0.004"* and is exact: 2/C(11,5) = 0.00433. The batched-attach
 * pair (n=10 per arm, complete separation) records *"U = 0.0, p = 0.0002"* — which is
 * the NORMAL approximation with a continuity correction (z = 3.742 → 1.83e-4). Its
 * exact value is 2/C(20,10) = **1.08e-5**, seventeen times smaller. The conclusion is
 * unaffected — it only gets stronger — but nothing in the doc said which method
 * produced which number, and a reader re-deriving one from the other would have
 * concluded the arithmetic was broken. Both are reachable here, and both are pinned
 * by tests.
 *
 * ## Which ties force the approximation, and why this is conservative
 *
 * ANY tie in the combined sample sends it to the approximation, including a tie
 * BETWEEN TWO VALUES OF THE SAME ARM. Strictly, a within-arm tie leaves U an integer
 * and the exact null distribution valid, so the exact test would still be available
 * there — this gives it up deliberately rather than by oversight. Timings are whole
 * milliseconds and arms are small, so within-arm ties are common; distinguishing the
 * two kinds of tie would mean a second code path whose only effect is a sharper p on
 * a number this tool explicitly refuses to gate on. Losing precision in the safe
 * direction is the cheaper mistake, and `method` in the output says which ran.
 *
 * @param {object} [options]
 * @param {'auto'|'normal'} [options.method] `'normal'` forces the approximation, for
 *   re-deriving a recorded number that was computed that way.
 */
export function mannWhitney(aValues, bValues, { method = 'auto' } = {}) {
  const m = aValues.length;
  const n = bValues.length;
  if (!m || !n) return null;
  const combined = [
    ...aValues.map((value) => ({ value, arm: 'a' })),
    ...bValues.map((value) => ({ value, arm: 'b' })),
  ].map((entry, index) => ({ ...entry, index }));
  const sorted = [...combined].sort((x, y) => x.value - y.value);
  const { ranks, tieGroups } = midRanks(sorted);

  let rankSumA = 0;
  for (const entry of combined) if (entry.arm === 'a') rankSumA += ranks[entry.index];
  const uA = rankSumA - (m * (m + 1)) / 2;
  const uB = m * n - uA;
  const u = Math.min(uA, uB);

  const ties = tieGroups.length > 0;
  if (method !== 'normal' && !ties && m * n <= EXACT_MAX_PAIRS) {
    const dist = uDistribution(m, n);
    let total = 0;
    for (const count of dist) total += count;
    let atOrBelow = 0;
    for (let i = 0; i <= u && i < dist.length; i++) atOrBelow += dist[i];
    return { u, uA, uB, p: Math.min(1, (2 * atOrBelow) / total), method: 'exact', ties };
  }

  const N = m + n;
  const tieTerm = tieGroups.reduce((sum, t) => sum + (t * t * t - t), 0);
  const variance = ((m * n) / 12) * (N + 1 - tieTerm / (N * (N - 1)));
  if (!(variance > 0)) return { u, uA, uB, p: 1, method: 'normal', ties };
  const z = (Math.abs(u - (m * n) / 2) - 0.5) / Math.sqrt(variance);
  return {
    u,
    uA,
    uB,
    p: Math.min(1, 2 * (1 - normalCdf(z))),
    method: 'normal',
    ties,
  };
}

/** True when every sample of one arm beats every sample of the other. */
export function completeSeparation(aValues, bValues) {
  if (!aValues.length || !bValues.length) return false;
  return Math.max(...aValues) < Math.min(...bValues) || Math.max(...bValues) < Math.min(...aValues);
}

/**
 * Did the arms alternate, or was one taken entirely before the other?
 *
 * The interleave rule (`A,B,A,B`) exists because content drift and device warm-up are
 * monotone in time: taken in blocks they land on ONE arm and read as a result. The
 * rule was a note in a plan for this tool's whole design period — which is precisely
 * how the flake baseline's selection recipe went wrong three times. So it is checked
 * from the recorded sample times rather than assumed to have happened.
 *
 * Samples with no `launchAt` are counted separately and never treated as ordered:
 * they predate the field, and "unknown" reading as "fine" is the failure this project
 * has removed from four different records now.
 */
export function interleaving(a, b) {
  const stamped = [
    ...a.samples.map((s) => ({ at: s.at, arm: 'A' })),
    ...b.samples.map((s) => ({ at: s.at, arm: 'B' })),
  ].filter((s) => Number.isFinite(Date.parse(s.at)));
  const unknown = a.samples.length + b.samples.length - stamped.length;
  if (!stamped.length) return { sequence: '', blocks: 0, unknown, spanMs: null };

  stamped.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const sequence = stamped.map((s) => s.arm).join('');
  let blocks = 1;
  for (let i = 1; i < stamped.length; i++) if (stamped[i].arm !== stamped[i - 1].arm) blocks++;
  return {
    sequence,
    blocks,
    unknown,
    spanMs: Date.parse(stamped[stamped.length - 1].at) - Date.parse(stamped[0].at),
  };
}

// ── Report ───────────────────────────────────────────────────────────────────

/**
 * A value with its unit. The unit is a PARAMETER rather than a hardcoded `ms`,
 * because `--field` can headline any timing a family emits and not all of them are
 * milliseconds — `instrumentUs` is microseconds, and printing it as `3200 ms` would
 * misstate the instrument's own footprint by three orders of magnitude in the one
 * report written to answer whether that footprint matters. See `unitFor`.
 */
const ms = (v, unit = 'ms') =>
  v === null || v === undefined ? '—' : `${Math.round(v * 10) / 10} ${unit}`;

/**
 * A span, in the largest unit that does not round it to nothing.
 *
 * Whole minutes alone printed `0 min` for anything under 30 s — and this number is
 * read to judge how far apart the arms were taken, so the one span it must not
 * describe as zero is a short one.
 */
const span = (v) => {
  if (!Number.isFinite(v)) return 'an unknown span';
  if (v < 90_000) return `${Math.round(v / 1000)} s`;
  if (v < 5_400_000) return `${Math.round(v / 60000)} min`;
  return `${(v / 3_600_000).toFixed(1)} h`;
};

/**
 * The comparison, as lines. Workload first, deliberately: it is the line that says
 * whether the timing line below it is about the change or about the fixture.
 */
export function reportComparison(a, b, { refusals = [], warnings = [] } = {}) {
  // Both arms' labels padded to one width, so the two rows of every block below line
  // up as columns. Free-form labels otherwise ragged the numbers they head.
  const width = Math.max(a.label.length, b.label.length);
  const name = (arm) => arm.label.padEnd(width);
  const lines = [
    `  ${name(a)}  ${describeSelector(a.selector)}   ${a.series.length} series · ${a.samples.length} cold samples`,
    `  ${name(b)}  ${describeSelector(b.selector)}   ${b.series.length} series · ${b.samples.length} cold samples`,
    '',
  ];
  if (refusals.length) {
    lines.push('  REFUSED — these are not two arms of one experiment:');
    for (const r of refusals) lines.push(`   ✗ ${r}`);
    lines.push(
      '',
      `  ${name(a)}: ${describeExclusions(a)}`,
      `  ${name(b)}: ${describeExclusions(b)}`,
    );
    return lines;
  }

  const context = a.series[0];
  lines.push(
    `  measuring   ${context.measurement} (${SERIES_KEYS.screen(context) ?? 'screen not recorded'})` +
      ` · ${a.primary} · ${SERIES_KEYS.model(context)} (${SERIES_KEYS.tier(context) ?? 'RAM unknown'})` +
      ` · ${SERIES_KEYS.server(context)}`,
    '',
  );

  // Workload BEFORE timing. This is the whole point of the tier: #799 states "both
  // arms end at 9 rows" by hand, in prose, as a thing its author remembered to check.
  const workA = workloadTally(a);
  const workB = workloadTally(b);
  const sameWork = workA.length === 1 && workB.length === 1 && workA[0][0] === workB[0][0];
  lines.push(
    `  workload    ${name(a)} ${workA.map(([k, n]) => `${k} ×${n}`).join(' · ')}`,
    `              ${name(b)} ${workB.map(([k, n]) => `${k} ×${n}`).join(' · ')}`,
    sameWork
      ? '              → identical: the delta below is not a run that did less work.'
      : '              → ⚠ THE ARMS DID NOT DO THE SAME WORK. A timing delta here can be a run ' +
          'that rendered less, not a faster one.',
    '',
  );

  const unit = unitFor(a.primary);
  const sa = summarizeValues(a.values);
  const sb = summarizeValues(b.values);
  const delta = sa.median !== null && sb.median !== null ? sb.median - sa.median : null;
  const pct = delta !== null && sa.median ? (delta / sa.median) * 100 : null;
  lines.push(
    `  ${a.primary.padEnd(11)} ${name(a)} median ${ms(sa.median, unit)}   (n=${sa.n}, ${ms(sa.min, unit)}–${ms(sa.max, unit)})`,
    `              ${name(b)} median ${ms(sb.median, unit)}   (n=${sb.n}, ${ms(sb.min, unit)}–${ms(sb.max, unit)})`,
    `              Δ ${delta > 0 ? '+' : ''}${ms(delta, unit)}${pct === null ? '' : ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`}` +
      `  ${b.label} relative to ${a.label}`,
  );

  const test = mannWhitney(a.values, b.values);
  if (test) {
    lines.push(
      `              rank test  Mann-Whitney U = ${test.u}, ${test.method} p = ${test.p.toFixed(4)}` +
        `${test.ties ? ' (ties present)' : ''}` +
        `${completeSeparation(a.values, b.values) ? ' · complete separation' : ''}`,
    );
    if (test.p > 0.05) {
      lines.push(
        '              → not distinguishable at this n. That bounds the effect; it does not make',
        '                it zero. The recorded floor for this method is ~120 ms at n=30 per arm.',
      );
    }
  }

  const order = interleaving(a, b);
  lines.push('');
  if (order.sequence) {
    lines.push(
      `  order       ${order.sequence}   ${order.blocks} block(s) over ${span(order.spanMs)}` +
        (order.unknown ? `   (${order.unknown} sample(s) carry no timestamp)` : ''),
    );
    // `<= 2` means one contiguous run of each arm. Suppressed when neither arm has
    // more than one sample, where two blocks is the ONLY sequence available and the
    // warning would be telling the operator to do something that does not exist. The
    // n<5 warning already covers that case, and a warning that cannot be acted on is
    // how the whole set stops being read.
    if (order.blocks <= 2 && Math.max(a.samples.length, b.samples.length) > 1) {
      lines.push(
        '              ⚠ the arms were NOT interleaved — one was taken entirely before the other,',
        '                so anything that drifts with time (fixture content, device warm-up, a',
        '                server getting busy) lands on one arm and reads as a result. Re-take them',
        '                alternating: --arm before, --arm after, --arm before, …',
      );
    }
  } else if (order.unknown) {
    lines.push(
      `  order       unknown — ${order.unknown} sample(s) carry no timestamp (recorded before the`,
      '              field existed), so whether the arms were interleaved cannot be checked.',
    );
  }

  if (warnings.length) {
    lines.push('');
    for (const w of warnings) lines.push(`  ⚠ ${w}`);
  }
  lines.push(
    '',
    '  No threshold is applied and none is coming: these numbers depend on server hardware,',
    '  library size and network, so a gate cannot tell a regression from a busy server.',
  );
  return lines;
}

const describeSelector = (selector) =>
  Object.entries(selector)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');

/** `before ×3   after ×3`, commonest first — one describe-mode row per selection key. */
function tally(records, read) {
  const counts = {};
  for (const r of records) {
    const k = read(r) ?? '(unrecorded)';
    counts[k] = (counts[k] || 0) + 1;
  }
  return (
    Object.entries(counts)
      .sort((x, y) => y[1] - x[1])
      .map(([k, n]) => `${k} ×${n}`)
      .join('   ') || '(none)'
  );
}

/**
 * What is IN the ledger, for before two arms have been named — the same job
 * `describeLedger` does for the run ledger, and for the same reason: the selection
 * keys are exactly what the operator has to supply, and a device is recorded as a
 * hash nobody can type from memory.
 */
export function describeMeasurements(records) {
  return [
    `  arm         ${tally(records, SERIES_KEYS.arm)}`,
    `  measurement ${tally(records, SERIES_KEYS.measurement)}`,
    `  screen      ${tally(records, SERIES_KEYS.screen)}`,
    `  commit      ${tally(records, SERIES_KEYS.commit)}`,
    `  device      ${tally(records, (r) => {
      const model = SERIES_KEYS.model(r);
      const key = SERIES_KEYS.device(r);
      return model && key ? `${model} ${key}` : (key ?? model);
    })}`,
    `  server      ${tally(records, SERIES_KEYS.server)}`,
    `  outcome     ${tally(records, (r) => r.outcome)}`,
    `  samples     ${tally(records, (r) => `${coldSamples(r).length} cold`)}`,
  ];
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = [
  'Usage:',
  '  npm run measure:compare                              describe the measurement ledger',
  '  npm run measure:compare -- --a before --b after      compare two labeled arms',
  '  npm run measure:compare -- --a commit=abc1234 --b commit=def5678',
  '  npm run measure:compare -- --a before --b after --field emit',
  '',
  'Flags:',
  '  --a / --b   an arm selector (required together)',
  '  --field     the timing to headline, instead of the family primary',
  `  --file      read a ledger other than ${MEASUREMENTS_LEDGER}`,
  '',
  `Selector keys: ${Object.keys(SERIES_KEYS).join(', ')} (a bare word means arm=<word>).`,
].join('\n');

/** Strict, for the reason `measure-args.js` documents: a dropped flag is a silent lie. */
export function parseCompareArgs(argv = []) {
  const flags = new Map([
    ['--a', 'a'],
    ['--b', 'b'],
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
  if ((args.a && !args.b) || (args.b && !args.a)) {
    throw new MeasureArgError('a comparison needs both --a and --b');
  }
  return args;
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  let args;
  try {
    args = parseCompareArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof MeasureArgError)) throw e;
    console.error(`[measure:compare] ${e.message}\n\n${USAGE}`);
    process.exit(1);
  }

  const file = args.file || MEASUREMENTS_LEDGER;
  const records = readJsonLines(file);
  console.log(`${file} — ${records.length} line(s)`);

  if (!records.length) {
    console.log(
      '  empty — no measurement series has been recorded yet. Take one with `npm run measure`.',
    );
    process.exit(1);
  }
  if (!args.a) {
    console.log('');
    for (const line of describeMeasurements(records)) console.log(line);
    console.log('');
    console.log('  Name two arms to compare them:  --a <selector> --b <selector>');
    console.log('  Label a series when you take it:  npm run measure -- --arm before');
    process.exit(0);
  }

  let armA;
  let armB;
  try {
    armA = buildArm(args.a, records, parseSelector(args.a), args.field);
    armB = buildArm(args.b, records, parseSelector(args.b), args.field || armA.primary);
  } catch (e) {
    if (!(e instanceof MeasureArgError)) throw e;
    console.error(`[measure:compare] ${e.message}\n\n${USAGE}`);
    process.exit(1);
  }

  const verdict = comparability(armA, armB);
  console.log('');
  for (const line of reportComparison(armA, armB, verdict)) console.log(line);
  process.exit(verdict.refusals.length ? 1 : 0);
}
