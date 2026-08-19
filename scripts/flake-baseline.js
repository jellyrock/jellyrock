/**
 * The run ledger's READER: turn N recorded runs into a flake rate you can defend.
 *
 *   npm run flake-baseline                                  describe the ledger
 *   npm run flake-baseline -- --commit HEAD --device <key>  compute a rate
 *   npm run flake-baseline -- --run run-roku-tests          the Rooibos ledger
 *
 * ## Why this is code and not a snippet in the docs
 *
 * It was a snippet, in two places, and it was WRONG in three different ways inside
 * one PR cycle: it filtered `variant === 'test:rta'` while the protocol says to use
 * `test:rta:fast` for runs 2..N (so it selected exactly the first run and reported a
 * one-sample baseline); it counted `outcome !== 'passed'` as a failure while the run
 * summary told the operator to exclude a crashed run; and the copy in the project
 * plan still carried the second bug after the doc copy was fixed. Every one of those
 * produced a plausible-looking number rather than an error.
 *
 * None of them were bugs in the ledger. They were bugs in a recipe a human retypes,
 * which is the shape of work that belongs in a script: one correct output for a
 * given input, run ~10 times per baseline series, and regression-testable. The docs
 * now explain WHY the filter is what it is and point here for the filter itself.
 *
 * ## Why the exclusions are output, not a silent `filter`
 *
 * The selection is deliberately strict — five keys, and a run must satisfy all of
 * them — so the ordinary failure is selecting FEWER runs than you think, or none.
 * A bare `filter` reports that as a small number or a `NaN`, both of which read as
 * an answer. Every excluded row is therefore counted and attributed, and a
 * zero-sample selection refuses to produce a rate at all.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { readRuns, runDir, RUN_OUTCOMES, SAMPLE_OUTCOMES } from './run-record.js';

/**
 * The variants that measure the same thing for a FLAKE rate.
 *
 * The protocol is one `test:rta` followed by `test:rta:fast` for runs 2..N, so that
 * the series measures one binary instead of N rebuilds of it — which means the
 * series spans two variant names by construction, and an equality filter on either
 * one silently reports a fraction of the runs taken. They are NOT interchangeable
 * for a DURATION comparison: `:fast` skips the deploy and is ~30 s shorter.
 */
export const FLAKE_VARIANTS = ['test:rta', 'test:rta:fast'];

/** The ledger a run kind appends to — derived from `runDir`, never a second mapping. */
export const ledgerFor = (run) =>
  path.join('.device-runs', path.basename(runDir(run)), 'runs.jsonl');

/**
 * Partition a ledger into the runs a baseline may count and the runs it may not.
 *
 * Every criterion is optional: omit one and it does not filter, which is what lets
 * the same function back both the describe mode and the rate mode. Each excluded row
 * is attributed to exactly ONE reason, first match wins, ordered from "not this
 * series at all" to "this series, but not usable evidence" — so the counts sum to
 * the rows read and a reader can see which criterion is doing the work.
 */
export function selectBaseline(runs, { commit, deviceKey, variants } = {}) {
  const wanted = variants ? new Set(variants) : undefined;
  const excluded = { otherCommit: 0, otherDevice: 0, otherVariant: 0, dirty: 0, nonSample: 0 };
  const nonSampleOutcomes = {};
  const samples = [];

  for (const r of runs) {
    if (commit !== undefined && r.commit !== commit) excluded.otherCommit++;
    else if (deviceKey !== undefined && r.deviceKey !== deviceKey) excluded.otherDevice++;
    else if (wanted && !wanted.has(r.variant)) excluded.otherVariant++;
    // A dirty tree is excluded rather than recorded-and-mixed because `dirty: true`
    // carries no content hash: two dirty runs are not provably the same code, which
    // is the one thing a baseline's `commit` key exists to establish.
    else if (r.dirty) excluded.dirty++;
    else if (!SAMPLE_OUTCOMES.has(r.outcome)) {
      excluded.nonSample++;
      const key = r.outcome ?? 'unrecorded';
      nonSampleOutcomes[key] = (nonSampleOutcomes[key] || 0) + 1;
    } else samples.push(r);
  }

  const failed = samples.filter((r) => r.outcome === RUN_OUTCOMES.FAILED).length;
  return {
    samples,
    passed: samples.length - failed,
    failed,
    // `null`, never `NaN`: an empty selection is the ordinary outcome of an
    // over-tight filter, and `0/0` printed as a percentage reads like a result.
    rate: samples.length ? failed / samples.length : null,
    excluded,
    nonSampleOutcomes,
  };
}

