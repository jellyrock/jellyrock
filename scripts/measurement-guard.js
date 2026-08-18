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
import net from 'node:net';
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
 * `IDENTITY_FATAL_FIELDS` encodes. But `serverSelect` can only be measured with no
 * server on the node, because reaching that screen requires deleting it:
 * `SetServerScreen` is where the user PICKS a server, so a run that has one is by
 * definition not on it.
 *
 * ⚠️ `serverSelect` and NOT `userSelect`, which is the correction this option's name
 * carries. `userSelect` is the app's other pre-login screen and it is reached by
 * clearing the ACTIVE USER, not the server — `SignOut()` (app menu → Sign out) and
 * `SignOut(false)` (→ Change user) both leave `server` in place. So `userSelect` reads
 * a perfectly good `serverUrl`, is not fatal, needs no declaration, and REFUSES this
 * one. `userId` is deliberately not in `IDENTITY_FATAL_FIELDS`, which is what already
 * makes that screen measurable with no flag at all.
 *
 * So "no server" becomes an ASSERTABLE state rather than a failed read — but only when
 * the operator SAYS SO. Deriving it (treating any absent `serverUrl` as intentional) is
 * how the tier goes blind: the ordinary case and the broken case look identical on the
 * wire, and the ordinary case is the one this whole module exists to catch.
 *
 * Lives here rather than in `measure.js` for the reason ADR 0028 was written about:
 * `measure.js` claims the device on import and cannot be unit-tested, so a rule that
 * lives there is a rule with no gate under it.
 */
