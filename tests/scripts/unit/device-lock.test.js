// Tests for scripts/device-lock.js — the shared-Roku mutex.
//
// Everything here runs against a stubbed `fetch`, so no device and no network.
// What is worth testing is the PROTOCOL, not the HTTP: who wins a CAS race, what
// happens when GitHub is unreachable, and — the case that motivated the module —
// that a local run yields to an in-flight CI device job even after it has already
// published its own ref.
//
// The GitHub behaviours these stubs encode were verified against the real API on
// 2026-08-10 (see the module header): 201 on create, 422 "Reference already
// exists" on a conflicting create, 204 on delete.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REPO = 'jellyrock/jellyrock';
const DEVICE = '192.168.1.177'; // how we REACH it — the shared dev device
const DEVICE_ID = 'S09042179A2U'; // who it IS — the real .177 Stick 4K's ECP device-id
/** What the ref is actually named: a hash, never the raw id (the repo is public). */
const lockKey = (id) => createHash('sha256').update(id).digest('hex').slice(0, 16);
const DEVICE_KEY = lockKey(DEVICE_ID);

/**
 * A fake GitHub with just enough surface for the lock: one ref namespace, a tag
 * object store, and a list of in-progress workflow runs.
 */
function fakeGitHub({ refs = new Map(), tags = new Map(), failWith = null } = {}) {
  let tagSeq = 0;
  const calls = [];
  const handler = async (rawPath, opts = {}) => {
    const method = opts.method || 'GET';
    const pathname = rawPath.replace(`/repos/${REPO}`, '');
    calls.push(`${method} ${pathname}`);
    if (failWith) throw new Error(failWith);

    const reply = (status, json) => ({ status, json });
    // `body` arrives as an OBJECT: the transport seam sits above serialisation,
    // so httpsTransport is what would JSON.stringify it on the wire.
    const body = opts.body;

    if (pathname === '/git/ref/heads/main') {
      return reply(200, { object: { sha: 'mainsha' } });
    }
    if (pathname === '/git/tags' && method === 'POST') {
      const sha = `tag${++tagSeq}`;
      tags.set(sha, { message: body.message, tagger: { date: body.tagger.date } });
      return reply(201, { sha });
    }
    if (pathname.startsWith('/git/tags/')) {
      const sha = pathname.split('/').pop();
      return tags.has(sha) ? reply(200, tags.get(sha)) : reply(404, {});
    }
    if (pathname === '/git/refs' && method === 'POST') {
      const name = body.ref.replace('refs/', '');
      if (refs.has(name)) return reply(422, { message: 'Reference already exists' });
      refs.set(name, body.sha);
      return reply(201, { ref: body.ref });
    }
    if (pathname.startsWith('/git/ref/device-lock/')) {
      const name = pathname.replace('/git/ref/', '');
      return refs.has(name)
        ? reply(200, { object: { sha: refs.get(name), type: 'tag' } })
        : reply(404, {});
    }
    if (pathname.startsWith('/git/refs/device-lock/') && method === 'DELETE') {
      refs.delete(pathname.replace('/git/refs/', ''));
      return reply(204, null);
    }
    // Tripwire. The module used to poll the Actions API to yield to in-flight CI
    // runs; that was removed once a LAN sweep showed CI runs on its own Roku, so
    // the check only ever blocked a developer from a device CI wasn't using.
    // Throwing here turns a re-introduction into a test failure rather than a
    // silent behaviour change. See the module header.
    if (pathname.startsWith('/actions/')) {
      throw new Error('device-lock must not call the Actions API');
    }
    return reply(404, {});
  };
  return { handler, refs, tags, calls };
}

/**
 * Genuinely tokenless: dropping GITHUB_TOKEN is not enough, because getToken()
 * falls back to `gh auth token` and this repo's developers are logged in. Empty
 * PATH makes that lookup fail the way it would on a runner with no gh.
 */
async function goTokenless() {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  process.env.PATH = '';
  vi.resetModules();
  mod = await import('../../../scripts/device-lock.js');
  installNetworkGuard();
}

/**
 * Default every test to a transport that THROWS. Without this, a test that
 * forgets its stub silently falls through to the real https transport and starts
 * creating refs on the live repo — which happened during development when the
 * module moved off `fetch` and the old `stubGlobal('fetch')` doubles went inert.
 */
