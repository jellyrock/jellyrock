/**
 * Hardware-free gate on `getActiveVals`' failure semantics.
 *
 * The batch helper exists to cut a one-shot assertion's device round trips from ~112
 * to 2, but the property worth gating is not the count — it is that a DEAD BATCH and
 * a MISSING FIELD stay distinguishable.
 *
 * The single-read `getActiveVal` swallows to `undefined`, which is correct for a poll
 * (callers retry; a persistent miss ends in a diagnosed timeout). Copying that into a
 * batch would be the `lib/jellyfin.js` defect one layer up: an ODC failure would make
 * every keyPath read `undefined` at once, and the assertion consuming them would
 * report "this screen has no rows" — a confident false statement about the app,
 * produced by an infrastructure failure.
 *
 * `odc` is stubbed rather than driven, deliberately: the behaviours under test are
 * "the transport rejected" and "the device answered `found: false`", and both are
 * shapes at the module boundary. What needs a real Roku is whether a given keyPath
 * resolves — that stays hardware-verified via `npm run test:rta`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getValues = vi.fn();
const getFocusedNode = vi.fn();
const getValue = vi.fn();
const sendKeypress = vi.fn();
vi.mock('roku-test-automation', () => ({
  odc: {
    getValues: (...a) => getValues(...a),
    getValue: (...a) => getValue(...a),
    getFocusedNode: (...a) => getFocusedNode(...a),
  },
  // `Key` carries the REAL values (verified against the installed package), not invented
  // ones — a helper that sends `ecp.Key.Up` must be asserted against what the device would
  // actually receive, or the test agrees with a typo.
  ecp: {
    sendKeypress: (...a) => sendKeypress(...a),
    // captureFailureState reads the OS media player, so the mock has to answer it
    // or every diagnosed failure throws instead of reporting.
    getMediaPlayer: async () => null,
    // Same reason: it also asks ECP whether a screensaver is up, which is the one
    // device state that explains an all-ODC-reads-failed record. `app` with no
    // `screensaver` is the ordinary case — the channel in the foreground.
    getActiveApp: async () => ({ app: { id: 'dev', title: 'JellyRock' } }),
    Key: { Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' },
  },
}));

// `resolution.js` is stubbed so these assert WHICH reads `waitFor` hands to the audit,
// without standing up a census. The real module is a no-op unless `RTA_AUDIT_RESOLUTION=1`,
// so replacing it changes nothing for every other case in this file.
const auditSceneResolution = vi.fn();
const auditSceneResolutions = vi.fn();
vi.mock('./resolution.js', async (importOriginal) => ({
  ...(await importOriginal()),
  auditSceneResolution: (...a) => auditSceneResolution(...a),
  auditSceneResolutions: (...a) => auditSceneResolutions(...a),
}));

const {
  getActiveVal,
  getActiveVals,
  getVals,
  waitFor,
  waitFocused,
  focusIsInside,
  waitFocusInside,
  waitDialogClosed,
  waitOsdUp,
  resendIfSwallowed,
  resendUntilFocusInside,
  resendUntilFocused,
  homeListId,
  waitFocusInHomeContent,
  walkFocusInto,
  walkHomeToFirstRow,
  overhangWalkKey,
  waitHome,
  scrollFocus,
  waitCellsQuiet,
  waitRowsSettled,
  readCellCounts,
  formatCellCounts,
  CELL_REPORT_COUNTERS,
  axisEnd,
  sweepBudget,
} = await import('./steps.js');
// The closed set the failure records group by. Imported from its owning module
// rather than through `diagnostics.js` so a test asserting a slug cannot agree
// with a re-export that has drifted.
const { FAILURE_KINDS, readRecoveries } = await import('../../../scripts/run-record.js');
// The predicate `resendUntilFocused` is driven with here, imported from the module that
// owns it rather than redefined — a test asserting against a hand-copied predicate would
// agree with a copy that had drifted.
const { focusIsInHomeContent } = await import('./home-list.js');

/** A `getFocusedNode` answer resting on a row list at `[row, item]`. */
const onRow = (row) => ({
  node: { subtype: 'HomeRows', id: 'homeRows', rowItemFocused: [row, 0] },
  keyPath: '#viewTarget.#homeRows',
});

beforeEach(() => {
  // NOTE the coupling these defaults model: the throw path runs through
  // `diagnosedError`, which calls `captureFailureState`, which issues its OWN
  // `getFocusedNode` + `getValues` against the same device. So a test that makes the
  // batch fail must fail only the FIRST call (`mockRejectedValueOnce`) and leave the
  // diagnostic capture able to answer — otherwise it is testing a device that has
  // gone away entirely, not a failed batch. Both must return promises for the same
  // reason: the capture `.catch()`es them.
  getValues.mockReset().mockResolvedValue({ results: {} });
  getFocusedNode.mockReset().mockResolvedValue(null);
});

describe('getActiveVals', () => {
  it('returns values positionally aligned with the keyPaths given', () => {
    getValues.mockResolvedValue({
      results: { k0: { found: true, value: 'Action' }, k1: { found: true, value: 3 } },
    });
    return expect(getActiveVals(['#a.title', '#a.getChildCount()'])).resolves.toEqual([
      'Action',
      3,
    ]);
  });

  it('reads a NOT-FOUND keyPath as undefined, matching the single-read form', async () => {
    // The device answered about this keyPath and did not find it. That is a fact, and
    // it must stay reportable as absence.
    getValues.mockResolvedValue({
      results: { k0: { found: true, value: 'Action' }, k1: { found: false } },
    });
    await expect(getActiveVals(['#a.title', '#a.missing'])).resolves.toEqual(['Action', undefined]);
  });

  it('THROWS when the batch itself fails, rather than reporting every field missing', async () => {
    // THE case. Swallowing here would hand an assertion a screen that appears
    // completely empty, and the assertion would blame the app.
    getValues.mockRejectedValueOnce(new Error('odc timeout'));
    await expect(getActiveVals(['#a.title'])).rejects.toThrow(/odc timeout/);
  });

  it('THROWS when the response carries no results at all', async () => {
    // A malformed answer is not an answer. Same reasoning as the rejection above:
    // anything other than a real batch must not become a screenful of undefined.
    getValues.mockResolvedValueOnce({});
    await expect(getActiveVals(['#a.title'])).rejects.toThrow(/not with a batch/);
  });

  it('sends ONE batch for many keyPaths, each scoped to the active routed view', async () => {
    // The round-trip saving is the reason this exists; and the `activeRoutedView.`
    // prefix is what keeps it reading the screen the user is on rather than a
    // suspended view (see getActiveVal).
    getValues.mockResolvedValue({ results: { k0: { found: true, value: 1 } } });
    await getActiveVals(['#a.x', '#b.y', '#c.z']);

    expect(getValues).toHaveBeenCalledTimes(1);
    const { requests } = getValues.mock.calls[0][0];
    expect(Object.keys(requests)).toHaveLength(3);
    for (const r of Object.values(requests)) {
      expect(r.base).toBe('global');
      expect(r.keyPath).toMatch(/^activeRoutedView\./);
    }
  });

  it('keys requests positionally, so a duplicate keyPath cannot collapse', async () => {
    // Keying by the keyPath itself would silently merge these into one request and
    // return a short array — a miscount inside the thing that reports counts.
    getValues.mockResolvedValue({
      results: { k0: { found: true, value: 'x' }, k1: { found: true, value: 'x' } },
    });
    await expect(getActiveVals(['#a.title', '#a.title'])).resolves.toEqual(['x', 'x']);
    expect(Object.keys(getValues.mock.calls[0][0].requests)).toHaveLength(2);
  });

  it('makes no device call at all for an empty list', async () => {
    await expect(getActiveVals([])).resolves.toEqual([]);
    expect(getValues).not.toHaveBeenCalled();
  });
});

/**
 * Read-failure ATTRIBUTION in the waits.
 *
 * The single-read swallow stays (a poll retries; that contract is unchanged and is
 * asserted below). What is gated here is that the timeout can still say WHICH of the two
 * causes it hit, because `last=undefined` alone cannot: a device that stopped answering
 * and a field the app never set produce byte-identical messages otherwise. That is the
 * ambiguity #785 recorded and could not resolve after the fact.
 *
 * The distinction is real on the wire, not inferred: ODC answers `found: false` for a
 * keyPath it resolved and did not find, and only REJECTS when the request itself failed.
 * So these drive the two shapes separately and assert they are not conflated.
 */
describe('wait read-failure attribution', () => {
  beforeEach(() => {
    getValue.mockReset();
  });

  it('names failed reads in the timeout when the device stops answering', async () => {
    getValue.mockRejectedValue(new Error('odc timeout'));
    await expect(
      waitFor('#a.loadState', (v) => v === 'loaded', { timeout: 120, interval: 10 }),
    ).rejects.toThrow(/read\(s\) did not complete/);
  });

  it('does NOT count a found:false answer as a failed read', async () => {
    // THE case that keeps the signal worth having. The device answered — the field is
    // simply not there — so a timeout here must read as a real absence, not as an
    // infrastructure fault. Conflating these would make the new clause fire on every
    // ordinary "not there yet" timeout and mean nothing.
    getValue.mockResolvedValue({ found: false });
    const err = await waitFor('#a.loadState', (v) => v === 'loaded', {
      timeout: 120,
      interval: 10,
    }).catch((e) => e);
    expect(err.message).toMatch(/timed out waiting for/);
    expect(err.message).not.toMatch(/read\(s\) did not complete/);
    expect(err.message).toMatch(/readErrors=0/);
  });

  it('still swallows a failed read per tick, so a recovering wait passes', async () => {
    // The swallow is the POINT of the single-read form and must survive: one dropped
    // read cannot fail a wait the very next tick satisfies.
    getValue
      .mockRejectedValueOnce(new Error('odc timeout'))
      .mockResolvedValue({ found: true, value: 'loaded' });
    await expect(
      waitFor('#a.loadState', (v) => v === 'loaded', { timeout: 500, interval: 10 }),
    ).resolves.toBe('loaded');
  });

  it('carries readErrors in the observed payload, beside actionErrors', async () => {
    // `observed` is what `diagnosedError` both renders into the message and hands to
    // `recordFailure`, so a flake baseline aggregates the same number a human reads.
    // Asserted through the rendered message because that is the shared surface.
    // Both counters appear so the two causes stay separable rather than merged.
    getValue.mockRejectedValue(new Error('odc timeout'));
    const err = await waitFor('#a.loadState', (v) => v === 'loaded', {
      timeout: 120,
      interval: 10,
    }).catch((e) => e);
    expect(err.message).toMatch(/readErrors=[1-9]/);
    expect(err.message).toMatch(/actionErrors=0/);
  });

  it('attributes a failed focus read in waitFocused too', async () => {
    // Same defect, same fix, different reader: `last=undefined@undefined` is otherwise
    // identical whether focus never arrived or the device went away. The capture at the
    // throw site needs getFocusedNode to answer, so only the polled reads reject.
    getFocusedNode
      .mockReset()
      .mockRejectedValueOnce(new Error('odc timeout'))
      .mockRejectedValueOnce(new Error('odc timeout'))
      .mockResolvedValue(null);
    await expect(
      waitFocused(() => true, { timeout: 60, interval: 10, label: 'anything' }),
    ).rejects.toThrow(/read\(s\) did not complete/);
  });
});

/**
 * `focusIsInside` — the one predicate every "is focus inside X" gate now shares.
 *
 * The property under test is that a container id is matched as a whole keyPath SEGMENT,
 * never as a substring. It is a red/green gate rather than a review note on purpose: the
 * substring form fails by succeeding EARLY, which produces no failure of its own — the
 * gate passes, the next step acts against a screen that has not arrived, and whatever
 * times out later gets the blame. And a prefix collision is introduced by NAMING a node,
 * so nothing in a test diff reveals it.
 *
 * The keyPaths below are the real ones, captured off `.178` on 2026-09-04 (a full green
 * suite, 214 focused-node reads) rather than invented — an invented shape is exactly how
 * a predicate ends up agreeing with a fixture and disagreeing with the device.
 */
