/**
 * Is the FIXTURE SERVER healthy? — a probe that only ever reports, never decides.
 *
 * ## Why this exists
 *
 * The suite's charter is that every failure is attributable to app vs. harness vs.
 * FIXTURE, and the third had no instrument. A red run against a degraded demo server
 * looked exactly like a red run against broken code, so each occurrence was re-argued
 * from memory rather than read off the record. Recorded 2026-09-06, when three runs in
 * one hour went red or blocked while the fixture was demonstrably unwell — one `blocked`
 * on auth transport errors, and one where Home rendered signed-in with ZERO rows, which
 * no nav or focus defect produces.
 *
 * ## Why it does not reuse `lib/jellyfin.js`
 *
 * Every request helper there routes failures through `fail()`, which records a
 * `SERVER_REQUEST_FAILED` — and `rta-run.js` reads exactly those to downgrade a red run
 * to `blocked`. A probe built on them would let INSTRUMENTATION change a run's verdict,
 * which is the one thing an instrument must never do. So this speaks plain `node:https`
 * and records nothing: it returns a reading, and the caller decides what it means.
 *
 * ## Why it cannot throw and cannot hang
 *
 * A probe that throws would fail the run it was measuring; a probe that hangs would BE
 * the outage it was looking for. `rta-odc-connect-unbounded` is the same lesson one layer
 * over: an unbounded call against an unhealthy endpoint is how a 39-minute wedge happens.
 * Every path here resolves, once, inside `timeoutMs`.
 *
 * @param {string} baseUrl - the fixture root, e.g. `https://demo.jellyfin.org/stable`
 * @param {{phase?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{phase: string, at: string, ok: boolean, status: number|null, ms: number, error?: string}>}
 */
import https from 'node:https';
import http from 'node:http';

export function probeFixture(baseUrl, { phase = 'probe', timeoutMs = 10000 } = {}) {
  const at = new Date().toISOString();
  const started = Date.now();
  const done = (extra) => ({ phase, at, ms: Date.now() - started, ...extra });

  return new Promise((resolve) => {
    let settled = false;
    // Belt-and-braces, NOT load-bearing: `resolve` is already idempotent, so a late answer
    // racing the timeout cannot overwrite the first reading whether this flag is here or
    // not. Proven by mutation 2026-09-06 — deleting the guard failed no test, because
    // there is no behaviour to fail. It stays as a statement that late callbacks are
    // EXPECTED on this path (`req.destroy()` in the timeout handler fires `error`), and it
    // is what keeps that true if `finish` ever grows a side effect.
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    let url;
    try {
      url = new URL('System/Info/Public', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    } catch (e) {
      // A malformed server URL is a reading too — and reporting it beats throwing at a
      // caller who only asked how the fixture was doing.
      finish(done({ ok: false, status: null, error: `bad server url: ${e.message}` }));
      return;
    }

    const mod = url.protocol === 'http:' ? http : https;
    const req = mod.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      // Drain, or the socket stays open and the process will not exit on its own.
      res.resume();
      res.on('end', () =>
        finish(
          done({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode ?? null,
          }),
        ),
      );
    });
    req.on('timeout', () => {
      req.destroy();
      finish(done({ ok: false, status: null, error: `no answer within ${timeoutMs}ms` }));
    });
    // `code` before `message` because the code is the stable, greppable half — and a TLS
    // message can carry the certificate's names, which is more than a health reading needs.
    req.on('error', (e) => finish(done({ ok: false, status: null, error: e.code || e.message })));
    req.end();
  });
}