function installNetworkGuard() {
  mod._internals.setTransport(() => {
    throw new Error('device-lock test made an unstubbed network call');
  });
  // No Roku on the LAN during unit tests; the lock resolves its ref key from the
  // device's ECP identity, so that lookup gets stubbed too.
  mod._internals.setDeviceIdLookup(async () => DEVICE_ID);
}

let mod;
let realPath;
beforeEach(async () => {
  realPath = process.env.PATH;
  vi.resetModules();
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.GITHUB_REPOSITORY = REPO;
  delete process.env.GITHUB_ACTIONS;
  delete process.env.RTA_REQUIRE_LOCK;
  delete process.env.RTA_SKIP_LOCK;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mod = await import('../../../scripts/device-lock.js');
  installNetworkGuard();
});

afterEach(() => {
  process.env.PATH = realPath;
  vi.restoreAllMocks();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;
});

describe('device-lock: acquiring', () => {
  it('takes the lock on a free device and reports it held', async () => {
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);

    const lock = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });

    expect(lock.held).toBe(true);
    expect(lock.degraded).toBe(false);
    // Keyed by a HASH of the device's identity — not its address, not the raw id.
    expect(gh.refs.has(`device-lock/${DEVICE_KEY}`)).toBe(true);
  });

  it('releases the ref so the next contender can take it', async () => {
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);

    const first = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });
    await first.release();
    expect(gh.refs.size).toBe(0);

    const second = await mod.acquireDeviceLock({ what: 'test:unit', deviceHost: DEVICE });
    expect(second.held).toBe(true);
  });

  it('still refuses when the CAS conflicts but the follow-up read comes back stale', async () => {
    // Regression: GitHub's ref READ is eventually consistent while the CAS is
    // not. Measured 2026-08-10 against the real API — a read of an aged ref
    // (the shape of a real 10-25min hold) returned stale 2/24 times, while the
    // create path returned 422 reliably every time.
    //
    // So "422, then a read that says free" means the READ is wrong. An earlier
    // draft inferred the contender purely from that read, which turned this into
    // a silent unlocked run reporting degraded:false — the precise failure this
    // module exists to prevent.
    const gh = fakeGitHub();
    mod._internals.setTransport(async (pathname, opts) => {
      const res = await gh.handler(pathname, opts);
      const isLockRead = pathname.includes('/git/ref/device-lock/');
      const isRead = !opts?.method || opts.method === 'GET';
      if (isLockRead && isRead) return { status: 404, json: {} }; // stale replica
      return res;
    });

    await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });

    await expect(
      mod.acquireDeviceLock({ what: 'screenshots', deviceHost: DEVICE }),
    ).rejects.toThrow(/in use by another device run/);
  });

  it('fails fast and names the holder when another local run owns the device', async () => {
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);
    await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });

    // A second process on the same host: the CAS must reject it, not queue it.
    await expect(
      mod.acquireDeviceLock({ what: 'screenshots', deviceHost: DEVICE }),
    ).rejects.toThrow(/in use by test:rta/);
  });
});

describe('device-lock: no CI-yield', () => {
  it('never polls the Actions API to yield to an in-flight CI run', async () => {
    // A LAN sweep on 2026-08-10 found THREE Rokus: CI drives .200, local drives
    // .177. They cannot contend through the device, so the old Actions-API check
    // only ever produced "you may not use .177 because CI is busy on .200". The
    // fake throws on /actions/*, so this passes only while that check stays gone.
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);

    const lock = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });

    expect(lock.held).toBe(true);
    expect(gh.calls.some((c) => c.includes('/actions/'))).toBe(false);
  });
});

describe('device-lock: read-only (CI) mode', () => {
  it('runs tokenless in CI as an observer, without degrading', async () => {
    // device-unit-tests.yml deliberately passes NO GITHUB_TOKEN, because that
    // job's env is readable by fork code. The repo is public and the two read
    // endpoints answer anonymously, so the check must still work.
    await goTokenless();
    process.env.GITHUB_ACTIONS = 'true';
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);

    const lock = await mod.acquireDeviceLock({ what: 'test:all', deviceHost: DEVICE });

    expect(lock.degraded).toBe(false);
    expect(lock.mode).toBe('observer');
    expect(gh.refs.size).toBe(0); // never writes
    expect(gh.calls.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('still blocks a tokenless CI run when a local run holds the lock', async () => {
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);
    await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE }); // local, with token

    // goTokenless() re-imports the module, so the new instance needs the SAME
    // fake wired up again — its `refs` map is what carries the local holder over.
    await goTokenless();
    mod._internals.setTransport(gh.handler);
    process.env.GITHUB_ACTIONS = 'true';

    await expect(mod.acquireDeviceLock({ what: 'test:all', deviceHost: DEVICE })).rejects.toThrow(
      /in use by test:rta/,
    );
  });

  it('degrades rather than silently observing when a LOCAL run has no token', async () => {
    // Locally, read-only is not good enough: without publishing a ref, a second
    // local run cannot see this one. That must be flagged, not passed off as fine.
    await goTokenless();
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);

    const lock = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });
    expect(lock.degraded).toBe(true);
    expect(lock.meta.reason).toMatch(/no GitHub token/);
  });
});

