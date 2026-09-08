/**
 * Hardware-free gate on `navLibraryByType`'s wrong-library OUTCOME check.
 *
 * ## Why this file exists
 *
 * The check and its recovery are, by construction, failure-path code: the branch that
 * added them shipped on the back of a full green suite that exercised none of them. A
 * green run cannot distinguish "the event did not occur" from "it occurred and the retry
 * recovered", so the on-device run is the wrong instrument for this particular property —
 * it can only ever confirm the success path.
 *
 * What is asserted here is the DECISION TABLE, which is pure control flow and needs no
 * device: match breaks, mismatch retries and re-presses, an exhausted budget throws with
 * the readings that were taken, an unresolved field is called out as its own thing rather
 * than reported as a wrong library, and an id-less caller keeps its previous behaviour.
 * What still needs a real Roku — whether `parentItem.id` resolves at all, whether Back
 * actually returns to Home — stays hardware-verified via `npm run test:rta`.
 *
 * `steps.js` is mocked wholesale rather than `odc` stubbed: every device touch in the
 * function under test goes through it, and the seam keeps these tests about the nav's
 * logic instead of re-deriving keyPath plumbing that `steps.test.js` already covers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const press = vi.fn();
const getVal = vi.fn();
const getVals = vi.fn();
const getActiveVal = vi.fn();
const getActiveVals = vi.fn();
const waitFor = vi.fn();
const waitFocusInside = vi.fn();
const waitHome = vi.fn();
const sleep = vi.fn();
const formatCellCounts = vi.fn();
const readCellCounts = vi.fn();
const scrollFocus = vi.fn();

vi.mock('./steps.js', () => ({
  press: (...a) => press(...a),
  getVal: (...a) => getVal(...a),
  getVals: (...a) => getVals(...a),
  getActiveVal: (...a) => getActiveVal(...a),
  getActiveVals: (...a) => getActiveVals(...a),
  waitFor: (...a) => waitFor(...a),
  waitFocused: vi.fn(),
  waitFocusInside: (...a) => waitFocusInside(...a),
  waitHome: (...a) => waitHome(...a),
  walkHomeToFirstRow: vi.fn(),
  overhangWalkKey: vi.fn(),
  hasChildren: (v) => typeof v === 'number' && v > 0,
  resendIfSwallowed: vi.fn(() => vi.fn()),
  resendUntilFocusInside: vi.fn(() => vi.fn()),
  scrollFocus: (...a) => scrollFocus(...a),
  waitCellsQuiet: vi.fn(),
  waitRowsSettled: vi.fn(),
  readCellCounts: (...a) => readCellCounts(...a),
  formatCellCounts: (...a) => formatCellCounts(...a),
  axisEnd: vi.fn(),
  sweepBudget: vi.fn(),
  sleep: (...a) => sleep(...a),
}));

// `ecp.Key` carries the REAL values, not invented ones — the same rule `steps.test.js`
// states: a helper asserted against a typo agrees with the typo.
vi.mock('roku-test-automation', () => ({
  ecp: { Key: { Ok: 'Ok', Back: 'Back', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' } },
  odc: { getFocusedNode: vi.fn(), getValue: vi.fn(), getValues: vi.fn() },
}));

// The throw path runs through `diagnosedError`, which reaches for the device to dump
// state. Stub it to a plain Error carrying the record, so these tests assert the DECISION
// rather than re-testing the diagnostics module (which owns its own spec).
// The recovery record is the point of the announcement — a `console.warn` dies with
// the scrollback, so the DURABLE write is what makes "does this ever fire" answerable.
// Stubbed here so the decision is asserted without touching the real ledger.
const recordRecovery = vi.fn();
vi.mock('../../../scripts/run-record.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordRecovery: (...a) => recordRecovery(...a),
}));

vi.mock('./diagnostics.js', async () => {
  const { FAILURE_KINDS } = await import('../../../scripts/run-record.js');
  return {
    FAILURE_KINDS,
    diagnosedError: vi.fn(async (message, record) => Object.assign(new Error(message), { record })),
  };
});

const { navLibraryByType, reportSweep } = await import('./nav.js');
const { FAILURE_KINDS } = await import('../../../scripts/run-record.js');

const MOVIES = 'f137a2dd';
const SHOWS = 'a656b907';

/** Home holding one library row (row 0) whose tile 1 is the Shows library. */
function homeWithShowsAt(row, col) {
  getVal.mockImplementation(async (keyPath) => {
    if (keyPath === '#homeRows.content.getChildCount()') return 1;
    if (keyPath === `#homeRows.content.${row}.sectionId`) return 'library';
    if (keyPath === `#homeRows.content.${row}.getChildCount()`) return col + 1;
    if (keyPath === `#homeRows.content.${row}.${col}.id`) return SHOWS;
    return undefined;
  });
  // The focus walk gates via `waitFor` (row half) and `scrollFocus` (column half);
  // neither has anything to prove here, so let both pass.
  waitFor.mockResolvedValue(undefined);
  scrollFocus.mockResolvedValue({ from: 0, to: col, pressed: col, recovered: 0 });
  getVals.mockResolvedValue([[row, col], col + 1]);
}

