/**
 * Hardware-free gate on the run record: the hour-boundary predicate, the
 * per-run-kind directory split, the append/read/reset round-trip, the run ledger,
 * the printed summary, and the begin/end lifecycle that resolves where all of it
 * lands.
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
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  crossesHourBoundary,
  appendJsonLine,
  readFailures,
  readRuns,
  resetFailures,
  runDir,
  summarizeRun,
  formatRunSummary,
  RUN_OUTCOMES,
} from '../../../scripts/run-record.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Failure-kind slugs as LITERALS, deliberately — not imported from
 * `tests/rta/lib/diagnostics.js`.
 *
 * `run-record.js` treats `kind` as an opaque string, and that is the whole point of
 * the module split (`decisions.md` -> `run-record-per-run-kind`): it is what lets the
 * Rooibos runner share this record without dragging the RTA harness in. A test that
 * imported `FAILURE_KINDS` to spell them would re-couple exactly what the split
 * decoupled — and would pull `roku-test-automation` (~250 ms of import) into a suite
 * whose entire premise is that it needs no device. The registry's own invariants —
 * uniqueness, kebab-case, frozen-ness — are gated next door in
 * `tests/rta/lib/diagnostics.test.js`, which is the module that owns them.
 */
const WAIT_FOR_TIMEOUT = 'wait-for-timeout';
const WAIT_FOCUSED_TIMEOUT = 'wait-focused-timeout';
const GRID_LOAD_TIMEOUT = 'grid-load-timeout';
const DETAIL_ROW_NOT_FOUND = 'detail-row-not-found';

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
    // The shape that motivates this: a ~13-minute suite starting after ~:46 has
    // the demo server's top-of-hour reset land mid-run, changing the server's own
    // content and any state the run created through the app.
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

