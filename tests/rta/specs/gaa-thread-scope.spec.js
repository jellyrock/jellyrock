/**
 * What is `GetGlobalAA()` actually scoped to?
 *
 * The task ledger wanted to live there: appending costs nothing measurable, against
 * 555.7 us per launch for the `m.global` node-field round-trip it replaced. That is a
 * ~500x difference, so it was worth knowing exactly what GetGlobalAA shares.
 *
 * ## The answer, and the mistake that nearly shipped
 *
 * It is scoped per COMPONENT, not per thread.
 *
 * The first version of this spec only compared a render-thread component against a
 * Task thread, and both sentinels came back empty in both directions. That was read
 * as "per thread" — but the experiment varied the THREAD and the COMPONENT at the
 * same time, so it could not tell the two explanations apart. The ledger was built on
 * the wrong one, and the symptom was the peak gate reading 0 live threads while the
 * app was plainly running several.
 *
 * `selfLaunchAndCount` is the discriminator that was missing: it holds the thread
 * fixed (render) and the component fixed, launching through `launchTask` and reading
 * the count back in the same component. It reads 1 where two render-thread components
 * read each other as 0.
 *
 * Kept as a regression gate because the conclusion is load-bearing: if a future Roku
 * OS made GetGlobalAA thread-scoped, the ledger could move there and get ~500x
 * cheaper, and this is the check that would notice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { odc } from '../lib/driver.js';
import { sleep } from '../lib/steps.js';

const BENCH = '#gaaProbeBench';

function field(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(obj)) if (k.toLowerCase() === want) return v;
  return undefined;
}

async function call(funcName) {
  const { value } = await odc.callFunc(
    { base: 'scene', keyPath: BENCH, funcName },
    { timeout: 15000 },
  );
  return value;
}

beforeAll(async () => {
  for (let i = 0; i < 120; i++) {
    const res = await odc.getValue({ base: 'scene', keyPath: '' }).catch(() => ({ found: false }));
    if (res.found) break;
    await sleep(500);
  }
  await odc.createChild({
    base: 'scene',
    keyPath: '',
    subtype: 'TaskLedgerBench',
    fields: { id: 'gaaProbeBench' },
  });
});

afterAll(async () => {
  await odc.removeNode({ base: 'scene', keyPath: BENCH }).catch(() => {});
});

it('determines whether GetGlobalAA is shared across threads', async () => {
  const started = await call('gaaProbe');
  expect(started, 'the probe Task did not start').toBeTruthy();

  // Poll until the Task has actually finished. Reading before it runs would produce
  // an empty result that looks exactly like "not shared" — the failure this spec
  // exists to avoid, so it is gated on the Task's own state rather than a sleep.
  let result = null;
  for (let i = 0; i < 40; i++) {
    result = await call('gaaProbeResult');
    if (field(result, 'taskState') === 'stop') break;
    await sleep(250);
  }

  const taskState = field(result, 'taskState');
  const taskSaw = field(result, 'taskSawRenderSentinel');
  const renderSaw = field(result, 'renderSeesTaskSentinel');
  const shared = taskSaw === 'render-wrote-this' && renderSaw === 'task-wrote-this';

  const outFile = path.join(
    process.cwd(),
    '.device-runs',
    `gaa-thread-scope-${process.env.ROKU_IP ?? 'unknown'}.json`,
  );
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ taskState, taskSaw, renderSaw, shared }, null, 2));

  // SEPARATE "per thread" from "per component". The result above varies BOTH at
  // once, so on its own it cannot tell them apart — and the task ledger reading 0
  // across two render-thread components says the distinction matters.
  const self = await call('selfLaunchAndCount');
  const countInside = field(self, 'countInsideThisComponent');
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      { taskState, taskSaw, renderSaw, shared, selfLaunchCountInsideComponent: countInside },
      null,
      2,
    ),
  );

  // The Task must have RUN for either answer to mean anything.
  expect(
    taskState,
    `probe Task never reached "stop" (state=${taskState}), so an empty sentinel would ` +
      'mean "did not run", not "not shared"',
  ).toBe('stop');
});
