// Vitest config — JS unit tests for scripts/.
//
// Scope: tests/scripts/**/*.test.js (mirrors tests/source/unit/ layout).
// Test files are ESM (.js) regardless of whether the script-under-test is
// `.cjs` or `.js`; Vitest handles cross-module-system imports transparently.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/scripts/**/*.test.js'],
    // Globals off — tests import { describe, it, expect } from 'vitest'
    // explicitly. Cleaner, plays nicer with ESLint's no-undef.
    globals: false,
    reporters: ['default'],
    // Per-test timeout. BSC plugin tests spin up a Program; allow headroom.
    testTimeout: 10_000,
  },
});
