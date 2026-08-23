/**
 * What does the Task-thread ceiling actually add to opening ItemDetails?
 *
 * The bench answers "what does one recordTaskLaunch call cost" (555.7 us at ledger
 * depth 10 on a Stick 4K). Turning that into a screen cost needs the number of
 * launches that screen really performs — and the figure floating around this project
 * is "38", which came from counting `launchTask()` CALL SITES in ExtrasRowList. A
 * call site is not a runtime launch. This measures the screen instead of multiplying.
 *
 * `#if perfTiming` accumulates elapsed microseconds and a launch count inside
 * `admitTaskLaunch` — the `cellLoadInstrumentUs` precedent, including its trap: the
 * roTimespan is cached, never created per call, because a fresh one costs ~22 us and
 * would dwarf what it is timing.
 *
 * Reported, not asserted. It is a cost reading whose value is the number; pinning it
 * would make it fail on any fixture but this one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { odc, hardRelaunch } from '../lib/driver.js';
import { sleep, waitHome } from '../lib/steps.js';
import { navMovieDetails } from '../lib/nav.js';

const BENCH = '#ledgerCostBench';
let ctx;

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
  const session = await authenticate(RTA_CONFIG.server);
  ctx = { libraries: await getLibraries(session) };
  const expectedServer = await seedHome(session, RTA_CONFIG.languages[0]);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'ledger screen cost');
  await waitHome();
  await odc.createChild({
    base: 'scene',
    keyPath: '',
    subtype: 'TaskLedgerBench',
    fields: { id: 'ledgerCostBench' },
  });
});

afterAll(async () => {
  await odc.removeNode({ base: 'scene', keyPath: BENCH }).catch(() => {});
});

it('reports what the ceiling costs a real ItemDetails open', async () => {
  // Zero AT the grid, so the window covers only the details screen and its extras
  // rows — not Home's bootstrap launches, which would otherwise be charged to it.
  const wasReset = await call('resetLedgerCost');
  expect(wasReset, 'build carries no perfTiming ledger instrument').toBeTruthy();

  await navMovieDetails(ctx);
  await sleep(3000); // let the extras rows finish launching

  const cost = await call('ledgerCost');
  const us = field(cost, 'us');
  const launches = field(cost, 'launches');
  const perLaunch = launches > 0 ? us / launches : 0;

  const outFile = path.join(
    process.cwd(),
    '.device-runs',
    `ledger-screen-cost-${process.env.ROKU_IP ?? 'unknown'}.json`,
  );
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      {
        device: process.env.ROKU_IP ?? 'unknown',
        server: RTA_CONFIG.server.url,
        screen: 'ItemDetails (movie, incl. extras rows)',
        launches,
        totalUs: us,
        totalMs: Math.round((us / 1000) * 100) / 100,
        perLaunchUs: Math.round(perLaunch * 10) / 10,
      },
      null,
      2,
    ),
  );

  // It must have RECORDED launches for the number to mean anything — 0 launches
  // would report 0 ms and read as "free" rather than "not measured".
  expect(launches, 'no launches were recorded during the ItemDetails open').toBeGreaterThan(0);
});
