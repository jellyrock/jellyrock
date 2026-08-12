/**
 * Hardware-free gate on the REST helpers' failure contract and on session identity.
 *
 * Both properties here were defects that shipped, and neither was catchable by
 * reading the code — each produced a plausible, self-consistent result:
 *
 *  - Every authenticated helper ended in `.catch(() => null)`, so a 401 returned the
 *    same value as a successful query that found nothing. The worst reachable case
 *    was `getLibraries`: it runs once in `beforeAll`, and its `[]` drives
 *    `screens.spec.js`'s legitimate "the fixture has no such library" skip. One
 *    swallowed 401 there skipped every view-based screen and reported the run GREEN.
 *  - Every caller authenticated as the literal DeviceId `"jellyrock-screenshots"`,
 *    and Jellyfin evicts a session when a second one is minted under the same
 *    DeviceId. Two tools, or one tool on two devices, logged each other out.
 *
 * These run against a real local HTTP server rather than a mock of our own module:
 * the thing under test is what happens to a REAL non-2xx on the wire, and a stub
 * that resolves/rejects on command would assert the test's own idea of failure.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
  JellyfinRequestError,
  authenticate,
  findMovie,
  getJson,
  getLibraries,
  isRequestError,
  sessionDeviceId,
} from './jellyfin.js';
import { FAILURE_KINDS, readFailures } from '../../../scripts/run-record.js';

/** Routes keyed by pathname prefix; each returns [status, body]. Set per test. */
let routes = {};
let server;
let base;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const key = Object.keys(routes).find((k) => req.url.startsWith(k));
    const [status, body] = key ? routes[key] : [404, { error: 'no route' }];
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

// Records land in the run's failures.jsonl; point that at a temp dir so a test run
// never appends to a real run's record.
let runDir;
beforeEach(() => {
  routes = {};
  runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyfin-test-'));
  process.env.RTA_RUN_DIR = runDir;
});
afterEach(() => {
  delete process.env.RTA_RUN_DIR;
  fs.rmSync(runDir, { recursive: true, force: true });
});

const session = (over = {}) => ({
  serverUrl: base,
  userId: 'u1',
  token: 't1',
  ...over,
});

describe('a failed request is never an empty result', () => {
  it('getLibraries THROWS on 401 instead of returning [] — the false-skip regression', async () => {
    // THE case. `[]` here is indistinguishable from "this server has no libraries",
    // which screens.spec.js reads as a fixture statement and converts into a skip.
    // A green run built on a dead session is worse than any red one.
    routes['/Users/'] = [401, { error: 'unauthorized' }];

    await expect(getLibraries(session())).rejects.toThrow(JellyfinRequestError);
  });

  it('surfaces the status and flags an auth failure as such', async () => {
    routes['/Users/'] = [401, {}];

    const err = await getLibraries(session()).catch((e) => e);
    expect(isRequestError(err)).toBe(true);
    expect(err.status).toBe(401);
    expect(err.isAuth).toBe(true);
    expect(err.url).toContain('/Users/u1/Views');
  });

  it('treats 403 as an auth failure and 500 as not one', async () => {
    routes['/Users/'] = [403, {}];
    expect((await getLibraries(session()).catch((e) => e)).isAuth).toBe(true);

    routes['/Users/'] = [500, {}];
    const err = await getLibraries(session()).catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.isAuth).toBe(false);
  });

  it('still reports genuine absence from a request that SUCCEEDED', async () => {
    // The other half of the contract, and the reason this is not just "throw on
    // everything": an empty library is a fact a caller may act on. Only a request
    // that never answered is disqualified from producing one.
    routes['/Users/'] = [200, { Items: [] }];
    await expect(getLibraries(session())).resolves.toEqual([]);

    routes['/Items'] = [200, { Items: [{ Name: 'Some Other Film', Id: 'x' }] }];
    await expect(findMovie(session(), 'Dracula')).resolves.toEqual({
      index: 0,
      id: '',
      backdropUrl: '',
    });
  });

  it('records the failure into the run record, so the cause outlives the frame', async () => {
    // A 401 inside a helper surfaces several frames away as an assertion failure.
    // Written down here or not at all — this is what lets the run be marked
    // `blocked` rather than counted as app flake.
    routes['/Users/'] = [401, {}];
    await getLibraries(session()).catch(() => {});

    const recorded = readFailures(path.join(runDir, 'failures.jsonl'));
    expect(recorded).toHaveLength(1);
    expect(recorded[0].kind).toBe(FAILURE_KINDS.SERVER_REQUEST_FAILED);
    expect(recorded[0].status).toBe(401);
    expect(recorded[0].isAuth).toBe(true);
  });

  it('reports a transport error with no status rather than swallowing it', async () => {
    // Nothing listening: the request never gets a status at all. `status: null` is
    // the honest answer, and it must still be an error rather than empty data.
    const err = await getJson('http://127.0.0.1:1/Anything', {}).catch((e) => e);
    expect(isRequestError(err)).toBe(true);
    expect(err.status).toBeNull();
  });
});

