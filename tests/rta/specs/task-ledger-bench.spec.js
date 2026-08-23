/**
 * The RENDER-THREAD cost of a production-resident task ledger.
 *
 * ## Why this spec exists at all
 *
 * `tests/source/unit/utils/taskLedgerCost.spec.bs` measured what `recordTaskLaunch`
 * costs and proved, from its own data, that it could not measure the case that
 * matters: at depth 0 the identical operation cost 909.9 us against `m.global` and
 * 245.6 us against a locally-created node — a 3.7x gap that can only exist if
 * `m.global` is owned by another thread. So Rooibos does not run on the render
 * thread, and every figure in that table is rendezvous-laden.
 *
 * The app's Task launches happen on the render thread. `ExtrasRowList` alone runs
 * 38 of them. On that thread a node op against a render-owned node does not
 * rendezvous at all, so the production cost could be ~60-100x lower than the spec
 * reports — or not, if `m.global` turns out not to be render-owned. Nothing had
 * measured it; the number was an EXTRAPOLATION, and the ceiling design was waiting
 * on it.
 *
 * ## Why an RTA spec is the vehicle
 *
 * RTA's on-device component receives requests on a Task thread, sets
 * `renderThreadRequest`, and its observer runs the handler — and an observer
 * callback for a field set from a Task thread executes on the Render thread
 * (rokudev/dev-doc v2.0, DEVELOPER/core-concepts/threads.md, "Task node objects
 * ownership"). So `odc.callFunc` IS render-thread execution, already wired, with
 * no app code path touched.
 *
 * `components/testing/TaskLedgerBench.bs` mirrors the Rooibos bench function for
 * function so the two tables differ in exactly ONE variable: the thread.
 *
 * ## This prints a table and gates ONE thing
 *
 * The grid is a measurement, and measurements do not belong in an assertion — the
 * numbers are the device's and will move with it. The assertion is the same
 * platform property the Rooibos spec gates from the other side: a field read on a
 * node the reading thread owns is cheap. Here it also carries the discriminator,
 * which is the finding: if `m.global` reads at render-thread-local cost, the
 * production ledger pays no crossing per launch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { odc } from '../lib/driver.js';
import { sleep } from '../lib/steps.js';

const ITERATIONS = 200;
const DEPTHS = [0, 10, 25, 50];
const BENCH = '#taskLedgerBench';

/**
 * Read a key from a BrightScript AA case-INSENSITIVELY.
 *
 * roAssociativeArray is case-insensitive by default, and the JSON that comes back
 * through ODC does not preserve the case the literal was written in. Measured, not
 * guessed: the first run of this bench printed every lowercase key (`us`, `cell`,
 * `depth`) correctly and every camelCase one (`floorUs`, `localNodeUs`, `sinkLen`)
 * as `undefined`. Reading by exact camelCase name silently yields undefined, which
 * is the failure mode this whole spec is built to refuse — an assertion against
 * `undefined` verifies nothing.
 */
function field(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(obj)) if (k.toLowerCase() === want) return v;
  return undefined;
}

/** One render-thread bench cell. Generous timeout: a slow cell is the finding, not a failure. */
async function runCell(args) {
  const { value } = await odc.callFunc(
    { base: 'scene', keyPath: BENCH, funcName: 'runCell', funcParams: [args] },
    { timeout: 30000 },
  );
  return value;
}

/**
 * Wait for the scene to answer, NOT for Home.
 *
 * The bench needs a render-owned parent and nothing else — no server, no library,
 * no signed-in user. Gating on `waitHome()` would make this spec depend on seeded
 * demo-server content it never reads, and would make it unrunnable on its own
 * (`npm run test:rta -- task-ledger-bench`), which is the way a measurement
 * actually gets re-taken. An empty keyPath resolves to the base node, so this
 * polls for the scene itself.
 */
async function waitForScene(timeout = 60000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const res = await odc.getValue({ base: 'scene', keyPath: '' }).catch(() => ({ found: false }));
    if (res.found) return;
    if (Date.now() > deadline) throw new Error('scene never answered — is the app running?');
    await sleep(500);
  }
}

beforeAll(async () => {
  await waitForScene();
  // Created under the scene, so the render thread owns it — which is the whole
  // point. `createChild` is itself processed on the render thread.
  await odc.createChild({ base: 'scene', keyPath: '', subtype: 'TaskLedgerBench' });
});

afterAll(async () => {
  await odc.removeNode({ base: 'scene', keyPath: BENCH }).catch(() => {});
});

