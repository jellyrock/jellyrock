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
 * That ODC dependency is also what makes `ENABLE_RTA` KNOWN rather than guessed.
 * The on-device component is present only because a build was deployed with
 * `injectTestingFiles`, and RTA's deploy flips `ENABLE_RTA=false` -> `true` in the
 * staged manifest to compile in the hook that starts it. So an identity read that
 * ANSWERS is itself proof that the running build has `ENABLE_RTA=true` — which is
 * strictly more than a tool can learn by reading a manifest, and it holds whether
 * or not this invocation performed the deploy. See `measure.js` for the derivation
 * at the call site.
 *
 * The app's own `[debug=… perfTiming=…]` bracket does NOT carry `ENABLE_RTA`, so a
 * line lifted out of a scrollback cannot self-report it.
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
import { ramTierFor } from './roku-devices.js';

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
 * The fields the batch ANSWERED but could not find.
 *
 * `readIdentity` throws when the whole batch fails, which is the loud case. This is
 * the quiet one: ODC answers, and reports `found: false` for a field — the node
 * exists but the app has no server on it, or a field was renamed under us. Left
 * alone that becomes `serverUrl: undefined` in a written record, which is the exact
 * laundering the throw above exists to prevent, one layer down. The caller decides
 * what is fatal; `serverUrl` is, because tier 1 rests on it and a sample nobody can
 * attribute to a server is not a sample.
 */
export const IDENTITY_FATAL_FIELDS = Object.freeze(['serverUrl']);

export function missingIdentityFields(identity) {
  return Object.keys(IDENTITY_REQUESTS).filter(
    (key) => identity?.[key] === undefined || identity?.[key] === '',
  );
}

/**
 * Which absent fields should ABORT the series, given what the operator declared.
 *
 * Absent `serverUrl` has two completely different causes and they must not be
 * conflated. Ordinarily it means the read went wrong or the app is in a state
 * nobody meant to measure, and the series is worthless — that is the refusal
 * `IDENTITY_FATAL_FIELDS` encodes. But the SIGNED-OUT screens (`serverSelect`,
 * `userSelect`) can only be measured with no server on the node, because reaching
 * them requires deleting it: `SetServerScreen` is where the user picks a server,
 * so a run that has one is by definition not on that screen.
 *
 * So "signed out" becomes an ASSERTABLE state rather than a failed read — but only
 * when the operator SAYS SO. Deriving it (treating any absent `serverUrl` as an
 * intentional signed-out run) is how the tier goes blind: the ordinary case and the
 * broken case look identical on the wire, and the ordinary case is the one this
 * whole module exists to catch.
 *
 * Lives here rather than in `measure.js` for the reason ADR 0028 was written about:
 * `measure.js` claims the device on import and cannot be unit-tested, so a rule that
 * lives there is a rule with no gate under it.
 */
