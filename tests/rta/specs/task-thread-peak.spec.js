/**
 * How close does the app actually get to Roku's 100-thread cap?
 *
 * ## Why this number decides a design, not just a curiosity
 *
 * The charter's last open criterion is "a production build enforces a ceiling".
 * Every enforcing design (defer, refuse, crash-early) has to know the live count at
 * launch time, and session 28 measured what that costs on the render thread:
 * ~527 us per launch at depth 10 on a Stick 4K. Whether that price is worth paying
 * depends entirely on how much headroom the app actually has, and NOBODY HAS
 * MEASURED IT since the two fan-out mechanisms were removed.
 *
 * Before the fix the app clearly exceeded 100 — that is what `&h29` was. After it,
 * the peak is unknown. A peak of ~12 against a cap of 100 and a peak of ~70 point
 * at opposite decisions.
 *
 * ## What it needs, and why this spec cannot be left in the suite as-is
 *
 * It reads `m.global.taskLedger`, which is filled by a TEMPORARY `#if ENABLE_RTA`
 * hook in `launchTask()`. That hook costs ~527 us per launch and would perturb
 * every RTA `measure` run, so it is reverted after this measurement. `tracked` is
 * returned alongside `live` so a build without the hook is distinguishable from an
 * app that genuinely runs no Task threads — opposite findings that a bare 0 would
 * conflate.
 *
 * ## Sampling
 *
 * Polled concurrently with a scripted journey rather than read at the end: the peak
 * is a transient during screen loads, and a reading taken once everything settles
 * measures the persistent floor instead — a different (and much smaller) number.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { odc, hardRelaunch } from '../lib/driver.js';
import { sleep, waitHome } from '../lib/steps.js';
import { navCellSweepExtras, navHomeReturnAfterDetails } from '../lib/nav.js';

const BENCH = '#taskThreadPeak';
const SAMPLE_MS = 120;

let ctx;
const samples = [];

async function sample(label) {
  const res = await odc
    .callFunc({ base: 'scene', keyPath: BENCH, funcName: 'liveCount' }, { timeout: 10000 })
    .catch(() => null);
  const v = res?.value;
  if (!v) return null;
  const live = v.live ?? v.LIVE;
  const tracked = v.tracked ?? v.TRACKED;
  if (typeof live === 'number') samples.push({ label, live, tracked, t: Date.now() });
  return live;
}

/** Poll until stopped. Returns a stop function. */
function startPolling(labelRef) {
  let stop = false;
  const done = (async () => {
    while (!stop) {
      await sample(labelRef.current);
      await sleep(SAMPLE_MS);
    }
  })();
  return async () => {
    stop = true;
    await done;
  };
}

beforeAll(async () => {
  const session = await authenticate(RTA_CONFIG.server);
  ctx = { libraries: await getLibraries(session) };

  // SEED, don't inherit. Without this the spec silently depends on whatever server
  // the device was last signed into by another run — it would pass against the wrong
  // fixture and report a peak for a library nobody chose.
  const expectedServer = await seedHome(session, RTA_CONFIG.languages[0]);
  await hardRelaunch(); // never plain relaunch — the app re-persists over the seed
  await assertSeedTookEffect(expectedServer, 'task-thread peak');
  await waitHome();
  await odc.createChild({
    base: 'scene',
    keyPath: '',
    subtype: 'TaskLedgerBench',
    fields: { id: 'taskThreadPeak' },
  });
});

afterAll(async () => {
  await odc.removeNode({ base: 'scene', keyPath: BENCH }).catch(() => {});
});

