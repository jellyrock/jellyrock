/**
 * Vitest globalSetup — a guard, not a lifecycle.
 *
 * Deploy and the device-registry snapshot/restore live in
 * [`scripts/rta-run.js`](../../../scripts/rta-run.js), the parent process that
 * runs Vitest as a child. They cannot live in here: Vitest's reporter installs a
 * `SIGINT` handler that calls `process.exit()` on a 1 ms timer, so a ~30 s
 * restore armed anywhere inside the Vitest process — globalSetup included — is
 * racing an exit it cannot win. See that file for the evidence.
 *
 * What is left here is the thing that file cannot do for itself: refuse a bare
 * `vitest --config vitest.rta.config.js`. That invocation would drive a real
 * device with no snapshot taken and no restore to come, and the failure is
 * silent — you find out when you next open the app and it is signed into the
 * demo server. Better a loud refusal than a stranded device.
 */
export async function setup() {
  if (process.env.RTA_RUNNER === '1') return;

  throw new Error(
    'RTA specs must be run through `npm run test:rta` (or :fast / :capture / :tdd).\n' +
      'Those go through scripts/rta-run.js, which snapshots the device registry before\n' +
      'seeding and restores it afterwards — including on Ctrl-C. Running vitest directly\n' +
      'skips that entirely and leaves the device signed into the demo server.',
  );
}
