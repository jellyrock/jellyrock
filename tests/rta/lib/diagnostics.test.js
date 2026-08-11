/**
 * Hardware-free gate on the failure-diagnostics record: the hour-boundary
 * predicate, the append/read/reset round-trip, and the run summary.
 *
 * These are the parts a device run cannot check for you. The hour-crossing flag
 * in particular is a claim about a fixture that resets on the hour — if it were
 * only ever eyeballed, the one time it mattered would be the run where it was
 * wrong, and the whole point is to attribute a failure nobody was watching.
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device) — distinct from the
 * `.spec.js` files under `specs/`, which drive real hardware.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  crossesHourBoundary,
  recordFailure,
  readFailures,
  resetFailures,
  summarizeRun,
  formatRunSummary,
} from './diagnostics.js';

let tmpDir;
let file;

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

  it('names each failure with the state that was captured', () => {
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T15:04:00Z',
        failures: [
          {
            at: '2026-08-10T15:01:00Z',
            kind: 'detail-row-not-found',
            test: 'screen "seasonDetails" loads',
            afterHourBoundary: true,
            state: {
              view: { subtype: 'ItemDetails', loadState: 'loaded' },
              focus: { subtype: 'RowList' },
            },
          },
        ],
      }),
    ).join('\n');
    expect(lines).toContain('screen "seasonDetails" loads');
    expect(lines).toContain('detail-row-not-found');
    expect(lines).toContain('view=ItemDetails');
    expect(lines).toContain('loadState=loaded');
    expect(lines).toContain('[AFTER the hourly reset]');
  });

  it('still names a failure whose device state could not be read', () => {
    // An unreachable device is itself the finding — it must not format away.
    const lines = formatRunSummary(
      summarizeRun({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [{ at: '2026-08-10T14:10:00Z', kind: 'wait-for-timeout', label: 'home rows' }],
      }),
    ).join('\n');
    expect(lines).toContain('home rows');
    expect(lines).toContain('wait-for-timeout');
  });
});
