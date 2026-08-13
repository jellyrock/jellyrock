/**
 * The measurement-integrity guard: tier 1 asserts identity, tier 2 records
 * everything else.
 *
 * A perf number taken on a device is only worth as much as the answer to "what
 * was it taken against?", and until now that answer lived in habit rather than
 * in the record. The project's own audit of recent samples put it plainly: three
 * measurements were clear of a leaked demo session **only because each happened
 * to record a count** that was inconsistent with the demo server's content, so a
 * reader could rule it out after the fact. That is luck, and it is not available
 * to the next sample.
 *
 * ## The split, and why it is not "assert everything"
 *
 * A naive "the library must have N rows" gate false-fails on every legitimate
 * content change — Continue Watching popping in, an episode watched, a library
 * added — and a gate that cries wolf is one people delete. So:
 *
 * - **Tier 1 ASSERTS identity.** Hard fail. Identity is the one thing that does
 *   not drift with content: only an actual server switch moves it, and a server
 *   switch IS the leak being guarded against.
 * - **Tier 2 RECORDS workload and provenance** and never asserts alone. Device
 *   model, Roku OS version, app version, build flavor, server version. Drift is
 *   made VISIBLE (tier 3 prints it beside the timing delta) rather than refused.
 *
 * ## Tier 1 asserts `serverUrl` — NOT the `serverId`/`userId` pair
 *
 * This is a correction to the guard's original design, and it is the whole reason
 * the tier exists in its current form. Measured 2026-08-12: `demo.jellyfin.org/stable`
 * and `demo.jellyfin.org/unstable` are genuinely different backends (Jellyfin
 * 10.11.11 vs 12.0.0, different `ServerName`) **cloned from one seed database, so
 * they report an IDENTICAL `serverId` AND an identical `userId`.**
 *
 * The original design called that pair "immune to content drift, because only an
 * actual server/user switch moves it, which IS the leak". True for a switch to a
 * *different* server — and false for the mistake most likely to happen here,
 * which is stable↔unstable: `RTA_CONFIG` points at `/stable` while the API-version
 * work targets `/unstable`, and the pair cannot see the difference. `serverUrl`
 * can. `serverId` / `userId` are kept, as recorded provenance, where being equal
 * across two servers costs nothing.
 *
 * ## Reads happen at SESSION boundaries, never inside a sample
 *
 * Every read here is an ODC call, and ODC is only present because the build was
 * deployed with `injectTestingFiles` — which makes the on-device component
 * resident. Whether a resident ODC moves a first-paint number is not established,
 * so this module is designed never to have to care: identity is read once per
 * session, before and after the series, and never between the relaunch and the
 * line being measured. That is also the constraint the guard's design settled on
 * independently, for a different reason — `m.log.*` faults at runtime past nine
 * arguments, so per-sample identity logging was never available on the app side
 * either.
 *
 * `ENABLE_RTA` itself is recorded in tier 2 for the same reason `debug` and
 * `perfTiming` are stamped into the app's own log lines: so a number can never be
 * silently compared against one measured in a differently-compiled build. Note
 * the app's `[debug=… perfTiming=…]` bracket does NOT carry `ENABLE_RTA`, so a
 * line lifted out of a scrollback cannot self-report it — only a tool that knows
 * which deploy it performed can.
 *
 * ## What it never reads
 *
 * Identity is read by NAMED FIELD — `server.serverUrl`, `server.id`, `user.id` —
 * never by dumping the node. `JellyfinUser` carries `authToken`, and these records
 * are written to disk. Same rule, and the same reason, as `tests/rta/lib/diagnostics.js`.
 */
import fs from 'node:fs';
import { odc } from 'roku-test-automation';
import { fetchDeviceInfo } from './device-lock.js';

/**
 * The identity + server-provenance read, as one batched ODC request.
 *
 * One batch rather than five reads, for the reason `getActiveVals` documents: N
 * sequential reads are N observations spread over ~5.4 ms each, and this set is
 * supposed to describe ONE moment — the moment the sample was taken against.
 * Named fields only; see the header.
 */
const IDENTITY_REQUESTS = {
  serverUrl: { base: 'global', keyPath: 'server.serverUrl' },
  serverId: { base: 'global', keyPath: 'server.id' },
  serverVersion: { base: 'global', keyPath: 'server.version' },
  apiVersion: { base: 'global', keyPath: 'server.apiVersion' },
  userId: { base: 'global', keyPath: 'user.id' },
};

/** Bound on the read, matching `diagnostics.js` — well under RTA's 10 s default. */
const READ_TIMEOUT_MS = 5000;

/**
 * Read the app's current identity.
 *
 * THROWS when the batch itself fails, rather than reporting a screen full of
 * absent fields. The distinction is the one `lib/jellyfin.js` exists to enforce
 * one layer up: an unanswered request must never be laundered into a fact. A
 * swallowed failure here would report `serverUrl: undefined`, and an `undefined`
 * that compares unequal to the expectation would fail the guard for the wrong
 * reason — or worse, an `undefined` expectation would make it pass.
 */
export async function readIdentity() {
  const batch = await odc.getValues({ requests: IDENTITY_REQUESTS }, { timeout: READ_TIMEOUT_MS });
  const results = batch?.results;
  if (!results) {
    throw new Error(
      'identity read returned no results — the device answered ODC, but not with a batch. ' +
        'A sample cannot be attributed to a server, so it is not a sample.',
    );
  }
  const out = {};
  for (const key of Object.keys(IDENTITY_REQUESTS)) {
    out[key] = results[key]?.found ? results[key].value : undefined;
  }
  return out;
}