describe('sessionDeviceId', () => {
  const KEY_A = 'ac4701ca4a5d8a0b';
  const KEY_B = '1f9118827848036c';

  it('separates two TOOLS on one device', () => {
    // capture-screenshots and an RTA run against the same Roku.
    expect(sessionDeviceId('rta', KEY_A)).not.toBe(sessionDeviceId('screenshots', KEY_A));
  });

  it('separates one TOOL across two devices', () => {
    // The case device-lock.js cannot serialize, and the one the two-suite contention
    // experiment requires: two Rokus driven at once.
    expect(sessionDeviceId('rta', KEY_A)).not.toBe(sessionDeviceId('rta', KEY_B));
  });

  it('is stable for the same role and device', () => {
    // Stable, not random-per-process, so the demo server reuses one session instead
    // of accumulating one per invocation.
    expect(sessionDeviceId('rta', KEY_A)).toBe(sessionDeviceId('rta', KEY_A));
  });

  it('names the role in the id so a session list is readable', () => {
    expect(sessionDeviceId('screenshots', KEY_A)).toMatch(/^jellyrock-screenshots-/);
  });

  it('falls back to a HASH of ROKU_IP when no device key is known', () => {
    // The degraded-lock path. Hashed rather than raw: this string is sent to a
    // third-party server, and a LAN address is the device's own business.
    const prevKey = process.env.RTA_DEVICE_KEY;
    delete process.env.RTA_DEVICE_KEY;
    process.env.ROKU_IP = '192.168.1.177';
    try {
      const id = sessionDeviceId('rta');
      expect(id).not.toContain('192.168.1.177');
      expect(id).toBe(sessionDeviceId('rta'));
      process.env.ROKU_IP = '192.168.1.178';
      expect(sessionDeviceId('rta')).not.toBe(id);
    } finally {
      delete process.env.ROKU_IP;
      if (prevKey !== undefined) process.env.RTA_DEVICE_KEY = prevKey;
    }
  });

  it('prefers an explicit key over the environment', () => {
    const prev = process.env.RTA_DEVICE_KEY;
    process.env.RTA_DEVICE_KEY = KEY_B;
    try {
      expect(sessionDeviceId('rta', KEY_A)).toContain(KEY_A);
    } finally {
      if (prev === undefined) delete process.env.RTA_DEVICE_KEY;
      else process.env.RTA_DEVICE_KEY = prev;
    }
  });
});

describe('authenticate', () => {
  it('sends the per-role DeviceId and returns it on the session', async () => {
    // The header is the whole point: it is what the server keys the session to, and
    // what stops two clients evicting each other.
    let seen;
    routes['/Users/AuthenticateByName'] = [
      200,
      { User: { Id: 'u1', Name: 'demo' }, AccessToken: 'tok', ServerId: 's1' },
    ];
    const prev = server.listeners('request')[0];
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      if (req.url.includes('AuthenticateByName')) seen = req.headers.authorization;
      prev(req, res);
    });

    const s = await authenticate(
      { url: base, username: 'demo', password: '' },
      { role: 'rta', deviceKey: 'devkey1' },
    );

    expect(seen).toContain('DeviceId="jellyrock-rta-devkey1"');
    expect(s.deviceId).toBe('jellyrock-rta-devkey1');

    server.removeAllListeners('request');
    server.on('request', prev);
  });
});
