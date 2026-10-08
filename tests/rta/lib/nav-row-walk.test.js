/**
 * Hardware-free gate on the Home ROW walk (`focusHomeRow`) against a device whose focus
 * index shows up LATER than the walk's poll tick.
 *
 * ## Why this file exists, and why it does not mock `steps.js`
 *
 * `nav.test.js` replaces `steps.js` wholesale, which is right for its decision table and
 * wrong for this defect: the flaw lives in how the walk's own loop and `scrollFocus` (or
 * the `waitFor` it replaced) interact with a lagging field, so both have to be REAL here.
 * Only the device is modelled: `roku-test-automation` is stubbed, and a keypress applies its
 * row change after `PRESS_LATENCY_MS`. 400 ms sits inside the delay measured on a Stick 4K
 * on 2026-10-08 and above the old 350 ms tick.
 *
 * The defect: a read-then-press loop reads the old row while an earlier press is still
 * unseen, presses again, then its predicate sees the target and returns while the extra key
 * is in flight. OK then lands one row too far.
 *
 * Fake timers drive the device's clock, so the 400 ms latency costs no wall time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getValue = vi.fn();
const getValues = vi.fn();
const sendKeypress = vi.fn();
vi.mock('roku-test-automation', () => ({
  ecp: {
    sendKeypress: (...a) => sendKeypress(...a),
    getMediaPlayer: async () => null,
    getActiveApp: async () => ({ app: { id: 'dev', title: 'JellyRock' } }),
    Key: { Ok: 'Ok', Back: 'Back', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' },
  },
  odc: {
    getValue: (...a) => getValue(...a),
    getValues: (...a) => getValues(...a),
    getFocusedNode: async () => ({ found: false }),
  },
}));

const { focusHomeRow } = await import('./nav.js');

const PRESS_LATENCY_MS = 400;
const ROW_COUNT = 3;

/** A Home whose focus index changes `latencyMs` after each Down or Up. */
function installDevice({ latencyMs, startRow = 0 }) {
  const device = { row: startRow, presses: [], leftHome: false };
  sendKeypress.mockImplementation(async (key) => {
    device.presses.push(key);
    setTimeout(() => {
      if (key === 'Down') device.row = Math.min(device.row + 1, ROW_COUNT - 1);
      if (key === 'Up') {
        // Up from row 0 releases focus to the overhang, which is the failure the walk
        // must never provoke.
        if (device.row === 0) device.leftHome = true;
        else device.row -= 1;
      }
    }, latencyMs);
  });
  getValues.mockImplementation(async ({ requests }) => ({
    results: Object.fromEntries(
      Object.keys(requests).map((k, i) => [k, i === 0 ? { found: true, value: 'HomeRows' } : {}]),
    ),
  }));
  getValue.mockImplementation(async ({ keyPath }) =>
    keyPath === '#homeRows.rowItemFocused'
      ? { found: true, value: [device.row, 0] }
      : { found: false },
  );
  return device;
}

async function walkTo(row) {
  const walk = focusHomeRow(row, 'test');
  // Settle the rejection handler up front: advancing timers while `walk` is unobserved
  // would otherwise report an unhandled rejection before the assertion sees it.
  const settled = walk.then(
    () => undefined,
    (e) => e,
  );
  await vi.advanceTimersByTimeAsync(60000);
  const err = await settled;
  if (err) throw err;
  // Let any key still in flight land, so a late extra press shows up in the final row.
  await vi.advanceTimersByTimeAsync(2000);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('focusHomeRow against a device slower than a poll tick', () => {
  it('sends exactly one Down per row and stops on the target row', async () => {
    const device = installDevice({ latencyMs: PRESS_LATENCY_MS });
    await walkTo(1);
    expect(device.presses).toEqual(['Down']);
    expect(device.row).toBe(1);
  });

  it('walks two rows down with one Down each', async () => {
    const device = installDevice({ latencyMs: PRESS_LATENCY_MS });
    await walkTo(2);
    expect(device.presses).toEqual(['Down', 'Down']);
    expect(device.row).toBe(2);
  });

  it('walks back up with one Up per row and never presses Up past row 0', async () => {
    const device = installDevice({ latencyMs: PRESS_LATENCY_MS, startRow: 2 });
    await walkTo(0);
    expect(device.presses).toEqual(['Up', 'Up']);
    expect(device.row).toBe(0);
    expect(device.leftHome).toBe(false);
  });

  it('presses nothing when already on the target row', async () => {
    const device = installDevice({ latencyMs: PRESS_LATENCY_MS, startRow: 1 });
    await walkTo(1);
    expect(device.presses).toEqual([]);
  });
});