describe('focusIsInside', () => {
  it('matches a container that is an ancestor segment of the focused node', () => {
    expect(focusIsInside('#routerOutlet.#viewTarget.#5d412eb3.#itemGrid', '#itemGrid')).toBe(true);
    expect(
      focusIsInside('#routerOutlet.#viewTarget.#a957cebb.#buttons.#resumeButton', '#buttons'),
    ).toBe(true);
  });

  it('matches through index segments, which ids-less nodes contribute', () => {
    // `...#extrasGrp.0.#extrasGrid` and `...#options.1.1.#buttons` are both real: RTA
    // falls back to the child index whenever a node carries no id.
    expect(
      focusIsInside(
        '#routerOutlet.#viewTarget.#0d5a08a5.#itemExtras.#extrasGrp.0.#extrasGrid',
        '#extrasGrid',
      ),
    ).toBe(true);
    expect(
      focusIsInside('#routerOutlet.#viewTarget.#fddf1216.#options.1.1.#buttons', '#options'),
    ).toBe(true);
  });

  it('does NOT match a container whose id merely PREFIXES the one asked for', () => {
    // The live collision this helper was written for: `#optionsPanelOverlay` is the
    // reparenting host in `components/JRScene.xml` and `#options` is a substring of it,
    // so the substring form reported the grid options dialog focused for focus anywhere
    // in that overlay. Segment matching is what makes the two distinguishable.
    expect(focusIsInside('#routerOutlet.#optionsPanelOverlay.2', '#options')).toBe(false);
    expect(focusIsInside('#routerOutlet.#itemGridTitles', '#itemGrid')).toBe(false);
  });

  it('still matches the real node when the overlay IS in the path', () => {
    // `OptionsSlider` reparents itself into that overlay when opened, and its own id is
    // `options` — so the overlay being present must not be read as the collision above.
    expect(focusIsInside('#optionsPanelOverlay.#options.0', '#options')).toBe(true);
  });

  it('normalises a container id given without its `#`', () => {
    // `dialogs.spec.js` asks for `jrDialog`; the real path is `#jrDialog.#optionList`.
    // Rejecting the bare form would trade a silent over-match for a silent under-match.
    expect(focusIsInside('#jrDialog.#optionList', 'jrDialog')).toBe(true);
    expect(focusIsInside('#jrDialog.#okButton', '#jrDialog')).toBe(true);
  });

  it('matches the FOCUSED node itself, not only its ancestors', () => {
    expect(focusIsInside('#routerOutlet.#viewTarget.#59354e77.#homeRows', '#homeRows')).toBe(true);
  });

  it('is false for a keyPath that was never read', () => {
    // A failed `getFocusedNode` must not read as "focus is somewhere else" OR as a match.
    for (const bad of [undefined, null, '', 0, {}])
      expect(focusIsInside(bad, '#itemGrid')).toBe(false);
  });
});

describe('waitFocusInside', () => {
  beforeEach(() => {
    getFocusedNode.mockReset().mockResolvedValue(null);
    sendKeypress.mockReset();
  });

  it('resolves once focus is inside the container', async () => {
    getFocusedNode.mockResolvedValue({ keyPath: '#routerOutlet.#viewTarget.#x.#itemGrid' });
    await expect(waitFocusInside('#itemGrid', { timeout: 200, interval: 10 })).resolves.toEqual({
      keyPath: '#routerOutlet.#viewTarget.#x.#itemGrid',
    });
  });

  it('does not resolve on a container that merely prefixes the one asked for', async () => {
    // The on-device consequence of the collision above, at the wait rather than the
    // predicate: this must TIME OUT, not report the dialog open.
    getFocusedNode.mockResolvedValue({ keyPath: '#routerOutlet.#optionsPanelOverlay.2' });
    await expect(waitFocusInside('#options', { timeout: 60, interval: 10 })).rejects.toThrow(
      /timed out waiting for focus/,
    );
  });

  it("names the caller's label in the timeout, not the container", async () => {
    // The label is the first thing read when a gate fails, and "grid options dialog" says
    // what was being waited for where "focus inside #options" only says where it lives.
    await expect(
      waitFocusInside('#options', { timeout: 60, interval: 10, label: 'grid options dialog' }),
    ).rejects.toThrow(/grid options dialog/);
  });

  it('falls back to naming the container when no label is given', async () => {
    await expect(waitFocusInside('#itemGrid', { timeout: 60, interval: 10 })).rejects.toThrow(
      /focus inside #itemGrid/,
    );
  });

  it('passes an action through, so a swallowed press can still be re-sent', async () => {
    // `navCellSweepExtras` and `focus.spec` both gate on focus ARRIVING after a Back that
    // the router may have swallowed; routing them through this helper must not cost them
    // the retry.
    getFocusedNode.mockResolvedValue({ keyPath: '#routerOutlet.#viewTarget.#x.#extrasGrid' });
    await waitFocusInside('#itemGrid', {
      timeout: 80,
      interval: 10,
      action: resendIfSwallowed('back', '#extrasGrid'),
    }).catch(() => {});
    expect(sendKeypress).toHaveBeenCalledWith('back');
  });
});

/**
 * The shared dialog-dismiss wait, gated because it is now a SINGLE point of failure for
 * ten call sites across two specs and a demo take. Before Phase 3b each of those spelled
 * out its own `#jrDialog.id` / `=== undefined` pair, so a typo could only break one site;
 * now a wrong keyPath or an inverted predicate breaks every dialog test at once, and it
 * would present as ten unrelated timeouts rather than as one broken helper.
 */
describe('waitDialogClosed', () => {
  beforeEach(() => {
    getValue.mockReset();
  });

  it('resolves once the overlay has left the scene', async () => {
    // ODC answers `found: false` for a keyPath it resolved and did not find, which is
    // exactly what a removed overlay looks like on the wire.
    getValue.mockResolvedValue({ found: false });
    await expect(
      waitDialogClosed('confirm dialog dismissed', { timeout: 200 }),
    ).resolves.toBeUndefined();
  });

  it('reads the scene-rooted overlay id, not an active-view-scoped one', async () => {
    // The keyPath is the helper's whole contract. `#jrDialog` is a top-level overlay
    // parented to the scene, not into the routed view, so a `getActiveVal` read would
    // miss it and every dismiss would report as still-open.
    getValue.mockResolvedValue({ found: false });
    await waitDialogClosed('x', { timeout: 200 });
    expect(getValue).toHaveBeenCalledWith(
      expect.objectContaining({ base: 'scene', keyPath: '#jrDialog.id' }),
    );
  });

  it('does NOT resolve while the dialog is still open', async () => {
    // The inverse of the first case, and the one that matters: a predicate flipped to
    // truthy would make all ten sites pass the instant the dialog OPENED.
    getValue.mockResolvedValue({ found: true, value: 'jrDialog' });
    await expect(waitDialogClosed('confirm dialog dismissed', { timeout: 60 })).rejects.toThrow(
      /confirm dialog dismissed/,
    );
  });

  it("honours the caller's timeout rather than its own default", async () => {
    // Landmine from Phase 2, gated rather than remembered: routing sites onto a helper
    // silently adopted ITS defaults and re-polled six of them every 300 ms. A default
    // that quietly overrode the 60 ms asked for here would show up as ~1000 reads.
    getValue.mockResolvedValue({ found: true, value: 'jrDialog' });
    await waitDialogClosed('still open', { timeout: 60 }).catch(() => {});
    expect(getValue.mock.calls.length).toBeLessThan(20);
  });
});

/**
 * The resend guard, gated without hardware.
 *
 * Two behaviours carry the whole helper and neither is visible by reading a call site:
 * it must NOT press on the first tick (waitFor invokes `action` before its first read,
 * and the caller has just pressed — resending there is a double-press into a screen
 * that is still mounting), and it must STOP once focus has left the container (or the
 * retry becomes the overshoot it was meant to avoid).
 *
 * Both were regressions waiting to happen: the two call sites this replaced were
 * hand-rolled and had the first-tick bug, which no on-device run would report as
 * anything but an occasional mystery.
 */
