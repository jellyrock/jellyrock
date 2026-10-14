/**
 * Hardware-free gate on the grid TILE walk (`focusGridTile`) against a device whose
 * `itemFocused` shows up LATER than a poll tick.
 *
 * `focusGridTile` is not exported, so this drives it through `navMovieDetails`, with the
 * real `nav.js` and the real `steps.js`. Only the device is modelled (`roku-test-automation`
 * is stubbed) plus the three Home gates that precede the grid, which have their own specs.
 * Home is a single library tile that already holds focus, so the library nav presses
 * exactly one OK and the grid walk is the only thing that presses Right.
 *
 * The defect: a read-then-press loop reads the old index while an earlier Right is still
 * unseen, presses again, and OK then opens a tile too far along. The latency here is
 * above the 500 ms tick that loop used. Fake timers drive the device's clock, so it costs
 * no wall time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getValue = vi.fn();
const getValues = vi.fn();
const sendKeypress = vi.fn();
const getFocusedNode = vi.fn();
vi.mock('roku-test-automation', () => ({
  ecp: {
    sendKeypress: (...a) => sendKeypress(...a),
    Key: { Ok: 'Ok', Back: 'Back', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right' },
  },
  odc: {
    getValue: (...a) => getValue(...a),
    getValues: (...a) => getValues(...a),
    getFocusedNode: (...a) => getFocusedNode(...a),
  },
}));

vi.mock('./steps.js', async (importOriginal) => ({
  ...(await importOriginal()),
  waitHome: vi.fn(),
  homeListId: async () => '#homeRows',
  waitFocusInHomeContent: vi.fn(),
}));

vi.mock('./diagnostics.js', async () => {
  const { FAILURE_KINDS } = await import('../../../scripts/run-record.js');
  return {
    FAILURE_KINDS,
    diagnosedError: vi.fn(async (message, record) => Object.assign(new Error(message), { record })),
  };
});

const { navMovieDetails } = await import('./nav.js');

const PRESS_LATENCY_MS = 600;
const TARGET = 3;

/**
 * A Movies grid whose focus index changes `latencyMs` after each Right or Left, or
 * `latencies[n]` after the n-th of them.
 */
function installDevice({ latencyMs, latencies = [] }) {
  let moves = 0;
  const device = { index: 0, presses: [], opened: null };
  sendKeypress.mockImplementation(async (key) => {
    device.presses.push(key);
    if (key === 'Ok' && device.presses.filter((k) => k === 'Ok').length > 1) {
      // The second OK is the one on the grid tile; record which tile it landed on.
      device.opened = device.index;
    }
    if (key === 'Right' || key === 'Left') {
      const step = key === 'Right' ? 1 : -1;
      setTimeout(() => (device.index += step), latencies[moves++] ?? latencyMs);
    }
  });
  // Focus sits on Home's row list until the first OK opens the library, then on the grid.
  getFocusedNode.mockImplementation(async () =>
    device.presses.includes('Ok')
      ? { found: true, keyPath: '#itemGrid', node: { subtype: 'MarkupGrid' } }
      : { found: true, keyPath: '#viewTarget.#homeRows', node: { subtype: 'HomeRows' } },
  );
  getValues.mockRejectedValue(new Error('not modelled'));
  getValue.mockImplementation(async ({ base, keyPath }) => {
    const found = (value) => ({ found: true, value });
    if (base === 'global') {
      if (keyPath === 'activeRoutedView.loadState') return found('loaded');
      return { found: false };
    }
    switch (keyPath) {
      case '#homeRows.content.getChildCount()':
        return found(1);
      case '#homeRows.content.0.sectionId':
        return found('library');
      case '#homeRows.content.0.getChildCount()':
        return found(1);
      case '#homeRows.content.0.0.collectionType':
        return found('movies');
      case '#homeRows.rowItemFocused':
        return found([0, 0]);
      case '#itemGrid.itemFocused':
        return found(device.index);
      case '#videoTitle.text':
        return found('A movie');
      default:
        return { found: false };
    }
  });
  return device;
}

async function walk(ctx) {
  const run = navMovieDetails(ctx);
  const settled = run.then(
    () => undefined,
    (e) => e,
  );
  await vi.advanceTimersByTimeAsync(60000);
  const err = await settled;
  if (err) throw err;
  await vi.advanceTimersByTimeAsync(2000);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('focusGridTile against a device slower than a poll tick', () => {
  it('sends exactly one Right per tile and opens the target tile', async () => {
    const device = installDevice({ latencyMs: PRESS_LATENCY_MS });
    await walk({ heroIndex: TARGET });
    expect(device.presses.filter((k) => k === 'Right')).toHaveLength(TARGET);
    expect(device.index).toBe(TARGET);
    expect(device.opened).toBe(TARGET);
  });

  it('walks back when a Right slower than the drop wait lands twice', async () => {
    // The first Right takes 1100 ms, past `STEPPED_DROP_WAIT_MS`, so it is re-sent and both
    // copies land. The walk must not open the tile after the target.
    const device = installDevice({ latencyMs: PRESS_LATENCY_MS, latencies: [1100] });
    await walk({ heroIndex: TARGET });
    expect(device.presses).toContain('Left');
    expect(device.index).toBe(TARGET);
    expect(device.opened).toBe(TARGET);
  });

  it('presses no Right for tile 0', async () => {
    const device = installDevice({ latencyMs: PRESS_LATENCY_MS });
    await walk({ heroIndex: 0 });
    expect(device.presses).not.toContain('Right');
    expect(device.opened).toBe(0);
  });
});