describe('device-lock: degraded mode', () => {
  it('warns and proceeds unlocked when GitHub is unreachable', async () => {
    const gh = fakeGitHub({ failWith: 'ENOTFOUND api.github.com' });
    mod._internals.setTransport(gh.handler);

    const lock = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });

    expect(lock.held).toBe(false);
    expect(lock.degraded).toBe(true);
    expect(lock.meta.reason).toMatch(/could not reach GitHub/);
  });

  it('hard-fails instead when RTA_REQUIRE_LOCK=1', async () => {
    const gh = fakeGitHub({ failWith: 'ENOTFOUND api.github.com' });
    mod._internals.setTransport(gh.handler);

    await expect(
      mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE, requireLock: true }),
    ).rejects.toThrow(/Device lock required but unavailable/);
  });

  it('records degradation in the run meta, not only in the log', async () => {
    // The whole point: a degraded green must stay identifiable after the run,
    // because an agent reads stdout minutes too late and the exit code is 0.
    const gh = fakeGitHub({ failWith: 'offline' });
    mod._internals.setTransport(gh.handler);

    const lock = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });
    expect(lock.meta).toMatchObject({ locked: false, degraded: true });
  });

  it('lets RTA_SKIP_LOCK=1 bypass, but never over RTA_REQUIRE_LOCK=1', async () => {
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);

    process.env.RTA_SKIP_LOCK = '1';
    const skipped = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });
    expect(skipped.degraded).toBe(true);
    expect(gh.refs.size).toBe(0);

    process.env.RTA_REQUIRE_LOCK = '1';
    await expect(mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE })).rejects.toThrow(
      /required but unavailable/,
    );
  });
});

