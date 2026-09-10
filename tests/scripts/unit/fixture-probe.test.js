/**
 * Gate on the one property that matters for an INSTRUMENT: it reports, it never decides.
 *
 * `probeFixture` runs on the fixture path of every RTA run. If it could throw it would
 * fail the run it was measuring; if it could hang it would BE the outage it was looking
 * for. Both are tested here against a local server rather than the demo host, so the
 * suite stays offline and deterministic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { probeFixture } from '../../../scripts/lib/fixture-probe.js';

let server;
const listen = (handler) =>
  new Promise((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`));
  });

afterEach(() => {
  server?.close();
  server = undefined;
});

describe('probeFixture', () => {
  it('reports ok for a 2xx, with the status and a duration', async () => {
    const url = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"Id":"x"}');
    });
    const r = await probeFixture(url, { phase: 'start' });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.phase).toBe('start');
    expect(typeof r.ms).toBe('number');
    expect(r.error).toBeUndefined();
  });

  it('reports NOT ok for a non-2xx without throwing — a sick fixture is a reading', async () => {
    const url = await listen((_req, res) => {
      res.writeHead(503);
      res.end('down');
    });
    const r = await probeFixture(url, { phase: 'end' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  it('requests the PUBLIC info endpoint, so it needs no credentials', async () => {
    let seen;
    const url = await listen((req, res) => {
      seen = req.url;
      res.writeHead(200);
      res.end('{}');
    });
    await probeFixture(url);
    expect(seen).toBe('/System/Info/Public');
  });

  it('joins the path correctly whether or not the base url ends in a slash', async () => {
    const paths = [];
    const url = await listen((req, res) => {
      paths.push(req.url);
      res.writeHead(200);
      res.end('{}');
    });
    await probeFixture(url.replace(/\/$/, ''));
    await probeFixture(url);
    expect(paths).toEqual(['/System/Info/Public', '/System/Info/Public']);
  });

  it('resolves — never rejects — on a malformed server url', async () => {
    const r = await probeFixture('not a url', { phase: 'start' });
    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
    expect(r.error).toMatch(/bad server url/);
  });

  // NOTE: there is deliberately no test for "settles once when a late answer races the
  // timeout". `resolve` is idempotent, so that behaviour holds with or without the guard
  // in the source — a test for it passes either way and proves nothing. Mutation caught it
  // as vacuous on 2026-09-06, which is the same defect class the suite's own gates are
  // audited for; the guard's comment records why it stays anyway.
  it('gives up on its own deadline rather than hanging the run it measures', async () => {
    // A server that accepts and never answers is the shape `rta-odc-connect-unbounded`
    // documents one layer over: an unbounded call against a wedged endpoint is how a
    // 39-minute stall happens. The probe must own its own clock.
    const url = await listen(() => {});
    const started = Date.now();
    const r = await probeFixture(url, { phase: 'end', timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no answer within 300ms/);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
