/**
 * Is the RTA on-device component THERE? — one TCP round trip, and no RTA client involved.
 *
 * ## Why this is a raw socket and not an ODC call
 *
 * The obvious way to test for the component's ABSENCE is to make an ODC call and expect it
 * to fail. That does not work, and the way it fails is worth stating because it has now
 * bitten this repo twice and the first write-up of it stopped one step short.
 *
 * RTA's `setupClientSocket` retries `ECONNREFUSED` once a second and rejects its CACHED
 * `clientSocketPromise` when its own connect timeout expires
 * (`OnDeviceComponent.js:989-1000`). It then ORPHANS that rejection: line 1080 attaches a
 * `.finally()` to clear the cache and never handles the promise `.finally()` RETURNS. So
 * the rejection goes unhandled no matter what the caller does — and an unhandled rejection
 * is a hard process exit on every Node this repo runs.
 *
 * Measured 2026-09-06 against the real client, no device: a caller that awaits, catches,
 * and carries on still dies with `exit 1` from `OnDeviceComponent.js:993`, at whatever
 * later point the connect gives up. Proven by control — patching a `.catch()` onto that one
 * derived promise removes the crash and nothing else changes. The orphan is unreachable
 * from our code (`setupClientSocket` returns the ORIGINAL promise), so no `try`/`catch` and
 * no `withTimeout` can prevent it. Tracked upstream as `docs/signals-backlog.md` →
 * `rta-odc-connect-hang`.
 *
 * The earlier sighting is the same defect read one step short: 2026-08-17, both plain-arm
 * blocks of the ODC calibration passed their probe, printed "identity asserted by
 * ENCLOSURE", asserted tier 1 — and then died mid-series with `Failed to connect to Roku
 * ... on port 9000`, recorded `crashed`, no record written. That was attributed to a caller
 * having given up waiting on the promise; the control above shows giving up was never
 * required.
 *
 * So the absence is tested WITHOUT RTA's client. A TCP connect to the port answers the one
 * question that matters — is the component there — in one round trip instead of a timeout,
 * and leaves no promise behind to kill the process later.
 *
 * ## Why it lives here rather than in either caller
 *
 * Two subsystems ask it from opposite sides of a boundary: `scripts/measurement-guard.js`
 * proves a measurement arm has NO component, and `tests/rta/lib/driver.js` proves one IS
 * there before a run's first ODC call. Neither can own it — the RTA lib importing
 * `measurement-guard.js` would drag the measurement-identity module, `device-lock.js` and a
 * synchronous `roku-hardware.json` read into every suite startup for a 15-line socket
 * probe. Same argument and same shape as `process-liveness.cjs`.
 *
 * `.js` rather than the `.cjs` that `scripts/CLAUDE.md` defaults `scripts/lib/` to: that
 * rule exists because CJS cannot `require()` ESM, and both callers here are ESM with no
 * `.cjs` requiring them. `fixture-probe.js` takes the same exception.
 */
import net from 'node:net';

/** The port RTA's on-device component listens on. Its default; nothing here overrides it. */
export const ODC_PORT = 9000;

/**
 * Is the on-device component RESIDENT — i.e. is anything listening on its port?
 *
 * ⚠️ It says "something is listening", NOT "the ODC is healthy", and the gap is measurable
 * rather than theoretical: against a server that accepts the connection and never answers
 * the handshake, this returns `true` in ~1 ms while an ODC call hangs indefinitely (45 s+
 * with no bound at all, measured 2026-09-06). That is the right strength for a PRECONDITION
 * and the wrong one for a liveness check — a caller that needs the component to actually
 * ANSWER has to bound the call as well. `ensureOdcReachable` in `tests/rta/lib/driver.js`
 * pairs the two; `readIdentity` in `scripts/measurement-guard.js` is the measurement
 * subsystem's answer to the same gap.
 *
 * Never rejects, so a caller cannot be taken out by the probe itself.
 */
export function odcIsResident(host, { port = ODC_PORT, timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const settle = (resident) => {
      socket.destroy();
      resolve(resident);
    };
    // A connect that hangs is neither a refusal nor an answer. Resolved as NOT resident
    // deliberately: this probe's job is to let the no-ODC arm proceed, and a port that
    // will not complete a handshake cannot be an on-device component serving requests.
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.on('connect', () => settle(true));
    socket.on('error', () => settle(false));
  });
}