it("keeps peak live Task threads far below Roku's cap across a real journey", async () => {
  const labelRef = { current: 'boot' };
  const stopPolling = startPolling(labelRef);
  const phaseErrors = {};

  // Each phase runs independently and a failure is RECORDED rather than thrown. The
  // deliverable is the sample series, and losing every sample because the last
  // navigation step missed a focus gate is the worst possible trade — the first run
  // of this spec did exactly that.
  //
  // `navCellSweepExtras` already chains home -> grid -> details -> extras, so calling
  // navLibraryGrid/navMovieDetails first double-navigates and times out.
  // Order matters: `navHomeReturnAfterDetails` starts FROM home, and
  // `navCellSweepExtras` ends on the library grid. Running the sweep first left the
  // seven-screens walk waiting for a focus on #homeRows that could never arrive.
  const phases = [
    ['home-settled', async () => sleep(2000)],
    ['seven-screens', () => navHomeReturnAfterDetails(ctx)],
    ['extras-sweep', () => navCellSweepExtras(ctx)],
  ];

  try {
    for (const [label, fn] of phases) {
      labelRef.current = label;
      try {
        await fn();
      } catch (e) {
        phaseErrors[label] = String(e?.message ?? e).split('\n')[0];
      }
    }
  } finally {
    await stopPolling();

    const lives = samples.map((s) => s.live);
    const byLabel = {};
    for (const s of samples) byLabel[s.label] = Math.max(byLabel[s.label] ?? 0, s.live);
    const outFile = path.join(
      process.cwd(),
      '.device-runs',
      `task-thread-peak-${process.env.ROKU_IP ?? 'unknown'}.json`,
    );
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(
      outFile,
      JSON.stringify(
        {
          device: process.env.ROKU_IP ?? 'unknown',
          server: RTA_CONFIG.server.url,
          libraryCount: ctx?.libraries?.length ?? null,
          cap: 100,
          consoleWarnsAbove: 50,
          sampleCount: samples.length,
          peakLive: lives.length ? Math.max(...lives) : null,
          medianLive: lives.length
            ? [...lives].sort((a, b) => a - b)[Math.floor(lives.length / 2)]
            : null,
          maxTracked: samples.length ? Math.max(...samples.map((s) => s.tracked ?? 0)) : 0,
          peakByPhase: byLabel,
          phaseErrors,
          samples,
        },
        null,
        2,
      ),
    );
    console.log(`[PEAK] wrote ${outFile}`);
  }

  // The ledger has to have RECORDED something for any of this to mean anything.
  // `tracked` 0 reads identically to a peak of 0 — "not measured" vs "no threads"
  // are opposite findings and the bound below would pass on either.
  expect(
    Math.max(...samples.map((s) => s.tracked ?? 0)),
    'the task ledger recorded nothing, so a peak of 0 would mean "not measured", ' +
      'not "no threads". Check that launchTask() is still recording.',
  ).toBeGreaterThan(0);

  expect(samples.length, 'no samples were taken').toBeGreaterThan(10);

  // THE GATE — the reason this spec is permanent rather than a one-off measurement.
  //
  // `no-raw-run` and `no-task-fanout` are compile-time ratchets, and they cannot see
  // the one thing that actually kills the app: the AGGREGATE count. Their own
  // documented gaps are interprocedural (a loop calling a helper that launches
  // internally), plus `components/vendor/**`, plus many screens each launching a
  // bounded number that sum. This is the check that covers those.
  //
  // A BOUND, not a pin. Measured 2026-08-23 on `.177`: peak 7 against a 4-library
  // demo server and 11 against a 13-library real one, median 6 — the count is
  // dominated by the fixed bootstrap set, not by screen activity, which is
  // `no-task-fanout` working. 30 is ~3x the observed peak, under Roku's own
  // 50-thread console warning, and half the runtime watermark. It will move with the
  // fixture; it must not move with the app.
  //
  // If this fails, something started fanning out Task threads. Read `peakByPhase` in
  // the written JSON to see which part of the journey did it.
  const peak = Math.max(...samples.map((s) => s.live));
  expect(
    peak,
    `peak live Task threads hit ${peak}. Baseline is 7-11. Roku caps an app at 100 ` +
      'and launchTask() refuses at 50, so this is a fan-out regression, not a tuning ' +
      `knob — see peakByPhase in .device-runs for the phase that did it.`,
  ).toBeLessThan(30);
});
