/**
 * Mutual exclusion for a shared Roku.
 *
 *   import { acquireDeviceLock } from './device-lock.js'   // library
 *   node scripts/device-lock.js status                     // who holds it?
 *   node scripts/device-lock.js release                    // recovery escape hatch
 *
 * ## What this protects
 *
 * MEASURED by an ECP sweep of the LAN on 2026-08-10, not assumed: there are
 * THREE Rokus here, and CI does not share one with a developer.
 *
 *   .177  Streaming Stick 4K   local development (`.env` ROKU_IP)
 *   .178  Ultra                a personal device; occasional dev overflow
 *   .200  Streaming Stick 4K   CI ONLY -- `secrets.ROKU_DEVICE_IP`, an ORG
 *                              secret unmodified since 2026-03-18, read by both
 *                              device workflows and by RTA
 *
 * The contention this closes is therefore LOCAL-vs-LOCAL: `test:rta`,
 * `test:unit`, `demo` and `screenshots:capture` can each grab the same device
 * from a different terminal, and the Rooibos path has no registry snapshot to
 * fall back on, so an overlapping run there is pure corruption.
 *
 * Because the key is the device's own identity rather than a role, it ALSO
 * covers a local run pointed at CI's `.200` -- both sides then compute the same
 * key. That is the only way local and CI can collide at all.
 *
 * ## Why there is no CI-yield check
 *
 * This does not serialise a local run against CI, because they are not on the
 * same hardware. An earlier revision polled the Actions API and refused to start
 * while ANY device workflow was in flight. It was removed deliberately: its
 * observable behaviour was "you may not use .177 because CI is busy on .200" --
 * blocking a developer from their own device to protect one nobody is touching.
 * It also carried a hardcoded workflow-filename list that rots silently on
 * rename, a 30s poll loop, and an anonymous-rate-limit workaround that existed
 * only to afford the polling.
 *
 * That check was justified by PR #800, whose CI run went red on
 * `SessionManagement.spec.bs` -> "connects to Jellyfin stable demo server" while
 * a local `npm run test:rta` ran in the same window. The device-contention
 * reading of that incident is REFUTED by the sweep above: a `hardRelaunch()` on
 * .177 cannot reach .200. What remains is contention on the shared
 * `demo.jellyfin.org` account, or plain flake, and those are not yet
 * distinguished -- see the open followup in `docs/progress.md`. Do NOT re-add a
 * CI-yield check on the strength of #800 until that is settled; if the demo
 * server turns out to be the shared resource, the thing to lock is the server,
 * not the device.
 *
 * ## Why the lock lives on GitHub and not on the device
 *
 * The obvious home is the device itself. It is not available: ECP (port 8060)
 * has NO persistent write. `query/registry/<channelId>` is read-only ("Lists the
 * entries" -- rokudev/dev-doc v2.0, DEVELOPER/dev-tools/external-control-api.md),
 * and every ECP POST is transient (`keypress`, `input`, `launch`, `exit-app`,
 * the tracking toggles). The registry IS writable via ODC, but only with the
 * RTA build deployed AND running -- and the lock must be taken BEFORE the deploy,
 * so that is circular. A registry-resident lock would also collide with
 * `registry.js`, whose whole-registry snapshot would capture and then restore
 * it, resurrecting released locks.
 *
 * GitHub's ref API gives a real compare-and-swap for free, with no new
 * infrastructure and no daemon to keep alive: `POST /git/refs` returns 422
 * "Reference already exists" on conflict. Verified against this repo on
 * 2026-08-10 (201, then 422, then 204 on delete), not assumed. Holder identity
 * and the lease clock come from a tag object the ref points at.
 *
 * ## The ref name carries no hardware identity
 *
 * The ref lives in a PUBLIC repo, so its name is world-readable to anyone who
 * runs `git ls-remote`. The key is therefore sha256(device-id) truncated -- never
 * the raw ECP `device-id`, which partially encodes the serial (.177 reports
 * serial X01700M79A2U and device-id S09042179A2U; note the shared tail). Both
 * parties hash the same input, so they still agree on the name. The holder
 * record in the tag object is scrubbed for the same reason: `where` and a pid,
 * never a hostname.
 *
 * Keying on identity rather than address is what makes agreement possible at
 * all -- see `fetchDeviceId`.
 *
 * ## Local publishes; CI only reads
 *
 * Creating a ref needs `contents: write`. Both device workflows declare
 * `permissions: contents: read`, and `device-unit-tests.yml` does so
 * DELIBERATELY -- it runs fork code under `pull_request_target`. So CI does not
 * publish; it performs a single read, which is enough for the one case that
 * matters (a local run holding CI's device announces itself, and CI backs off).
 * CI's own exclusivity against other CI jobs already comes from the fact that
 * exactly one runner carries the `roku-device` label and takes one job at a time.
 *
 * ## Reads are eventually consistent; writes are not
 *
 * Measured against this repo on 2026-08-10: `POST /git/refs` conflict detection
 * is immediate and reliable (422 on the second create, every time), but a GET of
 * an aged ref came back stale 2/24 times. So correctness NEVER rests on a read
 * being empty. The CAS decides who holds the lock; a read only names the holder
 * for a human and feeds the staleness check, and the steal path re-confirms
 * before acting.
 *
 * ## Degraded mode is recorded, not just logged
 *
 * When GitHub is unreachable or no token exists, a run warns and proceeds
 * unlocked rather than blocking device work. A warning line alone is useless to
 * an agent: it is read when the command returns, minutes after the decision, and
 * the exit code stays 0, so a degraded green is indistinguishable from a real
 * one. The lock state is therefore stamped into the run record
 * (`<runDir>/run-meta.json` — `out/rta/`, `out/device/`, … per run kind) as
 * provenance on the RESULT.
 *
 * That record is LOCAL-ONLY today: `out/` is gitignored and neither device
 * workflow uploads it as an artifact, so in CI the provenance still dies with the
 * runner. Locally it has a reader (the RTA failure fold + printed summary).
 *
 * `RTA_REQUIRE_LOCK=1` turns degraded into a hard failure. CI does NOT set it:
 * CI is alone on .200, so there is no contention for the flag to protect
 * against, and setting it would only trade a genuine green device-test run for
 * an api.github.com blip. It stays supported as a manual override.
 *
 * Acquisition happens before the DEPLOY, so a contended run is refused before it
 * touches the device and long before the ~10-15min suite. It is NOT the first
 * thing that happens overall -- `npm run test:rta` is `npm run build && node
 * scripts/rta-run.js`, so a refusal costs the build first. Measured 2026-08-10:
 * an incremental build took ~11s and the lock landed ~1.5s into `rta-run.js`, so
 * a contended run learns it lost in well under a minute. A cold build would push
 * that out. Moving the check ahead of the build would need a preflight in the npm
 * script, and a preflight can only ever be an advisory READ -- the authoritative
 * CAS has to stay here, in the process that holds the lock.
 */