/** Queue the `parentItem.id` answers one attempt at a time. */
function opensInOrder(...ids) {
  const queue = [...ids];
  getActiveVal.mockImplementation(async (keyPath) => {
    if (keyPath === 'loadState') return 'loaded';
    if (keyPath === 'parentItem.id') return queue.shift();
    if (keyPath === 'parentItem.name') return 'Movies';
    return undefined;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  homeWithShowsAt(0, 1);
});

afterEach(() => vi.restoreAllMocks());

describe('navLibraryByType — which library actually opened', () => {
  it('accepts the grid and presses nothing further when the opened id matches', async () => {
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    expect(press).toHaveBeenCalledTimes(1);
    expect(press).toHaveBeenCalledWith('Ok');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('backs out and retries when the wrong library opened, then succeeds', async () => {
    opensInOrder(MOVIES, SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    // Ok, Back, Ok — the recovery re-runs the whole scan/walk/press.
    expect(press.mock.calls.map(([k]) => k)).toEqual(['Ok', 'Back', 'Ok']);
  });

  it('ANNOUNCES a recovery, so a run that silently self-corrected is not indistinguishable from a clean one', async () => {
    opensInOrder(MOVIES, SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const [warning] = console.warn.mock.calls[0];
    expect(warning).toContain('opened the wrong library on attempt 1');
    expect(warning).toContain('recovered on attempt 2');
    // The pre-press readings ride along, because WHY it landed wrong is the open question.
    expect(warning).toContain('rowChildCount=');
  });

  it('RECORDS the recovery durably, so "does this ever fire" survives the scrollback', async () => {
    opensInOrder(MOVIES, SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    expect(recordRecovery).toHaveBeenCalledTimes(1);
    const [entry] = recordRecovery.mock.calls[0];
    expect(entry.what).toContain('library nav');
    expect(entry.observed).toMatchObject({ wanted: SHOWS, attempts: 2 });
    // One reading per attempt — which attempt saw a mid-flight row is the question.
    expect(entry.observed.probe).toHaveLength(2);
  });

  it('records nothing when the first attempt was right — a clean run stays clean', async () => {
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    expect(recordRecovery).not.toHaveBeenCalled();
  });

  it('walks the COLUMN through scrollFocus, which cannot press on an in-flight key', async () => {
    // The fix for the mechanism captured on .177 2026-09-07. The loop this replaced
    // decided whether to press from its own read of a LAGGING field, so it could send a
    // Right on top of one already in flight: focus reported [0,2], the tile there was the
    // library asked for, Home's rows were unchanged — and `rowItemSelected` came back
    // [0,3]. `scrollFocus` sends the exact distance once and re-presses only for a key it
    // can prove was dropped.
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);

    expect(scrollFocus).toHaveBeenCalledTimes(1);
    const [opts] = scrollFocus.mock.calls[0];
    expect(opts).toMatchObject({
      keyPath: '#homeRows.rowItemFocused',
      target: 1,
      forwardKey: 'Right',
      backKey: 'Left',
    });
  });

  it('selects the COLUMN component of rowItemFocused, not the row', async () => {
    // `rowItemFocused` is [row, item]. Selecting index 0 here would walk the vertical axis
    // with horizontal keys — it would still terminate, on the wrong cell, and the failure
    // would surface somewhere else entirely.
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    const [{ select }] = scrollFocus.mock.calls[0];
    expect(select([7, 3])).toBe(3);
    expect(select(undefined)).toBeUndefined();
  });

  it('leaves the ROW walk hand-rolled — Up from row 0 escapes Home entirely', async () => {
    // The asymmetry is deliberate. `Home.onKeyEvent` releases focus to the OVERHANG on Up
    // from row 0, so a single row overshoot does not land on the wrong tile, it leaves the
    // screen. The measured defect was a COLUMN over-press; converting the riskier axis on
    // that evidence would be speculation. This fails if someone converts it anyway.
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    const rowWalks = waitFor.mock.calls.filter(([kp]) => kp === '#homeRows.rowItemFocused');
    expect(rowWalks).toHaveLength(1);
    expect(rowWalks[0][2].label).toContain('home library row');
  });

  it('carries the column walk’s recovered count into the record, so the fix stays measurable', async () => {
    // `recovered` counts keys the walk had to re-send. After this fix it should be the only
    // source of drift on this path, so a record without it cannot show the fix working.
    scrollFocus.mockResolvedValue({ from: 0, to: 1, pressed: 1, recovered: 2 });
    opensInOrder(MOVIES, SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    const [entry] = recordRecovery.mock.calls[0];
    expect(entry.observed.probe[0]).toMatchObject({ colPressed: 1, colRecovered: 2 });
  });

  it('BRACKETS the press — the selection reading is taken after Ok, not before', async () => {
    // The whole reason this instrument exists. A gate on the tile's content at the
    // walked-to coordinates was tried here and PASSED while the press still opened
    // Movies, so whatever moves does so in a window no pre-press reading can see.
    // Ordering is therefore the property under test, not the field list.
    const order = [];
    press.mockImplementation(async (k) => order.push(`press:${k}`));
    getVals.mockImplementation(async (keyPaths) => {
      order.push(keyPaths.includes('#homeRows.rowItemSelected') ? 'read:selected' : 'read:pre');
      return keyPaths.map(() => undefined);
    });
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);

    // All three asserted PRESENT first. `indexOf` answers -1 for a step that never ran,
    // and -1 is less than every real index — so the ordering alone passes when the press
    // or either read is missing entirely, which is the regression this test exists for.
    expect(order).toContain('read:pre');
    expect(order).toContain('press:Ok');
    expect(order).toContain('read:selected');
    expect(order.indexOf('read:pre')).toBeLessThan(order.indexOf('press:Ok'));
    expect(order.indexOf('press:Ok')).toBeLessThan(order.indexOf('read:selected'));
  });

  it('records what it AIMED AT beside what Home SELECTED, so the two can disagree', async () => {
    // The discriminator. Same coordinates with a different id means the row's content
    // changed under fixed coordinates (a row swap); different coordinates means focus
    // moved between the probe and the press. A record carrying only one of the two
    // cannot tell those apart, which is the state this replaces.
    getVals.mockImplementation(async (keyPaths) =>
      keyPaths.includes('#homeRows.rowItemSelected')
        ? [[0, 5]]
        : keyPaths.map((k) => (k.endsWith('.id') ? MOVIES : undefined)),
    );
    opensInOrder(MOVIES, SHOWS);
    await navLibraryByType('tvshows', SHOWS);

    const [entry] = recordRecovery.mock.calls[0];
    expect(entry.observed.probe[0]).toMatchObject({ aimedAt: [0, 1], selected: [0, 5] });
  });

  it('does not let a failed SELECTION read fail a nav either', async () => {
    // The second probe is a second chance to break a healthy nav. It runs after the
    // press, when Home is suspended, so it is the likelier of the two to come back
    // empty — and it still may not turn instrumentation into a failure.
    getVals.mockImplementation(async (keyPaths) => {
      if (keyPaths.includes('#homeRows.rowItemSelected')) throw new Error('odc timeout');
      return keyPaths.map(() => undefined);
    });
    opensInOrder(SHOWS);
    await expect(navLibraryByType('tvshows', SHOWS)).resolves.toBeUndefined();
  });

  it('does not let a failed probe read fail a nav that was otherwise fine', async () => {
    // `getVals` throws on a batch failure by design. That is right for an assertion
    // and wrong for instrumentation on the SUCCESS path of every library nav:
    // diagnostics may not break the thing they diagnose.
    getVals.mockRejectedValue(new Error('batched read of 2 keyPath(s) returned no results'));
    opensInOrder(SHOWS);
    await expect(navLibraryByType('tvshows', SHOWS)).resolves.toBeUndefined();
    expect(press.mock.calls.map(([k]) => k)).toEqual(['Ok']);
  });

  it('throws with every attempt’s pre-press reading once the budget is spent', async () => {
    opensInOrder(MOVIES, MOVIES, MOVIES);
    const err = await navLibraryByType('tvshows', SHOWS).catch((e) => e);
    expect(err.message).toContain('opened the wrong library');
    expect(err.record.kind).toBe(FAILURE_KINDS.LIBRARY_OPENED_MISMATCH);
    expect(err.record.observed.attempts).toBe(3);
    // One reading per attempt — which attempt saw a mid-flight row is the whole question,
    // so a single reading would not answer it.
    expect(err.record.observed.probe).toHaveLength(3);
  });

  it('is bounded — it does not retry forever against a library that never opens', async () => {
    opensInOrder(MOVIES, MOVIES, MOVIES);
    await navLibraryByType('tvshows', SHOWS).catch(() => {});
    expect(press.mock.calls.filter(([k]) => k === 'Ok')).toHaveLength(3);
  });

  it('does not report a wrong library when the field did not resolve at all', async () => {
    // `parentItem.id` unreadable is a harness/app-shape problem. Retrying it three times
    // and then naming a library the app never claimed to open points at the wrong layer.
    opensInOrder(undefined);
    const err = await navLibraryByType('tvshows', SHOWS).catch((e) => e);
    expect(err.message).toContain('unreadable');
    expect(err.message).not.toContain('opened the wrong library');
    expect(err.record.kind).toBe(FAILURE_KINDS.LIBRARY_OPENED_MISMATCH);
    // Fails fast — "genuinely wrong", not "not there yet".
    expect(press.mock.calls.filter(([k]) => k === 'Ok')).toHaveLength(1);
  });

  it('keeps the previous behaviour for an id-less caller rather than inventing a weaker check', async () => {
    // `demos/` navigates without a library id. There is nothing to compare against, so
    // the check must stand down instead of guessing from collectionType.
    getVal.mockImplementation(async (keyPath) => {
      if (keyPath === '#homeRows.content.getChildCount()') return 1;
      if (keyPath === '#homeRows.content.0.sectionId') return 'library';
      if (keyPath === '#homeRows.content.0.getChildCount()') return 1;
      if (keyPath === '#homeRows.content.0.0.collectionType') return 'tvshows';
      return undefined;
    });
    opensInOrder(MOVIES);
    await navLibraryByType('tvshows');
    expect(press.mock.calls.map(([k]) => k)).toEqual(['Ok']);
  });
});

/**
 * `waitGridLoaded`'s conversion to `waitFor`, and the bucket it must not fall into.
 *
 * It hand-rolled its own poll loop until 2026-09-05. Routing it through the shared
 * primitive buys read-failure attribution and brings it inside
 * `jellyrock-rta/wait-justified`'s view — but a naive conversion would also have taken
 * its failure slug, because `waitFor` recorded `wait-for-timeout` unconditionally.
 *
 * That merge is the regression this gates, and it is invisible by construction: the
 * suite stays green (the wait still works), the diff shows a loop leaving and says
 * nothing about the record, and the cost lands weeks later in a flake baseline where a
 * grid that never loads is indistinguishable from every other timeout in the suite.
 * `FAILURE_KINDS`' own docblock names one-slug-for-two-classes as the failure; this is
 * the assertion that the conversion did not cause it.
 *
 * The reader and cadence are asserted for the same reason Phase 3b stated every
 * converted site's timeout: a helper's defaults are not the defaults the call site had.
 * `loadState` recurs on every BaseGridView, so a scene-rooted read could answer from a
 * SUSPENDED view and pass this wait against the screen the user just left.
 */
describe('waitGridLoaded — converted to waitFor without losing its own failure bucket', () => {
  /** The `waitFor` call the grid wait issued, out of the several a nav makes. */
  const gridWait = () => waitFor.mock.calls.find(([keyPath]) => keyPath === 'loadState');

  it('reports grid-load-timeout, not the shared wait-for-timeout bucket', async () => {
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    expect(gridWait()?.[2]).toMatchObject({ kind: FAILURE_KINDS.GRID_LOAD_TIMEOUT });
  });

  it('keeps the 20 s budget and 500 ms cadence the hand-rolled loop had', async () => {
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    expect(gridWait()?.[2]).toMatchObject({ timeout: 20000, interval: 500 });
  });

  it('polls the ACTIVE routed view, so a suspended grid cannot satisfy it', async () => {
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    // Asserted by DELEGATION, not by reference: `steps.js` is mocked with wrappers, so
    // the reader `nav.js` holds is never the same object as the spy here. Calling it is
    // the stronger check anyway — it proves which reader RUNS. Passing the scene-rooted
    // `getVal` instead would leave this spy untouched, which is the mistake being gated.
    getActiveVal.mockClear();
    await gridWait()[2].read('loadState');
    expect(getActiveVal).toHaveBeenCalledWith('loadState');
    expect(getVal).not.toHaveBeenCalledWith('loadState');
  });

  it('accepts loaded and empty, and nothing else — an empty library is a real screen', async () => {
    // "empty" means zero ITEMS, not a failed load: the "No Items" view is capture-worthy
    // and this nav is shared with the store-screenshot path, which would otherwise time
    // out on every legitimately empty library.
    opensInOrder(SHOWS);
    await navLibraryByType('tvshows', SHOWS);
    const predicate = gridWait()?.[1];
    expect(predicate('loaded')).toBe(true);
    expect(predicate('empty')).toBe(true);
    expect(predicate('skeleton')).toBe(false);
    expect(predicate(undefined)).toBe(false);
  });
});

/**
 * `reportSweep`'s suppression rule, which is a decision table and not a device property.
 *
 * Its branches are exactly the ones a green on-device run cannot tell apart: a build with
 * counters, a build without, and a keyPath that resolves to nothing all end in a plausible
 * console line and a passing test. The line is also the ONLY channel — `measure` records the
 * nav's name, not its itinerary — so a wrong one is not caught later by anything.
 */
describe('reportSweep — the BEFORE segment, and when it must not print', () => {
  const legs = [{ axis: 'rows -> 2', walk: { from: 0, to: 2, recovered: 0 }, available: 5 }];
  const endInstrumented = {
    quiet: true,
    instrumented: true,
    resolved: true,
    counts: { Binds: 106 },
    waitedMs: 1782,
  };
  let logged;
  let warned;

  beforeEach(() => {
    logged = [];
    warned = [];
    vi.spyOn(console, 'log').mockImplementation((line) => logged.push(line));
    console.warn.mockImplementation((line) => warned.push(line));
    formatCellCounts.mockImplementation((counts) => `binds=${counts?.Binds}`);
  });

  it('prints the baseline as a READING when both ends are instrumented', () => {
    reportSweep('cellSweepHome', legs, endInstrumented, {
      atStart: { counts: { Binds: 104 }, instrumented: true, resolved: true },
    });

    // Both numbers on the line, neither subtracted for the reader: the totals are cumulative,
    // so the split stays a subtraction someone can check.
    expect(logged[0]).toContain('binds=106');
    expect(logged[0]).toContain('of which before the sweep (binds=104)');
    expect(warned).toEqual([]);
  });

  it('prints the per-row widths, which rows and items together cannot express', () => {
    // 128 items over 12 rows is the same total whether one row holds 64 or every row holds
    // 11 — and only the first makes the horizontal texture window reachable. A per-row-limit
    // campaign reads this vector to know how many rows are even in scope.
    reportSweep('cellSweepHome', legs, endInstrumented, {
      settle: { rows: 4, items: 128, widths: [64, 33, 16, 15], settled: true, waitedMs: 1977 },
    });

    expect(logged[0]).toContain('over 4 row(s) / 128 item(s) widths [64,33,16,15] at sweep start');
  });

  it('omits the widths segment rather than printing an empty one', () => {
    // A settle that did not resolve returns `widths: []`. `widths []` on the line would read
    // as "every row is gone" instead of "this was not measured".
    reportSweep('cellSweepHome', legs, endInstrumented, {
      settle: { rows: undefined, items: undefined, widths: [], settled: false, waitedMs: 0 },
    });

    expect(logged[0]).not.toContain('widths');
    expect(logged[0]).toContain('NEVER SETTLED');
  });

  it('says nothing when no baseline was asked for — the other three sweeps pass none', () => {
    reportSweep('cellSweepGrid', legs, endInstrumented);

    expect(logged[0]).not.toContain('before the sweep');
    expect(warned).toEqual([]);
  });

  it('WARNS when a baseline was asked for and came back empty against an instrumented end', () => {
    // Not a production build — that one has no counters at EITHER end. This is the ledger
    // attaching after the gate, or a reader swapped for the single-keyPath one next door.
    reportSweep('cellSweepHome', legs, endInstrumented, {
      atStart: { counts: {}, instrumented: false, resolved: true },
    });

    expect(logged[0]).not.toContain('before the sweep');
    expect(warned[0]).toMatch(/no cell-load counters/);
    expect(warned[0]).toMatch(/TOTAL with no seam/);
  });

  it('names a list that resolved to nothing differently from a build with no counters', () => {
    // The distinction `readCellCounts` carries `resolved` for: one is a fact about the
    // build, the other means the baseline described no list at all.
    reportSweep('cellSweepHome', legs, endInstrumented, {
      atStart: { counts: {}, instrumented: false, resolved: false },
    });

    expect(warned[0]).toMatch(/the list did not resolve/);
    expect(warned[0]).not.toMatch(/no cell-load counters/);
  });

  it('stays silent on a production build, where NEITHER end has counters', () => {
    // `perfTiming` off is the correct state for a release build, so there is nothing to
    // report and nothing to warn about — a warning here would fire on every store build.
    reportSweep(
      'cellSweepHome',
      legs,
      { quiet: true, instrumented: false, resolved: true },
      {
        atStart: { counts: {}, instrumented: false, resolved: true },
      },
    );

    expect(logged[0]).toContain('perfTiming off');
    expect(logged[0]).not.toContain('before the sweep');
    expect(warned).toEqual([]);
  });

  it('takes settle and atStart by NAME, so a caller with only one skips no slot', () => {
    // The reason these are an options object: three sweeps are expected to grow an `atStart`
    // without a `settle`, which positionally would mean each writing a `null` to skip one.
    reportSweep('cellSweepHome', legs, endInstrumented, {
      settle: { rows: 5, items: 22, settled: true, waitedMs: 1763 },
    });

    expect(logged[0]).toContain('over 5 row(s) / 22 item(s) at sweep start (settled in 1763 ms)');
    expect(logged[0]).not.toContain('before the sweep');
    expect(warned).toEqual([]);
  });
});
