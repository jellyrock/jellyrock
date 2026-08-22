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
    Key: { Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' },
  },
}));

const {
  getActiveVals,
  resendIfSwallowed,
  walkHomeToFirstRow,
  overhangWalkKey,
  waitHome,
  scrollFocus,
  waitCellsQuiet,
  waitRowsSettled,
  formatCellCounts,
  axisEnd,
  sweepBudget,
} = await import('./steps.js');

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
    // See `rta-home-active-list-hardcoded` in docs/architecture/tech-debt.md.
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

describe('waitHome — the login flow is a separate question, asked first', () => {
  beforeEach(() => {
    getValue.mockReset();
    getFocusedNode.mockReset();
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