import 'dotenv/config'; // ROKU_IP is how we REACH the device; its identity comes from ECP
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const API = 'https://api.github.com';

/** Heartbeat interval. Every publisher refreshes; see `startRefresh`. */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * How long a lease survives WITHOUT a heartbeat before it is considered abandoned.
 *
 * This is a lease timeout, not a cap on how long a run may take. Every publisher
 * refreshes (see REFRESH_MS and `startRefresh`), so a legitimately long hold — a
 * 40-minute `screenshots:capture` across the language matrix — keeps renewing and
 * never self-expires. Sizing it against "the longest run we can imagine" would be
 * the wrong model, and it is what an earlier revision of this comment did.
 *
 * 3 missed heartbeats. Short enough that a crashed holder frees the device in
 * ~15 minutes rather than 30.
 */
const DEFAULT_LEASE_MS = 3 * REFRESH_MS;

/**
 * Gap between the two reads that authorise a steal. Long enough to decorrelate
 * replica routing, short enough that recovering a crashed holder stays painless.
 */
const STEAL_CONFIRM_MS = 10 * 1000;

const isCI = () => process.env.GITHUB_ACTIONS === 'true';

/** Control-flow marker: this caller is read-only, so skip the write attempt. */
class SkipWrite extends Error {}

/**
 * The ref path component for a device: sha256 of its ECP identity, truncated.
 *
 * NOT the raw `device-id`. The ref lives in a PUBLIC repo, so its name is
 * world-readable via `git ls-remote`, and the device-id partially encodes the
 * hardware serial. Both parties hash the same input, so they still agree on the
 * name while publishing nothing about the hardware.
 *
 * 16 hex chars is 64 bits — vastly more than enough to separate a handful of
 * Rokus. A collision would merely make two devices share one lock, which is
 * conservative; it can never produce a MISSED lock. Hashing also removes the
 * ref-name escaping problem for free: the output is always [0-9a-f]{16}, so the
 * old dot/colon sanitising is no longer needed.
 */