it('measures the task ledger on the render thread', async () => {
  const reads = await runCell({ cell: 'reads', iterations: ITERATIONS });

  const rows = [];
  for (const depth of DEPTHS) {
    const [recordGlobal, recordLocal, count, prune] = [
      await runCell({ cell: 'recordGlobal', depth, iterations: ITERATIONS }),
      await runCell({ cell: 'recordLocal', depth, iterations: ITERATIONS }),
      await runCell({ cell: 'count', depth, iterations: ITERATIONS }),
      await runCell({ cell: 'prune', depth, iterations: ITERATIONS }),
    ];
    rows.push({ depth, recordGlobal, recordLocal, count, prune });
  }

  // Written to a FILE, not just logged. Vitest suppresses console output for a
  // PASSING test in a non-TTY run, so a green measurement spec would print its
  // table to nobody — the numbers would exist only when the run failed. A device
  // measurement is the output here, so it gets a durable home next to the other
  // per-device run records.
  const outDir = path.join(process.cwd(), '.device-runs');
  const outFile = path.join(outDir, `ledger-cost-${process.env.ROKU_IP ?? 'unknown'}.json`);

  // The REDESIGN candidates, measured before anything is built on them.
  const candidates = {};
  const verified = {};
  for (const [cell, depth] of [
    ['counterOnly', 0],
    ['countNoLCase', 10],
    ['countNoLCase', 50],
    ['aaRecord', 10],
    ['aaRecord', 50],
    ['aaRecordNoLCase', 10],
    ['aaRecordNoLCase', 50],
  ]) {
    candidates[`${cell}@${depth}`] = field(
      await runCell({ cell, depth, iterations: ITERATIONS }),
      'us',
    );
  }
  // These two return a length so "too cheap to measure" can be told apart from
  // "did not happen" — a sub-floor reading is meaningless without it.
  for (const [cell, depth] of [
    ['aaAppendVerified', 10],
    ['aaAppendVerified', 50],
    ['nodeArrayPush', 10],
    ['nodeArrayPush', 50],
  ]) {
    const r = await runCell({ cell, depth, iterations: ITERATIONS });
    candidates[`${cell}@${depth}`] = field(r, 'us');
    verified[`${cell}@${depth}`] = {
      finalCount: field(r, 'finalCount'),
      expectedCount: field(r, 'expectedCount'),
      grew: field(r, 'finalCount') === field(r, 'expectedCount'),
    };
  }

  const us = (r) => {
    const v = field(r, 'us');
    return typeof v === 'number' ? v.toFixed(1) : '?';
  };
  const localNodeUs = field(reads, 'localNodeUs');
  const taskNodeUs = field(reads, 'taskNodeUs');
  const globalUs = field(reads, 'globalUs');

  console.log(`[LEDGER-COST/render] raw reads payload: ${JSON.stringify(reads)}`);
  console.log(`[LEDGER-COST/render] iterations=${ITERATIONS} floorUs=${field(reads, 'floorUs')}`);
  console.log(
    `[LEDGER-COST/render] one field read - localNodeUs=${localNodeUs} ` +
      `taskNodeUs=${taskNodeUs} globalUs=${globalUs}`,
  );
  console.log('[LEDGER-COST/render] depth | recordGlobalUs | recordLocalUs | countUs | pruneUs');
  for (const r of rows) {
    console.log(
      `[LEDGER-COST/render] ${r.depth} | ${us(r.recordGlobal)} | ${us(r.recordLocal)} | ` +
        `${us(r.count)} | ${us(r.prune)}`,
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        device: process.env.ROKU_IP ?? 'unknown',
        thread: 'render',
        iterations: ITERATIONS,
        floorUs: field(reads, 'floorUs'),
        reads: { localNodeUs, taskNodeUs, globalUs },
        candidates,
        verified,
        rows: rows.map((r) => ({
          depth: r.depth,
          recordGlobalUs: field(r.recordGlobal, 'us'),
          recordLocalUs: field(r.recordLocal, 'us'),
          countUs: field(r.count, 'us'),
          pruneUs: field(r.prune, 'us'),
        })),
      },
      null,
      2,
    ),
  );
  console.log(`[LEDGER-COST/render] wrote ${outFile}`);

  // The bench has to have RUN for the table to mean anything — a callFunc that
  // silently returned nothing would print a grid of "?" and pass.
  expect(field(reads, 'sinkLen'), 'the discriminator reads did not execute').toBeGreaterThan(0);

  // THE PROOF THAT THIS RAN ON THE RENDER THREAD, and the reason the table above
  // is evidence rather than just numbers.
  //
  // Everything here rests on `odc.callFunc` executing on the render thread. That is
  // read off RTA's architecture (a Task sets `renderThreadRequest`; the observer
  // callback for a field set from a Task thread runs on the Render thread) — but an
  // architectural reading is exactly the kind of claim this project keeps finding
  // wrong, and if it IS wrong every figure above is a second copy of the off-thread
  // table rather than its counterpart.
  //
  // `taskNode` settles it from the DATA, with no appeal to the architecture: Roku's
  // docs state flatly that "Task nodes are owned by the Render thread", so a Task
  // node is a known-render-owned probe. Read from off-thread it costs 91-118 us
  // (measured, `.177`). Read from the render thread it must be thread-local-cheap.
  // So this assertion cannot pass anywhere but the render thread — which is the
  // same trick session 27 used in reverse to prove Rooibos ISN'T on it.
  expect(
    taskNodeUs,
    `a Task node field read cost ${taskNodeUs} us. Task nodes are render-owned, so ` +
      'a cheap read here is the proof this bench ran on the render thread. This figure ' +
      'says it did NOT, and the whole table above is therefore an off-thread reading — ' +
      'do not use it for the ceiling design.',
  ).toBeLessThan(10);

  // THE GATE — the same platform property the Rooibos spec pins from off-thread.
  // A render-thread read of a render-owned node must be cheap, or a production
  // ledger is unaffordable everywhere and the cost model is wrong.
  expect(
    localNodeUs,
    `a thread-local node field read cost ${localNodeUs} us on the render thread`,
  ).toBeLessThan(10);
});