describe('the run ledger lives outside the build output directory', () => {
  // THE regression gate for a bug that shipped invisibly: the ledger was under
  // `out/`, and all eight `build*` npm scripts open with `npx rimraf build/ out/`.
  // `npm run test:rta` builds first, so the file was deleted immediately before
  // each run that was meant to append to it — the documented N-run baseline would
  // have ended with exactly one line, and nothing would have said so.
  const buildScriptsWipeOut = () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return Object.entries(pkg.scripts)
      .filter(([name]) => name.startsWith('build'))
      .filter(([, body]) => /rimraf[^&|]*\bout\//.test(body))
      .map(([name]) => name);
  };

  it('is not under out/, which every build script deletes', async () => {
    const { runsLedgerPath: ledgerPath } = await import('../../../scripts/run-record.js');
    expect(ledgerPath().startsWith(`out${path.sep}`)).toBe(false);
  });

  it('documents the reason: build scripts really do rimraf out/', () => {
    // Pinned against package.json rather than asserted in prose, so the day a
    // build stops wiping `out/` this says so instead of silently over-protecting.
    expect(buildScriptsWipeOut().length).toBeGreaterThan(0);
    expect(buildScriptsWipeOut()).toContain('build');
  });

  it('keeps the per-run files in out/, where a wipe is harmless', async () => {
    // They are truncated at open anyway, so nothing is lost — and keeping them
    // beside the build output is what makes `out/rta/` one place to look.
    const { failuresPath: fp } = await import('../../../scripts/run-record.js');
    expect(fp().startsWith(`out${path.sep}`)).toBe(true);
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

describe('the run lifecycle — where a run s records actually land', () => {
  // The rest of this file passes explicit file paths, which means the mechanism
  // that CHOOSES those paths had no gate: a regression in `getRunDir`'s precedence
  // would silently send a screenshots run's records into `out/rta/` — the exact
  // clobber the per-kind split exists to remove — with every other test still
  // green. These exercise the real relative-path resolution by chdir'ing into a
  // temp root, and re-import the module per case so the module-level run state
  // (active directory, start-time cache, close guard) cannot leak between them.
  const LOCK = { meta: { locked: true, mode: 'test', degraded: false } };
  let cwd;
  let maxListeners;

  const fresh = () => {
    vi.resetModules();
    return import('../../../scripts/run-record.js');
  };

  // Each `fresh()` mints a NEW module instance whose `netArmed` starts false, so
  // every one arms its own `process.on('exit')` net on the single real process —
  // and past ten of them Node warns about a listener leak. That warning is an
  // artifact of the harness, not of the module: production loads `run-record.js`
  // once per process and `netArmed` holds it to exactly one listener. Raised (and
  // restored) here rather than worked around in the module, so a genuine leak
  // warning elsewhere still means something.
  beforeAll(() => {
    maxListeners = process.getMaxListeners();
    process.setMaxListeners(maxListeners + 40);
  });
  afterAll(() => process.setMaxListeners(maxListeners));

  beforeEach(() => {
    cwd = process.cwd();
    process.chdir(tmpDir);
    delete process.env.RTA_RUN_DIR;
  });
  afterEach(() => {
    process.chdir(cwd);
    delete process.env.RTA_RUN_DIR;
  });

  describe('getRunDir precedence', () => {
    it('falls back to out/rta for a bare read with no lifecycle', async () => {
      const { getRunDir } = await fresh();
      expect(getRunDir()).toBe(path.join('out', 'rta'));
    });

    it('takes RTA_RUN_DIR next — the only channel a spawned child has', async () => {
      // The Vitest child is a separate process and cannot inherit module state, so
      // if this stops being read the suite's failure records go to the fallback.
      process.env.RTA_RUN_DIR = path.join('out', 'screenshots');
      const { getRunDir } = await fresh();
      expect(getRunDir()).toBe(path.join('out', 'screenshots'));
    });

    it('lets beginRun override both, and hands the child the same directory', async () => {
      process.env.RTA_RUN_DIR = path.join('out', 'stale-from-an-outer-run');
      const { beginRun, getRunDir, runDir: dirFor } = await fresh();
      const run = beginRun({ lock: LOCK, run: 'capture-screenshots' });
      expect(getRunDir()).toBe(dirFor('capture-screenshots'));
      // What the parent passes into `spawn` must be what the parent later reads.
      expect(run.env.RTA_RUN_DIR).toBe(getRunDir());
      run.close();
    });
  });

  describe('beginRun', () => {
    it('stamps an origin that runStartedAt reads back', async () => {
      // The child stamps every failure against this, so a record that cannot be
      // read back cannot be placed relative to the hourly reset.
      const { beginRun, runStartedAt } = await fresh();
      const run = beginRun({ lock: LOCK, run: 'test:rta' });
      expect(runStartedAt()).toBe(run.startedAt);
      run.close();
    });

    it('clears the previous run s failures, so a fold sees only this run', async () => {
      const { beginRun, failuresPath, recordFailure, readFailures } = await fresh();
      const first = beginRun({ lock: LOCK, run: 'test:rta' });
      recordFailure({ kind: WAIT_FOR_TIMEOUT, at: '2026-08-10T14:10:00Z' });
      expect(readFailures(failuresPath())).toHaveLength(1);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      first.close();
      vi.restoreAllMocks();

      const second = beginRun({ lock: LOCK, run: 'test:rta' });
      expect(readFailures(failuresPath())).toEqual([]);
      second.close();
    });

    it('re-opens the origin for a second run rather than serving a cached one', async () => {
      // `runStartedAt` caches; a stale cache would stamp run 2's failures with run
      // 1's window, which is precisely the attribution the record exists for.
      //
      // The clock is FAKED because the two opens otherwise land in the same
      // millisecond and mint an identical ISO string — which makes the assertion
      // pass whether the cache was invalidated or not. (Measured: the real-clock
      // version failed 7 of 8 runs.)
      const { beginRun, runStartedAt } = await fresh();
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-08-10T14:00:00Z'));
        const first = beginRun({ lock: LOCK, run: 'test:rta' });
        expect(runStartedAt()).toBe(first.startedAt);
        first.close();

        vi.setSystemTime(new Date('2026-08-10T15:30:00Z'));
        const second = beginRun({ lock: LOCK, run: 'test:rta' });
        expect(second.startedAt).not.toBe(first.startedAt);
        expect(runStartedAt()).toBe(second.startedAt);
        second.close();
      } finally {
        vi.useRealTimers();
      }
    });

    it('stamps `cumulative` into the OPEN s record, where a child can read it', async () => {
      // Asserted BEFORE any close, because that is the whole point: the closed
      // summary also carries `cumulative`, but a spawned child needs it WHILE the
      // run is in flight. It is what tells the child its origin belongs to a
      // session rather than an iteration — without which every failure past the
      // first hour of a watch session is stamped as post-reset.
      const { beginRun, runIsCumulative } = await fresh();
      const run = beginRun({ lock: LOCK, run: 'test:rta:tdd', cumulative: true });
      expect(runIsCumulative()).toBe(true);
      const meta = JSON.parse(fs.readFileSync(path.join(run.dir, 'run-meta.json'), 'utf8'));
      expect(meta.cumulative).toBe(true);
      run.close();
    });

    it('leaves an ordinary run s record unchanged — no cumulative key at all', async () => {
      // Omitted rather than written false, matching `summarizeRun`. A single run is
      // the common case and its record should not grow a field to say so.
      const { beginRun, runIsCumulative } = await fresh();
      const run = beginRun({ lock: LOCK, run: 'test:rta' });
      expect(runIsCumulative()).toBe(false);
      const meta = JSON.parse(fs.readFileSync(path.join(run.dir, 'run-meta.json'), 'utf8'));
      expect(meta).not.toHaveProperty('cumulative');
      run.close();
    });

    it('re-reads `cumulative` for a second run rather than serving a cached one', async () => {
      // `runStartedAt` and `runIsCumulative` share one cached parse, so an
      // invalidation bug would strand the FLAG as well as the origin — and a watch
      // session opened after a normal run would silently stamp its failures.
      const { beginRun, runIsCumulative } = await fresh();
      beginRun({ lock: LOCK, run: 'test:rta' }).close();
      expect(runIsCumulative()).toBe(false);
      const watch = beginRun({ lock: LOCK, run: 'test:rta:tdd', cumulative: true });
      expect(runIsCumulative()).toBe(true);
      watch.close();
    });
  });

  describe('endRun', () => {
    it('folds the failures into run-meta and appends one ledger line', async () => {
      const { beginRun, recordFailure, readRuns: ledger, runsLedgerPath } = await fresh();
      const run = beginRun({ lock: LOCK, run: 'run-roku-tests' });
      recordFailure({ kind: WAIT_FOR_TIMEOUT, at: '2026-08-10T14:10:00Z' });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const summary = run.close();
      vi.restoreAllMocks();

      expect(summary.failures).toHaveLength(1);
      const meta = JSON.parse(fs.readFileSync(path.join(run.dir, 'run-meta.json'), 'utf8'));
      expect(meta.failures).toHaveLength(1);
      expect(meta.locked).toBe(true); // lock provenance survives the fold
      expect(ledger(runsLedgerPath())).toHaveLength(1);
    });

    it('is idempotent, so the exit net cannot double-count a closed run', async () => {
      // `beginRun` arms a process-exit net; an entry point that also closes
      // explicitly would otherwise append the same run to the ledger twice, and an
      // N-run baseline cannot absorb a miscount it has no way to see.
      const { beginRun, readRuns: ledger, runsLedgerPath } = await fresh();
      const run = beginRun({ lock: LOCK, run: 'test:rta' });
      const first = run.close();
      const second = run.close();

      expect(second).toBe(first); // the same summary object, not a fresh fold
      expect(ledger(runsLedgerPath())).toHaveLength(1);
    });

    it('carries the open s cumulative flag, so an abandoned watch session is labelled', async () => {
      // Watch mode declares `cumulative` at the OPEN because the exit net may be
      // what closes it, and the net only knows what `beginRun` was told.
      const { beginRun, readRuns: ledger, runsLedgerPath } = await fresh();
      const run = beginRun({ lock: LOCK, run: 'test:rta:tdd', cumulative: true });
      run.close(); // the handle carries it — no caller restates it, none can get it wrong
      expect(ledger(runsLedgerPath())[0].cumulative).toBe(true);
    });
  });

  describe('invocation provenance — what lets a baseline SELECT its runs', () => {
    // Without these a ledger of N runs cannot tell a full `test:rta` from a
    // `test:rta:fast` (no deploy) or a `test:rta:capture` (extra per-screen PNG
    // work), nor `test:unit` from `test:all` — they share a run kind. The
    // documented alternative was "remember to `rm` the ledger first", which is
    // exactly the kind of human bookkeeping this file exists to remove.
    it('records the npm script that produced the run, not just the run kind', async () => {
      const { beginRun, readRuns: ledger, runsLedgerPath } = await fresh();
      process.env.npm_lifecycle_event = 'test:rta:fast';
      try {
        beginRun({ lock: LOCK, run: 'test:rta' }).close();
        const [line] = ledger(runsLedgerPath());
        expect(line.run).toBe('test:rta'); // the shared record directory
        expect(line.variant).toBe('test:rta:fast'); // ...and what actually ran
      } finally {
        delete process.env.npm_lifecycle_event;
      }
    });

    it('falls back to the run kind when the script was invoked by hand', async () => {
      const { beginRun, readRuns: ledger, runsLedgerPath } = await fresh();
      delete process.env.npm_lifecycle_event;
      beginRun({ lock: LOCK, run: 'test:rta' }).close();
      expect(ledger(runsLedgerPath())[0].variant).toBe('test:rta');
    });

    it('records the device the run drove, off the lock', async () => {
      // The ledger is the only record that survives the next run, and `run-meta.json`
      // is NOT a fallback for this: it is per-run and lives under `out/`, which the
      // next `build*` wipes. So if the device is not on the ledger line it is nowhere.
      const { beginRun, readRuns: ledger, runsLedgerPath } = await fresh();
      const lock = { meta: { ...LOCK.meta, deviceKey: 'ac4701ca4a5d8a0b' } };
      beginRun({ lock, run: 'test:rta' }).close();
      expect(ledger(runsLedgerPath())[0].deviceKey).toBe('ac4701ca4a5d8a0b');
    });

    it('reports a null device rather than inventing one on the degraded lock path', async () => {
      // `acquireDeviceLock` degrades to an unlocked run when GitHub is unreachable
      // or the device cannot be identified over ECP, and that meta carries no
      // `deviceKey`. Such a run genuinely IS of unknown provenance — which is the
      // honest thing for a baseline to see, and a reason to exclude it.
      const { beginRun, readRuns: ledger, runsLedgerPath } = await fresh();
      const degraded = { meta: { locked: false, mode: 'degraded', degraded: true } };
      beginRun({ lock: degraded, run: 'test:rta' }).close();
      expect(ledger(runsLedgerPath())[0].deviceKey).toBeNull();
    });

    it('reports nulls rather than failing the run when git cannot answer', async () => {
      // These cases chdir into a temp dir that is not a git checkout, so this is
      // the real unavailable path — not a mock. Bookkeeping must never fail a
      // device run, and an export/tarball checkout is a fine place to run one.
      const { beginRun, readRuns: ledger, runsLedgerPath } = await fresh();
      expect(() => beginRun({ lock: LOCK, run: 'test:rta' }).close()).not.toThrow();
      const [line] = ledger(runsLedgerPath());
      expect(line.commit).toBeNull();
      expect(line.dirty).toBeNull();
    });

    /**
     * Run one `beginRun`/`close()` with `git status --porcelain` answering
     * `statusOut`, and return the ledger line.
     *
     * PARTIALLY mocked: `device-lock.js` (which `run-record.js` imports) promisifies
     * `execFile` at module load, so replacing the whole of `node:child_process`
     * breaks the import chain rather than the function under test.
     */
    const withGit = async (statusOut) => {
      vi.resetModules();
      vi.doMock('node:child_process', async (importOriginal) => ({
        ...(await importOriginal()),
        execFileSync: (_cmd, args) => (args[0] === 'rev-parse' ? 'deadbee\n' : statusOut),
      }));
      try {
        const {
          beginRun,
          readRuns: ledger,
          runsLedgerPath,
        } = await import('../../../scripts/run-record.js');
        beginRun({ lock: LOCK, run: 'test:rta' }).close();
        return ledger(runsLedgerPath())[0];
      } finally {
        vi.doUnmock('node:child_process');
        vi.resetModules();
      }
    };

    it('stamps the commit and a dirty tree when git does answer', async () => {
      // Mocked because the real answer depends on the checkout the tests run in,
      // and "is the working tree dirty right now" is not something a unit test can
      // pin. What IS pinned: both values reach the ledger line, and a non-empty
      // `status --porcelain` reads as dirty.
      expect(await withGit(' M scripts/run-record.js\n')).toMatchObject({
        commit: 'deadbee',
        dirty: true,
      });
    });

    it('counts an UNTRACKED file as dirty — it still gets compiled in', async () => {
      // `--porcelain` keeps its default untracked handling on purpose: an untracked
      // `.bs` under `source/` lands in the build like any other file, so ignoring
      // untracked files would report `dirty: false` for a run HEAD does not
      // describe. Ignored paths (`out/`, `.device-runs/`) never appear here.
      expect((await withGit('?? source/newThing.bs\n')).dirty).toBe(true);
    });

    it('reports a clean tree as false, not as unknown', async () => {
      // `dirty: false` is a claim ("HEAD describes what ran"); `null` is the
      // absence of one. Collapsing them would let an unanswerable git report as a
      // clean baseline.
      expect((await withGit('\n')).dirty).toBe(false);
    });

    it('is resolved at the OPEN, so the exit net folds it too', async () => {
      // Provenance is captured in `beginRun` and closed over, exactly as
      // `cumulative` is above — the handle's `close()` and the process-exit net
      // fold the SAME args object, so a run abandoned to a signal handler carries
      // what an explicit close would. Capturing it at the open is also what keeps a
      // git subprocess off the exit path, where only synchronous work is legal.
      const { beginRun, readRuns: ledger, runsLedgerPath } = await fresh();
      process.env.npm_lifecycle_event = 'screenshots:capture';
      try {
        const run = beginRun({ lock: LOCK, run: 'capture-screenshots' });
        delete process.env.npm_lifecycle_event; // gone by close time — the open already read it
        run.close();
        expect(ledger(runsLedgerPath())[0].variant).toBe('screenshots:capture');
      } finally {
        delete process.env.npm_lifecycle_event;
      }
    });
  });

  it('writeRunMeta refuses an implicit directory', async () => {
    // The default this used to carry was `out/rta` — an alias onto one known run
    // kind, which is the clobber the split removes. A silent no-op would be worse
    // than a throw: it loses the record it exists to write.
    const { writeRunMeta } = await import('../../../scripts/device-lock.js');
    expect(() => writeRunMeta(LOCK.meta, { run: 'test:rta' })).toThrow(TypeError);
  });
});

describe('the process-exit net — the fold nobody calls', () => {
  /**
   * These need a REAL process exit, so they run in a subprocess.
   *
   * `armCloseOnExit` is the only fold three of the four entry points have on their
   * interrupt path — `capture-screenshots` and `demos` both hand their exit to
   * `armRestoreOnInterrupt`, whose handler ends in `process.exit()`, so nothing they
   * could write runs after it. It is also the whole fold for any path that throws.
   * In-process that mechanism cannot be exercised at all: emitting `exit` by hand
   * proves the listener is attached, not that Node runs it on a real exit, and
   * `process.exit()` inside Vitest would take the runner down with it.
   *
   * The suite was already ACCOMMODATING this net (see the `setMaxListeners` bump
   * above) without ever exercising it, which is the shape of an untested mechanism
   * hiding behind tests that merely tolerate it.
   */
  const runRecord = pathToFileURL(path.join(repoRoot, 'scripts', 'run-record.js')).href;

  /** Run `body` in a fresh node process rooted at the temp dir, and read its ledger back. */
  const inSubprocess = (body, { exitCode = 0 } = {}) => {
    const probe = path.join(tmpDir, 'probe.mjs');
    fs.writeFileSync(
      probe,
      `import { beginRun } from ${JSON.stringify(runRecord)};\n` +
        `const run = beginRun({ lock: ${JSON.stringify(LOCK)}, run: 'test:rta' });\n` +
        `${body}\n`,
    );
    const result = spawnSync(process.execPath, [probe], {
      cwd: tmpDir,
      encoding: 'utf8',
      // The provenance the fold must carry across, whichever path does the folding.
      env: { ...process.env, npm_lifecycle_event: 'test:rta:fast' },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(exitCode);
    const ledger = path.join(tmpDir, '.device-runs', 'rta', 'runs.jsonl');
    const lines = fs.existsSync(ledger)
      ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean)
      : [];
    return { lines: lines.map((l) => JSON.parse(l)), stdout: result.stdout };
  };

  // The lock shape `beginRun` is handed in production — see the lifecycle block above.
  const LOCK = { meta: { locked: true, mode: 'test', degraded: false } };

  it('folds a run whose entry point exited without closing it', () => {
    // The interrupt path, reproduced: open a run, then leave the way a signal
    // handler does. Nothing in the process calls `close()`.
    const { lines } = inSubprocess('process.exit(0);');
    expect(lines).toHaveLength(1);
    expect(lines[0].run).toBe('test:rta');
  });

  it('carries the open s provenance into a fold it never made', () => {
    // The net folds `closeArgs`, captured at the open. If it ever re-derived them
    // instead, this is where it would show: `npm_lifecycle_event` is read once, at
    // `beginRun`, and a baseline filters on the result.
    const { lines } = inSubprocess('process.exit(0);');
    expect(lines[0].variant).toBe('test:rta:fast');
  });

  it('folds on an uncaught throw too, not only on an explicit exit', () => {
    // `capture-screenshots`'s error path reaches `process.exit(1)` from a `.catch`,
    // but a throw from anywhere else still has to leave the run recorded.
    const { lines } = inSubprocess("throw new Error('take blew up');", { exitCode: 1 });
    expect(lines).toHaveLength(1);
  });

  it('does not double-count a run the entry point already closed', () => {
    // The counterpart to the in-process idempotency test: that one proves the guard,
    // this one proves the guard is what the REAL exit path hits. A second ledger line
    // per run is a miscount an N-run baseline has no way to see.
    const { lines } = inSubprocess('run.close();\nprocess.exit(0);');
    expect(lines).toHaveLength(1);
  });

  it('labels a run nobody closed `crashed`, so it cannot pass as a clean pass', () => {
    // The measured case this exists for: `ROKU_IP=192.168.1.200 npm run test:rta`
    // threw out of the deploy on a 401 and appended `durationMs: 621, failures: []`
    // — a line the documented baseline recipe (`variant`/`commit`/`dirty`/
    // `deviceKey`) selected, on a run where no test ever executed.
    const { lines } = inSubprocess("throw new Error('deploy 401');", { exitCode: 1 });
    expect(lines[0].outcome).toBe('crashed');
    // The point of the field: BOTH runs fold with an empty failure list, so this is
    // the only thing separating them.
    expect(lines[0].failures).toEqual([]);
  });

  it('distinguishes a crashed run from a passed one, though both record no failures', () => {
    // Both subprocesses append to the one ledger in this test's temp dir — which is
    // the ledger's whole contract — so the second run is the LAST line, not line 0.
    const crashed = inSubprocess("throw new Error('deploy 401');", { exitCode: 1 }).lines[0];
    const passed = inSubprocess("run.close('passed');\nprocess.exit(0);").lines.at(-1);
    expect([crashed.failures.length, passed.failures.length]).toEqual([0, 0]);
    expect([crashed.outcome, passed.outcome]).toEqual(['crashed', 'passed']);
  });

  it('does not relabel a run the entry point closed as an outcome of its own', () => {
    // The net must not overwrite a deliberate `interrupted` with `crashed` — the
    // abandon path in `rta-run.js` closes explicitly for exactly that reason.
    const { lines } = inSubprocess("run.close('interrupted');\nprocess.exit(130);", {
      exitCode: 130,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].outcome).toBe('interrupted');
  });

  it('announces a crashed run on the terminal, where silence used to hide it', () => {
    // A run with no failures printed NOTHING, which is how the 621 ms line above
    // reached the ledger unnoticed.
    const { stdout } = inSubprocess("throw new Error('deploy 401');", { exitCode: 1 });
    expect(stdout).toContain('run crashed');
  });

  it('prints the summary from the net, so an abandoned run still says what it saw', () => {
    // The net's `console.log` is the only narration an interrupted run gets. (It is
    // synchronous on Linux/CI for pipes; `exit-net-summary-lost-on-macos-pipe` in
    // tech-debt.md covers the macOS caveat, which is why the durable ledger line
    // above is asserted separately rather than through this.)
    const { stdout } = inSubprocess(
      `const { recordFailure } = await import(${JSON.stringify(runRecord)});\n` +
        `recordFailure({ at: new Date().toISOString(), kind: 'wait-for-timeout', label: 'home rows' });\n` +
        'process.exit(0);',
    );
    expect(stdout).toContain('[rta]');
    expect(stdout).toContain('home rows');
  });
});

describe('the run outcome — whether the suite actually ran', () => {
  const at = { startedAt: '2026-08-12T01:07:47Z', endedAt: '2026-08-12T01:07:48Z' };

  it('records the outcome it was given', () => {
    expect(summarizeRun({ ...at, outcome: RUN_OUTCOMES.FAILED }).outcome).toBe('failed');
  });

  it('reports null rather than assuming a pass when the entry point did not say', () => {
    // Same argument as the other four filter keys: absent would mean "you have to
    // know the convention", and the convention a reader would guess is "passed".
    expect(summarizeRun(at).outcome).toBeNull();
  });

  it('speaks up for a red run that captured no failure records', () => {
    // The specs assert with plain `expect()` as well as through the five diagnosed
    // throw sites, so a genuinely red suite can fold with `failures: []`. Reading
    // the empty list as the outcome would score it green and print nothing.
    const lines = formatRunSummary(
      { ...at, run: 'test:rta', failures: [], outcome: RUN_OUTCOMES.FAILED },
      'x.jsonl',
    );
    expect(lines.join('\n')).toContain('run failed');
  });

  it('stays silent on a clean pass — silence is still the clean-run signal', () => {
    expect(
      formatRunSummary(
        { ...at, run: 'test:rta', failures: [], outcome: RUN_OUTCOMES.PASSED },
        'x.jsonl',
      ),
    ).toEqual([]);
  });

  it('tells the operator a crashed run ran no suite, rather than just naming it', () => {
    const lines = formatRunSummary(
      { ...at, run: 'test:rta', failures: [], outcome: RUN_OUTCOMES.CRASHED },
      'x.jsonl',
    );
    expect(lines.join('\n')).toContain('exclude it from a baseline');
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

  it('records which take a demo run was, since the ledger outlives run-meta.json', () => {
    // `run` is `demo` for every take, and run-meta.json is overwritten by the next
    // run — so the ledger line is the only surviving record of which choreography
    // this was. Measured case: five demo runs in one session, all reading `demo`.
    const summary = summarizeRun({
      startedAt: '2026-08-11T15:44:00Z',
      endedAt: '2026-08-11T15:46:00Z',
      run: 'demo',
      what: 'demo:server-switch',
    });
    expect(summary.what).toBe('demo:server-switch');
  });

  it('omits `what` when it would only repeat the run kind', () => {
    const summary = summarizeRun({
      startedAt: '2026-08-11T15:44:00Z',
      endedAt: '2026-08-11T15:46:00Z',
      run: 'test:rta',
      what: 'test:rta',
    });
    expect(summary.what).toBeUndefined();
  });

  it('carries the invocation and the code it ran against', () => {
    const summary = summarizeRun({
      startedAt: '2026-08-11T15:44:00Z',
      endedAt: '2026-08-11T15:46:00Z',
      run: 'test:rta',
      variant: 'test:rta:fast',
      commit: 'abc1234',
      dirty: true,
    });
    expect(summary).toMatchObject({ variant: 'test:rta:fast', commit: 'abc1234', dirty: true });
  });

  it('emits the four filter keys even when they are unknown', () => {
    // The contract that separates these from `what`: they are what a baseline
    // SELECTS on, so `runs.filter(r => r.variant === 'test:rta')` must never drop a
    // row because the field was omitted as redundant. `null` says unknown; missing
    // would require the reader to know a convention.
    const summary = summarizeRun({ startedAt: 'a', endedAt: 'b', run: 'test:rta' });
    expect(summary.variant).toBeNull();
    expect(summary.commit).toBeNull();
    expect(summary.dirty).toBeNull();
    expect(summary.deviceKey).toBeNull();
    expect(Object.keys(summary)).toEqual(
      expect.arrayContaining(['variant', 'commit', 'dirty', 'deviceKey']),
    );
  });

  it('records WHICH device the run drove', () => {
    // The baseline is specified on one device (`.200`) because the three Rokus on
    // this LAN are not interchangeable. `variant` and `commit` cannot separate a
    // stray `.177` run from that series — a baseline's whole point is that those
    // two are identical across its runs — so the device has to be its own key.
    const summary = summarizeRun({
      startedAt: 'a',
      endedAt: 'b',
      run: 'test:rta',
      deviceKey: 'ac4701ca4a5d8a0b',
    });
    expect(summary.deviceKey).toBe('ac4701ca4a5d8a0b');
  });

  it('keeps `variant` even when it equals the run kind — unlike `what`', () => {
    // A full `npm run test:rta` has variant === run. Omitting it there is exactly
    // the case that would break a filter, so the redundancy rule that governs
    // `what` deliberately does NOT apply here.
    const summary = summarizeRun({
      startedAt: 'a',
      endedAt: 'b',
      run: 'test:rta',
      variant: 'test:rta',
      what: 'test:rta',
    });
    expect(summary.variant).toBe('test:rta');
    expect(summary.what).toBeUndefined();
  });

  it('collects the unregistered kinds, deduplicated', () => {
    const summary = summarizeRun({
      startedAt: '2026-08-10T14:02:00Z',
      endedAt: '2026-08-10T14:14:00Z',
      failures: [
        { kind: 'made-up', kindUnknown: true },
        { kind: 'made-up', kindUnknown: true },
        { kind: WAIT_FOR_TIMEOUT },
      ],
    });
    expect(summary.unknownKinds).toEqual(['made-up']);
  });
});

describe('formatRunSummary', () => {
  /**
   * A summary for an RTA run. Every case names its run kind, because the `[tag]`
   * on each printed line is derived from it — and `endRun`, the only real caller,
   * always supplies one. A `run`-less summary is not a shape this receives.
   */
  const rta = (fields) => summarizeRun({ run: 'test:rta', ...fields });

  it('says nothing about a clean run inside one hour', () => {
    // Silence on the happy path is the whole reason this can live in every run.
    expect(
      formatRunSummary(
        rta({
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
      rta({
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T15:04:00Z',
        failures: [],
      }),
    );
    expect(lines.join('\n')).toMatch(/crossed the top of the hour \(14:52→15:04 UTC\)/);
  });

  it('tags each line with the RUN KIND, not with the RTA harness', () => {
    // This module is shared with the Rooibos runner, so a hardcoded `[rta]` would
    // print over `npm run test:unit` — the same "named for the other harness"
    // dishonesty the per-kind directory split removed, just in the output rather
    // than on disk. The tag is derived from the record directory's own name, so
    // there is no second mapping that can drift out of sync with `runDir`.
    const rooibos = formatRunSummary(
      summarizeRun({
        run: 'run-roku-tests',
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T15:04:00Z',
        failures: [],
      }),
    ).join('\n');
    expect(rooibos).toContain('[device]');
    expect(rooibos).not.toContain('[rta]');

    // ...and the harness that IS rta still says so.
    const suite = formatRunSummary(
      rta({ startedAt: '2026-08-10T14:52:00Z', endedAt: '2026-08-10T15:04:00Z', failures: [] }),
    ).join('\n');
    expect(suite).toContain('[rta]');

    // Every run kind maps to a distinct tag, so a demo and a screenshot matrix
    // cannot be confused in a scrollback.
    const tagFor = (run) =>
      formatRunSummary(
        summarizeRun({
          run,
          startedAt: '2026-08-10T14:52:00Z',
          endedAt: '2026-08-10T15:04:00Z',
          failures: [],
        }),
      )[0].split(' ')[0];
    const tags = ['test:rta', 'capture-screenshots', 'demo', 'run-roku-tests'].map(tagFor);
    expect(new Set(tags).size).toBe(4);
  });

  it('drops the hour warning for a cumulative watch session', () => {
    // Watch mode resets once at session start and folds once at exit, so any
    // session over an hour trips the flag. A flag that always fires is noise, and
    // it would be noisiest in the mode where you are already watching the output.
    const lines = formatRunSummary(
      rta({
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
      rta({
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T18:04:00Z',
        failures: [{ at: '2026-08-10T15:01:00Z', kind: WAIT_FOR_TIMEOUT }],
        cumulative: true,
      }),
    ).join('\n');
    expect(lines).toContain('this watch session');
    expect(lines).not.toContain('crossed the top of the hour');
  });

  it('names each failure with the state that was captured', () => {
    const lines = formatRunSummary(
      rta({
        startedAt: '2026-08-10T14:52:00Z',
        endedAt: '2026-08-10T15:04:00Z',
        failures: [
          {
            at: '2026-08-10T15:01:00Z',
            kind: DETAIL_ROW_NOT_FOUND,
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
      rta({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [
          {
            at: '2026-08-10T14:10:00Z',
            kind: WAIT_FOCUSED_TIMEOUT,
            state: { shell: { isRemoteDisabled: true } },
          },
        ],
      }),
    ).join('\n');
    expect(lines).toContain('input=BLOCKED');
  });

  it('names the attempt for a screenshot retry, so a recovered screen reads as one', () => {
    const lines = formatRunSummary(
      rta({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [
          {
            at: '2026-08-10T14:10:00Z',
            kind: GRID_LOAD_TIMEOUT,
            context: { screen: 'en_US/moviesLibrary', attempt: 1, attempts: 3 },
          },
        ],
      }),
    ).join('\n');
    expect(lines).toContain('en_US/moviesLibrary');
    expect(lines).toContain('(attempt 1)');
  });

  it('names the demo take, the other label Vitest cannot supply', () => {
    // A demo failure carries neither a test name nor a screen, so without this it
    // printed a bare kind — which does not say which choreography was running.
    const lines = formatRunSummary(
      rta({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [
          {
            at: '2026-08-10T14:10:00Z',
            kind: WAIT_FOR_TIMEOUT,
            context: { take: 'browse-and-play' },
          },
        ],
      }),
    ).join('\n');
    expect(lines).toContain('browse-and-play');
  });

  it('warns loudly about an unregistered kind, where the operator will see it', () => {
    // The bucket-split guard. This line lands in the artifact a baseline operator
    // reads after every run, so a forked bucket announces itself at the moment it
    // would corrupt the number.
    const lines = formatRunSummary(
      rta({
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
      rta({
        startedAt: '2026-08-10T14:02:00Z',
        endedAt: '2026-08-10T14:14:00Z',
        failures: [{ at: '2026-08-10T14:10:00Z', kind: WAIT_FOR_TIMEOUT, label: 'home rows' }],
      }),
    ).join('\n');
    expect(lines).toContain('home rows');
    expect(lines).toContain('wait-for-timeout');
  });
});