describe('device-lock: helpers', () => {
  it('keys the ref by a hash, never the raw device-id — the repo is PUBLIC', () => {
    // `git ls-remote` on a public repo exposes every ref name, and a Roku's
    // device-id partially encodes its serial (.177 reports serial X01700M79A2U
    // and device-id S09042179A2U — note the shared tail). The pinned value is
    // what the CI self-test printed for the real device, so this also locks the
    // algorithm: change the hash or the truncation and both sides stop agreeing.
    const key = mod._internals.deviceKey('S09042179A2U');
    expect(key).toBe('ac4701ca4a5d8a0b');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(key).not.toContain('S09042179A2U');
    // Hashing subsumes the old sanitising: dots and colons can't survive it.
    expect(mod._internals.deviceKey('a.b.c')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('treats a ref whose tag it cannot read as HELD, not free', async () => {
    // The REF existing is the authority; the tag only names the holder. An
    // earlier revision returned null on a failed tag fetch, which let a tokenless
    // CI observer — whose only signal is this read — conclude "free" on a
    // transient 5xx while a local run held the lock.
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);
    await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });

    await goTokenless();
    process.env.GITHUB_ACTIONS = 'true';
    mod._internals.setTransport(async (pathname, opts) => {
      if (pathname.includes('/git/tags/')) return { status: 500, json: null };
      return gh.handler(pathname, opts);
    });

    await expect(mod.acquireDeviceLock({ what: 'test:all', deviceHost: DEVICE })).rejects.toThrow(
      /in use by/,
    );
  });

  it('refuses to lock a device it cannot identify, rather than inventing a key', async () => {
    // An address-derived fallback key would be a key the OTHER party may never
    // compute, so both sides would read "free" and both would run. Degrading
    // loudly beats a lock that only looks like one.
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);
    mod._internals.setDeviceIdLookup(async () => {
      throw new Error('EHOSTUNREACH');
    });

    const lock = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });
    expect(lock.degraded).toBe(true);
    expect(lock.meta.reason).toMatch(/could not identify the device/);
    expect(gh.refs.size).toBe(0);
  });

  it('gives two different devices two different locks', async () => {
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);
    mod._internals.setDeviceIdLookup(async (host) =>
      host === '192.168.1.200' ? 'S0J7355NCXLC' : DEVICE_ID,
    );

    const dev = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: '192.168.1.177' });
    const ci = await mod.acquireDeviceLock({ what: 'test:unit', deviceHost: '192.168.1.200' });
    expect(dev.held).toBe(true);
    expect(ci.held).toBe(true);
    expect(gh.refs.size).toBe(2);
  });

  it('locks the same device across hosts that address it differently', async () => {
    // The defect that motivated identity-keying: local .env and CI's
    // ROKU_DEVICE_IP secret naming the same Roku by different addresses (DHCP
    // change, or simply different values) would split the lock in two, and BOTH
    // sides would read "free".
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);
    mod._internals.setDeviceIdLookup(async () => DEVICE_ID); // same box, either address

    await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: '192.168.1.178' });
    await expect(
      mod.acquireDeviceLock({ what: 'test:all', deviceHost: '10.0.0.42' }),
    ).rejects.toThrow(/in use by test:rta/);
  });

  it('describes a holder in terms a human can act on', () => {
    const desc = mod.describeHolder({
      pid: 42,
      what: 'test:rta',
      where: 'local',
      startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    });
    expect(desc).toMatch(/test:rta \(local, pid 42\)/);
    expect(desc).toMatch(/3min ago/);
  });

  it('separates a CI holder from a local one without naming a machine', () => {
    const ci = mod.describeHolder({
      what: 'RTA Functional Tests',
      where: 'ci',
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      runUrl: 'https://github.com/jellyrock/jellyrock/actions/runs/999',
    });
    expect(ci).toMatch(/RTA Functional Tests \(CI\)/);
    expect(ci).toMatch(/actions\/runs\/999/);
  });

  it('never records the machine hostname — the lock ref lives in a PUBLIC repo', async () => {
    // `refs/device-lock/*` and the tag object it points at are both readable
    // unauthenticated (`git ls-remote`, `GET /git/tags/{sha}`), so anything put
    // in the holder record is published for as long as the lock is held. A
    // hostname identifies the person, not the run. This is a gate, not a note:
    // the field was there once and a reviewer would not spot it coming back.
    const gh = fakeGitHub();
    mod._internals.setTransport(gh.handler);

    const lock = await mod.acquireDeviceLock({ what: 'test:rta', deviceHost: DEVICE });

    expect(lock.meta.holder).not.toHaveProperty('host');
    expect(JSON.stringify(lock.meta)).not.toContain(os.hostname());
    // The tag message is the copy that actually reaches GitHub.
    expect([...gh.tags.values()].map((t) => t.message).join('')).not.toContain(os.hostname());
  });
});

// A snapshot under `.device-runs/` means a run did not put that device back. It is
// both the only recovery path and a file holding a live authToken, and it had no
// operator surface at all until `device:status` grew one — which is how one got
// deleted by an `rm -rf` aimed at the ledger beside it. The lines it prints are
// therefore load-bearing, and the recovery command in them has to actually RUN.
describe('device-lock: stranded-snapshot report', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stranded-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const lines = () => mod._internals.strandedSnapshotLines(dir);
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);

  it('says nothing when no device was left dirty', () => {
    expect(lines()).toEqual([]);
  });

  it('says nothing when the directory does not exist at all', () => {
    expect(mod._internals.strandedSnapshotLines(path.join(dir, 'nope'))).toEqual([]);
  });

  it('names the host and the recovery command', () => {
    write(
      `registry-${DEVICE}.json`,
      JSON.stringify({ host: DEVICE, takenAt: '2026-08-11T20:00:00Z' }),
    );
    const [line] = lines();
    expect(line).toContain(DEVICE);
    expect(line).toContain('2026-08-11T20:00:00Z');
    expect(line).toContain(`ROKU_IP=${DEVICE} npm run rta:restore`);
  });

  it('recovers the host from the FILENAME when the snapshot is truncated', () => {
    // What a killed write leaves — and precisely when an operator needs the
    // command most. Reading the host only from the contents produced
    // `ROKU_IP=an unknown device npm run rta:restore`, which the shell parses as
    // `ROKU_IP=an` and then tries to execute `unknown`. The host is in the name.
    write(`registry-${DEVICE}.json`, '{"host":"192.168.1.177","values":{"trunc');
    const [line] = lines();
    expect(line).toContain(`ROKU_IP=${DEVICE} npm run rta:restore`);
    expect(line).not.toContain('unknown device');
    // No timestamp is available from the name alone, so it must not be invented.
    expect(line).not.toContain('snapshot taken');
  });

  it('reports a device other than the one ROKU_IP points at', () => {
    // The case a host-specific check reports as clean: stranded by `npm run demo`
    // on one Roku, then a run against another. Each file names its own host.
    write('registry-192.168.1.178.json', '{');
    expect(lines()[0]).toContain('ROKU_IP=192.168.1.178 npm run rta:restore');
  });

  it('ignores files that are not registry snapshots', () => {
    // `.device-runs/` also holds the per-run-kind ledger directories.
    fs.mkdirSync(path.join(dir, 'rta'));
    write('runs.jsonl', '{}');
    expect(lines()).toEqual([]);
  });

  it('does not claim an accepted-residue record as a stranded snapshot', () => {
    // The two reports share a directory, and the snapshot glob is greedy. Naming the
    // record `registry-<host>.accepted.json` would have matched it here as a device
    // called `192.168.1.177.accepted` — and printed a recovery command with that as
    // its ROKU_IP. The distinct prefix is what prevents it; this pins that.
    write(`accepted-${DEVICE}.json`, JSON.stringify({ host: DEVICE, differences: [] }));
    expect(lines()).toEqual([]);
  });
});