export function fatalIdentityFields(identity, { expectNoServer = false } = {}) {
  if (expectNoServer) return [];
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
export function checkServerIdentity(identity, expectedServerUrl, { expectNoServer = false } = {}) {
  // The no-server arm ASSERTS, in both directions, and the second direction is the half
  // that earns it. "No server, as declared" is a pass. "A server, when you declared
  // none" is a HARD FAIL — because `serverSelect` is reached by LAUNCHING, not by
  // navigating: `beginLogin()` re-reads `server` every launch, so a device that still
  // has one lands on Home and every sample in the series is a Home measurement filed
  // under `serverSelect`. That is the confidently-wrong-number failure this tier exists
  // to prevent, and it is silent — the run completes, the samples are well-formed, and
  // only the screen is wrong.
  if (expectNoServer) {
    const observed = identity?.serverUrl;
    const ok = observed === undefined || observed === '';
    return {
      asserted: true,
      ok,
      noServer: true,
      observed,
      expected: null,
      // The failure needs BOTH exits, because there are two ways to arrive here and one
      // of them is an operator who did nothing wrong except read a flag name. Naming
      // only the Change-server exit is what turned an earlier revision into a closed
      // loop: someone measuring `userSelect` was told to sign out, did, was refused
      // here, and was then sent to the one menu item that takes them OFF the screen
      // they were trying to measure.
      reason: ok
        ? undefined
        : '--no-server declared that the app has NO server, but it is on ' +
          `${JSON.stringify(observed)}. \`serverSelect\` is reached by launching, so a device ` +
          'that still has a server lands on Home and the series would measure Home under the ' +
          'name you asked for.\n' +
          '  To measure `serverSelect`: delete the server first (app menu → Change server).\n' +
          '  If you meant the USER picker (`userSelect`): drop --no-server. Change user and ' +
          'Sign out both leave the server in place, so that state needs no declaration — and ' +
          '--server <url> still asserts it.',
    };
  }
  if (!expectedServerUrl) {
    return {
      asserted: false,
      ok: true,
      // Stated rather than left absent, on the same reasoning as `provenance.server.url`
      // one file over: `JSON.stringify` DROPS an undefined value, so a key that appears
      // only when true reads as "this record predates the field" on every record where
      // it is false — a different claim from "the operator did not declare it".
      noServer: false,
      observed: identity?.serverUrl,
      reason: 'no expected server declared — tier 1 did NOT assert',
    };
  }
  const ok = sameServer(identity?.serverUrl, expectedServerUrl);
  return {
    asserted: true,
    ok,
    noServer: false,
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

/** The port RTA's on-device component listens on. Its default; nothing here overrides it. */
export const ODC_PORT = 9000;

/**
 * Is the on-device component RESIDENT — i.e. is anything listening on its port?
 *
 * ## Why this is a raw socket and not `readIdentity()`
 *
 * The enclosed arm has to assert the ABSENCE of ODC, and the obvious way to test that is
 * to try an ODC call and expect it to fail. That does not work, and the way it fails is
 * worth stating because it has now bitten this subsystem twice.
 *
 * RTA's `setupClientSocket` RETRIES `ECONNREFUSED` once a second and only rejects its
 * CACHED `clientSocketPromise` when its own connect timeout expires
 * (`OnDeviceComponent.js:989-1000`). A caller that bounds the call more tightly — which
 * one must, since RTA's timeout does not cover a connect that neither connects nor errors
 * — gets its rejection, handles it, and moves on. The underlying promise is still alive,
 * and when it finally rejects there is nobody attached: the rejection surfaces as an
 * `unhandledRejection`, from a socket `error` EVENT outside any await chain.
 *
 * Measured 2026-08-17, dogfooding the calibration: both plain-arm blocks passed the probe,
 * printed "identity asserted by ENCLOSURE", asserted tier 1 — and then died mid-series
 * with `Failed to connect to Roku ... on port 9000`, recorded as `crashed`, no record
 * written. `measure-signin.js` documents the same shape from a different angle ("RTA
 * surfaces a refused connect as a socket error event, outside the await chain, where no
 * `catch` can see it"), which is the second sighting.
 *
 * So the absence is tested WITHOUT RTA's client. A TCP connect to the port answers the
 * only question that matters — is the component there — costs one round trip instead of a
 * timeout, and leaves no promise behind.
 *
 * ⚠️ It says "something is listening", not "the ODC is healthy". That is the right
 * direction for this caller: the failure it guards against is a mislabeled arm still
 * holding an RTA build, and a listening port is enough to catch it. Callers who need the
 * component to actually ANSWER should use `readIdentity`.
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

/**
 * Tier 1 for an arm that has no ODC to read — [ADR 0030](../docs/adr/0030-non-odc-arm-identity-by-enclosure.md).
 *
 * The ODC calibration needs one arm with no resident on-device component, and identity
 * is read over ODC and nothing else, so that arm is the one arm that cannot observe what
 * server it measured against. It does not get to skip the assert: the failure tier 1
 * exists to catch — a device sitting on a server nobody meant to measure — has the same
 * shape and the same silence in a build with no ODC as in one with it.
 *
 * So the identity is asserted by ENCLOSURE, by the caller, and this records that it was.
 * `identitySource: 'enclosed'` is a FIELD rather than a note, so a reader wanting only
 * observed identities filters on one value and a reader who does not know the distinction
 * exists is told by what it reads. Never `'observed'`, and never written into
 * `provenance.server.url` as though it had been seen — that is the laundering
 * `readIdentity`'s throw exists to prevent, one layer up.
 *
 * What it does NOT claim is that the identity held at each sample; the enclosure is a
 * property of the BLOCK. `enclosureVerdict` below is what establishes it, and the caller
 * is responsible for not publishing a block whose enclosure did not close.
 */
export function enclosedServerIdentity(declaredServerUrl) {
  return {
    asserted: true,
    ok: true,
    noServer: false,
    // Nothing was observed IN THIS ARM, and the field says so rather than echoing the
    // declaration back — an `observed` equal to `expected` is exactly what a reader
    // takes as a passing read.
    observed: null,
    expected: declaredServerUrl,
    identitySource: 'enclosed',
    reason:
      'asserted by ENCLOSURE — this arm has no ODC, so identity comes from observed reads ' +
      'taken either side of it (ADR 0030), never from a read of its own.',
  };
}

/**
 * Did an enclosure CLOSE — i.e. may the block it brackets be published?
 *
 * Both brackets must agree with each other AND with what the operator declared. A
 * disagreement fails the whole enclosed block rather than one sample, because an
 * enclosure cannot say at which point inside it the identity moved — that is the honest
 * consequence of measuring at the boundary instead of at the sample, and it is why the
 * verdict is computed here rather than left as a warning for a reader to weigh.
 *
 * A bracket that could not be READ is a failure too, and a distinct one: an unread
 * bracket is not a disagreement, and saying "the identity drifted" about an ODC call that
 * timed out would send whoever hit it to look at the server.
 *
 * @param {object|null} before identity observed immediately before the enclosed block.
 * @param {object|null} after identity observed immediately after it.
 * @param {string} [declaredServer] what tier 1 was told to expect.
 */
export function enclosureVerdict({ before, after, declaredServer } = {}) {
  const missing = [!before && 'opening', !after && 'closing'].filter(Boolean);
  if (missing.length) {
    return {
      ok: false,
      identity: null,
      reason:
        `the ${missing.join(' and ')} bracket could not be read, so nothing observed this ` +
        'block. An unread bracket is not a disagreement — check that the ODC answered on ' +
        'the arms either side before suspecting the server moved.',
    };
  }
  const consistency = checkSeriesConsistency(before, after);
  if (!consistency.ok) {
    return {
      ok: false,
      identity: null,
      drifted: consistency.drifted,
      reason:
        'the two brackets disagree, so the identity moved somewhere inside this block: ' +
        consistency.drifted
          .map((d) => `${d.field} ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`)
          .join(', ') +
        '. The whole enclosed block fails — an enclosure cannot say WHERE inside itself it ' +
        'moved.',
    };
  }
  if (declaredServer && !sameServer(before.serverUrl, declaredServer)) {
    return {
      ok: false,
      identity: null,
      reason:
        `both brackets agree on ${JSON.stringify(before.serverUrl)}, which is not the ` +
        `${JSON.stringify(declaredServer)} this run declared. The enclosure is sound and the ` +
        'run is measuring the wrong server.',
    };
  }
  return {
    ok: true,
    identitySource: 'enclosed',
    identity: {
      serverUrl: before.serverUrl ?? null,
      serverId: before.serverId ?? null,
      serverVersion: before.serverVersion ?? null,
      apiVersion: before.apiVersion ?? null,
      userId: before.userId ?? null,
    },
    // BOTH reads are carried, not just the agreed value: the claim being recorded is
    // "two observations, taken either side, agreed", and a reader cannot check that
    // against a single collapsed field.
    brackets: { before, after },
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
