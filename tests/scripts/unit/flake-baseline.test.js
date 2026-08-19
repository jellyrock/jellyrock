/**
 * The ledger's reader — see `scripts/flake-baseline.js`.
 *
 * These gates exist because every version of this logic that lived as a DOC SNIPPET
 * was wrong: `variant === 'test:rta'` selected only the first run of a series, and
 * `outcome !== 'passed'` counted a crashed run as a failure. Both produced a
 * plausible number rather than an error, which is the whole reason the selection
 * moved into code — so the cases that used to be prose caveats are asserted here.
 */
import { describe, expect, it } from 'vitest';

import {
  FLAKE_VARIANTS,
  describeLedger,
  flakeUpperBound,
  ledgerFor,
  hourCrossings,
  reportBaseline,
  selectBaseline,
} from '../../../scripts/flake-baseline.js';

/** A ledger row with everything a baseline needs, overridable per case. */
const row = (over = {}) => ({
  run: 'test:rta',
  variant: 'test:rta',
  commit: 'abc1234',
  dirty: false,
  deviceKey: 'dev-a',
  outcome: 'passed',
  // `summarizeRun` writes this on every close, so a complete ledger line always
  // carries it. Cases that need an ABSENT flag delete it explicitly, below.
  crossedHourBoundary: false,
  ...over,
});

/** A row from before the flag existed, or a hand-edited one. */
const rowWithoutHourFlag = () => {
  const r = row();
  delete r.crossedHourBoundary;
  return r;
};

const CRITERIA = { commit: 'abc1234', deviceKey: 'dev-a', variants: FLAKE_VARIANTS };

describe('selecting a baseline series', () => {
  it('counts a rate over the runs that reached a verdict', () => {
    const runs = [row(), row(), row({ outcome: 'failed' }), row()];
    const sel = selectBaseline(runs, CRITERIA);
    expect([sel.samples.length, sel.passed, sel.failed]).toEqual([4, 3, 1]);
    expect(sel.rate).toBeCloseTo(0.25);
  });

  it('keeps the `:fast` runs, which ARE the series from run 2 onwards', () => {
    // The trap the recipe shipped with: the protocol is one `test:rta` then
    // `test:rta:fast` for runs 2..N, so an equality filter reports a one-sample
    // baseline from a six-run series and nothing says so.
    const runs = [row(), ...Array.from({ length: 5 }, () => row({ variant: 'test:rta:fast' }))];
    expect(selectBaseline(runs, CRITERIA).samples).toHaveLength(6);
  });

  it('drops a non-sample from the population rather than counting it red', () => {
    // The second recipe bug: `outcome !== 'passed'` made a deploy 401 a failure. A
    // crashed run is not evidence about the app in either direction.
    const runs = [row(), row(), row({ outcome: 'crashed' }), row({ outcome: 'interrupted' })];
    const sel = selectBaseline(runs, CRITERIA);
    expect(sel.rate).toBe(0); // 0 of 2 samples, not 2 of 4
    expect(sel.excluded.nonSample).toBe(2);
    expect(sel.nonSampleOutcomes).toEqual({ crashed: 1, interrupted: 1 });
  });

  it('treats an unrecorded outcome as a non-sample, not as a pass', () => {
    // Every ledger line written before the field existed, plus anything a future
    // entry point forgets to label. Assuming `passed` is the reading that hides a
    // real failure.
    const sel = selectBaseline([row({ outcome: null }), row()], CRITERIA);
    expect(sel.samples).toHaveLength(1);
    expect(sel.nonSampleOutcomes).toEqual({ unrecorded: 1 });
  });

  it('separates runs on another device, which the other keys cannot', () => {
    // `variant` and `commit` are identical across a baseline's runs BY
    // CONSTRUCTION, so they are exactly the two keys that cannot catch a stray run
    // on a second Roku.
    const sel = selectBaseline([row(), row({ deviceKey: 'dev-b' })], CRITERIA);
    expect(sel.samples).toHaveLength(1);
    expect(sel.excluded.otherDevice).toBe(1);
  });

  it('excludes a dirty tree, whose commit does not describe the code that ran', () => {
    const sel = selectBaseline([row(), row({ dirty: true })], CRITERIA);
    expect(sel.samples).toHaveLength(1);
    expect(sel.excluded.dirty).toBe(1);
  });

  it('attributes every excluded row to exactly one reason', () => {
    // So the counts sum to what was read: a reader can tell "my filter is too
    // tight" from "the ledger is empty", and neither reads as a rate.
    const runs = [
      row(),
      row({ commit: 'other' }),
      row({ deviceKey: 'dev-b' }),
      row({ variant: 'test:rta:tdd' }),
      row({ dirty: true }),
      row({ outcome: 'crashed' }),
    ];
    const sel = selectBaseline(runs, CRITERIA);
    const total = Object.values(sel.excluded).reduce((a, b) => a + b, 0);
    expect(total + sel.samples.length).toBe(runs.length);
    expect(sel.excluded).toEqual({
      otherCommit: 1,
      otherDevice: 1,
      otherVariant: 1,
      dirty: 1,
      nonSample: 1,
    });
  });

  it('filters on nothing it was not given, so one function backs both modes', () => {
    expect(
      selectBaseline([row(), row({ commit: 'other', deviceKey: 'dev-b' })], {}).samples,
    ).toHaveLength(2);
  });
});

