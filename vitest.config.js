// Vitest config: hardware-free JS unit tests.
//
// Scope: tests/scripts/**/*.test.js plus tests/rta/**/*.test.js, the pure-JS
// parts of the RTA harness (for example the registry diff/restore planner and
// the failure-kind registry). The `.test.js` / `.spec.js` split matters:
// `.spec.js` under tests/rta/specs/ drives a real device and runs under
// vitest.rta.config.js, so it must never be picked up here.
//
// Test files are ESM (.js) regardless of whether the script-under-test is
// `.cjs` or `.js`; Vitest handles cross-module-system imports transparently.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/scripts/**/*.test.js', 'tests/rta/**/*.test.js'],
    // Fails the run if the suite wrote into `.device-runs/`, which belongs to
    // real device runs. See that file for the leak it was written against.
    globalSetup: ['tests/scripts/setup/no-durable-writes.js'],
    // Keep the developer's ~/.config/jellyrock/env out of these tests, so a result does not
    // depend on whose machine ran it (scripts/lib/env-config.cjs). The device suites use
    // vitest.rta.config.js, which does not set this, because they need that file.
    env: { JELLYROCK_USER_ENV: 'off' },
    // Globals off: tests import { describe, it, expect } from 'vitest'
    // explicitly. Cleaner, plays nicer with ESLint's no-undef.
    globals: false,
    reporters: ['default'],
    // Per-test timeout. BSC plugin tests spin up a Program; allow headroom.
    testTimeout: 10_000,
  },
});