/** P(X <= k) for X ~ Binomial(n, p), summed iteratively so no factorial overflows. */
function binomialCdf(k, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let term = (1 - p) ** n; // i = 0
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term *= ((n - i + 1) / i) * (p / (1 - p));
    sum += term;
  }
  return Math.min(1, sum);
}

/**
 * The one-sided Clopper–Pearson upper bound on the true flake probability.
 *
 * This exists because the interesting result is the one the point estimate cannot
 * express: **a clean series does not measure a 0% flake rate.** Six green runs bound
 * the per-run probability at 39%, ten at 26%, thirty at 10% — so "0/8, we fixed it"
 * is a claim the data does not support, and no affordable N makes it one. Reporting
 * the bound beside the estimate is what keeps a green series honest, and it is also
 * why a single RED run is worth so much more than one more green one.
 *
 * Solved by bisection on `binomialCdf`, which is monotone decreasing in `p`; exact
 * to ~1e-30 in 100 halvings, and `n` here is single digits.
 */
export function flakeUpperBound(failures, n, confidence = 0.95) {
  if (!n) return null;
  if (failures >= n) return 1;
  const alpha = 1 - confidence;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(failures, n, mid) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/** `a ×2   b ×1`, commonest first — one describe-mode row per filter key. */
function tally(runs, valueOf) {
  const counts = {};
  for (const r of runs) {
    const k = valueOf(r) ?? '(unrecorded)';
    counts[k] = (counts[k] || 0) + 1;
  }
  return (
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ×${n}`)
      .join('   ') || '(none)'
  );
}

/**
 * What is IN the ledger, for before a series has been named.
 *
 * One row per selection key, because the keys are exactly what the operator has to
 * supply and the ledger records a device as a HASH — so without this, learning the
 * value to filter on means running `device:status` against each Roku in turn.
 */
export function describeLedger(runs) {
  return [
    `  variant     ${tally(runs, (r) => r.variant)}`,
    `  device      ${tally(runs, (r) => r.deviceKey)}`,
    `  commit      ${tally(runs, (r) => r.commit)}`,
    `  outcome     ${tally(runs, (r) => r.outcome)}`,
    `  tree        ${tally(runs, (r) => (r.dirty == null ? null : r.dirty ? 'dirty' : 'clean'))}`,
    // Not a selection key like the four above — you cannot filter on it, and the
    // rate mode warns rather than excludes. It is here because it is the one
    // property of a run that invalidates a series without changing any of them.
    `  hour        ${tally(runs, (r) =>
      r.crossedHourBoundary == null
        ? null
        : r.crossedHourBoundary
          ? 'crossed :00'
          : 'inside one hour',
    )}`,
  ];
}

/**
 * How many of a selection ran across the demo server's hourly reset.
 *
 * Counted over SAMPLES, not over the whole ledger: a run excluded for a dirty tree
 * or a wrong commit cannot contaminate a rate it is not in.
 *
 * `crossedHourBoundary` is written by `summarizeRun` on every close, so an absent
 * value means a hand-edited or truncated line rather than a run that did not cross.
 * Counted separately for that reason — treating unknown as `false` is precisely the
 * "silently assume the good case" move this whole field exists to prevent.
 */
export function hourCrossings(samples) {
  let crossed = 0;
  let unknown = 0;
  for (const r of samples) {
    if (r.crossedHourBoundary === true) crossed++;
    else if (r.crossedHourBoundary == null) unknown++;
  }
  return { crossed, unknown };
}

/** Lines reporting a selected series: what counted, what did not, and the rate. */
export function reportBaseline(result) {
  const { samples, passed, failed, rate, excluded, nonSampleOutcomes } = result;
  const reasons = [
    [excluded.otherCommit, 'other commit'],
    [excluded.otherDevice, 'other device'],
    [excluded.otherVariant, 'other variant'],
    [excluded.dirty, 'dirty tree'],
    [
      excluded.nonSample,
      `not a sample (${Object.entries(nonSampleOutcomes)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ')})`,
    ],
  ]
    .filter(([n]) => n > 0)
    .map(([n, why]) => `${n} ${why}`);

  const lines = [
    `  samples     ${samples.length}${samples.length ? `   (${passed} passed, ${failed} failed)` : ''}`,
    `  excluded    ${Object.values(excluded).reduce((a, b) => a + b, 0)}${
      reasons.length ? `   ${reasons.join(' · ')}` : ''
    }`,
    '',
  ];

  if (rate === null) {
    lines.push(
      '  no rate — 0 runs selected. A rate over zero runs is not 0%; it is not a rate.',
      '  Widen the selection, or take the series: one `test:rta` then `test:rta:fast` for runs 2..N.',
    );
    return lines;
  }

  const bound = flakeUpperBound(failed, samples.length);
  lines.push(
    `  flake rate  ${failed}/${samples.length} = ${pct(rate)}   95% upper bound ${pct(bound)}`,
  );

  // Warned, never excluded — and printed BEFORE the clean-series note, because it
  // qualifies the number both of those lines are about.
  //
  // Not an exclusion because whether it invalidates the series depends on the
  // PROPORTION, which is a judgment the operator can only make with the count in
  // front of them: 1 of 8 is noise, 5 of 8 is measuring the fixture. Dropping them
  // silently would also shrink the population, which widens the bound without
  // saying why.
  //
  // This exists because everything above it is exact and this was not reported at
  // all: a series could carry a rate AND a 95% bound with no signal that most of it
  // straddled a reset — and a confidence interval over a contaminated population
  // reads as rigour, which is worse than no tool.
  const { crossed, unknown } = hourCrossings(samples);
  if (crossed || unknown) {
    const parts = [];
    if (crossed) parts.push(`${crossed} of ${samples.length} samples crossed the top of the hour`);
    if (unknown) parts.push(`${unknown} did not record the flag (hand-edited line?)`);
    lines.push(
      `  ⚠ ${parts.join('; ')}.`,
      `  The demo server resets then, so those ran against a fixture that changed underneath`,
      `  them. NOT excluded — whether it matters is the proportion, which is a judgment only`,
      `  you can make: a rate drawn mostly from crossing runs measures the fixture, not the app.`,
    );
  }

  if (failed === 0) {
    // The instruction this replaces lived in a local planning note as a note-to-self,
    // which is the wrong place for the one conclusion a clean series most invites getting
    // wrong — it belongs in the output, where whoever reads the number reads it too.
    lines.push(
      `  A clean series BOUNDS the rate, it does not measure 0% — report "consistent with`,
      `  fixed, upper bound ${pct(bound)}", never a measured zero. One red run would say far more.`,
    );
  }
  return lines;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const run = arg('run') || 'test:rta';
  const deviceKey = arg('device');
  let commit = arg('commit');
  // `HEAD` resolved here rather than made the default: defaulting would mean the
  // no-argument invocation silently selects a series, and the no-argument
  // invocation's job is to show you what is in the ledger before you filter it.
  if (commit === 'HEAD') {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  }

  const file = ledgerFor(run);
  const runs = readRuns(file);
  console.log(`${file} — ${runs.length} line(s)`);

  if (!runs.length) {
    console.log('  empty — no run has closed against this ledger yet.');
  } else if (commit === undefined && deviceKey === undefined) {
    console.log('');
    for (const line of describeLedger(runs)) console.log(line);
    console.log('');
    console.log('  Name a series to get a rate:  --commit <sha|HEAD> --device <key>');
    console.log('  Device keys come from `npm run device:status`.');
  } else {
    // Defaulted only for the RTA ledger, whose two-variant protocol is a documented
    // trap. The Rooibos ledger carries `test:unit` / `test:integration` / `test:all`
    // — different SUITES, not one suite deployed two ways — so guessing a set there
    // would silently mix them. Left unfiltered instead, and named as such.
    const variants =
      arg('variant')?.split(',') ?? (run === 'test:rta' ? FLAKE_VARIANTS : undefined);
    console.log(
      `  selecting   commit ${commit ?? 'any'} · device ${deviceKey ?? 'any'} · variants ${
        variants ? variants.join(', ') : 'any'
      }`,
    );
    console.log('');
    for (const line of reportBaseline(selectBaseline(runs, { commit, deviceKey, variants })))
      console.log(line);
  }
}