// `--accept` clears the snapshot so an unconvergeable residual stops wedging every
// later run. That trade removes the only durable signal that the device is dirty,
// and no run re-reports it: the file a run would have found is exactly what was
// cleared. This report is the replacement, so it has to name the device and the file.
describe('device-lock: accepted-residue report', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accepted-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const lines = () => mod._internals.acceptedResidueLines(dir);
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);

  it('says nothing when nothing was accepted', () => {
    expect(lines()).toEqual([]);
  });

  it('says nothing when the directory does not exist at all', () => {
    expect(mod._internals.acceptedResidueLines(path.join(dir, 'nope'))).toEqual([]);
  });

  const accepted = (events) => JSON.stringify({ host: DEVICE, events });

  it('names the host, the count, when, and both the review and acknowledge paths', () => {
    write(
      `accepted-${DEVICE}.json`,
      accepted([
        {
          acceptedAt: '2026-08-11T20:00:00Z',
          differences: [
            { section: 'u1', key: 'authToken' },
            { section: 'u1', key: 'username' },
          ],
        },
      ]),
    );
    const [line] = lines();
    expect(line).toContain(DEVICE);
    expect(line).toContain('2 accepted difference(s)');
    expect(line).toContain('2026-08-11T20:00:00Z');
    expect(line).toContain(path.join(dir, `accepted-${DEVICE}.json`));
    // Unlike a snapshot, this file is safe to delete — that IS the acknowledgement.
    expect(line).toContain(`rm ${path.join(dir, `accepted-${DEVICE}.json`)}`);
    // One accept reads as one thing, not as "across 1 accepts".
    expect(line).not.toContain('across');
  });

  it('totals every accept and reports the most recent, because none of them were repaired', () => {
    write(
      `accepted-${DEVICE}.json`,
      accepted([
        { acceptedAt: '2026-08-10T09:00:00Z', differences: [{ section: 'u1', key: 'authToken' }] },
        {
          acceptedAt: '2026-08-11T20:00:00Z',
          differences: [
            { section: 'u2', key: 'username' },
            { section: 'u2', key: 'serverId' },
          ],
        },
      ]),
    );
    const [line] = lines();
    expect(line).toContain('3 accepted difference(s)');
    expect(line).toContain('across 2 accepts');
    // The LATEST, not the first — an operator wants to know how recent the damage is.
    expect(line).toContain('latest 2026-08-11T20:00:00Z');
    expect(line).not.toContain('latest 2026-08-10');
  });

  it('still names the device when the record is truncated', () => {
    write(`accepted-${DEVICE}.json`, '{"host":"192.168.1.177","even');
    const [line] = lines();
    expect(line).toContain(DEVICE);
    expect(line).toContain('some accepted difference(s)');
    // No timestamp is available, so it must not be invented.
    expect(line).not.toContain('latest');
  });

  it('does not claim a stranded snapshot as an accepted residue', () => {
    write(`registry-${DEVICE}.json`, JSON.stringify({ host: DEVICE, takenAt: 'x' }));
    expect(lines()).toEqual([]);
  });
});