export function fatalIdentityFields(identity, { expectSignedOut = false } = {}) {
  if (expectSignedOut) return [];
  return missingIdentityFields(identity).filter((key) => IDENTITY_FATAL_FIELDS.includes(key));
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
export function checkServerIdentity(identity, expectedServerUrl, { expectSignedOut = false } = {}) {
  // The signed-out arm ASSERTS, in both directions, and the second direction is the
  // half that earns it. "No server, as declared" is a pass. "A server, when you
  // declared none" is a HARD FAIL — because the signed-out screens are reached by
  // LAUNCHING, not by navigating: `beginLogin()` re-reads `server` every launch, so a
  // device that still has one lands on Home and every sample in the series is a Home
  // measurement filed under `serverSelect`. That is the confidently-wrong-number
  // failure this tier exists to prevent, and it is silent — the run completes, the
  // samples are well-formed, and only the screen is wrong.
  if (expectSignedOut) {
    const observed = identity?.serverUrl;
    const ok = observed === undefined || observed === '';
    return {
      asserted: true,
      ok,
      signedOut: true,
      observed,
      expected: null,
      reason: ok
        ? undefined
        : `--signed-out declared that the app has NO server, but it is on ` +
          `${JSON.stringify(observed)}. The signed-out screens are reached by launching, so a ` +
          'device that still has a server lands on Home and the series would measure Home ' +
          'under the name you asked for. Use Change Server in the app menu first.',
    };
  }
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
 * The RAM tier for a `model-number`, re-exported from the device dictionary.
 *
 * This used to be a 38-entry table typed by hand into this file off Roku's spec. It
 * was accurate and it was still incomplete in the way hand-typed tables always are:
 * it keyed on `/^(\\d{4})/`, so every Roku TV and the Projector — sixteen families
 * from 512 MB to 2 GB — resolved to `null` forever. It also could not notice that
 * upstream had added a new supported device.
 *
 * It is now derived from `scripts/data/roku-hardware.json`, generated from Roku's
 * published table and kept current by a weekly sync. See `scripts/roku-devices.js`
 * for the lookup contract and `scripts/generate/roku-hardware.js` for the pipeline.
 *
 * Re-exported here rather than repointing every caller, because this is the name the
 * guard's own API already promised and `readDeviceProvenance` below is its main user.
 */
export { deviceFor, describeDevice } from './roku-devices.js';
export { ramTierFor };

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
  const modelNumber = info['model-number'] || undefined;
  return {
    model: info['model-name'] || undefined,
    modelNumber,
    // Resolved at RECORD time rather than at read time, so a line written today
    // still says what tier it was taken on after the table below has grown. The
    // reader prefers the recorded value and falls back to the table for older lines.
    ramTier: ramTierFor(modelNumber),
    osVersion: info['software-version'] || undefined,
    osBuild: info['software-build'] || undefined,
  };
}

/**
 * Tier 2, app half. The version THIS CHECKOUT would build.
 *
 * Read from the manifest rather than `package.json` because the manifest is what a
 * deploy hands the device — the two can disagree mid-release, and the question a
 * sample answers is about the artifact that ran.
 *
 * ⚠️ It describes the device only when this invocation performed the deploy.
 * `npm run measure` defaults to measuring the build ALREADY on the device, which
 * may have been sideloaded from another branch days ago; the record therefore
 * files this under `checkout` and carries `deployedFromCheckout` beside it, rather
 * than presenting a working-tree version as the running app's. `git blame` on this
 * comment leads to the review that caught it being presented as the latter.
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
 * `ENABLE_RTA` is excluded from the checkout read below, because the checkout is
 * the one place its value is knowably WRONG about the device — see the note there.
 */
const NOT_FROM_THE_CHECKOUT = new Set(['ENABLE_RTA']);

/**
 * The compile-time flags THIS CHECKOUT's manifest declares.
 *
 * ## What this is for, and what it is not
 *
 * It is NOT the running build's flavor. The app stamps `[debug=… perfTiming=…]`
 * into its own timing lines and that bracket is authoritative, because it came out
 * of the build that produced the number; `measurements.js` captures it as each
 * sample's `buildFlags`. This read exists to be COMPARED against that bracket: a
 * disagreement is the only available evidence that the device is running something
 * other than what this checkout would build, which is exactly the case where the
 * record's `appVersion` and `commit` describe the wrong artifact.
 *
 * ## Why `ENABLE_RTA` is deliberately dropped
 *
 * It used to be the stated reason this function existed — "the ONE flag the app
 * does not stamp". That was backwards. RTA's deploy rewrites `ENABLE_RTA=false` ->
 * `true` in the STAGED build dir, never in the repo (see `harden-prod-manifest.js`
 * and `driver.js`), and the committed value is `false`. So this read reported
 * `ENABLE_RTA: false` on every run — including runs that had just deployed with it
 * on, where the record then carried `enableRta: true` two fields away. One record,
 * two contradictory answers about the same flag, and the contradiction was
 * manufactured by reading a file that cannot know.
 *
 * The flag is now derived where it is actually observable — a responding ODC proves
 * it — so this function returns only the flags the checkout can honestly speak to.
 */
export function readCheckoutBuildFlags(manifestPath) {
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
    if (!k || v === undefined) continue;
    const name = k.trim();
    if (NOT_FROM_THE_CHECKOUT.has(name)) continue;
    flags[name] = v.trim() === 'true' ? true : v.trim() === 'false' ? false : v.trim();
  }
  return Object.keys(flags).length ? flags : undefined;
}

/**
 * Does the build that produced a sample agree with the checkout's manifest?
 *
 * `null` when there is nothing to compare — no complete sample carried a bracket,
 * or the manifest could not be read. Deliberately NOT `true`: "the flags match" and
 * "there were no flags to match" must not look alike, for the same reason
 * `checkServerIdentity` refuses to let `asserted: false` look like a pass.
 *
 * Only the keys the app actually stamps are compared. The checkout declares more
 * than the bracket carries, and an absent key is not a disagreement.
 */
export function buildFlagsAgree(observed, checkoutFlags) {
  if (!observed || !checkoutFlags) return null;
  const shared = Object.keys(observed).filter((k) => checkoutFlags[k] !== undefined);
  if (!shared.length) return null;
  return shared.every((k) => observed[k] === checkoutFlags[k]);
}
