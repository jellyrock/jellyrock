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
    testTimeout: 120_000, // OSD playback wait alone can take ~90s
    hookTimeout: 120_000, // deploy + boot in globalSetup/beforeAll
    // One real device — everything must run serially (Vitest 4: no poolOptions).
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    sequence: { concurrent: false },
  },
});
