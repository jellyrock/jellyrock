import { defineConfig } from 'vitest/config';

// Dedicated config for the on-device RTA functional tests. Kept separate from
// vitest.config.js (Node-side scripts tests) so `npm run test:scripts` never
// tries to drive a device, and so these can have device-appropriate settings:
// serial execution against ONE device, long timeouts, and a once-per-run deploy.
export default defineConfig({
  test: {
    include: ['tests/rta/specs/**/*.spec.js'],
    globals: false,
    globalSetup: ['tests/rta/setup/global-setup.js'], // deploy once (main process)
    setupFiles: ['tests/rta/setup/env-setup.js'], // RTA env per worker
    // A test must have room to reach its OWN timeout: a wait that gives up throws through
    // `diagnosedError` and reports the device state it saw, whereas a Vitest timeout reports
    // nothing at all — so the budget here has to stay clear of the worst-case gate chain, or
    // the suite loses its best diagnostic exactly when it needs it. `screen "settings"` is the
    // longest: hardRelaunch 14s (exitMs + bootMs) + waitHome 65s (45s login + 20s rows) +
    // walkHomeToFirstRow 10s + overhang focus 15s + version label 20s + 1s settle = ~125s.
    // The OSD playback wait alone is ~90s. Re-do this arithmetic when a gate's timeout moves.
    testTimeout: 180_000,
    hookTimeout: 120_000, // deploy + boot in globalSetup/beforeAll
    // One real device — everything must run serially (Vitest 4: no poolOptions).
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    sequence: { concurrent: false },
  },
});
