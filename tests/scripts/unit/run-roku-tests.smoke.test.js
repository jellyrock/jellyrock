// Smoke test for scripts/run-roku-tests.js.
//
// The script deploys a build to a real Roku device. Full coverage would
// require either a Roku at test time or extensive mocking of roku-deploy.
// This test verifies the env-var guard: missing ROKU_IP / ROKU_PASSWORD
// should fail fast with exit 1 and a clear message.

import { describe, it, expect } from 'vitest';
import { spawnScript } from './_helpers/spawn-script.js';

describe('run-roku-tests (smoke)', () => {
  it('exits 1 with a clear message when ROKU_IP is missing', () => {
    const { exitCode, stderr } = spawnScript('scripts/run-roku-tests.js', [], {
      env: { ROKU_IP: '', ROKU_PASSWORD: 'secret', PATH: process.env.PATH },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Missing required environment variables/);
  });

  it('exits 1 with a clear message when ROKU_PASSWORD is missing', () => {
    const { exitCode, stderr } = spawnScript('scripts/run-roku-tests.js', [], {
      env: { ROKU_IP: '192.168.1.1', ROKU_PASSWORD: '', PATH: process.env.PATH },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Missing required environment variables/);
  });
});