describe('resendIfSwallowed', () => {
  beforeEach(() => {
    getFocusedNode.mockReset();
    sendKeypress.mockReset();
  });

  const focusedAt = (keyPath) => getFocusedNode.mockResolvedValue({ keyPath });

  it('does not press on the first tick — the caller just pressed', async () => {
    focusedAt('scene.#itemGrid.0');
    const action = resendIfSwallowed('back', '#itemGrid');
    await action();
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('resends once focus is still inside the container on a later tick', async () => {
    focusedAt('scene.#itemGrid.0');
    const action = resendIfSwallowed('back', '#itemGrid');
    await action(); // first tick, sits out
    await action();
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(2);
    expect(sendKeypress).toHaveBeenCalledWith('back');
  });

  it('stops pressing once focus has left the container', async () => {
    focusedAt('scene.#itemGrid.0');
    const action = resendIfSwallowed('back', '#itemGrid');
    await action();
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
    focusedAt('scene.#homeRows.2'); // the press landed; we navigated away
    await action();
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
  });

  it('does not press when the focus read fails — an unknown state is not a swallow', async () => {
    getFocusedNode.mockRejectedValue(new Error('odc down'));
    const action = resendIfSwallowed('back', '#itemGrid');
    await action();
    await action();
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('RECORDS the resend, so a silent recovery cannot look like the event never happening', async () => {
    // Read back through the module's own accessor rather than a mock: with no run context
    // `recordDir()` returns a throwaway per-pid tmpdir and keeps read/write symmetric,
    // which is the property that makes this assertable without stubbing the writer.
    const before = readRecoveries().length;
    focusedAt('scene.#itemGrid.0');
    const action = resendIfSwallowed('back', '#itemGrid');
    await action(); // first tick, sits out
    await action(); // swallow detected -> re-send
    const added = readRecoveries().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0].what).toBe('swallowed back at #itemGrid');
    expect(added[0].observed).toMatchObject({
      key: 'back',
      containerId: '#itemGrid',
      resends: 1,
      keyPath: 'scene.#itemGrid.0',
    });
  });

  it('records NOTHING when the press landed — the guard is silent on the happy path', async () => {
    // The counterpart that matters: an instrument firing on every wait would drown the
    // signal it exists to carry. Verified on device 2026-09-08 (a full green suite recorded
    // `recoveries: 0`), and pinned here so it stays true.
    focusedAt('scene.#homeRows.2'); // focus already left the grid: the Back landed
    const before = readRecoveries().length;
    const action = resendIfSwallowed('back', '#itemGrid');
    await action();
    await action();
    expect(sendKeypress).not.toHaveBeenCalled();
    expect(readRecoveries()).toHaveLength(before);
  });

  it('gives each wait its own first-tick budget', async () => {
    focusedAt('scene.#itemGrid.0');
    const first = resendIfSwallowed('back', '#itemGrid');
    await first();
    await first();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
    // A second wait must sit out its OWN first tick rather than inherit the first's state.
    const second = resendIfSwallowed('back', '#itemGrid');
    await second();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
  });
});

describe("walkHomeToFirstRow — the precondition Home's Up-to-overhang escape requires", () => {
  beforeEach(() => {
    // The outer `beforeEach` does not own `sendKeypress`, and these tests install their own
    // `getFocusedNode` implementations — both must be cleared or a later test inherits the
    // presses and the focus script of an earlier one.
    getFocusedNode.mockReset();
    sendKeypress.mockReset().mockResolvedValue(undefined);
  });

  it('sends nothing when Home is already resting on row 0', async () => {
    // The healthy case, and the one that runs on every nav. A helper that pressed here
    // would escape into the overhang before the caller asked it to.
    getFocusedNode.mockResolvedValue(onRow(0));
    await expect(walkHomeToFirstRow()).resolves.toEqual({ walked: 0, from: null });
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('walks up to row 0 and reports where it started', async () => {
    // The recorded failure: Home resting on row 3, where `Home.onKeyEvent` returns false
    // for Up, so the key bubbles away and the caller times out blaming the overhang.
    let row = 3;
    getFocusedNode.mockImplementation(async () => onRow(row));
    sendKeypress.mockImplementation(async () => {
      row -= 1;
    });

    await expect(walkHomeToFirstRow()).resolves.toEqual({ walked: 3, from: 3 });
    expect(sendKeypress).toHaveBeenCalledTimes(3);
    expect(sendKeypress).toHaveBeenLastCalledWith('Up');
  });

  it('stops pressing the moment a read reports row 0, mid-walk', async () => {
    // The guard that keeps the walk from overshooting. Presses are counted against what the
    // read SAYS, so a device that arrives at row 0 sooner than expected gets no extra Up —
    // which would leave focus in the overhang and the caller somewhere it never asked for.
    const rows = [2, 0, 0];
    let i = 0;
    getFocusedNode.mockImplementation(async () => onRow(rows[Math.min(i++, rows.length - 1)]));

    await expect(walkHomeToFirstRow()).resolves.toEqual({ walked: 1, from: 2 });
    expect(sendKeypress).toHaveBeenCalledTimes(1);
  });

  it('presses nothing when focus is not on a row list at all, and times out under its own name', async () => {
    // An ABSENT `rowItemFocused` means focus is somewhere Up is not the right key. Pressing
    // at an unidentified component is the north-star mistake; failing by name is not.
    getFocusedNode.mockResolvedValue({
      node: { subtype: 'ResumeButton', id: 'resumeButton' },
      keyPath: '#resumeButton',
    });

    await expect(walkHomeToFirstRow({ timeout: 30, interval: 10 })).rejects.toThrow(
      /home row 0 focused/,
    );
    expect(sendKeypress).not.toHaveBeenCalled();
  });
});

describe('overhangWalkKey — the key is chosen from where focus IS', () => {
  // Fixtures mirror what the device actually reports, ids included. RTA builds each keyPath
  // segment from `node.id` while it is non-empty and from the child INDEX otherwise
  // (`processGetFocusedNodeRequest`), so a node the app creates WITHOUT an id shows up as a
  // bare number — which is why several of these carry no `#name`. Getting that wrong is what
  // made an earlier revision of this suite assert against states the device cannot produce.
  const onIcon = {
    node: { subtype: 'JROverhangIcon', id: 'settingsIcon' },
    keyPath: '#overhang.#settingsIcon',
  };
  // Fresh launch: `Home.xml` declares `<HomeRows id="homeRows" />`, so the id IS present.
  const inHomeRows = {
    node: { subtype: 'HomeRows', id: 'homeRows', rowItemFocused: [0, 2] },
    keyPath: '#routerOutlet.#viewTarget.#abc.#homeRows',
  };
  // `JROverhang.onTabsChanged` appends its JRTabBar with `CreateObject` and sets no id.
  const onTabBar = { node: { subtype: 'JRTabBar', id: '' }, keyPath: '#overhang.2' };

  it('sends nothing once the icon has focus', () => {
    expect(overhangWalkKey(onIcon, 'settingsIcon')).toBeNull();
  });

  it('re-presses Up while focus is still inside Home rows — the #789 signature', () => {
    // The exact recorded state: row 0, item index dragged to 2 by the Rights themselves.
    // Right cannot leave Home from here, which is why the old walk could never recover.
    expect(overhangWalkKey(inHomeRows, 'settingsIcon')).toBe('Up');
  });

  it('still recognises Home after a tab round trip, when the row list has NO id', () => {
    // `Home.onTabChanged` re-creates the list with `CreateObject` and never re-assigns the
    // id, so from here on the focused node reports `id: ''` and an index keyPath. Matching
    // on id or keyPath would fall through to Right and quietly reinstate the defect above;
    // subtype is set by the component, so it survives. Unreachable from the suite today
    // (nothing in `specs/` selects a tab) — this pins the rule, not a live path.
    const afterTabRoundTrip = {
      node: { subtype: 'HomeRows', id: '', rowItemFocused: [0, 2] },
      keyPath: '#routerOutlet.#viewTarget.#abc.0',
    };
    expect(overhangWalkKey(afterTabRoundTrip, 'settingsIcon')).toBe('Up');
  });

  it('treats the favorites list as Home too (future-proofing, not coverage)', () => {
    // Home's active list is `m.activeContent`, which is the favorites list under that tab.
    // Nothing in `specs/` selects a tab, so this state is unreachable from `focusOverhangIcon`
    // today — asserted so the predicate agrees with the app, NOT as evidence it is exercised.
    // See `focusIsInHomeContent` in ./home-list.js, which owns this question.
    const inFavorites = {
      node: { subtype: 'FavoritesRows', id: '', rowItemFocused: [0, 0] },
      keyPath: '#routerOutlet.#viewTarget.#abc.0',
    };
    expect(overhangWalkKey(inFavorites, 'settingsIcon')).toBe('Up');
  });

  it('walks Right once focus has reached the overhang chain', () => {
    expect(overhangWalkKey(onTabBar, 'settingsIcon')).toBe('Right');
  });

  it('falls back to Right when the focus read failed', () => {
    // Unchanged from the pre-fix behaviour on purpose — a failed read is not evidence that
    // the escape is stuck, and Up from the overhang is inert anyway.
    expect(overhangWalkKey(null, 'settingsIcon')).toBe('Right');
  });

  it('does not mistake a DIFFERENT overhang icon for the target', () => {
    expect(
      overhangWalkKey(
        { node: { subtype: 'JROverhangIcon', id: 'searchIcon' }, keyPath: '#overhang.#searchIcon' },
        'settingsIcon',
      ),
    ).toBe('Right');
  });
});

describe('homeListId — which row list Home actually has in the scene', () => {
  beforeEach(() => {
    getValue.mockReset();
    getFocusedNode.mockReset().mockResolvedValue(null);
    getValues.mockReset();
  });

  /** A batch answer where candidate `i` resolved to `subtype`. */
  const resolves = (i, subtype) => ({
    results: { [`k${i}`]: { found: true, value: subtype }, [`k${1 - i}`]: { found: false } },
  });

  it('asks about BOTH candidate ids in ONE round trip', async () => {
    getValues.mockResolvedValue(resolves(0, 'HomeRows'));

    await homeListId();

    // One batch, not two reads. Asking sequentially would cost a second round trip AND
    // straddle a tab change, so the two answers could describe different moments.
    expect(getValues).toHaveBeenCalledTimes(1);
    const sent = Object.values(getValues.mock.calls[0][0].requests).map((r) => r.keyPath);
    expect(sent).toEqual(['#homeRows.subtype()', '#favoritesRows.subtype()']);
    // Scene-rooted, not `activeRoutedView`-scoped: `selectionProbe` reads Home's rows AFTER
    // a drill-down has opened, when Home is suspended but still in the tree.
    expect(Object.values(getValues.mock.calls[0][0].requests).map((r) => r.base)).toEqual([
      'scene',
      'scene',
    ]);
  });

  it('returns the id of whichever list answered', async () => {
    getValues.mockResolvedValue(resolves(0, 'HomeRows'));
    await expect(homeListId()).resolves.toBe('#homeRows');
  });

  it('resolves the FAVORITES list when that is the tab in the scene', async () => {
    // The case no spec reaches today and the whole reason the conversion happened: under
    // the Favorites tab, `#homeRows` is not stale, it is absent.
    getValues.mockResolvedValue(resolves(1, 'FavoritesRows'));
    await expect(homeListId()).resolves.toBe('#favoritesRows');
  });

  it('probes `subtype()` rather than `id`, so the right id on the wrong node cannot pass', async () => {
    // Costs the same round trip and proves more. A node carrying the id but a different
    // subtype is not a row list, and reading it would be the "right id, wrong node" class.
    getValues.mockResolvedValue({
      results: { k0: { found: true, value: 'Group' }, k1: { found: false } },
    });
    await expect(homeListId({ timeout: 1 })).rejects.toThrow(/active row list to be in the scene/);
  });

  it('fails under its OWN kind when neither list is there, rather than answering undefined', async () => {
    // The defect this whole conversion exists to remove. The shape it replaces did not fail
    // at all: `#homeRows.content.getChildCount()` resolved in 8 ms to `undefined`, a
    // caller's `|| 0` read that as an empty Home, and the run blamed a tile.
    getValues.mockResolvedValue({ results: { k0: { found: false }, k1: { found: false } } });

    // The slug it aggregates under is asserted against the RECORD, in the failure-kind
    // describe below — the message never carries it.
    await expect(homeListId({ timeout: 1 })).rejects.toThrow(/neither #id resolved/);
  });

  it('keeps waiting through a dead batch instead of throwing the transport error', async () => {
    // A poll must swallow a transport failure per tick — the loop retries, and a persistent
    // miss ends in the diagnosed timeout above. Letting `getVals`' batch throw escape here
    // would turn one ODC hiccup into a failed nav.
    getValues.mockRejectedValue(new Error('odc timeout'));
    await expect(homeListId({ timeout: 1 })).rejects.toThrow(/neither #id resolved/);
  });
});

describe('resendUntilFocused — the resend whose destination is a predicate', () => {
  beforeEach(() => {
    getFocusedNode.mockReset();
    sendKeypress.mockReset();
  });

  it('sits out the first tick, like its id-keyed sibling', async () => {
    // The press may still be in flight; spending the poll interval as the "did it land?"
    // window is the whole mechanism.
    getFocusedNode.mockResolvedValue({ keyPath: 'x', node: { subtype: 'BaseGridView' } });
    const action = resendUntilFocused('back', focusIsInHomeContent);

    await action();
    expect(sendKeypress).not.toHaveBeenCalled();

    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
  });

  it('STOPS pressing once the predicate is satisfied', async () => {
    // Over-pressing Back on Home raises the exit-confirm dialog, and off the path to Home it
    // is worse than that: `UserSelect.onKeyEvent` treats Back as *change server*.
    getFocusedNode.mockResolvedValue({ keyPath: 'x', node: { subtype: 'HomeRows' } });
    const action = resendUntilFocused('back', focusIsInHomeContent);

    await action();
    await action();
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('sends NOTHING when focus cannot be read, rather than guessing', async () => {
    // The same rule `walkHomeToFirstRow` follows: an unreadable focus is not a licence to
    // press at an unidentified component.
    getFocusedNode.mockResolvedValue(null);
    const action = resendUntilFocused('back', focusIsInHomeContent);

    await action();
    await action();
    expect(sendKeypress).not.toHaveBeenCalled();
  });
});

describe('waitFocusInHomeContent — Home focus, asked by subtype', () => {
  beforeEach(() => {
    getFocusedNode.mockReset();
    getValue.mockReset();
    sendKeypress.mockReset();
  });

  it('accepts focus on EITHER row list', async () => {
    getFocusedNode.mockResolvedValue({ keyPath: 'x', node: { subtype: 'FavoritesRows' } });
    await expect(waitFocusInHomeContent({ timeout: 1000 })).resolves.toBeTruthy();
  });

  it('does not accept focus that merely sits under a matching keyPath', async () => {
    // The id half is gone on purpose: a keyPath naming the container is exactly what stops
    // being true when the other tab is selected.
    getFocusedNode.mockResolvedValue({
      keyPath: 'a.#homeRows.b',
      node: { subtype: 'JRTabBar' },
    });
    await expect(waitFocusInHomeContent({ timeout: 1 })).rejects.toThrow(/focus inside Home/);
  });
});

describe('waitHome — the login flow is a separate question, asked first', () => {
  beforeEach(() => {
    getValue.mockReset();
    // Re-arm rather than bare-reset: the refusal tests below take the THROW path, which
    // runs `diagnosedError` -> `captureFailureState` -> its own `getFocusedNode`, and the
    // capture `.catch()`es the result. A bare `mockReset()` returns undefined and the
    // diagnostic dies on `.catch` of undefined, replacing the real failure with a mock
    // artifact. Same coupling the file-level `beforeEach` documents.
    getFocusedNode.mockReset().mockResolvedValue(null);
    sendKeypress.mockReset();
    // Home's active list resolves to `HomeRows`. `waitHome` no longer NAMES a row list — it
    // asks `homeListId` which of the two is in the scene, which is one batched read of both
    // candidate ids. These cases are about the LOGIN gate, so the resolution is arranged to
    // succeed; `homeListId`'s own behaviour is tested separately below.
    getValues.mockReset().mockResolvedValue({
      results: { k0: { found: true, value: 'HomeRows' }, k1: { found: false } },
    });
  });

  it('resolves the row list only AFTER the view gate has named Home', async () => {
    // The ordering that makes a throwing resolver safe here. `steps.js` documents a window
    // between launch and Home where NEITHER list is in the tree, so asking which list is
    // active before Home is up would fail on a login that had simply not finished — the
    // exact misattribution the view gate exists to prevent, reintroduced one layer down.
    const order = [];
    let mounted = false;
    getValue.mockImplementation(async ({ keyPath }) => {
      if (keyPath === 'activeRoutedView.subtype()') {
        order.push('view');
        const res = mounted ? { found: true, value: 'Home' } : { found: false };
        mounted = true;
        return res;
      }
      order.push('rows');
      return { found: true, value: 3 };
    });
    getValues.mockImplementation(async () => {
      order.push('resolve');
      return { results: { k0: { found: true, value: 'HomeRows' }, k1: { found: false } } };
    });

    await waitHome();

    // Presence FIRST: `indexOf` answers -1 for an absent step, and -1 is below every real
    // index, so the ordering assertions below would pass on a `waitHome` that never resolved
    // or never read the rows at all. (`jellyrock-tests/ordering-asserts-presence` catches
    // exactly this — it caught this very test.)
    expect(order).toContain('view');
    expect(order).toContain('resolve');
    expect(order).toContain('rows');
    // Every view read precedes the resolution, and the rows read follows it.
    expect(order.lastIndexOf('view')).toBeLessThan(order.indexOf('resolve'));
    expect(order.indexOf('resolve')).toBeLessThan(order.indexOf('rows'));
  });

  it('waits for a routed view BEFORE it ever reads Home rows', async () => {
    // The ordering IS the fix. Reading `#homeRows` while the app is still logging in
    // reports "home rows never appeared" — a claim about Home caused by an unfinished
    // login (recorded on .177, 2026-08-18).
    const seen = [];
    getValue.mockImplementation(async ({ base, keyPath }) => {
      seen.push(`${base}:${keyPath}`);
      if (keyPath === 'activeRoutedView.subtype()') return { found: true, value: 'Home' };
      return { found: true, value: 3 };
    });

    await waitHome();

    expect(seen[0]).toBe('global:activeRoutedView.subtype()');
    expect(seen[1]).toBe('scene:#homeRows.content.getChildCount()');
  });

  it('does not accept an unresolved view as "mounted"', async () => {
    // `found: false` is exactly what the 2026-08-18 record carried for both view fields.
    // Treating it as a mounted view would put the gate straight back where it was.
    let mounted = false;
    getValue.mockImplementation(async ({ keyPath }) => {
      if (keyPath === 'activeRoutedView.subtype()') {
        const res = mounted ? { found: true, value: 'Home' } : { found: false };
        mounted = true; // resolves on the SECOND read, so the gate must have polled again
        return res;
      }
      return { found: true, value: 2 };
    });

    await waitHome();

    const viewReads = getValue.mock.calls.filter(
      ([a]) => a.keyPath === 'activeRoutedView.subtype()',
    );
    expect(viewReads.length).toBeGreaterThan(1);
  });

  it('REFUSES a library grid — the false gate this helper used to be', async () => {
    // The whole point. Before 2026-09-06 both gates passed from a grid: the view gate only
    // asked that `subtype()` be non-EMPTY and a grid answers `BaseGridView`, while the rows
    // gate is scene-rooted and finds Home's rows SUSPENDED in the tree under sgRouter's
    // `suspendMode: "hide"`. So a Back swallowed by the router reported as an arrival, and
    // the caller's next step timed out blaming focus one nav later (.178, 2026-09-06).
    //
    // Both device answers below are the ones a real grid gives, including the rows read
    // succeeding — so this fails ONLY because the view is named.
    getValue.mockImplementation(async ({ keyPath }) =>
      keyPath === 'activeRoutedView.subtype()'
        ? { found: true, value: 'BaseGridView' }
        : { found: true, value: 7 },
    );

    await expect(waitHome({ viewTimeout: 1 })).rejects.toThrow(/Home to be the active/);
  });

  it('does not fall through to the rows gate when the app is not on Home', async () => {
    // Attribution, not just failure: the run must blame the view it is actually on, never
    // "home rows". A rows read here would mean the helper had gone on to ask a question
    // whose answer cannot be trusted.
    const seen = [];
    getValue.mockImplementation(async ({ base, keyPath }) => {
      seen.push(`${base}:${keyPath}`);
      return keyPath === 'activeRoutedView.subtype()'
        ? { found: true, value: 'BaseGridView' }
        : { found: true, value: 7 };
    });

    await expect(waitHome({ viewTimeout: 1 })).rejects.toThrow();
    expect(seen).not.toContain('scene:#homeRows.content.getChildCount()');
  });

  it('sends no keys — it detects a lost Back, it does not recover from one', async () => {
    // Deliberate, and load-bearing. The recovery is a re-pressed Back, which is
    // destructive off the path to Home: `UserSelect.onKeyEvent` treats Back as CHANGE
    // SERVER and the coordinator DELETES the saved server. Routing four navs through the
    // re-pressing `backToHome` was tried on 2026-09-06 and came back signed out on
    // `SetServerScreen`. 30-odd call sites share this helper; only detection is safe here.
    getValue.mockImplementation(async () => ({ found: true, value: 'BaseGridView' }));

    await expect(waitHome({ viewTimeout: 1 })).rejects.toThrow();
    expect(sendKeypress).not.toHaveBeenCalled();
  });
});

/**
 * `scrollFocus` is the whole correctness surface of the scripted cell workload: if it does
 * not land exactly on the target, the measurement's denominator moved and two runs stop
 * being comparable — which is the defect the scripted workload exists to remove. Its two
 * hard cases are both about a device that is BEHIND: an index short of the target because
 * the burst is still draining (wait) versus short because a key was lost (press again), and
 * they are indistinguishable from a single read. Both are here.
 *
 * Driven entirely through the mocked device: the behaviours are "what did we send" and
 * "when did we stop", neither of which needs a Roku. What does need one — that a given
 * keyPath resolves at all — stays covered by `npm run test:rta`.
 */
describe('scrollFocus', () => {
  /** Serve a scripted sequence of index reads, one per `getValue` call. */
  const indexReads = (values) => {
    let i = 0;
    getValue.mockImplementation(async () => ({
      found: true,
      value: values[Math.min(i++, values.length - 1)],
    }));
  };

  beforeEach(() => {
    getValue.mockReset();
    sendKeypress.mockReset().mockResolvedValue(undefined);
  });

  it('bursts exactly the distance asked for, and reports it', async () => {
    indexReads([0, 5]);
    const walk = await scrollFocus({
      keyPath: '#itemGrid.itemFocused',
      target: 5,
      forwardKey: 'Right',
      keyIntervalMs: 0,
      interval: 1,
    });

    expect(sendKeypress.mock.calls.map(([k]) => k)).toEqual([
      'Right',
      'Right',
      'Right',
      'Right',
      'Right',
    ]);
    expect(walk).toEqual({ from: 0, to: 5, pressed: 5, recovered: 0 });
  });

  it('walks backwards with the back key when the target is behind', async () => {
    indexReads([4, 1]);
    const walk = await scrollFocus({
      keyPath: '#homeRows.rowItemFocused',
      select: (v) => (Array.isArray(v) ? v[0] : v),
      target: 1,
      forwardKey: 'Down',
      backKey: 'Up',
      keyIntervalMs: 0,
      interval: 1,
    });

    expect(sendKeypress.mock.calls.map(([k]) => k)).toEqual(['Up', 'Up', 'Up']);
    expect(walk.pressed).toBe(3);
  });

  it('refuses to walk backwards with no key for that direction, naming the cause', async () => {
    indexReads([9]);
    await expect(
      scrollFocus({ keyPath: '#g.itemFocused', target: 2, forwardKey: 'Right', keyIntervalMs: 0 }),
    ).rejects.toThrow(/no key was given for that direction/);
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('does NOT press while the index is still moving — a burst still draining is not a drop', async () => {
    // THE overshoot case. Reads climb 0 -> 1 -> 2 -> 3 with no repeat, so every corrective
    // tick sees a different value and must hold its fire; pressing on top of keys already in
    // flight is what sends the walk past its target and starts it oscillating back.
    indexReads([0, 1, 2, 3]);
    const walk = await scrollFocus({
      keyPath: '#g.itemFocused',
      target: 3,
      forwardKey: 'Right',
      keyIntervalMs: 0,
      interval: 1,
    });

    expect(sendKeypress).toHaveBeenCalledTimes(3); // the burst, and nothing else
    expect(walk.recovered).toBe(0);
  });

  it('re-presses once the index has STOPPED short — a dropped key is recoverable', async () => {
    // A device modelled rather than a read sequence scripted: it applies every press except
    // the third, which is exactly the swallow `resendIfSwallowed` documents. The index then
    // stalls one short and STAYS there, and no amount of further waiting fixes it — the
    // distinction the corrective press turns on.
    let pressed = 0;
    let index = 0;
    sendKeypress.mockImplementation(async () => {
      pressed++;
      if (pressed !== 3) index++;
    });
    getValue.mockImplementation(async () => ({ found: true, value: index }));

    const walk = await scrollFocus({
      keyPath: '#g.itemFocused',
      target: 3,
      forwardKey: 'Right',
      keyIntervalMs: 0,
      interval: 1,
    });

    expect(walk).toMatchObject({ from: 0, to: 3, pressed: 3, recovered: 1 });
    expect(pressed).toBe(4); // the burst of 3, plus the one that replaced the lost key
    expect(index).toBe(3); // and it really did arrive
  });

  it('does not stack a second correction on top of one still in flight', async () => {
    // THE regression this locks down. The zero-latency device above cannot see it: its
    // correction lands before the next read, so the guard is never asked to hold twice.
    // Model a device where a press takes three polls to apply, and drop exactly one key.
    // Before the `lastSeen` reset, the tick after a correction still read the pre-press
    // index, scored it as "stuck and short", and pressed AGAIN — two corrections for one
    // lost key. The walk then returned reporting the target while a fifth press was still
    // in flight, and the list settled one PAST it: a denominator that moved after
    // `scrollFocus` said it had not, which is the whole defect the scripted workload exists
    // to remove.
    const LATENCY_TICKS = 3;
    let inFlight = [];
    let tick = 0;
    let sent = 0;
    let index = 0;
    sendKeypress.mockImplementation(async (key) => {
      sent++;
      if (sent === 3) return; // the swallowed key
      inFlight.push({ at: tick + LATENCY_TICKS, key });
    });
    getValue.mockImplementation(async () => {
      tick++;
      for (const p of inFlight.filter((p) => p.at <= tick)) index += p.key === 'Right' ? 1 : -1;
      inFlight = inFlight.filter((p) => p.at > tick);
      return { found: true, value: index };
    });

    const walk = await scrollFocus({
      keyPath: '#g.itemFocused',
      target: 3,
      forwardKey: 'Right',
      backKey: 'Left',
      keyIntervalMs: 0,
      interval: 1,
    });

    expect(walk).toMatchObject({ from: 0, to: 3, pressed: 3, recovered: 1 });
    expect(sent).toBe(4); // the burst of 3 plus ONE correction, not two
    // Nothing left in flight, so the index the walk reported is the index that stands.
    expect(inFlight).toHaveLength(0);
    expect(index).toBe(3);
  });

  it('presses once per STRIDE, not once per index — a grid row is numColumns items', async () => {
    // The defect this closes, measured on `.177` 2026-08-20: a library grid's `itemFocused`
    // moves by `numColumns` on Down, so a walk from 0 to 18 on a 6-column grid is THREE
    // presses. Treating it as 18 would send fifteen keys the grid has nowhere to put.
    indexReads([0, 18]);
    const walk = await scrollFocus({
      keyPath: '#itemGrid.itemFocused',
      target: 18,
      stride: 6,
      forwardKey: 'Down',
      backKey: 'Up',
      keyIntervalMs: 0,
      interval: 1,
    });

    expect(sendKeypress.mock.calls.map(([k]) => k)).toEqual(['Down', 'Down', 'Down']);
    expect(walk.pressed).toBe(3);
  });

  it('refuses a target that is not a whole number of strides', async () => {
    // Down out of the last FULL row of a grid lands on the final item rather than the same
    // column, so `row * numColumns` is not always a stop the grid has. Pressing at one is an
    // unreachable target, which presents as a timeout blaming the list.
    indexReads([0]);
    await expect(
      scrollFocus({
        keyPath: '#itemGrid.itemFocused',
        target: 20,
        stride: 6,
        forwardKey: 'Down',
        keyIntervalMs: 0,
      }),
    ).rejects.toThrow(/not a whole number of 6-unit presses/);
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('waits for the index to become readable before pressing anything', async () => {
    // The north-star precondition: `itemFocused` reads as its retained value — or as
    // nothing at all — until the list holds focus, and a burst sent then goes to whatever
    // does hold it. Not one key may be sent while the field is unreadable.
    let reads = 0;
    getValue.mockImplementation(async () => {
      reads++;
      if (reads === 1) return { found: false };
      expect(sendKeypress.mock.calls.length).toBe(reads > 2 ? 2 : 0);
      return { found: true, value: reads > 2 ? 2 : 0 };
    });

    await scrollFocus({
      keyPath: '#g.itemFocused',
      target: 2,
      forwardKey: 'Right',
      keyIntervalMs: 0,
      interval: 1,
    });

    expect(reads).toBeGreaterThan(2);
  });
});

/**
 * `readCellCounts` is the BEFORE half of every cell-load number this suite publishes. It has
 * one job — describe a single instant — and its failure modes are silent by construction: a
 * read spread across the settling screen, a production build whose counters do not exist
 * being reported as a screen that bound nothing, and a keyPath that names nothing being
 * reported as that same production build.
 */
describe('readCellCounts', () => {
  /** `found: true` for every counter plus the content root that rides along with them. */
  const allFound = (value) => ({
    results: Object.fromEntries(
      [...CELL_REPORT_COUNTERS, 'childCount'].map((_c, i) => [`k${i}`, { found: true, value }]),
    ),
  });

  beforeEach(() => {
    getValues.mockReset();
  });

  it('reads every reported counter in ONE batch, keyed off the list content root', async () => {
    // The batch is the correctness property, not a speed one (`tests/rta/CLAUDE.md`): the
    // counters must describe ONE instant, or a delta taken against them credits the sweep
    // with work that finished before it started.
    getValues.mockResolvedValue({
      results: Object.fromEntries(
        [...CELL_REPORT_COUNTERS, 'childCount'].map((_c, i) => [
          `k${i}`,
          { found: true, value: i },
        ]),
      ),
    });

    const res = await readCellCounts('#homeRows');

    expect(getValues).toHaveBeenCalledTimes(1);
    const sent = Object.values(getValues.mock.calls[0][0].requests).map((r) => r.keyPath);
    expect(sent).toEqual([
      ...CELL_REPORT_COUNTERS.map((c) => `activeRoutedView.#homeRows.content.cellLoad${c}`),
      'activeRoutedView.#homeRows.content.getChildCount()',
    ]);
    expect(res.counts).toEqual(Object.fromEntries(CELL_REPORT_COUNTERS.map((c, i) => [c, i])));
    expect(res.instrumented).toBe(true);
    expect(res.resolved).toBe(true);
  });

  it('carries the content root in the SAME batch, so telling the two failures apart is free', async () => {
    // The whole reason the resolve check lives here rather than in a second call: one round
    // trip either way. `waitCellsQuiet` pays a sequential read for the same answer because
    // its sample loop is sequential by design; this one has no such excuse.
    getValues.mockResolvedValue(allFound(1));

    await readCellCounts('#homeRows');

    expect(getValues).toHaveBeenCalledTimes(1);
    expect(Object.keys(getValues.mock.calls[0][0].requests)).toHaveLength(
      CELL_REPORT_COUNTERS.length + 1,
    );
  });

  it('reports a production build as UNINSTRUMENTED but RESOLVED, not as zero work', async () => {
    // `perfTiming` off is the correct state for a release build. Returning zeroes here would
    // publish "the sweep bound nothing before it started" as a measurement, and a subtraction
    // against it would credit the sweep with the whole page load.
    getValues.mockResolvedValue({
      results: {
        ...Object.fromEntries(CELL_REPORT_COUNTERS.map((_c, i) => [`k${i}`, { found: false }])),
        [`k${CELL_REPORT_COUNTERS.length}`]: { found: true, value: 12 },
      },
    });

    const res = await readCellCounts('#homeRows');

    expect(res.instrumented).toBe(false);
    expect(res.resolved).toBe(true);
    expect(res.counts.Binds).toBeUndefined();
  });

  it('separates a list that resolved to NOTHING from that production build', async () => {
    // These are identical from the counter reads alone — both come back `undefined` — and
    // collapsing them is what `waitCellsQuiet`'s header calls out: it would report
    // "perfTiming off" at an operator whose keyPath was simply wrong. One is a fact about
    // the build; the other means this reading describes no list and every delta is fiction.
    getValues.mockResolvedValue({
      results: Object.fromEntries(
        [...CELL_REPORT_COUNTERS, 'childCount'].map((_c, i) => [`k${i}`, { found: false }]),
      ),
    });

    const res = await readCellCounts('#nope');

    expect(res.instrumented).toBe(false);
    expect(res.resolved).toBe(false);
  });

  it('covers exactly the counters the report line formats, with no gaps', async () => {
    // The guard against the two drifting: `formatCellCounts` walks CELL_REPORT_COUNTERS, so a
    // counter added there and missed here formats as `binds=undefined` on a line that
    // otherwise looks complete.
    getValues.mockResolvedValue(allFound(7));

    const { counts } = await readCellCounts('#homeRows');

    expect(formatCellCounts(counts)).not.toMatch(/undefined/);
  });

  it('carries the unload REASON split, which the total cannot substitute for', async () => {
    // Pinned by name rather than left to `CELL_REPORT_COUNTERS`'s length, because these two
    // are the only at-gate evidence that horizontal windowing engaged. `Unloads` is
    // dominated by vertical eviction — Home reads ~57 of it on a sweep where no row is even
    // long enough for the window to be reachable — so dropping the split would leave a
    // report line that still looks complete while answering a different question.
    expect(CELL_REPORT_COUNTERS).toContain('UnloadsWindow');
    expect(CELL_REPORT_COUNTERS).toContain('UnloadsRange');
    expect(formatCellCounts({ UnloadsWindow: 12, UnloadsRange: 45 })).toContain('unloadsWindow=12');
  });

  it('propagates a failed batch instead of reporting a screen that bound nothing', async () => {
    // Same rule as `getActiveVals`: a transport failure must not become a reading. A
    // swallowed one here would silently rebase every delta on zero.
    getValues.mockRejectedValueOnce(new Error('odc timeout'));

    await expect(readCellCounts('#homeRows')).rejects.toThrow(/odc timeout/);
  });

  it('takes its reader by injection, and the reader is a BATCH one', async () => {
    // `readMany`, not `read`: the neighbouring waits take a single-keyPath `read` and their
    // call sites sit two lines from this one in `nav.js`. This asserts the shape the name is
    // protecting — one call, an ARRAY of keyPaths in, an array out.
    const readMany = vi.fn(async (keyPaths) => keyPaths.map((_k, i) => i));

    const res = await readCellCounts('#homeRows', { readMany });

    expect(getValues).not.toHaveBeenCalled();
    expect(readMany).toHaveBeenCalledTimes(1);
    expect(readMany.mock.calls[0][0]).toHaveLength(CELL_REPORT_COUNTERS.length + 1);
    expect(res.counts.Binds).toBe(0);
    expect(res.resolved).toBe(true);
  });
});

/**
 * `waitCellsQuiet` decides WHERE the measured session ends. Its failure modes are silent by
 * construction — ending early undercounts `loadsFailed`, ending on a build with no counters
 * would hang a nav that has nothing to wait for — so both are gated here rather than left to
 * a device run to notice.
 */
describe('waitCellsQuiet', () => {
  beforeEach(() => {
    getValue.mockReset();
  });

  it('returns immediately, and says so, when the build carries no counters', async () => {
    // `perfTiming` off is the correct state for a production build, not an anomaly — so it
    // is reported as uninstrumented rather than warned about or waited on. The content root
    // resolving is what separates it from a keyPath that is simply wrong.
    getValue.mockImplementation(async ({ keyPath }) =>
      keyPath.endsWith('getChildCount()') ? { found: true, value: 12 } : { found: false },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await waitCellsQuiet('#itemGrid', { quietMs: 10, interval: 1, timeout: 100 });

    expect(res).toMatchObject({ instrumented: false, resolved: true, quiet: true });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('distinguishes an unreadable keyPath from an uninstrumented build', async () => {
    // Both read `undefined` from the counters alone, and collapsing them tells an operator
    // whose keyPath was wrong that their production build has `perfTiming` off — while the
    // counts they go on to publish have no settle behind them at all.
    getValue.mockResolvedValue({ found: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await waitCellsQuiet('#nope', { quietMs: 10, interval: 1, timeout: 100 });

    expect(res).toMatchObject({ instrumented: false, resolved: false });
    // NOT quiet. A caller that reads only `.quiet` must not be told a watch of nothing was
    // a settle; the uninstrumented-but-resolved case above is the one that is genuinely
    // quiet, because a production build has no counters to wait on.
    expect(res.quiet).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('watched nothing'));
    warn.mockRestore();
  });

  it('waits until the counters stop moving, not merely until they are readable', async () => {
    const binds = [10, 12, 14, 14, 14, 14, 14, 14];
    let i = 0;
    getValue.mockImplementation(async ({ keyPath }) => ({
      found: true,
      value: keyPath.endsWith('cellLoadBinds') ? binds[Math.min(i++, binds.length - 1)] : 3,
    }));

    const res = await waitCellsQuiet('#itemGrid', { quietMs: 20, interval: 5, timeout: 3000 });
    expect(res).toMatchObject({ quiet: true, instrumented: true });
    expect(res.counts.Binds).toBe(14);
  });

  it('keeps waiting while ONLY an asynchronously-closing counter is still moving', async () => {
    // The counter set is the point of this function, so it gets a test that fails if the
    // set shrinks back. `binds` and `loadsStarted` are stable from the first read — the
    // shape a sweep is in the moment the last keypress lands — while `loadsFailed` is still
    // arriving, because a request that has started and not yet failed is exactly the
    // in-flight case the settle exists to close. Gating on the old two-counter set would
    // declare quiet here and publish a truncated `loadsFailed`.
    const failed = [0, 4, 9, 11, 11, 11, 11, 11, 11, 11];
    let i = 0;
    getValue.mockImplementation(async ({ keyPath }) => {
      if (keyPath.endsWith('cellLoadLoadsFailed'))
        return { found: true, value: failed[Math.min(i++, failed.length - 1)] };
      return { found: true, value: keyPath.endsWith('cellLoadBinds') ? 40 : 7 };
    });

    const res = await waitCellsQuiet('#extrasGrid', { quietMs: 20, interval: 5, timeout: 3000 });

    expect(res.quiet).toBe(true);
    expect(res.counts.LoadsFailed).toBe(11); // settled, not the 4 an early gate would have
  });

  it('watches unloads too — an off-screen release moves nothing else', async () => {
    // `unloadTexture` bumps no other counter, so it is the second field that can move while
    // binds and loadsStarted sit still. Same guard, different mechanism.
    const unloads = [0, 2, 3, 3, 3, 3, 3, 3, 3];
    let i = 0;
    getValue.mockImplementation(async ({ keyPath }) => {
      if (keyPath.endsWith('cellLoadUnloads'))
        return { found: true, value: unloads[Math.min(i++, unloads.length - 1)] };
      return { found: true, value: keyPath.endsWith('cellLoadBinds') ? 40 : 7 };
    });

    const res = await waitCellsQuiet('#homeRows', { quietMs: 20, interval: 5, timeout: 3000 });

    expect(res.quiet).toBe(true);
    expect(res.counts.Unloads).toBe(3);
  });

  it('watches appearances too — a cell returning with its texture moves nothing else', async () => {
    // The third field that can move while binds and loadsStarted sit still, and the one the
    // settle was blind to until 2026-08-22. A cell that scrolls back into view with its
    // texture ALREADY loaded bumps only this: no bind (it was never rebound), no load (the
    // buffer held it), no unload. Measured on cellSweepGrid, that is 12 of 18 re-entries —
    // so a settle gated on the old five would declare quiet mid-sweep and publish an
    // `appearances` short by most of the re-entries the pop-in line exists to count.
    const appearances = [28, 34, 41, 46, 46, 46, 46, 46, 46];
    let i = 0;
    getValue.mockImplementation(async ({ keyPath }) => {
      if (keyPath.endsWith('cellLoadAppearances'))
        return { found: true, value: appearances[Math.min(i++, appearances.length - 1)] };
      return { found: true, value: keyPath.endsWith('cellLoadBinds') ? 28 : 7 };
    });

    const res = await waitCellsQuiet('#itemGrid', { quietMs: 20, interval: 5, timeout: 3000 });

    expect(res.quiet).toBe(true);
    expect(res.counts.Appearances).toBe(46); // settled, not the 28 an early gate would have
  });

  it('does NOT let popIns hold a settle open — it cannot move on its own', async () => {
    // The negative half of the same rule, and it is what keeps the watched set MINIMAL.
    // popIns only ever increments inside loadSucceeded, so it cannot move while
    // loadsSucceeded sits still; watching it would add a read per poll and buy nothing.
    // It is still reported, because seeing it is the whole point.
    let popIns = 0;
    getValue.mockImplementation(async ({ keyPath }) => {
      // Rises forever — if popIns were in the quiet set this could never settle.
      if (keyPath.endsWith('cellLoadPopIns')) return { found: true, value: popIns++ };
      return { found: true, value: keyPath.endsWith('cellLoadBinds') ? 28 : 7 };
    });

    const res = await waitCellsQuiet('#itemGrid', { quietMs: 20, interval: 5, timeout: 3000 });

    expect(res.quiet).toBe(true);
    expect(typeof res.counts.PopIns).toBe('number'); // read and reported, just not watched
  });

  it('puts both new counters on the report line', async () => {
    // The line is the deliverable here: the run that shipped the re-entry blind spot had
    // appearances equal to binds and nobody caught it, because neither number was printed.
    expect(formatCellCounts({ Binds: 28, Appearances: 46, PopIns: 24 })).toContain(
      'appearances=46',
    );
    expect(formatCellCounts({ Binds: 28, Appearances: 46, PopIns: 24 })).toContain('popIns=24');
    expect(formatCellCounts({ Binds: 28, Appearances: 46, PopIns: 24 })).toContain('binds=28');
  });

  it('reports a list that never settles instead of throwing', async () => {
    // A runaway rebind is a FINDING — the very shape the ledger was built to catch — and
    // every caller also runs as a functional test, where a throw would read as "the screen
    // did not load".
    let n = 100;
    getValue.mockImplementation(async () => ({ found: true, value: n++ }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await waitCellsQuiet('#extrasGrid', { quietMs: 20, interval: 1, timeout: 60 });

    expect(res).toMatchObject({ quiet: false, instrumented: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('never went quiet'));
    warn.mockRestore();
  });
});

/**
 * `sweepBudget` and `axisEnd` decide how far a sweep travels, which IS the measurement's
 * denominator — so their arithmetic is the itinerary's correctness, and it was previously
 * private to `nav.js` with no test at all. They are separated by what a shortfall MEANS: a
 * budget can be cut short by a thin fixture (news, because it changes every published
 * count), while a structurally-bounded axis reaching its end is the itinerary working.
 */
describe('sweepBudget / axisEnd — how far a sweep is allowed to travel', () => {
  let warn;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('returns the requested last index and says nothing when the fixture is deep enough', () => {
    expect(sweepBudget('rows', 6, 31)).toBe(6);
    expect(warn).not.toHaveBeenCalled();
  });

  it('clamps to the last reachable index and ANNOUNCES it', () => {
    // A run that swept 3 rows and a run that swept 12 differ in every count the ledger
    // publishes, and `measure` records the nav's NAME, not its itinerary — so this console
    // line is the only thing that tells the two records apart.
    expect(sweepBudget('cellSweepGrid rows', 12, 4)).toBe(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('clamps to 3 of 12'));
  });

  it('reports an axis with nothing to travel rather than returning a bogus index', () => {
    expect(sweepBudget('rows', 6, 0)).toBe(0);
    expect(sweepBudget('rows', 6, undefined)).toBe(0);
    expect(axisEnd('columns', 0)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('sweeping nothing'));
  });

  it('does NOT announce a clamp for a whole-axis traverse — the layout is not a shortfall', () => {
    // The cry-wolf case, and the reason the two are separate functions. A grid row is
    // `numColumns` wide by layout, so asking a 12-step budget for it warned on EVERY run
    // and taught the operator to skip the channel that reports a changed workload.
    expect(axisEnd('cellSweepGrid columns', 6)).toBe(5);
    expect(warn).not.toHaveBeenCalled();
    // Same six columns through the budget helper is what used to happen, and it warns.
    expect(sweepBudget('cellSweepGrid columns', 12, 6)).toBe(5);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/**
 * `waitRowsSettled` decides WHERE the measured session begins, and its failure is silent by
 * construction: a sweep that starts too early still travels, still reports a clean itinerary
 * and still emits a `cell-load` sample whose `items` field agrees with every other run —
 * because that field is counted at emit time, after the screen finished building. Three
 * `cellSweepHome` campaigns spent their spread (222–253 binds) on exactly this, so the gate
 * gets tests rather than a device run to notice.
 */
describe('waitRowsSettled', () => {
  beforeEach(() => {
    getValue.mockReset();
  });

  /** A device whose row structure walks through `shapes`, one step per full sample. */
  const structureReader = (shapes) => {
    let i = 0;
    let readsThisSample = 0;
    return async ({ keyPath }) => {
      const shape = shapes[Math.min(i, shapes.length - 1)];
      if (keyPath.endsWith('content.getChildCount()')) {
        readsThisSample = 0;
        return { found: true, value: shape.length };
      }
      const m = keyPath.match(/content\.(\d+)\.getChildCount\(\)$/);
      if (!m) return { found: false };
      const width = shape[Number(m[1])];
      readsThisSample++;
      if (readsThisSample >= shape.length) i++; // sample complete — advance the device
      return { found: true, value: width };
    };
  };

  /**
   * A device that answers ONE full 2-row sample and then goes away for good — the screen
   * replaced, the view swapped. Shared by the two tests that need it because they pin two
   * different properties of the same event: that it is not reported as settled, and that it
   * is not reported as a screen still being built.
   */
  const vanishingReader = () => {
    let reads = 0;
    return async ({ keyPath }) => {
      reads++;
      if (reads > 3) return { found: false };
      return { found: true, value: keyPath.endsWith('content.getChildCount()') ? 2 : 16 };
    };
  };

  it('waits for rows still ARRIVING, not merely for rows to exist', async () => {
    // `waitHome()` passes on skeletons; this is the gate that does not. The row count grows
    // as `insertLatestMediaSkeletons` inserts, which is the coarse half of the signal.
    getValue.mockImplementation(
      structureReader([
        [1, 1],
        [1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
      ]),
    );

    const res = await waitRowsSettled('#homeRows', { quietMs: 20, interval: 5, timeout: 3000 });

    expect(res).toMatchObject({ settled: true, resolved: true, rows: 4 });
  });

  it('waits for a row FILLING, which does not move the row count at all', async () => {
    // The half a row-count gate would miss, and the one that actually moves the sweep: a
    // skeleton row carries ONE placeholder child and a populated one carries its items, so
    // `populateRowFromData` changes the widest row — which is the row `sweepRowList` picks
    // its horizontal leg from — while leaving the row count exactly where it was.
    getValue.mockImplementation(
      structureReader([
        [1, 1, 1],
        [16, 1, 1],
        [16, 16, 1],
        [16, 16, 16],
        [16, 16, 16],
        [16, 16, 16],
        [16, 16, 16],
      ]),
    );

    const res = await waitRowsSettled('#homeRows', { quietMs: 20, interval: 5, timeout: 3000 });

    expect(res).toMatchObject({ settled: true, rows: 3, items: 48 });
    expect(res.widths).toEqual([16, 16, 16]);
  });

  it('reports the structure the sweep will travel, because the ledger cannot', async () => {
    // The deliverable. `cell-load`'s `items` is counted at EMIT time and read 129 on all
    // nine launches of the unbounded campaigns, so it cannot tell a run that swept a
    // half-built Home from one that swept a whole one. This return value can.
    getValue.mockImplementation(structureReader([[16, 16, 5]]));

    const res = await waitRowsSettled('#homeRows', { quietMs: 20, interval: 5, timeout: 3000 });

    expect(res.items).toBe(37);
    expect(res.rows).toBe(3);
  });

  it('holds the gate open for the whole quiet window, not just until two samples agree', async () => {
    // Two agreeing samples are what a screen mid-lull looks like: `LoadLatestRowsTask`
    // delivers one row per observer wake, so the structure genuinely does hold still
    // between arrivals. The window is the only thing separating that from a finished
    // screen, so a settle that returned on the first match would be gating on nothing.
    getValue.mockImplementation(structureReader([[16, 16]]));

    const res = await waitRowsSettled('#homeRows', { quietMs: 60, interval: 5, timeout: 3000 });

    expect(res.settled).toBe(true);
    expect(res.waitedMs).toBeGreaterThanOrEqual(60);
  });

  it('measures the quiet window from the LAST change, not from when the gate opened', async () => {
    // The window has to re-arm on every change or it degenerates into "quietMs after the
    // gate opened", which is a fixed sleep wearing a settle's clothes — and it fails exactly
    // where Home needs it, because Home spends SECONDS building. Once the build outlasts
    // `quietMs`, a gate that never re-armed returns on the first agreeing pair, however
    // early that lands. Found by mutation: every other test here passed with the re-arm
    // deleted, because their structures settle sooner than the window is wide.
    const shapes = [];
    for (let i = 1; i <= 15; i++) shapes.push([i, 1]); // a long build, then the last shape holds
    let lastAdvanceAt = 0;
    let i = 0;
    let readsThisSample = 0;
    getValue.mockImplementation(async ({ keyPath }) => {
      const shape = shapes[Math.min(i, shapes.length - 1)];
      if (keyPath.endsWith('content.getChildCount()')) {
        readsThisSample = 0;
        return { found: true, value: shape.length };
      }
      readsThisSample++;
      if (readsThisSample >= shape.length) {
        i++;
        if (i < shapes.length) lastAdvanceAt = Date.now();
      }
      return { found: true, value: shape[readsThisSample - 1] };
    });

    const res = await waitRowsSettled('#homeRows', { quietMs: 60, interval: 5, timeout: 5000 });
    const settledAt = Date.now();

    expect(res.settled).toBe(true);
    expect(settledAt - lastAdvanceAt).toBeGreaterThanOrEqual(60);
  });

  it('reports a list that never resolved at all, rather than waiting out its timeout on it', async () => {
    // The keyPath is simply wrong, or the list is not mounted. Waiting cannot fix either,
    // and the caller needs to know its sweep had no gate rather than to lose 20 s first.
    getValue.mockResolvedValue({ found: false });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await waitRowsSettled('#nope', { quietMs: 20, interval: 5, timeout: 200 });

    expect(res).toMatchObject({ settled: false, resolved: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not resolve'));
    warn.mockRestore();
  });

  it('does NOT call a list that stops answering MID-POLL settled', async () => {
    // The case the early return above cannot reach, and the one that would publish a
    // confident falsehood: the list answered once and then went away — the screen was
    // replaced, the view swapped — so every later sample is `{ rows: undefined, widths: [] }`,
    // which compares EQUAL to itself. A structural compare without the resolved-ness guard
    // reads that as the quietest screen it has ever seen and returns `settled: true` for a
    // list that is not there. Found by mutation: the first version of the test above passed
    // with that guard deleted, because it never got past the early return.
    getValue.mockImplementation(vanishingReader());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await waitRowsSettled('#homeRows', { quietMs: 20, interval: 5, timeout: 150 });

    expect(res.settled).toBe(false);
    warn.mockRestore();
  });

  it('reports the LAST structure it read, not the one it opened on', async () => {
    // `lastGood` has to track the latest successful sample, and the shared `vanishingReader`
    // cannot show that: it answers exactly ONE sample, so the last good read and the
    // gate-open read are the same object and the two are indistinguishable. Deleting the
    // `lastGood = next` update passes every other test in this file — found by mutation.
    // A list that answers twice and THEN vanishes separates them, and it is also the honest
    // case: a screen replaced two seconds in has been read several times by that point, so
    // reporting its opening structure would describe a screen that had already moved on.
    const shapes = [
      [16, 16],
      [16, 16, 16],
    ];
    let i = 0;
    let readsThisSample = 0;
    getValue.mockImplementation(async ({ keyPath }) => {
      if (i >= shapes.length) return { found: false }; // gone for good
      const shape = shapes[i];
      if (keyPath.endsWith('content.getChildCount()')) {
        readsThisSample = 0;
        return { found: true, value: shape.length };
      }
      readsThisSample++;
      if (readsThisSample >= shape.length) i++;
      return { found: true, value: shape[readsThisSample - 1] };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await waitRowsSettled('#homeRows', { quietMs: 20, interval: 5, timeout: 150 });

    expect(res).toMatchObject({ settled: false, resolved: true, rows: 3, items: 48 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('3 row(s), 48 item(s)'));
    warn.mockRestore();
  });

  it('names the list going AWAY as its own finding, not as a screen still being built', async () => {
    // The two ways this gives up need two diagnoses, and the wrong one costs an operator the
    // whole investigation: "still being built" sends them at row-arrival timing, when the
    // real event was the screen being replaced underneath the call. Same split
    // `waitCellsQuiet` draws between an uninstrumented build and an unreadable keyPath.
    getValue.mockImplementation(vanishingReader());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await waitRowsSettled('#homeRows', { quietMs: 20, interval: 5, timeout: 150 });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('STOPPED ANSWERING'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('still being built'));
    // ...and it hands back the structure it DID read, not the failed read that followed. The
    // regression this pins printed `last undefined row(s), 0 item(s)` and returned the same.
    expect(res).toMatchObject({ rows: 2, items: 32 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 row(s), 32 item(s)'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('undefined'));
    warn.mockRestore();
  });

  it('warns and hands back the unsettled structure when rows never stop moving', async () => {
    // A screen that never settles is a FINDING, not a harness failure — every caller is a
    // nav that also runs as a functional test, where a throw would read as "the screen did
    // not load". The counts still describe a real session; the warning is what stops them
    // being compared against a settled run.
    let n = 2;
    getValue.mockImplementation(async ({ keyPath }) =>
      keyPath.endsWith('content.getChildCount()')
        ? { found: true, value: 2 }
        : { found: true, value: n++ },
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await waitRowsSettled('#homeRows', { quietMs: 20, interval: 5, timeout: 120 });

    expect(res).toMatchObject({ settled: false, resolved: true, rows: 2 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('never held still'));
    warn.mockRestore();
  });
});

describe("waitFor's caller-supplied observed", () => {
  // The failure that motivated it: a confirm dialog that never appeared, where the
  // throw-time dump was taken 10s late and could not say what the press had landed on.
  // Only the CALLER knows that, so it needs a way to attach it.
  it('merges a plain object into the record', async () => {
    getValue.mockResolvedValue({ found: true, value: 0 });
    const err = await waitFor('#x', (v) => v === 99, {
      timeout: 1,
      observed: { pressedOnId: 'watchedButton' },
    }).catch((e) => e);
    // `diagnosedError` returns a plain Error and renders `observed` INTO the message —
    // that is the artifact a human reads in the terminal, so it is what to assert on.
    expect(err.message).toContain('pressedOnId="watchedButton"');
  });

  it('awaits a FUNCTION, so a device read is paid for only when the wait fails', async () => {
    getValue.mockResolvedValue({ found: true, value: 0 });
    const reader = vi.fn(async () => ({ detailType: 'Movie' }));
    const err = await waitFor('#x', (v) => v === 99, { timeout: 1, observed: reader }).catch(
      (e) => e,
    );
    expect(reader).toHaveBeenCalledTimes(1);
    expect(err.message).toContain('detailType="Movie"');
  });

  it('never runs the reader on a wait that SUCCEEDS', async () => {
    getValue.mockResolvedValue({ found: true, value: 7 });
    const reader = vi.fn(async () => ({}));
    await waitFor('#x', (v) => v === 7, { timeout: 500, observed: reader });
    expect(reader).not.toHaveBeenCalled();
  });

  it('still reports the timeout when the reader throws — a diagnostic may not replace the failure', async () => {
    getValue.mockResolvedValue({ found: true, value: 0 });
    const err = await waitFor('#x', (v) => v === 99, {
      timeout: 1,
      observed: async () => {
        throw new Error('device stopped answering');
      },
    }).catch((e) => e);
    expect(err.message).toContain('timed out');
    expect(err.message).toContain('observedReadFailed');
  });
});

describe('getVals', () => {
  beforeEach(() => getValues.mockReset().mockResolvedValue({ results: {} }));

  it('reads scene-rooted keyPaths verbatim, with no activeRoutedView prefix', async () => {
    // The prefix is the ONLY difference from `getActiveVals`, and it is the whole point:
    // `#homeRows` is deliberately scene-rooted because Home is not the active view once a
    // drill-down opens. A prefix leaking in here would silently read nothing.
    getValues.mockResolvedValue({
      results: { k0: { found: true, value: [0, 3] }, k1: { found: true, value: 4 } },
    });
    await expect(
      getVals(['#homeRows.rowItemFocused', '#homeRows.content.0.getChildCount()']),
    ).resolves.toEqual([[0, 3], 4]);
    const { requests } = getValues.mock.calls[0][0];
    expect(requests.k0).toEqual({ base: 'scene', keyPath: '#homeRows.rowItemFocused' });
    expect(requests.k1.keyPath).not.toContain('activeRoutedView');
  });

  it('reads a NOT-FOUND keyPath as undefined, matching its active-view twin', async () => {
    getValues.mockResolvedValue({ results: { k0: { found: false } } });
    await expect(getVals(['#homeRows.missing'])).resolves.toEqual([undefined]);
  });

  it('THROWS when the batch itself fails, rather than reporting a screen of missing fields', async () => {
    // Same defect this guards against in `getActiveVals`: a dead batch that degrades to
    // `undefined` everywhere becomes a confident false statement about the app.
    getValues.mockRejectedValueOnce(new Error('odc down'));
    await expect(getVals(['#homeRows.rowItemFocused'])).rejects.toThrow();
  });

  it('costs no device call for an empty read', async () => {
    await expect(getVals([])).resolves.toEqual([]);
    expect(getValues).not.toHaveBeenCalled();
  });
});

describe('walkFocusInto', () => {
  beforeEach(() => {
    getFocusedNode.mockReset();
    sendKeypress.mockReset();
  });

  const focusedAt = (keyPath) => getFocusedNode.mockResolvedValue({ keyPath });

  it('presses on the FIRST tick — a walk has sent nothing to wait and see about', async () => {
    // The one behaviour that separates this from both `resend*` helpers. They sit out a
    // tick because their caller already pressed; a walk that did the same would add an
    // interval of latency to every call for no reading.
    focusedAt('scene.#userRow.0');
    await walkFocusInto('down', '#buttons')();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
    expect(sendKeypress).toHaveBeenCalledWith('down');
  });

  it("keeps pressing while focus has not arrived — the rung count is the fixture's, not ours", async () => {
    focusedAt('scene.#buttons.1');
    const action = walkFocusInto('up', '#itemDescription');
    await action();
    await action();
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(3);
  });

  it('stops the moment focus arrives, so it cannot press on into what the target opens', async () => {
    focusedAt('scene.#buttons.1');
    const action = walkFocusInto('up', '#itemDescription');
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
    focusedAt('scene.#itemDetails.#itemDescription');
    await action();
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
  });

  it('counts the container itself as arrived, not only its descendants', async () => {
    // `#itemDescription` is a leaf the app focuses directly — if containment did not
    // include the node itself this would press forever at a target already reached.
    focusedAt('scene.#itemDescription');
    await walkFocusInto('up', '#itemDescription')();
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('matches a whole keyPath SEGMENT, never a substring', async () => {
    // Phase 2's fix, restated as a gate on this helper: substring matching reports
    // `#options` as inside `#optionsPanelOverlay`. A walk that believed that would stop
    // one container short and hand the press budget to the wrong node.
    focusedAt('scene.#optionsPanelOverlay.0');
    await walkFocusInto('up', '#options')();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
  });

  it('normalises a missing `#` the same way the predicate does', async () => {
    focusedAt('scene.#itemDescription');
    await walkFocusInto('up', 'itemDescription')();
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('does not press when the focus read fails — an unknown state is not a reason to walk', async () => {
    getFocusedNode.mockRejectedValue(new Error('odc down'));
    const action = walkFocusInto('down', '#buttons');
    await action();
    await action();
    expect(sendKeypress).not.toHaveBeenCalled();
  });
});

describe('resendUntilFocusInside', () => {
  beforeEach(() => {
    getFocusedNode.mockReset();
    sendKeypress.mockReset();
  });

  const focusedAt = (keyPath) => getFocusedNode.mockResolvedValue({ keyPath });

  it('does not press on the first tick — the caller just pressed', async () => {
    focusedAt('scene.#itemGrid.0');
    const action = resendUntilFocusInside('back', '#homeRows');
    await action();
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('resends while focus has not yet ARRIVED in the destination', async () => {
    focusedAt('scene.#itemGrid.0');
    const action = resendUntilFocusInside('back', '#homeRows');
    await action(); // first tick, sits out
    await action();
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(2);
    expect(sendKeypress).toHaveBeenCalledWith('back');
  });

  it('stops the moment focus arrives — over-pressing Back on Home raises the exit dialog', async () => {
    focusedAt('scene.#itemGrid.0');
    const action = resendUntilFocusInside('back', '#homeRows');
    await action();
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
    focusedAt('scene.#homeRows.2'); // arrived
    await action();
    await action();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
  });

  it('does not press when the focus read fails — an unknown state is not a swallow', async () => {
    getFocusedNode.mockRejectedValue(new Error('odc down'));
    const action = resendUntilFocusInside('back', '#homeRows');
    await action();
    await action();
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('is the INVERSE of resendIfSwallowed on the same reading', async () => {
    // The pair must never both press, or a caller that picked the wrong one would still
    // appear to work while pressing at the wrong end of the move.
    focusedAt('scene.#homeRows.2');
    const leaving = resendIfSwallowed('back', '#itemGrid');
    const arriving = resendUntilFocusInside('back', '#homeRows');
    await leaving();
    await arriving();
    await leaving();
    await arriving();
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('gives each wait its own first-tick budget', async () => {
    focusedAt('scene.#itemGrid.0');
    const first = resendUntilFocusInside('back', '#homeRows');
    await first();
    await first();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
    const second = resendUntilFocusInside('back', '#homeRows');
    await second();
    expect(sendKeypress).toHaveBeenCalledTimes(1);
  });
});

/**
 * The failure KIND a timeout is recorded under.
 *
 * `FAILURE_KINDS` is a closed set because the flake baseline groups by it, and its own
 * docblock names the two ways that goes wrong: two slugs for one class SPLIT the count,
 * one slug for two classes MERGES it. Routing a hand-rolled poll loop through `waitFor`
 * causes the merge — silently, since a converted loop's diff shows the loop leaving and
 * nothing about the bucket it used to report. That is why `waitFor` takes a `kind` at
 * all, and it is only worth taking if it actually reaches the record.
 *
 * Asserted against `failures.jsonl` rather than the thrown Error, because the record is
 * the artifact the baseline reads — the message never carries the slug. `RTA_RECORD_DIR`
 * points it at a tmpdir, the same channel `diagnostics.test.js` uses and the same one a
 * spawned Vitest child gets in production.
 */
describe('waitFor — the failure kind that reaches the record', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rta-steps-kind-'));
    process.env.RTA_RECORD_DIR = tmpDir;
    getValue.mockReset().mockResolvedValue({ found: true, value: 'never' });
  });

  afterEach(() => {
    delete process.env.RTA_RECORD_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** The last failure record this tmpdir received. */
  const lastRecord = () => {
    const lines = fs
      .readFileSync(path.join(tmpDir, 'failures.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
    return JSON.parse(lines.at(-1));
  };

  it('defaults to wait-for-timeout, so the 61 existing call sites are unmoved', async () => {
    await waitFor('#a.loadState', () => false, { timeout: 60, interval: 10 }).catch(() => {});
    const record = lastRecord();
    expect(record.kind).toBe('wait-for-timeout');
    expect(record.kindUnknown).toBeUndefined();
  });

  it("records the CALLER's kind when it has one, instead of merging into the default", async () => {
    await waitFor('loadState', () => false, {
      timeout: 60,
      interval: 10,
      label: 'movies grid',
      kind: FAILURE_KINDS.GRID_LOAD_TIMEOUT,
    }).catch(() => {});
    const record = lastRecord();
    expect(record.kind).toBe('grid-load-timeout');
    expect(record.label).toBe('movies grid');
    expect(record.kindUnknown).toBeUndefined();
  });

  it('records home-list-absent for an unresolvable Home list, not the shared default', async () => {
    // Its own bucket because the fix is different in kind: a wait timeout says a field never
    // reached a value; this says the node that field lives on is not in the scene, so no
    // amount of waiting on Home's content is the answer. Merging them would hide that.
    getValues.mockResolvedValue({ results: { k0: { found: false }, k1: { found: false } } });

    await homeListId({ timeout: 60, interval: 10 }).catch(() => {});

    const record = lastRecord();
    expect(record.kind).toBe('home-list-absent');
    expect(record.kind).toBe(FAILURE_KINDS.HOME_LIST_ABSENT);
    // The guard against the opposite error: a slug that is not in the registry is reported
    // rather than silently corrected, which would SPLIT the bucket instead of merging it.
    expect(record.kindUnknown).toBeUndefined();
  });

  it('flags an unregistered slug rather than correcting it, so a SPLIT bucket is visible', async () => {
    // The opposite error to the merge above, and the reason the parameter takes a
    // `FAILURE_KINDS` member rather than a string: an invented slug must not quietly
    // become a new bucket. `diagnosedError` owns this guard; the point here is that
    // routing a kind through `waitFor` does not bypass it.
    await waitFor('#a.loadState', () => false, {
      timeout: 60,
      interval: 10,
      kind: 'grid-loading-timeout',
    }).catch(() => {});
    expect(lastRecord().kindUnknown).toBe(true);
  });
});

/**
 * `waitOsdUp` — the OSD-open sequence the three call sites used to each carry a copy of.
 *
 * ## What is actually being gated
 *
 * The app swallows Up until `stateAllowsOSD()` says otherwise, and that predicate reads
 * `m.top.state` on the player node — the same field this reads back over ODC, because
 * `VideoPlayerView` stamps itself with the item id it is playing. All three sites used to
 * follow their playable gate with `await sleep(1500)`, and the two in `dialogs.spec.js`
 * NEEDED something there: they gate on `waitMediaPlaying`, which reads the OS media
 * player over ECP and goes true well before the app's own field does.
 *
 * So the property under test is not "it opens the OSD" — it is that no input is sent
 * until the app would accept it, with no fixed dwell standing in for that fact. A
 * regression here is silent: pressing early just wastes presses, the retry loop still
 * gets there, and the suite stays green while the guard is gone.
 *
 * The device is faked at the `odc`/`ecp` boundary. Whether `#osd.visible` is the right
 * keyPath stays hardware-verified via `npm run test:rta`.
 */
describe('waitOsdUp — no input before the app will accept it', () => {
  /**
   * A device whose player reports `state` from `states` (one per read, last value
   * sticking) and whose OSD becomes visible once `upPressesToOpen` Ups have landed.
   */
  const player = ({ states, upPressesToOpen = 1 }) => {
    const queue = [...states];
    let last = queue[0];
    let ups = 0;
    // The state the player was in AT THE MOMENT of each Up. Counting presses is not
    // enough: with the gate removed the OSD still opens on the first press, so the count
    // is identical and only the state it was sent in differs. That state is the property.
    const pressedWhile = [];
    sendKeypress.mockReset().mockImplementation(async (key) => {
      if (key !== 'Up') return;
      ups++;
      pressedWhile.push(last);
    });
    getValue.mockReset().mockImplementation(async ({ keyPath }) => {
      if (keyPath === '#hero1.state') {
        if (queue.length) last = queue.shift();
        return { found: true, value: last };
      }
      if (keyPath === '#osd.visible') return { found: true, value: ups >= upPressesToOpen };
      return { found: false };
    });
    return { ups: () => ups, pressedWhile: () => pressedWhile };
  };

  it('sends NOTHING while the player is still buffering', async () => {
    // The regression that produced this helper: the old loop pressed Up through the
    // whole ~5-7 s stream-start window, into a player designed not to answer.
    const p = player({ states: ['buffering', 'buffering', 'playing'] });
    // The state gate polls at 1 s, so three answers need room for three ticks.
    await waitOsdUp('osd visible', { itemId: 'hero1', playableTimeout: 5000, timeout: 2000 });
    // Every Up was sent against a playable player — not merely "one Up was sent", which
    // stays true with the gate removed and is what let an earlier version of this test
    // pass a mutation that deleted the guard outright.
    expect(p.pressedWhile()).not.toHaveLength(0);
    expect(p.pressedWhile().every((state) => state === 'playing')).toBe(true);
  });

  it("reads the app's OWN player field, not the OS media player", async () => {
    // `dialogs.spec.js` gates on ECP before calling this. If this read moved to ECP too,
    // both sites would gate on the same early signal and the guard would be gone.
    player({ states: ['playing'] });
    await waitOsdUp('osd visible', { itemId: 'hero1', playableTimeout: 2000, timeout: 2000 });
    const keyPaths = getValue.mock.calls.map(([req]) => req.keyPath);
    expect(keyPaths).toContain('#hero1.state');
  });

  it('does not dwell once the player answers — the 1500 ms settle is gone', async () => {
    // The assertion the conversion exists for. A restored `sleep(1500)` between the two
    // waits pushes this well past the bound; the gated path costs one poll interval.
    player({ states: ['playing'] });
    const start = Date.now();
    await waitOsdUp('osd visible', { itemId: 'hero1', playableTimeout: 2000, timeout: 2000 });
    expect(Date.now() - start).toBeLessThan(1200);
  });

  it('does not press into an OSD that is already up', async () => {
    // Up OPENS the OSD; it is not a toggle. Once open the key reaches the OSD itself and
    // moves focus between its controls, perturbing the state the caller asserts on.
    player({ states: ['playing'], upPressesToOpen: 0 });
    await waitOsdUp('osd visible', { itemId: 'hero1', playableTimeout: 2000, timeout: 2000 });
    expect(sendKeypress).not.toHaveBeenCalled();
  });

  it('keeps re-pressing when a key is swallowed, rather than failing on one drop', async () => {
    player({ states: ['playing'], upPressesToOpen: 3 });
    await waitOsdUp('osd visible', { itemId: 'hero1', playableTimeout: 2000, timeout: 12000 });
    expect(sendKeypress.mock.calls.filter(([k]) => k === 'Up').length).toBeGreaterThanOrEqual(3);
  });

  it('times out under the OSD label when the player never becomes playable', async () => {
    player({ states: ['buffering'] });
    await expect(
      waitOsdUp('osd visible', { itemId: 'hero1', playableTimeout: 150, timeout: 150 }),
    ).rejects.toThrow(/player playable \(pre-OSD\)/);
    expect(sendKeypress).not.toHaveBeenCalled();
  });
});

// A scene census walks from the scene ROOT, so it only describes a read that was
// scene-rooted too. `getActiveVal` resolves under `m.global.activeRoutedView` precisely to
// dodge the cross-view id collisions the audit hunts for, so auditing ITS keyPath reports an
// ambiguity that read was never exposed to — and a false positive lands in the same
// false-alarm count `resolution.js` names as the bar for promoting the audit to a throw.
describe('waitFor audits only the reads a scene census can describe', () => {
  beforeEach(() => {
    auditSceneResolution.mockClear();
    getValue.mockResolvedValue({ found: true, value: 'ready' });
  });

  it('audits a scene-rooted read', async () => {
    await waitFor('#itemGrid.type', (v) => v === 'ready', { interval: 1 });
    expect(auditSceneResolution).toHaveBeenCalledWith('#itemGrid.type', expect.anything());
  });

  it('does NOT audit an activeVal-scoped read', async () => {
    // `#extrasGrid` is the real instance of the collision: every ItemDetails declares one,
    // and sgRouter keeps suspended views in the tree through a Series -> Season -> Episode
    // drill-down, which is exactly why this site reads activeVal-scoped in the first place.
    await waitFor('#extrasGrid.type', (v) => v === 'ready', {
      read: getActiveVal,
      interval: 1,
    });
    expect(auditSceneResolution).not.toHaveBeenCalled();
  });

  it('does NOT audit a reader it cannot characterise', async () => {
    // The safe default: a census cannot be trusted to describe a read whose base it does
    // not know, so an unknown reader gets no audit rather than a scene-rooted guess.
    await waitFor('#itemGrid.type', (v) => v === 'ready', {
      read: async () => 'ready',
      interval: 1,
    });
    expect(auditSceneResolution).not.toHaveBeenCalled();
  });
});
