// tests/rta/lib/timeout.js — bound a promise that may never settle.
//
// Its own leaf module, importing nothing, because three callers on both sides of an
// import cycle need it. `driver.js` imports `steps.js` (for `sleep`) and `steps.js`
// imports `diagnostics.js` (for `diagnosedError`), so `diagnostics.js` cannot import
// back from `driver.js` where this used to live. Same mechanical reason `home-list.js`
// is its own module; `driver.js` re-exports this one so its existing importers
// (`registry.js`, `scripts/measure-signin.js`) did not have to move.

/**
 * Race `promise` against a wall clock, so an unbounded wait fails with a DIAGNOSIS.
 *
 * Exported because the deploy is not the only step here that can wait forever, and the
 * second caller proved the shape general rather than deploy-specific. RTA's own timeouts
 * do not cover this class: `sendRequest` races the request against `getTimeOut(options)`,
 * but it `await`s `setupClientSocket()` FIRST — and that promise only self-rejects on
 * `ECONNREFUSED`/`EPIPE`. A connect to port 9000 that neither connects nor errors leaves
 * it unsettled, and `clientSocketPromise` is cached, so it stays that way. Read out of
 * `client/dist/OnDeviceComponent.js` on 2026-08-16, not inferred from a symptom.
 *
 * So a caller that needs a bound on "the on-device component answers at all" has to put
 * it OUTSIDE the ODC call. That is what this is for.
 *
 * @param {Promise} promise the work to bound.
 * @param {number} ms the cap.
 * @param {string} message what to throw — say the likely CAUSE, not just the elapsed time.
 */
export async function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    // Never hold the process open on the timer alone.
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