/**
 * Compare two server URLs for the purposes of the tier-1 assert.
 *
 * Normalisation is deliberately SHALLOW — trailing slashes and the case of the
 * scheme and host only. It must not touch the path: `/stable` and `/unstable`
 * differ in the path alone, and they are the exact pair this assert was corrected
 * to catch. An over-eager normaliser is how a guard goes quietly blind, so
 * anything beyond the two provably-equivalent spellings below is left as a
 * mismatch for a human to look at.
 */
export function sameServer(a, b) {
  const norm = (u) => {
    if (typeof u !== 'string') return undefined;
    const trimmed = u.trim().replace(/\/+$/, '');
    // Lowercase scheme + authority; leave the path exactly as written.
    return trimmed.replace(
      /^([a-zA-Z][\w+.-]*:\/\/)([^/]+)/,
      (_, scheme, host) => scheme.toLowerCase() + host.toLowerCase(),
    );
  };
  const na = norm(a);
  const nb = norm(b);
  return na !== undefined && na === nb;
}

/**
 * Tier 1. Returns a verdict rather than throwing, so the caller decides whether a
 * sample is discarded or the whole series is abandoned.
 *
 * `asserted: false` when no expectation was declared. That case is REPORTED
 * loudly by the caller rather than passing quietly: "nobody told me which server
 * to expect" and "the server is the one you expected" must never look alike in
 * the output, because the entire value of the tier is the difference between them.
 */
export function checkServerIdentity(identity, expectedServerUrl) {
  if (!expectedServerUrl) {
    return {
      asserted: false,
      ok: true,
      observed: identity?.serverUrl,
      reason: 'no expected server declared — tier 1 did NOT assert',
    };
  }
  const ok = sameServer(identity?.serverUrl, expectedServerUrl);
  return {
    asserted: true,
    ok,
    observed: identity?.serverUrl,
    expected: expectedServerUrl,
    reason: ok
      ? undefined
      : `the app is on ${JSON.stringify(identity?.serverUrl)} but the measurement expected ` +
        `${JSON.stringify(expectedServerUrl)}. Note serverId/userId cannot be used to tell ` +
        'these apart — the demo stable/unstable backends are cloned from one seed DB and ' +
        'report an identical pair.',
  };
}

/**
 * Series consistency: did the server move UNDER a run of samples?
 *
 * Distinct from the check above, and neither subsumes the other. A declared
 * expectation catches "you measured the wrong server"; this catches "the server
 * changed halfway through", which is the shape a leaked session or a mid-series
 * re-seed actually takes — and which a declared expectation would miss entirely
 * if the drift happened to land on the expected server.
 */
export function checkSeriesConsistency(first, current) {
  const drifted = [];
  for (const key of ['serverUrl', 'serverId', 'userId', 'serverVersion']) {
    if (first?.[key] !== current?.[key]) {
      drifted.push({ field: key, from: first?.[key], to: current?.[key] });
    }
  }
  return { ok: drifted.length === 0, drifted };
}

/**
 * Tier 2, device half. Model and Roku OS version, read from ECP.
 *
 * RECORDED, never asserted — and that is a decision with a history. The CI/local
 * Roku OS split was briefly treated as a load-bearing premise and had to be
 * retired one day later, because **Roku OS cannot be pinned**: any "these two
 * devices differ" claim has an expiry date nobody controls. Recording the version
 * each run actually saw is the durable replacement for assuming one.
 */
export async function readDeviceProvenance(host) {
  const info = await fetchDeviceInfo(host);
  return {
    model: info['model-name'] || undefined,
    modelNumber: info['model-number'] || undefined,
    osVersion: info['software-version'] || undefined,
    osBuild: info['software-build'] || undefined,
  };
}

/**
 * Tier 2, app half. The version the sample was taken against, from the manifest.
 *
 * Read from the manifest rather than `package.json` because the manifest is what
 * the DEVICE was given — the two can disagree mid-release, and the question a
 * sample answers is about the artifact that ran.
 */
export function readAppVersion(manifestPath) {
  let text;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    return undefined;
  }
  const field = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]?.trim();
  const parts = [field('major_version'), field('minor_version'), field('build_version')];
  return parts.every((p) => p !== undefined) ? parts.join('.') : undefined;
}

/**
 * The compile-time flags the manifest was built with.
 *
 * The app stamps `debug` and `perfTiming` into its own log lines, and those are
 * authoritative for a sample — they came from the running build. This reads the
 * manifest instead, and exists for the ONE flag the app does not stamp:
 * `ENABLE_RTA`. Recorded beside the app's own bracket rather than instead of it,
 * so a disagreement between them is visible instead of resolved by whichever was
 * consulted last.
 */
export function readBuildFlags(manifestPath) {
  let text;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    return undefined;
  }
  const line = /^bs_const=(.*)$/m.exec(text)?.[1];
  if (!line) return undefined;
  const flags = {};
  for (const pair of line.split(';')) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) {
      flags[k.trim()] = v.trim() === 'true' ? true : v.trim() === 'false' ? false : v.trim();
    }
  }
  return Object.keys(flags).length ? flags : undefined;
}