describe('a selection that finds nothing', () => {
  it('reports no rate rather than NaN', () => {
    // `0/0` is the ordinary result of an over-tight filter, and as a percentage it
    // renders as a number — which is how an empty selection reads as an answer.
    const sel = selectBaseline([row({ dirty: true })], CRITERIA);
    expect(sel.rate).toBeNull();
    expect(sel.samples).toHaveLength(0);
  });

  it('says so in words, and does not print a percentage', () => {
    const text = reportBaseline(selectBaseline([row({ dirty: true })], CRITERIA)).join('\n');
    expect(text).toContain('no rate');
    expect(text).toContain('1 dirty tree');
    // No COMPUTED figure — the prose still says the words "not 0%", which is the
    // point being made rather than a result being reported.
    expect(text).not.toContain('flake rate');
    expect(text).not.toMatch(/=\s*[\d.]+%/);
  });
});

describe('the upper bound on a clean series', () => {
  // Derived here rather than copied from anywhere: a clean series of N runs bounds the
  // per-run flake probability, and no affordable N brings that bound near zero. This is
  // the claim a green baseline is allowed to make.
  it.each([
    [4, 0.53],
    [6, 0.39],
    [10, 0.26],
    [30, 0.1],
  ])('bounds %i clean runs at ~%f', (n, expected) => {
    expect(flakeUpperBound(0, n)).toBeCloseTo(expected, 2);
  });

  it('closed form for zero failures — 1 - 0.05^(1/n)', () => {
    // Cross-checks the bisection against the analytic answer it should reproduce.
    for (const n of [1, 5, 12, 40]) {
      expect(flakeUpperBound(0, n)).toBeCloseTo(1 - 0.05 ** (1 / n), 9);
    }
  });

  it('widens as failures appear, and is 1 when every run failed', () => {
    expect(flakeUpperBound(1, 10)).toBeGreaterThan(flakeUpperBound(0, 10));
    expect(flakeUpperBound(3, 3)).toBe(1);
  });

  it('has no bound to report without samples', () => {
    expect(flakeUpperBound(0, 0)).toBeNull();
  });

  it('refuses to let a clean series be reported as a measured zero', () => {
    const text = reportBaseline(
      selectBaseline(
        Array.from({ length: 6 }, () => row()),
        CRITERIA,
      ),
    ).join('\n');
    expect(text).toContain('0/6 = 0.0%');
    expect(text).toContain('95% upper bound 39.3%');
    expect(text).toContain('does not measure 0%');
  });
});

describe('describing a ledger nobody has filtered yet', () => {
  it('names the device keys, which are hashes a reader cannot guess', () => {
    const text = describeLedger([row(), row(), row({ deviceKey: 'dev-b' })]).join('\n');
    expect(text).toContain('dev-a ×2');
    expect(text).toContain('dev-b ×1');
  });

  it('labels a missing key rather than dropping the row from its tally', () => {
    const text = describeLedger([row({ commit: null, outcome: null })]).join('\n');
    expect(text.match(/\(unrecorded\)/g)).toHaveLength(2);
  });

  it('reads the tree state as words, since `dirty: false` is the useful one', () => {
    const text = describeLedger([row(), row({ dirty: true })]).join('\n');
    expect(text).toContain('clean ×1');
    expect(text).toContain('dirty ×1');
  });
});

describe('the hourly reset, which invalidates a series without changing any run', () => {
  const crossing = (n) => Array.from({ length: n }, () => row({ crossedHourBoundary: true }));
  const inside = (n) => Array.from({ length: n }, () => row({ crossedHourBoundary: false }));
  const rate = (runs) => reportBaseline(selectBaseline(runs, CRITERIA)).join('\n');

  it('counts crossings over the SAMPLES, not the whole ledger', () => {
    // A run excluded for a dirty tree cannot contaminate a rate it is not in.
    const runs = [...inside(2), row({ dirty: true, crossedHourBoundary: true })];
    expect(hourCrossings(selectBaseline(runs, CRITERIA).samples).crossed).toBe(0);
  });

  it('warns on the rate, naming the proportion the operator has to judge', () => {
    const text = rate([...crossing(3), ...inside(5)]);
    expect(text).toContain('3 of 8 samples crossed the top of the hour');
    expect(text).toContain('measures the fixture, not the app');
  });

  it('warns WITHOUT excluding — the population is untouched', () => {
    // Dropping them would shrink n and widen the bound without saying why.
    const sel = selectBaseline([...crossing(3), ...inside(5)], CRITERIA);
    expect(sel.samples).toHaveLength(8);
    expect(reportBaseline(sel).join('\n')).toContain('8 = 0.0%');
  });

  it('stays silent when no sample crossed — silence is the clean signal', () => {
    expect(rate(inside(4))).not.toMatch(/top of the hour/);
  });

  it('counts an ABSENT flag separately rather than reading it as "did not cross"', () => {
    // `summarizeRun` writes the field on every close, so absence means a hand-edited
    // or truncated line. Treating unknown as false is the assume-the-good-case move
    // this field exists to prevent.
    const { crossed, unknown } = hourCrossings([rowWithoutHourFlag(), row()]);
    expect([crossed, unknown]).toEqual([0, 1]);
    expect(rate([rowWithoutHourFlag(), ...inside(3)])).toContain('did not record the flag');
  });

  it('shows the split in describe mode, before a series has been named', () => {
    const text = describeLedger([...crossing(1), ...inside(2)]).join('\n');
    expect(text).toContain('crossed :00 ×1');
    expect(text).toContain('inside one hour ×2');
  });
});

describe('which ledger a run kind reads', () => {
  it('derives the path from the record module, with no second mapping', () => {
    expect(ledgerFor('test:rta')).toBe('.device-runs/rta/runs.jsonl');
    expect(ledgerFor('run-roku-tests')).toBe('.device-runs/device/runs.jsonl');
  });
});