function deviceKey(id) {
  return createHash('sha256')
    .update(String(id ?? 'unknown'))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Ask the device who it is, over ECP.
 *
 * The lock is keyed by the device's OWN identity, never by its address. Keying
 * on the IP looks fine until the two parties disagree about it — a DHCP lease
 * change, or simply a `ROKU_DEVICE_IP` secret that names the device differently
 * from a developer's `.env`. Then each side computes a different ref name, each
 * reads "no lock", and both proceed. That failure is SILENT and total: it looks
 * exactly like an idle device. `device-id` is stable, and any host on the LAN can
 * read it unauthenticated, so both parties always agree.
 */
/**
 * Read ECP `/query/device-info` and return its flat `<tag>value</tag>` pairs.
 *
 * Exported because the measurement guard needs the SAME document for tier-2
 * provenance (device model, Roku OS version) that this module already fetches for
 * the lock key. A second fetcher would be a second timeout policy, a second error
 * vocabulary, and a second thing to fix when ECP changes — so this one grew a
 * general return value rather than growing a sibling.
 *
 * Values are returned verbatim (trimmed); no field is required here, because the
 * callers disagree about which ones they cannot proceed without.
 *
 * ⚠️ **XML entities are NOT decoded.** Verified against live ECP on three devices
 * (2026-08-12): zero entities in any response, and every field read today is
 * machine-generated — `device-id` (a serial), `model-name`, `model-number`,
 * `software-version`, `software-build`. None can contain user input, so none can
 * carry one.
 *
 * The exposure is the user-settable name fields — `user-device-name`,
 * `friendly-device-name`, `default-device-name` — which nothing reads yet. A device
 * named "Living Room & Den" would come back as the literal `Living Room &amp; Den`:
 * a wrong value, not a parse failure. Worth knowing because the field a future
 * caller is most likely to want is a human-readable device LABEL, which is exactly
 * the one that can carry an entity. Roku's ECP reference does not specify the
 * encoding either way, and a name cannot be set over ECP, so this is reasoned from
 * XML well-formedness rather than demonstrated. Decode at the call site if you read
 * a name field.
 */
export function fetchDeviceInfo(host) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${host}:8060/query/device-info`, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        data += c;
      });
      res.on('end', () => {
        const info = {};
        for (const [, tag, value] of data.matchAll(/<([a-z0-9-]+)>([^<]*)<\/\1>/g)) {
          info[tag] = value.trim();
        }
        resolve(info);
      });
    });
    req.on('error', (e) => reject(new Error(e.code || 'ECP unreachable')));
    req.setTimeout(5000, () => req.destroy(new Error('ECP timeout')));
  });
}

/**
 * The lock key's half of the document above.
 *
 * Kept as its own function rather than inlined at the call site: the lock CANNOT
 * proceed without `device-id` (see the note above on why an address is not an
 * acceptable fallback), so the missing-field throw belongs here, next to the
 * reasoning, and not in a caller that might be tempted to default it.
 */
function fetchDeviceId(host) {
  return fetchDeviceInfo(host).then((info) => {
    const id = info['device-id'];
    if (!id) throw new Error('no device-id in ECP device-info');
    return id;
  });
}

let deviceIdLookup = fetchDeviceId;
const idCache = new Map();

/**
 * Resolve the ref key for a device. Throws rather than falling back to the
 * address: an IP-derived key would be a key the OTHER party might not compute,
 * which is the exact split this function exists to prevent. A device that cannot
 * answer ECP is also a device no run can drive, so failing here costs nothing.
 */
async function resolveDeviceKey(host) {
  if (idCache.has(host)) return idCache.get(host);
  const key = deviceKey(await deviceIdLookup(host));
  idCache.set(host, key);
  return key;
}

let cachedToken;
/**
 * `GITHUB_TOKEN` in CI, otherwise the local `gh` login. Returns null rather than
 * throwing — a missing token is a degraded run, not a crash.
 */
async function getToken() {
  if (cachedToken !== undefined) return cachedToken;
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return (cachedToken = fromEnv);
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10_000 });
    cachedToken = stdout.trim() || null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

let cachedRepo;
/** `owner/repo` from the Actions env, else from the `origin` remote. */
async function getRepo() {
  if (cachedRepo !== undefined) return cachedRepo;
  if (process.env.GITHUB_REPOSITORY) return (cachedRepo = process.env.GITHUB_REPOSITORY);
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      timeout: 10_000,
    });
    const m = stdout.trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    cachedRepo = m ? m[1] : null;
  } catch {
    cachedRepo = null;
  }
  return cachedRepo;
}

/**
 * Minimal GitHub REST call over `node:https`.
 *
 * Not `scripts/lib/signals-fetch.cjs`'s `httpGet`, and not `fetch`. `httpGet`
 * REJECTS any non-200 — but this protocol is built on reading exactly those: 422
 * is the compare-and-swap signal and 404 is "lock is free". Teaching a
 * spec-fetching helper about auth headers, request bodies and status
 * passthrough would turn it into a general REST client for one caller in an
 * unrelated domain. `fetch` is out because the repo's ESLint targets Node >=16,
 * where it and `AbortSignal.timeout` are still flagged experimental.
 *
 * `token` is optional. jellyrock/jellyrock is public and both endpoints the lock
 * reads (`git/ref`, `actions/runs`) answer unauthenticated, which is what lets
 * `device-unit-tests.yml` run the check WITHOUT being handed a credential it
 * would then expose to fork code. Writes still need one, so a tokenless caller
 * is read-only by construction.
 */
function api(pathname, opts = {}) {
  return transport(pathname, opts);
}

/**
 * The real transport. Swappable via `_internals.setTransport` so the unit tests
 * can drive the PROTOCOL (who wins a CAS, who yields to whom) without touching
 * the network — and, more importantly, so a stubbed test can never silently fall
 * through to real GitHub and start creating refs.
 */
function httpsTransport(pathname, { method = 'GET', body, token } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${API}${pathname}`,
      {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'jellyrock-device-lock',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'x-github-api-version': '2022-11-28',
          ...(payload ? { 'content-type': 'application/json' } : {}),
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          let json;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = null; // 204s and error pages are both legitimately non-JSON
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', (err) => reject(new Error(`${err.code || 'ERR'}: ${pathname}`)));
    req.setTimeout(20_000, () => req.destroy(new Error(`timeout calling ${pathname}`)));
    if (payload) req.write(payload);
    req.end();
  });
}

