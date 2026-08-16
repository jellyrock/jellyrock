/**
 * Hardware-free gate on the failure-kind registry, the failure RECORD's shape, and
 * the lines a human reads in the terminal.
 *
 * `kind` is the key the flake baseline aggregates by, and a bucket goes wrong in
 * two directions. Two names for one class SPLITS the count — guarded at runtime by
 * `kindUnknown`, which the run summary reports. One name for two classes MERGES it
 * — a copy-pasted entry, invisible in review and invisible at runtime, because
 * both sites look perfectly valid. That second one is what these assert.
 *
 * What needs a real Roku is the ODC ROUND TRIP — whether `activeRoutedView.loadState`
 * resolves on a given screen, what `getFocusedNode` answers. Everything wrapped
 * around it is ordinary logic: which fields print, which are suppressed, what lands
 * in the JSONL. That was eyeballed on hardware and nowhere else, which left the
 * module's most-read output — the 2-4 lines under a failure — with no gate at all,
 * while the near-identical roll-up formatter next door had ten. These close that.
 * The device side stays hardware-verified; see `docs/dev/rta-tests.md`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FAILURE_KINDS, isUnknownKind } from './diagnostics.js';

describe('the FAILURE_KINDS re-export', () => {
  // The registry itself moved to `scripts/run-record.js` (it has a second producer
  // now — `lib/jellyfin.js`, which must not import the device client to reach it),
  // and its invariants — uniqueness, kebab-case, frozen-ness — are gated there,
  // beside the definition. What is still this module's contract is the RE-EXPORT:
  // every throw site and spec imports these names from here, so a move that broke
  // the alias would break them all. That is what these two assert, and nothing more.
  it('re-exports the registry so existing throw sites keep importing from here', () => {
    expect(FAILURE_KINDS.WAIT_FOR_TIMEOUT).toBe('wait-for-timeout');
    expect(Object.isFrozen(FAILURE_KINDS)).toBe(true);
  });

  it('re-exports isUnknownKind bound to that same registry', () => {
    // Guards the failure mode a bare `export { x } from` would have had: a re-export
    // that resolves but is checked against a DIFFERENT set would call every
    // registered slug unknown.
    for (const slug of Object.values(FAILURE_KINDS)) expect(isUnknownKind(slug)).toBe(false);
    expect(isUnknownKind('detail-rows-missing')).toBe(true);
    expect(isUnknownKind(undefined)).toBe(true);
  });
});

describe('diagnosedError — the message a human reads and the record a baseline reads', () => {
  let tmpDir;

  /** The shape ODC's batch read returns: every key path answers `found` or not. */
  const found = (values) =>
    Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { found: true, value }]));

  const HEALTHY = found({
    viewSubtype: 'BaseGridView',
    viewId: '649e2164-aaaa-bbbb-cccc-ddddeeeeffff',
    loadState: 'loaded',
    isLoading: false,
    isRemoteDisabled: false,
    homeRowCount: 5,
    serverUrl: 'https://demo.jellyfin.org/stable',
    serverId: 'f0b33816-1111-2222-3333-444455556666',
    userId: '4ed1b8b4-9999-8888-7777-666655554444',
  });

  /**
   * Drive one `diagnosedError` against a faked device and hand back both halves of
   * what it produced: the Error a wait would throw, and the JSON line it appended.
   *
   * `roku-test-automation` is mocked because the ODC round trip is the ONE part that
   * genuinely needs a Roku — faking it is what lets the formatting and record shape
   * around it be gated at all. `RTA_RUN_DIR` points the record at a temp directory,
   * the same channel a spawned Vitest child uses in production.
   */
  const diagnose = async (message, opts = {}, { results = HEALTHY, focused, meta } = {}) => {
    vi.resetModules();
    vi.doMock('roku-test-automation', () => ({
      odc: {
        getFocusedNode: async () => focused ?? null,
        getValues: async () => (results instanceof Error ? Promise.reject(results) : { results }),
      },
    }));
    process.env.RTA_RUN_DIR = tmpDir;
    if (meta) fs.writeFileSync(path.join(tmpDir, 'run-meta.json'), JSON.stringify(meta));
    try {
      const mod = await import('./diagnostics.js');
      if (opts.context !== undefined) mod.setFailureContext(opts.context);
      const error = await mod.diagnosedError(message, opts);
      const lines = fs
        .readFileSync(path.join(tmpDir, 'failures.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean);
      return { error, record: JSON.parse(lines.at(-1)) };
    } finally {
      vi.doUnmock('roku-test-automation');
      vi.resetModules();
    }
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rta-diagnostics-'));
  });
  afterEach(() => {
    delete process.env.RTA_RUN_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const BASE = { kind: FAILURE_KINDS.WAIT_FOR_TIMEOUT, label: 'home rows', waitedMs: 20000 };

  it('keeps the human-written message as the first line', async () => {
    const { error } = await diagnose('nav timed out waiting for home rows', BASE);
    expect(error).toBeInstanceOf(Error);
    expect(error.message.split('\n')[0]).toBe('nav timed out waiting for home rows');
  });

  it('reports the view, its load state and the focused node', async () => {
    const { error } = await diagnose('timed out', BASE, {
      focused: {
        node: { subtype: 'JRMarkupGrid', id: 'itemGrid' },
        keyPath: '#viewTarget.#itemGrid',
      },
    });
    expect(error.message).toContain('view=BaseGridView');
    expect(error.message).toContain('loadState=loaded');
    expect(error.message).toContain('focus=JRMarkupGrid@#viewTarget.#itemGrid');
  });

  it('prints loadState=— on a detail screen, which is correct rather than broken', async () => {
    // `loadState` is declared on BaseGridView alone; ItemDetails extends JRScreen,
    // its sibling. A record with no load state there is the honest answer, and
    // `detail=<n>` plus the shell fields are what answer instead.
    const { error } = await diagnose('timed out', BASE, {
      results: found({ viewSubtype: 'ItemDetails', detailRowCount: 3, isRemoteDisabled: false }),
    });
    expect(error.message).toContain('view=ItemDetails');
    expect(error.message).toContain('loadState=—');
    expect(error.message).toContain('detail=3');
  });

  it('surfaces a swallowed-input failure, the highest-value field in the dump', async () => {
    // `JRScene.onKeyEvent` returns true for every key while `isRemoteDisabled` is
    // set, so a timeout carrying this means the app ate our presses — the
    // north-star failure mode, which could only be INFERRED before.
    const { error } = await diagnose('timed out', BASE, {
      results: found({ viewSubtype: 'ItemDetails', isRemoteDisabled: true }),
    });
    expect(error.message).toContain('input=BLOCKED');
  });

  it('stays quiet about the shell when the app was neither blocked nor loading', async () => {
    // Both print only when they are the INTERESTING value, which is what keeps an
    // ordinary failure as short as it was before they existed — and keeps
    // `input=BLOCKED` worth noticing when it does appear.
    const { error } = await diagnose('timed out', BASE);
    expect(error.message).not.toContain('input=BLOCKED');
    expect(error.message).not.toContain('spinner=on');
  });

  it('names the spinner and what it said it was loading', async () => {
    const { error } = await diagnose('timed out', BASE, {
      results: found({ viewSubtype: 'ItemDetails', isLoading: true, loadingText: 'Loading…' }),
    });
    expect(error.message).toContain('spinner=on("Loading…")');
  });

  it('renders the state the loop already read, without re-reading the device', async () => {
    // The `observed` hand-off is what turns "2 row(s) present" into the two types
    // that actually landed — i.e. "Season is late" vs "Season is absent".
    const { error } = await diagnose('detail row not found', {
      ...BASE,
      kind: FAILURE_KINDS.DETAIL_ROW_NOT_FOUND,
      observed: { wanted: 'Season', rowTypes: ['Chapter', 'Person'] },
    });
    expect(error.message).toContain('rowTypes=[Chapter, Person]');
    expect(error.message).toContain('wanted="Season"');
  });

  it('truncates long ids in the line but keeps them whole in the record', async () => {
    const { error, record } = await diagnose('timed out', BASE);
    expect(error.message).toContain('(id f0b33816…)');
    expect(record.state.identity.serverId).toBe('f0b33816-1111-2222-3333-444455556666');
  });

  it('records a device that stopped answering rather than swallowing it', async () => {
    // An unreachable device IS the finding. The identity line is suppressed there
    // because `server=? (id ?) user=?` under "did not answer" is pure noise.
    const { error, record } = await diagnose('timed out', BASE, {
      results: new Error('ECONNREFUSED'),
    });
    expect(error.message).toContain('device did not answer ODC: ECONNREFUSED');
    expect(error.message).not.toContain('server=?');
    expect(record.state.unreachable).toBe('ECONNREFUSED');
  });

  it('never throws, even when every device read fails', async () => {
    // A diagnostic that can fail turns one clear failure into two confusing ones.
    await expect(
      diagnose('timed out', BASE, { results: new Error('device gone') }),
    ).resolves.toBeTruthy();
  });

  it('writes a record carrying the kind, label, wait and message', async () => {
    const { record } = await diagnose('nav timed out waiting for home rows', BASE);
    expect(record).toMatchObject({
      kind: 'wait-for-timeout',
      label: 'home rows',
      waitedMs: 20000,
      message: 'nav timed out waiting for home rows',
    });
    expect(Date.parse(record.at)).not.toBeNaN();
  });

  it('flags an unregistered kind in the record rather than normalising it away', async () => {
    // Recorded, not corrected: silently fixing the slug would hide the bucket split
    // it causes, and throwing would break the never-throws contract. The run
    // summary is what shouts about it.
    const { record } = await diagnose('timed out', { ...BASE, kind: 'detail-rows-missing' });
    expect(record.kindUnknown).toBe(true);
  });

  it('leaves kindUnknown off a registered kind', async () => {
    const { record } = await diagnose('timed out', BASE);
    expect(record.kindUnknown).toBeUndefined();
  });

  it('labels the test it was inside, so a suite failure names itself', async () => {
    const { record } = await diagnose('timed out', BASE);
    expect(record.test).toContain('labels the test it was inside');
  });

  it('carries the ambient context for the runners Vitest cannot label', async () => {
    // `capture-screenshots` retries a screen three times; without the attempt number
    // a screen that RECOVERED leaves records indistinguishable from real failures.
    const { record } = await diagnose('timed out', {
      ...BASE,
      context: { screen: 'en_US/moviesLibrary', attempt: 2, attempts: 3 },
    });
    expect(record.context).toEqual({ screen: 'en_US/moviesLibrary', attempt: 2, attempts: 3 });
  });

  it('treats an empty context as no context at all', async () => {
    const { record } = await diagnose('timed out', { ...BASE, context: {} });
    expect(record.context).toBeUndefined();
  });

  it('places the failure on the far side of the hourly reset when it is', async () => {
    // The demo server resets on the hour. A ~13-min suite starting after ~:46 has
    // that land mid-run, so a record needs to say which side of it the failure fell
    // on — that claim is the whole reason the run origin is stamped.
    const { record, error } = await diagnose('timed out', BASE, {
      meta: { startedAt: '2026-08-10T14:52:00Z' },
    });
    expect(record.runStartedAt).toBe('2026-08-10T14:52:00Z');
    expect(record.afterHourBoundary).toBe(true);
    expect(error.message).toContain('crossed the top of the hour');
  });

  it('does not claim a crossing for a run that started this hour', async () => {
    const { record, error } = await diagnose('timed out', BASE, {
      meta: { startedAt: new Date().toISOString() },
    });
    expect(record.afterHourBoundary).toBe(false);
    expect(error.message).not.toContain('crossed the top of the hour');
  });

  it('leaves the crossing UNKNOWN for a cumulative watch session', async () => {
    // In watch mode the record opens ONCE at session start, so the origin belongs
    // to the session rather than to this iteration — any session running past an
    // hour would stamp every failure from then on. That is the same always-fires
    // noise `formatRunSummary` already suppresses for `cumulative`, and the flag
    // had to stop at the run level only because the child could not see it.
    //
    // `undefined`, not `false`: the reset may well have happened, so `false` would
    // be a claim. The ORIGIN is still recorded — a session's start is provenance
    // either way, and it is what places the failure in the session.
    const { record, error } = await diagnose('timed out', BASE, {
      meta: { startedAt: '2026-08-10T14:52:00Z', cumulative: true },
    });
    expect(record.afterHourBoundary).toBeUndefined();
    expect(error.message).not.toContain('crossed the top of the hour');
    expect(record.runStartedAt).toBe('2026-08-10T14:52:00Z');
  });

  it('still flags the crossing for a single run — the flag keeps its meaning', async () => {
    // The counterpart to the case above: suppressing it in watch mode must not
    // suppress it where a ~13-minute suite really did straddle the reset.
    const { record } = await diagnose('timed out', BASE, {
      meta: { startedAt: '2026-08-10T14:52:00Z', cumulative: false },
    });
    expect(record.afterHourBoundary).toBe(true);
  });

  it('leaves the crossing UNKNOWN when no run origin was stamped', async () => {
    // `false` would be a claim. Without an origin there is nothing to compare
    // against, and a run record that says "not after the reset" when it cannot know
    // is worse than one that says nothing.
    const { record } = await diagnose('timed out', BASE);
    expect(record.afterHourBoundary).toBeUndefined();
    expect(record.runStartedAt).toBeUndefined();
  });

  it('keeps only the four named fields from the focused node — never the node itself', async () => {
    // `JellyfinUser` carries `authToken`, and identity is read by NAMED FIELD for
    // that reason. The focused node is the other whole-node read in the capture, so
    // it gets the same treatment: a record must never become a credential leak.
    const { record } = await diagnose('timed out', BASE, {
      focused: {
        node: { subtype: 'ResumeButton', id: 'resumeButton', secretField: 'must-not-appear' },
        keyPath: '#buttons.#resumeButton',
      },
    });
    expect(record.state.focus).toEqual({
      subtype: 'ResumeButton',
      id: 'resumeButton',
      keyPath: '#buttons.#resumeButton',
    });
    expect(JSON.stringify(record)).not.toContain('must-not-appear');
  });

  it('keeps rowItemFocused when the focused node is a list, and prints the row', async () => {
    // The field that distinguishes a healthy Home from a stuck one: both rest on the
    // `#homeRows` CONTAINER under an identical keyPath, so without the row index the
    // record cannot say which is which. This is that exact failure, as recorded.
    const { record, error } = await diagnose('nav timed out waiting for focus', BASE, {
      focused: {
        node: { subtype: 'HomeRows', id: 'homeRows', rowItemFocused: [3, 0] },
        keyPath: '#viewTarget.#homeRows',
      },
    });
    expect(record.state.focus.rowItemFocused).toEqual([3, 0]);
    expect(error.message).toContain('rowItemFocused=[3,0]');
  });

  it('omits rowItemFocused when the focused node is not a list', async () => {
    // Keeps an unrelated failure as short as it was before this field existed.
    const { record, error } = await diagnose('timed out', BASE, {
      focused: { node: { subtype: 'ResumeButton', id: 'resumeButton' }, keyPath: '#resumeButton' },
    });
    expect(record.state.focus.rowItemFocused).toBeUndefined();
    expect(error.message).not.toContain('rowItemFocused');
  });
});
