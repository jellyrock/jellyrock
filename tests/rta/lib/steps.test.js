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
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  ecp: { sendKeypress: (...a) => sendKeypress(...a), Key: { Up: 'Up', Right: 'Right' } },
}));

const { getActiveVals, resendIfSwallowed, walkHomeToFirstRow, overhangWalkKey, waitHome } =
  await import('./steps.js');

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
  const onIcon = { node: { id: 'settingsIcon' }, keyPath: '#overhang.#settingsIcon' };
  const inHomeRows = {
    node: { subtype: 'HomeRows', id: 'homeRows', rowItemFocused: [0, 2] },
    keyPath: '#routerOutlet.#viewTarget.#abc.#homeRows',
  };
  const onTabBar = { node: { subtype: 'JRTabBar', id: 'tabBar' }, keyPath: '#overhang.#tabBar' };

  it('sends nothing once the icon has focus', () => {
    expect(overhangWalkKey(onIcon, 'settingsIcon')).toBeNull();
  });

  it('re-presses Up while focus is still inside Home rows — the #789 signature', () => {
    // The exact recorded state: row 0, item index dragged to 2 by the Rights themselves.
    // Right cannot leave Home from here, which is why the old walk could never recover.
    expect(overhangWalkKey(inHomeRows, 'settingsIcon')).toBe('Up');
  });

  it('treats the favorites list as Home too', () => {
    // Home's active list is `m.activeContent`, which is the favorites list under that tab.
    const inFavorites = {
      node: { subtype: 'FavoritesRows', id: 'favoritesRows', rowItemFocused: [0, 0] },
      keyPath: '#routerOutlet.#viewTarget.#abc.#favoritesRows',
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
        { node: { id: 'searchIcon' }, keyPath: '#overhang.#searchIcon' },
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