let transport = httpsTransport;

/**
 * Identity written into the tag object, so a contender can be named to a human.
 *
 * Deliberately NO hostname. This ref and the tag object it points at live in a
 * PUBLIC repo — `git ls-remote` and `GET /git/tags/{sha}` both answer
 * unauthenticated — so every field here is world-readable for as long as the
 * lock is held. `where` plus a pid already separates the only cases a human
 * needs to tell apart (a second terminal on this machine vs. CI); a machine name
 * identifies the PERSON, not the run, and buys nothing for that.
 */
function selfDescription(what) {
  const meta = {
    pid: process.pid,
    what,
    where: isCI() ? 'ci' : 'local',
    startedAt: new Date().toISOString(),
  };
  if (isCI() && process.env.GITHUB_RUN_ID) {
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    meta.runUrl = `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  }
  return meta;
}

/** Human-readable one-liner for a holder record. */
export function describeHolder(holder) {
  if (!holder) return 'unknown';
  const age = holder.startedAt
    ? `${Math.round((Date.now() - Date.parse(holder.startedAt)) / 60000)}min ago`
    : 'unknown time';
  const who =
    holder.where === 'ci'
      ? 'CI'
      : holder.where === 'local'
        ? `local, pid ${holder.pid ?? '?'}`
        : 'unidentified';
  const url = holder.runUrl ? ` — ${holder.runUrl}` : '';
  return `${holder.what || 'a device run'} (${who}), started ${age}${url}`;
}

/**
 * Read the current holder, or null when free.
 *
 * A read can be stale (see the header), so this is for REPORTING and for the
 * staleness check — never for deciding that the lock is free.
 */
export async function readDeviceLock({ deviceHost = process.env.ROKU_IP } = {}) {
  const token = await getToken();
  const repo = await getRepo();
  if (!repo) return null;
  const ref = `device-lock/${await resolveDeviceKey(deviceHost)}`;
  const got = await api(`/repos/${repo}/git/ref/${ref}`, { token });
  if (got.status !== 200 || !got.json?.object?.sha) return null;
  const tagSha = got.json.object.sha;
  // The REF existing is the authority; the tag only NAMES the holder. A failed
  // tag fetch therefore means "someone holds it, we cannot say who" — never "the
  // device is free". An earlier revision returned null here, which let CI (whose
  // only signal is this read) conclude free on a transient 5xx while a local run
  // held the lock. That is the module's own rule — never infer free from a read —
  // being broken by its own helper.
  const tag = await api(`/repos/${repo}/git/tags/${tagSha}`, { token });
  if (tag.status !== 200) return { holder: null, acquiredAt: null, tagSha };
  let holder;
  try {
    holder = JSON.parse(tag.json.message);
  } catch {
    holder = { what: 'unparseable lock record' };
  }
  return { holder, acquiredAt: tag.json?.tagger?.date ?? null, tagSha };
}

/** Create the tag object that carries holder metadata, and return its sha. */
async function createHolderTag(repo, token, deviceHost, holder) {
  const head = await api(`/repos/${repo}/git/ref/heads/main`, { token });
  const anchor = head.json?.object?.sha;
  if (!anchor) throw new Error('cannot resolve main to anchor the lock tag');
  const tag = await api(`/repos/${repo}/git/tags`, {
    method: 'POST',
    token,
    body: {
      tag: `device-lock-${await resolveDeviceKey(deviceHost)}`,
      message: JSON.stringify(holder),
      object: anchor,
      type: 'commit',
      tagger: {
        name: 'jellyrock-device-lock',
        email: 'device-lock@jellyrock.invalid',
        date: new Date().toISOString(),
      },
    },
  });
  if (!tag.json?.sha) throw new Error(`could not create lock record (HTTP ${tag.status})`);
  return tag.json.sha;
}

/**
 * Drop an abandoned lock.
 *
 * Deliberately conservative, because a DELETE is unconditional and reads are
 * eventually consistent: re-read and require the SAME tag sha and a still-expired
 * clock before touching anything. A lock that was released and freshly retaken
 * between the two reads changes sha, so it is left alone.
 *
 * The confirming read is SEPARATED IN TIME on purpose. Measured on 2026-08-10,
 * ref staleness is not a propagation window that closes — it is per-read replica
 * routing, and the stale hit landed on the 4th of 8 consecutive reads, not the
 * 1st. Two back-to-back reads can therefore hit the same stale replica and agree
 * with each other while both are wrong, which would let us delete a lock that had
 * been released and freshly retaken by someone else. A gap decorrelates them.
 * This costs STEAL_CONFIRM_MS on the rare crashed-holder path and nothing at all
 * on the normal one.
 */
async function stealIfExpired(repo, token, ref, deviceHost, current, leaseMs) {
  // `acquiredAt` is the tag date, which every heartbeat re-stamps — so this is
  // "time since last sign of life", not "time since the run started".
  const renewed = current.acquiredAt ? Date.parse(current.acquiredAt) : NaN;
  if (!Number.isFinite(renewed) || Date.now() - renewed < leaseMs) return false;
  await new Promise((r) => setTimeout(r, STEAL_CONFIRM_MS));
  const confirm = await readDeviceLock({ deviceHost });
  if (!confirm || confirm.tagSha !== current.tagSha) return false;
  const stillExpired = confirm.acquiredAt && Date.now() - Date.parse(confirm.acquiredAt) >= leaseMs;
  if (!stillExpired) return false;
  const del = await api(`/repos/${repo}/git/refs/${ref}`, { method: 'DELETE', token });
  return del.status === 204 || del.status === 200;
}

/**
 * Take the device lock.
 *
 * Resolves to a handle whose `held` says whether exclusivity was actually
 * obtained and whose `degraded` says whether the check could even run. Callers
 * MUST call `release()` (including on interrupt) and should stamp `meta` into
 * their run record.
 *
 * There is NO wait budget: a contended run fails immediately and names the
 * holder. A human at a keyboard wants the answer now, and the previous CI
 * queueing path existed only to serve the Actions-API CI-yield check that this
 * module no longer performs (see the header).
 *
 * Throws only when exclusivity was required and could not be had — either
 * `RTA_REQUIRE_LOCK=1` with no working lock, or a live contender.
 */
export async function acquireDeviceLock({
  what = 'device run',
  deviceHost = process.env.ROKU_IP,
  requireLock = process.env.RTA_REQUIRE_LOCK === '1',
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  // Explicit human override. RTA_REQUIRE_LOCK still wins, so setting both is a
  // loud contradiction rather than a silent bypass.
  if (process.env.RTA_SKIP_LOCK === '1') {
    return degraded('RTA_SKIP_LOCK=1 was set explicitly', requireLock, what);
  }

  const token = await getToken();
  const repo = await getRepo();

  if (!repo) return degraded('cannot resolve the repo', requireLock, what);

  // No token means read-only. That is the DESIGNED state in CI (which runs under
  // `contents: read`) and a degraded one locally: an observer can see an existing
  // lock but cannot publish its own, so a second local run would not see IT.
  if (!token && !isCI()) {
    return degraded('no GitHub token (run `gh auth login`)', requireLock, what);
  }

  let key;
  try {
    key = await resolveDeviceKey(deviceHost);
  } catch (e) {
    // Cannot identify the device => cannot agree on a key with the other party.
    // Claiming a lock under a key nobody else computes is worse than no lock,
    // because it reads as protected.
    return degraded(
      `could not identify the device at ${deviceHost} (${e.message})`,
      requireLock,
      what,
    );
  }
  const ref = `device-lock/${key}`;
  const holder = selfDescription(what);

  for (;;) {
    // Three outcomes, kept distinct on purpose. `conflict` is AUTHORITATIVE:
    // measured on 2026-08-10, a read of an aged ref comes back stale ~8% of the
    // time (2/24), so a 422 followed by a read that says "free" means the READ is
    // wrong, never that the lock is free. Collapsing these into one boolean is
    // exactly how a contended run would slip through as an unflagged green.
    let tookRef = false;
    let conflict = false;
    let cannotWrite = !token; // tokenless == observer; don't even try to write
    try {
      if (cannotWrite) throw new SkipWrite();
      const tagSha = await createHolderTag(repo, token, deviceHost, holder);
      const created = await api(`/repos/${repo}/git/refs`, {
        method: 'POST',
        token,
        body: { ref: `refs/${ref}`, sha: tagSha },
      });
      if (created.status === 201) tookRef = true;
      else if (created.status === 422) conflict = true;
      else if (created.status === 403 || created.status === 404) cannotWrite = true;
      else throw new Error(`HTTP ${created.status}`);
    } catch (e) {
      // CI runs under `contents: read` by design, so a write failure there is the
      // expected read-only path, not an outage.
      if (e instanceof SkipWrite || isCI()) cannotWrite = true;
      else return degraded(`could not reach GitHub (${e.message})`, requireLock, what);
    }

    let contender = null;
    if (conflict) {
      const current = await readDeviceLock({ deviceHost });
      if (current && (await stealIfExpired(repo, token, ref, deviceHost, current, leaseMs))) {
        console.warn(
          `[device-lock] stole an expired lease held by ${describeHolder(current.holder)}`,
        );
        continue; // retry the CAS now that the ref is gone
      }
      // The read only DECORATES the contender with a name. If it came back empty
      // (stale replica) we still know someone holds the lock, because the CAS
      // said so.
      contender = current?.holder ?? { what: 'another device run' };
    } else if (cannotWrite) {
      const current = await readDeviceLock({ deviceHost });
      if (current) contender = current.holder ?? { what: 'a device run' };
    }

    if (contender) {
      // Do not sit on our own ref while refusing.
      if (tookRef) await releaseRef(repo, token, ref, true);
      throw new Error(
        `The Roku at ${deviceHost} is in use by ${describeHolder(contender)}.\n` +
          `        Wait for it, or run \`npm run device:status\` for detail.\n` +
          `        Another Roku on the LAN is free game: ROKU_IP=<other-ip> npm run <script>` +
          (isCI() ? '' : '\n        Override (at your own risk): RTA_SKIP_LOCK=1'),
      );
    }

    // `observer` is an honest label, not a failure: a tokenless caller holds no
    // ref but HAS confirmed no other holder.
    const mode = tookRef ? 'publisher' : 'observer';
    // Started here rather than on demand: an unbounded hold (watch mode, a long
    // capture matrix) must renew or the lease expires under a live run.
    const stopRefresh = tookRef ? startRefresh(repo, token, ref, deviceHost, holder) : () => {};
    return {
      held: tookRef,
      mode,
      degraded: false,
      meta: { locked: tookRef, mode, degraded: false, holder, deviceKey: key },
      // Stopping the heartbeat is part of releasing. Leaving it running would keep
      // minting tag objects and PATCHing a ref that no longer exists.
      release: async () => {
        stopRefresh();
        await releaseRef(repo, token, ref, tookRef);
      },
      stopRefresh,
    };
  }
}

