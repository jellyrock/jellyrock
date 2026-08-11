/**
 * Hardware-free gate on the run record: the hour-boundary predicate, the
 * per-run-kind directory split, the append/read/reset round-trip, the run ledger,
 * and the printed summary.
 *
 * These are the parts a device run cannot check for you. The hour-crossing flag in
 * particular is a claim about a fixture that resets on the hour — if it were only
 * ever eyeballed, the one time it mattered would be the run where it was wrong,
 * and the whole point is to attribute a failure nobody was watching.
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device) — distinct from the
 * `.spec.js` files under `tests/rta/specs/`, which drive real hardware.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  crossesHourBoundary,
  appendJsonLine,
  readFailures,
  readRuns,
  resetFailures,
  runDir,
  summarizeRun,
  formatRunSummary,
} from '../../../scripts/run-record.js';
import { FAILURE_KINDS } from '../../../tests/rta/lib/diagnostics.js';

let tmpDir;
let file;

const recordFailure = (entry, target) => appendJsonLine(target, entry);

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rta-diag-'));
  file = path.join(tmpDir, 'nested', 'failures.jsonl');
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('crossesHourBoundary', () => {
  it('flags a run that straddles the top of the hour', () => {
    // The shape that motivates this: a ~13-minute suite starting after ~:46
    // loses its seeded state mid-run when the demo server resets.
    expect(crossesHourBoundary('2026-08-10T14:52:00Z', '2026-08-10T15:04:00Z')).toBe(true);
  });

  it('does not flag a long run that stays inside one hour', () => {
    expect(crossesHourBoundary('2026-08-10T14:01:00Z', '2026-08-10T14:59:59Z')).toBe(false);
  });

  it('flags a run ending exactly on the hour boundary', () => {
    expect(crossesHourBoundary('2026-08-10T14:59:00Z', '2026-08-10T15:00:00Z')).toBe(true);
  });

  it('does not flag #800 s window, which never crossed :00', () => {
    // 15:45–15:52 UTC — the run whose red is still unattributed. If this said
    // true it would hand that investigation a cause it does not have.
    expect(crossesHourBoundary('2026-08-10T15:45:00Z', '2026-08-10T15:52:00Z')).toBe(false);
  });

  it('returns false rather than throwing on an unparseable instant', () => {
    expect(crossesHourBoundary(undefined, '2026-08-10T15:00:00Z')).toBe(false);
    expect(crossesHourBoundary('2026-08-10T14:00:00Z', 'not-a-date')).toBe(false);
  });
});

describe('runDir — one directory per run kind', () => {
  // `writeRunMeta` is a full overwrite, so a shared path meant any device run
  // destroyed the previous one's record. These assertions ARE that guarantee.
  it('gives each device entry point its own directory', () => {
    const dirs = ['test:rta', 'capture-screenshots', 'demo', 'run-roku-tests'].map(runDir);
    expect(new Set(dirs).size).toBe(4);
  });

  it('keeps the Rooibos runner out of a path named for the RTA harness', () => {
    expect(runDir('run-roku-tests')).toBe(path.join('out', 'device'));
    expect(runDir('run-roku-tests')).not.toContain('rta');
  });

  it('shares one directory between the suite and its watch mode', () => {
    // Same records, same consumer — only the summary differs.
    expect(runDir('test:rta:tdd')).toBe(runDir('test:rta'));
  });

  it('gives an UNMAPPED run kind its own directory rather than aliasing onto rta', () => {
    // A default of `out/rta` would silently reintroduce the exact clobber the
    // split removes, and it would do so for the case nobody tested.
    const dir = runDir('some:new/runner');
    expect(dir).not.toBe(runDir('test:rta'));
    expect(dir).toBe(path.join('out', 'run-some-new-runner'));
  });
});

describe('the failure record round-trip', () => {
  it('creates the directory and appends one line per failure', () => {
    recordFailure({ kind: 'detail-row-not-found', at: '2026-08-10T15:02:00Z' }, file);
    recordFailure({ kind: 'wait-for-timeout', at: '2026-08-10T15:03:00Z' }, file);
    const read = readFailures(file);
    expect(read.map((f) => f.kind)).toEqual(['detail-row-not-found', 'wait-for-timeout']);
  });

  it('reads back an empty list when no run has written anything', () => {
    expect(readFailures(file)).toEqual([]);
  });

  it('skips a truncated final line instead of losing the whole file', () => {
    // What a SIGKILLed child leaves behind: the parent still needs the records
    // that did land.
    recordFailure({ kind: 'wait-for-timeout' }, file);
    fs.appendFileSync(file, '{"kind":"half-writ');
    expect(readFailures(file).map((f) => f.kind)).toEqual(['wait-for-timeout']);
  });

  it('reset drops a previous run s records', () => {
    recordFailure({ kind: 'stale' }, file);
    resetFailures(file);
    expect(readFailures(file)).toEqual([]);
  });

  it('reset is a no-op when there is nothing to clear', () => {
    expect(() => resetFailures(file)).not.toThrow();
  });
});

describe('the run ledger', () => {
  // The accumulator that makes an N-run baseline a read instead of N manual
  // copies — the run record is per-run and truncating, this one is not.
  it('accumulates one entry per run and survives a truncated line', () => {
    const ledger = path.join(tmpDir, 'runs.jsonl');
    appendJsonLine(ledger, summarizeRun({ startedAt: 'a', endedAt: 'b', run: 'test:rta' }));
    appendJsonLine(ledger, summarizeRun({ startedAt: 'c', endedAt: 'd', run: 'test:rta' }));
    fs.appendFileSync(ledger, '{"run":"half-writ');
    expect(readRuns(ledger).map((r) => r.startedAt)).toEqual(['a', 'c']);
  });
});

describe('summarizeRun', () => {
  it('reports the window, the duration and the crossing', () => {
    const summary = summarizeRun({
      startedAt: '2026-08-10T14:52:00Z',
      endedAt: '2026-08-10T15:04:00Z',
      failures: [],
    });
    expect(summary.durationMs).toBe(12 * 60 * 1000);
    expect(summary.crossedHourBoundary).toBe(true);
  });

  it('never reports a negative duration', () => {
    const summary = summarizeRun({
      startedAt: '2026-08-10T15:04:00Z',
      endedAt: '2026-08-10T14:52:00Z',
      failures: [],
    });
    expect(summary.durationMs).toBe(0);
  });

  it('collects the unregistered kinds, deduplicated', () => {
    const summary = summarizeRun({
      startedAt: '2026-08-10T14:02:00Z',
      endedAt: '2026-08-10T14:14:00Z',
      failures: [
        { kind: 'made-up', kindUnknown: true },
        { kind: 'made-up', kindUnknown: true },
        { kind: FAILURE_KINDS.WAIT_FOR_TIMEOUT },
      ],
    });
    expect(summary.unknownKinds).toEqual(['made-up']);
  });
});

describe('formatRunSummary', () => {
  it('says nothing about a clean run inside one hour', () => {
    // Silence on the happy path is the whole reason this can live in every run.
    expect(
      formatRunSummary(
        summarizeRun({
          startedAt: '2026-08-10T14:02:00Z',
          endedAt: '2026-08-10T14:14:00Z',
          failures: [],
        }),
      ),
    ).toEqual([]);
  });

  it('warns about an hour-crossing run even when every test passed', () => {
    // A green run that straddled the reset is still a run whose result was taken
    // against a fixture that changed underneath it.
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T15:04:00Z',
        failures: [],
      }),
    );
    expect(lines.join('\n')).toMatch(/crossed the top of the hour \(14:52→15:04 UTC\)/);
  });

  it('drops the hour warning for a cumulative watch session', () => {
    // Watch mode resets once at session start and folds once at exit, so any
    // session over an hour trips the flag. A flag that always fires is noise, and
    // it would be noisiest in the mode where you are already watching the output.
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T18:04:00Z',
        failures: [],
        cumulative: true,
      }),
    );
    expect(lines).toEqual([]);
  });

  it('labels a cumulative failure list as the session, not the run', () => {
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T18:04:00Z',
        failures: [{ at: '2026-08-10T15:01:00Z', kind: FAILURE_KINDS.WAIT_FOR_TIMEOUT }],
        cumulative: true,
      }),
    ).join('\n');
    expect(lines).toContain('this watch session');
    expect(lines).not.toContain('crossed the top of the hour');
  });

  it('names each failure with the state that was captured', () => {
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T15:04:00Z',
        failures: [
          {
            at: '2026-08-10T15:01:00Z',
            kind: FAILURE_KINDS.DETAIL_ROW_NOT_FOUND,
            test: 'screen "seasonDetails" loads',
            afterHourBoundary: true,
            state: {
              // ItemDetails extends JRScreen, which has no `loadState` — that
              // field is BaseGridView's. A detail-screen record legitimately
              // carries none, and the shell fields are what answer instead.
              view: { subtype: 'ItemDetails' },
              focus: { subtype: 'ExtrasRowList' },
              shell: { isLoading: false, isRemoteDisabled: false },
            },
          },
        ],
      }),
    ).join('\n');
    expect(lines).toContain('screen "seasonDetails" loads');
    expect(lines).toContain('detail-row-not-found');
    expect(lines).toContain('view=ItemDetails');
    expect(lines).toContain('[AFTER the hourly reset]');
    expect(lines).not.toContain('loadState=');
  });

  it('surfaces a swallowed-input failure in the roll-up', () => {
    // `isRemoteDisabled` means JRScene.onKeyEvent was returning true for every key
    // we sent — the north-star failure mode, and the one a roll-up must not bury.
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [
          {
            at: '2026-08-10T14:10:00Z',
            kind: FAILURE_KINDS.WAIT_FOCUSED_TIMEOUT,
            state: { shell: { isRemoteDisabled: true } },
          },
        ],
      }),
    ).join('\n');
    expect(lines).toContain('input=BLOCKED');
  });

  it('names the attempt for a screenshot retry, so a recovered screen reads as one', () => {
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [
          {
            at: '2026-08-10T14:10:00Z',
            kind: FAILURE_KINDS.GRID_LOAD_TIMEOUT,
            context: { screen: 'en_US/moviesLibrary', attempt: 1, attempts: 3 },
          },
        ],
      }),
    ).join('\n');
    expect(lines).toContain('en_US/moviesLibrary');
    expect(lines).toContain('(attempt 1)');
  });

  it('warns loudly about an unregistered kind, where the operator will see it', () => {
    // The bucket-split guard. This line lands in the artifact a baseline operator
    // reads after every run, so a forked bucket announces itself at the moment it
    // would corrupt the number.
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [{ at: '2026-08-10T14:10:00Z', kind: 'detail-rows-missing', kindUnknown: true }],
      }),
    ).join('\n');
    expect(lines).toContain('unregistered failure kind(s): detail-rows-missing');
    expect(lines).toContain('FAILURE_KINDS');
  });

  it('still names a failure whose device state could not be read', () => {
    // An unreachable device is itself the finding — it must not format away.
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [
          { at: '2026-08-10T14:10:00Z', kind: FAILURE_KINDS.WAIT_FOR_TIMEOUT, label: 'home rows' },
        ],
      }),
    ).join('\n');
    expect(lines).toContain('home rows');
    expect(lines).toContain('wait-for-timeout');
  });
});
