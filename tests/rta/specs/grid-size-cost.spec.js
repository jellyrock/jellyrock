/**
 * What a denser library grid costs: how long the first screen of posters takes to land,
 * how long a scroll takes, and how much memory the app holds, at several counts of items
 * per row. It reports numbers and gates nothing, so it runs only when asked for:
 *
 *   RTA_BENCH=1 npm run test:rta -- grid-size-cost
 *
 * Run it against a library with far more items than a screen holds (the music library's
 * Albums tab is the densest case: square cells show the most rows). `RTA_COST_COUNTS=6,11`
 * picks the counts, `RTA_COST_SAMPLES` the cold starts per count (3), `RTA_COST_ROWS` how
 * many rows the scroll goes down (8). One JSON line per sample is appended to
 * `out/rta/grid-size-cost.jsonl`, and the medians are printed at the end.
 *
 * Memory is the OS's figure for the app's process (ECP `query/chanperf`, `memory.used`).
 * Whether that includes texture memory is not established here, so read it as a relative
 * figure between counts on one device, never as the app's whole footprint.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryByType, waitGridLoaded } from '../lib/nav.js';
import { getVal, scrollFocus, waitCellsQuiet, waitFocusInside, waitHome } from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const BENCH_ENABLED = process.env.RTA_BENCH === '1';
const COUNTS = (process.env.RTA_COST_COUNTS || '3,6,9,11').split(',').map(Number);
const SAMPLES = Number(process.env.RTA_COST_SAMPLES || 3);
const SCROLL_ROWS = Number(process.env.RTA_COST_ROWS || 8);
const QUIET_MS = 1500;
const OUT_FILE = path.join(process.cwd(), 'out', 'rta', 'grid-size-cost.jsonl');

let session;
let libraries;

beforeAll(async () => {
  if (!BENCH_ENABLED) return;
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

/** The app process's memory in megabytes, as the OS reports it. */
async function memoryUsedMb() {
  const res = await fetch(`http://${process.env.ROKU_IP}:8060/query/chanperf`);
  const used = /<used>(\d+)<\/used>/.exec(await res.text());
  return used ? Math.round(Number(used[1]) / 1048576) : undefined;
}

/** The cells to settle, how long that took past the quiet window, and what they did. */
async function settle() {
  const quiet = await waitCellsQuiet('#itemGrid', { quietMs: QUIET_MS, timeout: 60000 });
  return { ms: Math.max(0, quiet.waitedMs - QUIET_MS), quiet: quiet.quiet, counts: quiet.counts };
}

async function sampleOnce(libraryId, columns, n) {
  const expectedServer = await seedHome(session, RTA_CONFIG.languages[0]);
  const landing = await seedLibraryLanding(session, libraryId, 'albums');
  await odc.writeRegistry({
    values: { [session.userId]: { [`display.${libraryId}.columns_albums`]: String(columns) } },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, `cost ${columns}`, { landing });
  await waitHome();
  const memoryHomeMb = await memoryUsedMb();
  await navLibraryByType('music', libraryId);
  await waitGridLoaded(`cost ${columns} per row`);
  await waitFocusInside('#itemGrid', { label: 'the grid before the scroll', timeout: 20000 });

  const first = await settle();
  const memoryFirstMb = await memoryUsedMb();
  if (n === 0) await captureRawUI(`cost-${columns}-per-row`);

  const scrollStart = Date.now();
  const walk = await scrollFocus({
    keyPath: '#itemGrid.itemFocused',
    target: columns * SCROLL_ROWS,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    stride: columns,
    read: getVal,
    timeout: 60000,
    label: `down ${SCROLL_ROWS} rows at ${columns} per row`,
  });
  const scrollMs = Date.now() - scrollStart;
  const after = await settle();
  const memoryScrolledMb = await memoryUsedMb();

  return {
    columns,
    sample: n,
    firstFillMs: first.ms,
    firstQuiet: first.quiet,
    firstLoadsStarted: first.counts.LoadsStarted,
    scrollMs,
    scrolledTo: walk.to,
    scrollFillMs: after.ms,
    scrollQuiet: after.quiet,
    loadsStarted: after.counts.LoadsStarted,
    loadsFailed: after.counts.LoadsFailed,
    binds: after.counts.Binds,
    memoryHomeMb,
    memoryFirstMb,
    memoryScrolledMb,
  };
}

const median = (values) => {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
};

it.skipIf(!BENCH_ENABLED)(
  'measures the first fill, a scroll and memory at each count of items per row',
  async (testCtx) => {
    const libraryId = libraryIdFor(libraries, 'music');
    if (!libraryId) testCtx.skip('server has no "music" library');
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

    const rows = [];
    for (const columns of COUNTS) {
      for (let n = 0; n < SAMPLES; n++) {
        const row = await sampleOnce(libraryId, columns, n);
        fs.appendFileSync(OUT_FILE, `${JSON.stringify(row)}\n`);
        rows.push(row);
      }
    }

    console.log('  [cost] medians per count:');
    for (const columns of COUNTS) {
      const mine = rows.filter((r) => r.columns === columns);
      const m = (key) => median(mine.map((r) => r[key]));
      console.log(
        `  [cost] ${columns} per row: first fill ${m('firstFillMs')} ms (${m('firstLoadsStarted')} loads), ` +
          `scroll ${m('scrollMs')} ms + ${m('scrollFillMs')} ms to settle, ${m('loadsStarted')} loads, ` +
          `${m('binds')} binds, memory ${m('memoryHomeMb')} / ${m('memoryFirstMb')} / ${m('memoryScrolledMb')} MB ` +
          `(Home / first screen / scrolled)`,
      );
    }

    // A number taken while the app was not driven is not a measurement: every scroll has
    // to have arrived, and every settle has to have seen the cells go quiet.
    for (const row of rows) {
      expect(row.scrolledTo, `the scroll at ${row.columns} per row arrived`).toBe(
        row.columns * SCROLL_ROWS,
      );
      expect(row.firstQuiet && row.scrollQuiet, `the cells settled at ${row.columns}`).toBe(true);
    }
  },
  90 * 60 * 1000,
);