function degraded(reason, requireLock, what) {
  if (requireLock) {
    throw new Error(`Device lock required but unavailable: ${reason}`);
  }
  console.warn(
    `[device-lock] ⚠️  running UNLOCKED — ${reason}.\n` +
      '[device-lock]    Another host could drive the device mid-run; treat this result as unverified.',
  );
  return {
    held: false,
    mode: 'degraded', // same shape as the success path — `lock.mode` is never undefined
    degraded: true,
    meta: {
      locked: false,
      mode: 'degraded',
      degraded: true,
      reason,
      holder: selfDescription(what),
    },
    release: async () => {},
    stopRefresh: () => {},
  };
}

async function releaseRef(repo, token, ref, tookRef) {
  if (!tookRef) return;
  try {
    await api(`/repos/${repo}/git/refs/${ref}`, { method: 'DELETE', token });
  } catch {
    // A leaked lease expires on its own once the heartbeat stops, so a failed
    // release is not fatal.
    console.warn('[device-lock] could not release the lock; the lease will expire on its own');
  }
}

/**
 * Keep a lease alive by re-stamping the tag date. Runs for EVERY publisher, not
 * just watch mode — this is what makes DEFAULT_LEASE_MS a lease timeout rather
 * than a cap on run length. Returns a stop function, which `release()` calls.
 * `unref()` so the timer never keeps the process up.
 */
function startRefresh(repo, token, ref, deviceHost, holder) {
  const timer = setInterval(async () => {
    try {
      const tagSha = await createHolderTag(repo, token, deviceHost, holder);
      await api(`/repos/${repo}/git/refs/${ref}`, {
        method: 'PATCH',
        token,
        body: { sha: tagSha, force: true },
      });
    } catch {
      // Best effort; the next acquire's staleness check is the backstop.
    }
  }, REFRESH_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Stamp lock provenance onto the run record.
 *
 * The point is that a degraded or unlocked run stays identifiable AFTER the fact
 * — from CI, from an agent, from a later triage — instead of living only in a
 * scrollback line nobody reads. Phase 4's measurement provenance extends this
 * same record rather than inventing a second one.
 *
 * `dir` is REQUIRED, and that is load-bearing rather than a tidiness knob: this is
 * a full OVERWRITE, so while every entry point shared one path, any device run
 * destroyed the previous one's record. Harmless while the file held only lock
 * provenance; not once it carries folded failure records. A default here would be
 * an alias onto one known run kind — exactly the clobber the per-kind split
 * removes, reintroduced silently for whichever caller forgot. The run-kind mapping
 * lives with those records in `scripts/run-record.js` (`runDir`); this module knows
 * about locks, not about run kinds.
 *
 * A missing `dir` is a programming error, not a runtime condition, so it throws
 * rather than joining the "never fail a run over bookkeeping" contract below —
 * a silent no-op would lose the record it exists to write.
 */
export function writeRunMeta(meta, extra = {}, dir) {
  if (!dir) throw new TypeError('writeRunMeta: an explicit run-record directory is required');
  try {
    const file = path.join(dir, 'run-meta.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `${JSON.stringify({ ...meta, ...extra, writtenAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch {
    // Never fail a device run over bookkeeping.
  }
}

export const _internals = {
  deviceKey,
  resolveDeviceKey,
  /** Test seam — avoids needing a real Roku on the LAN. */
  setDeviceIdLookup: (fn) => {
    idCache.clear();
    deviceIdLookup = fn ?? fetchDeviceId;
  },
  describeHolder,
  DEFAULT_LEASE_MS,
  /** Test seam — see `httpsTransport`. Pass nothing to restore the real one. */
  setTransport: (fn) => {
    transport = fn ?? httpsTransport;
  },
  /** Test seam — takes the directory so a test never reads the real `.device-runs/`. */
  strandedSnapshotLines,
  acceptedResidueLines,
};

/**
 * Report any device left mid-restore, as part of `status`.
 *
 * A registry snapshot under `.device-runs/` means exactly one thing: a run did not
 * put that device back. The file is the recovery path AND the device's whole
 * registry including a live `authToken`, so it is both the most valuable and the
 * most sensitive thing on disk here — and since it moved out of `out/` nothing
 * deletes it but a verified restore or `npm run rta:restore`.
 *
 * It had no operator-facing surface at all, which is how it got destroyed: during
 * review of this branch a stranded snapshot for `.177` was wiped by an `rm -rf`
 * aimed at the ledger beside it, and recovery meant hand-writing registry keys back
 * over ODC. Nothing would have told you it was there. This line does.
 *
 * Read by GLOB rather than by composing the path from `ROKU_IP`, deliberately, and
 * it is not a shortcut: the case that bites is a snapshot for a device you are NOT
 * currently pointed at (stranded by `npm run demo` on `.177`, then `ROKU_IP=.178`),
 * which a host-specific check would report as clean. Each file names its own host,
 * so the glob answers for every device with no second copy of the naming convention
 * — `tests/rta/lib/registry.js` owns that, and importing it here would drag the
 * whole `roku-test-automation` client into a module that only knows about locks.
 */
function strandedSnapshotLines(dir = '.device-runs') {
  const out = [];
  let entries;
  try {
    entries = fs
      .readdirSync(dir)
      .map((f) => ({ file: f, host: /^registry-(.+)\.json$/.exec(f)?.[1] }))
      .filter((e) => e.host);
  } catch {
    return out; // no `.device-runs/` yet — no device run has ever been taken here
  }
  for (const { file, host: hostFromName } of entries) {
    // The FILENAME is the fallback, not a placeholder. A truncated snapshot — what
    // a killed write leaves — is exactly when an operator needs the recovery
    // command, and a placeholder there produced `ROKU_IP=an unknown device npm run
    // rta:restore`, which the shell parses as `ROKU_IP=an` and then tries to run
    // `unknown`. The host is in the name either way, so the contents only ever add
    // the timestamp.
    let host = hostFromName;
    let takenAt = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      host = parsed.host || host;
      takenAt = parsed.takenAt || null;
    } catch {
      // A truncated or unreadable snapshot is still a stranded one — say so with
      // what we have rather than staying silent about the file that is sitting there.
    }
    out.push(
      `⚠️  ${host} was left mid-restore${takenAt ? ` (snapshot taken ${takenAt})` : ''} — ` +
        'its registry is NOT as you found it, and the snapshot holds an auth token.\n' +
        `    Recover: ROKU_IP=${host} npm run rta:restore`,
    );
  }
  return out;
}

/**
 * Report any device carrying differences an operator ACCEPTED, as part of `status`.
 *
 * `npm run rta:restore -- --accept` exists because a residual the restore loop cannot
 * converge would otherwise wedge every later run — it clears the snapshot so the next
 * run is not blocked. The cost of clearing it is that the device is left not-as-found
 * with nothing on disk saying so, and the next run's snapshot then adopts that state
 * as the user's own baseline. `tests/rta/lib/registry.js` writes `accepted-<host>.json`
 * to close that, and this is the line that surfaces it.
 *
 * Unlike a stranded snapshot this file is SAFE to delete — it is redacted evidence,
 * not the recovery path — and deleting it is how an operator acknowledges the device.
 * Nothing clears it automatically, because no later restore can prove the original
 * value came back; it is gone.
 *
 * Globbed on a distinct prefix rather than a `registry-*.accepted.json` suffix, which
 * `strandedSnapshotLines`' greedy `registry-(.+)\.json` would otherwise claim as a
 * stranded snapshot for a device named `<host>.accepted`.
 */
function acceptedResidueLines(dir = '.device-runs') {
  const out = [];
  let entries;
  try {
    entries = fs
      .readdirSync(dir)
      .map((f) => ({ file: f, host: /^accepted-(.+)\.json$/.exec(f)?.[1] }))
      .filter((e) => e.host);
  } catch {
    return out; // no `.device-runs/` yet — no device run has ever been taken here
  }
  for (const { file, host: hostFromName } of entries) {
    // Same fallback rule as the snapshot report: the filename carries the host, so a
    // truncated record still names the device it belongs to rather than going silent.
    let host = hostFromName;
    let acceptedAt = null;
    let count = null;
    let events = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      host = parsed.host || host;
      if (Array.isArray(parsed.events) && parsed.events.length) {
        // The record APPENDS — every accept on this device is still live damage,
        // because nothing repairs one. Report the total and the most recent.
        events = parsed.events.length;
        count = parsed.events.reduce(
          (n, e) => n + (Array.isArray(e.differences) ? e.differences.length : 0),
          0,
        );
        acceptedAt = parsed.events[parsed.events.length - 1].acceptedAt || null;
      }
    } catch {
      // Unreadable is still accepted-and-unresolved — say so with what we have.
    }
    out.push(
      `⚠️  ${host} has ${count ?? 'some'} accepted difference(s)` +
        `${events > 1 ? ` across ${events} accepts` : ''}` +
        `${acceptedAt ? ` (latest ${acceptedAt})` : ''} — its registry is NOT as it was ` +
        'found, and no run will report this again on its own.\n' +
        `    Review: ${path.join(dir, file)}   Acknowledge: rm ${path.join(dir, file)}`,
    );
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const [cmd] = process.argv.slice(2);
  const host = process.env.ROKU_IP;
  if (cmd === 'status') {
    // A device that cannot answer ECP makes `readDeviceLock` throw (it resolves the
    // key first), which surfaced as a raw Node stack trace — an unreachable device
    // is the most ordinary thing `status` gets asked about, and the least
    // deserving of one. Report it and keep going: the stranded-snapshot and
    // accepted-residue lines below are read from LOCAL disk and are still true, and
    // they are the ones that cost you the next run.
    const cur = await readDeviceLock({ deviceHost: host }).catch((e) => {
      console.log(`lock state unknown — ${host} did not answer (${e.message})`);
      return undefined;
    });
    if (cur !== undefined) console.log(cur ? `held by ${describeHolder(cur.holder)}` : 'free');
    // Name the device this answer is ABOUT. `status` reads `ROKU_IP`, so on a LAN
    // with three Rokus the line above is otherwise silent about which one it
    // describes. It is also the only way to learn the key by which the run ledger
    // records a device — `runs.jsonl` stores this hash, never an address, so
    // filtering a baseline to one device (see rta-tests.md) needs it. Degrades to
    // a reason rather than throwing: an unreachable device still has a lock state
    // worth printing, and this line is provenance, not the answer.
    try {
      console.log(`device ${host} — ledger key ${await resolveDeviceKey(host)}`);
    } catch (e) {
      console.log(`device ${host} — could not identify over ECP (${e.message})`);
    }
    // After the lock line, not instead of it: "free" and "left dirty" are both true
    // at once, and the second is the one that costs you the next run.
    for (const line of strandedSnapshotLines()) console.log(line);
    // And after THAT: an accepted residue is the one state no run will ever
    // re-report, because accepting is what cleared the file a run would have found.
    for (const line of acceptedResidueLines()) console.log(line);
  } else if (cmd === 'release') {
    const token = await getToken();
    const repo = await getRepo();
    await releaseRef(repo, token, `device-lock/${await resolveDeviceKey(host)}`, true);
    console.log('released');
  } else {
    console.log('usage: node scripts/device-lock.js status|release');
  }
}
