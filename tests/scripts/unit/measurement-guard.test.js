/**
 * The measurement guard — see `scripts/measurement-guard.js`.
 *
 * The load-bearing case is `sameServer`: tier 1 was CORRECTED to assert
 * `serverUrl` because the demo `/stable` and `/unstable` backends are cloned from
 * one seed database and report an identical `serverId` AND `userId` (measured
 * 2026-08-12). The pair therefore cannot see the likeliest wrong-server mistake,
 * and the pin below is what stops a future "normalise the URL a bit harder"
 * change from re-blinding it.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  buildFlagsAgree,
  checkSeriesConsistency,
  checkServerIdentity,
  IDENTITY_FATAL_FIELDS,
  enclosedServerIdentity,
  enclosureVerdict,
  odcIsResident,
  ODC_PORT,
  fatalIdentityFields,
  missingIdentityFields,
  readAppVersion,
  readCheckoutBuildFlags,
  sameServer,
} from '../../../scripts/measurement-guard.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-guard-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const writeManifest = (body) => {
  const p = path.join(tmp, `manifest-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(p, body);
  return p;
};

describe('sameServer', () => {
  it('treats a trailing slash and scheme/host case as the same server', () => {
    expect(
      sameServer('https://demo.jellyfin.org/stable', 'https://demo.jellyfin.org/stable/'),
    ).toBe(true);
    expect(sameServer('HTTPS://Demo.Jellyfin.ORG/stable', 'https://demo.jellyfin.org/stable')).toBe(
      true,
    );
  });

  it('does NOT collapse /stable and /unstable', () => {
    // The whole reason tier 1 moved off the serverId/userId pair. These two are
    // different Jellyfin versions behind one hostname, and the path is the only
    // field that separates them.
    expect(
      sameServer('https://demo.jellyfin.org/stable', 'https://demo.jellyfin.org/unstable'),
    ).toBe(false);
  });

  it('leaves the path case alone, where the scheme and host are lowercased', () => {
    // Deliberately shallow normalisation: an over-eager normaliser is how a guard
    // goes quietly blind, so anything past the provably-equivalent spellings is
    // left as a mismatch for a human to look at.
    expect(sameServer('https://host/Stable', 'https://host/stable')).toBe(false);
  });

  it('is false when either side is missing, never vacuously true', () => {
    expect(sameServer(undefined, 'https://x/y')).toBe(false);
    expect(sameServer('https://x/y', undefined)).toBe(false);
    expect(sameServer(undefined, undefined)).toBe(false);
  });

  it('separates two different hosts on the same path', () => {
    expect(sameServer('http://192.0.2.10:8096', 'http://192.0.2.11:8096')).toBe(false);
  });
});

describe('checkServerIdentity (tier 1)', () => {
  const identity = { serverUrl: 'http://192.0.2.10:8096', serverId: 'abc', userId: 'u1' };

  it('passes when the app is on the declared server', () => {
    const v = checkServerIdentity(identity, 'http://192.0.2.10:8096');
    expect(v).toMatchObject({ asserted: true, ok: true });
  });

  it('fails, and names both sides, when it is not', () => {
    const v = checkServerIdentity(identity, 'https://demo.jellyfin.org/stable');
    expect(v.asserted).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('192.0.2.10');
    expect(v.reason).toContain('demo.jellyfin.org/stable');
  });

  it('says explicitly that it did NOT assert when no expectation was declared', () => {
    // "Nobody told me which server to expect" and "the server is the one you
    // expected" must never look alike in the output — the entire value of the
    // tier is the difference between them.
    const v = checkServerIdentity(identity, undefined);
    expect(v.asserted).toBe(false);
    expect(v.ok).toBe(true);
    expect(v.reason).toMatch(/did NOT assert/);
  });

  it('explains why serverId/userId are not the fields to compare', () => {
    const v = checkServerIdentity(identity, 'https://demo.jellyfin.org/unstable');
    expect(v.reason).toMatch(/cloned from one seed DB|identical pair/);
  });
});

describe('checkServerIdentity — the no-server arm (--no-server)', () => {
  const hasServer = { serverUrl: 'http://192.0.2.10:8096', serverId: 'abc', userId: 'u1' };
  const noServer = { serverUrl: undefined, serverId: undefined, userId: undefined };

  it('ASSERTS rather than declining, when the app has no server as declared', () => {
    // The distinction that makes the flag worth having: this is not the
    // `asserted: false` case wearing a different hat. Something was checked.
    const v = checkServerIdentity(noServer, undefined, { expectNoServer: true });
    expect(v).toMatchObject({ asserted: true, ok: true, noServer: true });
    expect(v.reason).toBeUndefined();
  });

  it('treats an empty-string serverUrl as no server, matching missingIdentityFields', () => {
    // The app resets the server node in place rather than dropping it, so ODC can
    // answer `found: true` with `""`. If the two helpers disagreed on what counts as
    // absent, the run would pass tier 1 and then abort on a "fatal missing field".
    const v = checkServerIdentity({ ...noServer, serverUrl: '' }, undefined, {
      expectNoServer: true,
    });
    expect(v.ok).toBe(true);
  });

  it('FAILS when the app still has a server — the half that earns the assertion', () => {
    // `serverSelect` is reached by LAUNCHING, so a device that still has a server lands
    // on Home and every sample is a Home measurement filed under the screen the operator
    // asked for. Silent: the run completes and the samples are well-formed. This is the
    // only thing standing between that and a published number.
    const v = checkServerIdentity(hasServer, undefined, { expectNoServer: true });
    expect(v).toMatchObject({ asserted: true, ok: false, noServer: true });
    expect(v.reason).toContain('192.0.2.10');
    expect(v.reason).toMatch(/Change server/);
  });

  it('offers the OTHER exit too, so a `userSelect` operator is not sent in a circle', () => {
    // The failure this pins. Change user and Sign out both leave `server` in place, so
    // an operator measuring `userSelect` who reaches for this flag lands here — and a
    // message naming only "Change server" would send them off the screen they were
    // measuring. The run needs no declaration at all in that state.
    const v = checkServerIdentity(hasServer, undefined, { expectNoServer: true });
    expect(v.reason).toMatch(/userSelect/);
    expect(v.reason).toMatch(/drop --no-server/);
    expect(v.reason).toMatch(/--server <url> still asserts it/);
  });

  it('states noServer on EVERY arm, so the wire never reads the key as missing', () => {
    // Same argument as `provenance.server.url ?? null`: `JSON.stringify` drops an
    // undefined value, so a key present only when true reads as "this record predates
    // the field" on every record where it is false.
    expect(checkServerIdentity(hasServer, undefined, {}).noServer).toBe(false);
    expect(checkServerIdentity(hasServer, 'http://192.0.2.10:8096').noServer).toBe(false);
    expect(
      JSON.parse(JSON.stringify(checkServerIdentity(hasServer, undefined, {}))),
    ).toHaveProperty('noServer', false);
  });

  it('does not change the ordinary arms when the option is absent or false', () => {
    expect(checkServerIdentity(hasServer, undefined, {}).asserted).toBe(false);
    expect(checkServerIdentity(hasServer, undefined, { expectNoServer: false }).asserted).toBe(
      false,
    );
    expect(checkServerIdentity(hasServer, 'http://192.0.2.10:8096').ok).toBe(true);
  });
});

describe('checkSeriesConsistency', () => {
  const first = { serverUrl: 'http://a', serverId: 's1', userId: 'u1', serverVersion: '10.11.11' };

  it('passes when nothing moved under the series', () => {
    expect(checkSeriesConsistency(first, { ...first })).toEqual({ ok: true, drifted: [] });
  });

  it('catches a server that changed HALFWAY THROUGH', () => {
    // Different guarantee from the declared expectation, and neither subsumes the
    // other: this fires even when the drift lands on the expected server.
    const v = checkSeriesConsistency(first, { ...first, serverUrl: 'http://b' });
    expect(v.ok).toBe(false);
    expect(v.drifted).toEqual([{ field: 'serverUrl', from: 'http://a', to: 'http://b' }]);
  });

  it('catches a server UPGRADE mid-series, which no URL check would see', () => {
    const v = checkSeriesConsistency(first, { ...first, serverVersion: '12.0.0' });
    expect(v.ok).toBe(false);
    expect(v.drifted[0].field).toBe('serverVersion');
  });

  it('catches a user switch', () => {
    expect(checkSeriesConsistency(first, { ...first, userId: 'u2' }).ok).toBe(false);
  });
});

describe('readAppVersion', () => {
  it('reads the version THIS CHECKOUT would build, from the manifest', () => {
    // Not "what the device is running" — `npm run measure` defaults to measuring a
    // build it did not deploy. The record files this under `checkout` and carries
    // `deployedFromCheckout` beside it for exactly that reason.
    const p = writeManifest(
      'title=JellyRock\nmajor_version=2\nminor_version=25\nbuild_version=0\n',
    );
    expect(readAppVersion(p)).toBe('2.25.0');
  });

  it('returns undefined rather than a partial version', () => {
    const p = writeManifest('title=JellyRock\nmajor_version=2\n');
    expect(readAppVersion(p)).toBeUndefined();
  });

  it('returns undefined for a missing manifest instead of throwing', () => {
    expect(readAppVersion(path.join(tmp, 'nope'))).toBeUndefined();
  });
});

describe('readCheckoutBuildFlags', () => {
  it('parses bs_const', () => {
    const p = writeManifest('bs_const=debug=false;perfTiming=true\n');
    expect(readCheckoutBuildFlags(p)).toEqual({ debug: false, perfTiming: true });
  });

  it('REFUSES to report ENABLE_RTA, which the checkout cannot know', () => {
    // The committed value is always `false`; RTA's deploy flips it to `true` in the
    // STAGED build dir only. Reading it here reported `ENABLE_RTA: false` on every
    // run, including runs that had just deployed with it on and recorded
    // `enableRta: true` two fields away — one record, two answers, and the
    // contradiction manufactured by reading a file that cannot know. It is derived
    // from a responding ODC instead.
    const p = writeManifest('bs_const=debug=false;ENABLE_RTA=false;perfTiming=true\n');
    expect(readCheckoutBuildFlags(p)).not.toHaveProperty('ENABLE_RTA');
    expect(readCheckoutBuildFlags(p)).toEqual({ debug: false, perfTiming: true });
  });

  it('keeps a non-boolean value as a string rather than coercing it', () => {
    const p = writeManifest('bs_const=debug=false;someLevel=3\n');
    expect(readCheckoutBuildFlags(p).someLevel).toBe('3');
  });

  it('returns undefined when there is no bs_const line', () => {
    expect(readCheckoutBuildFlags(writeManifest('title=JellyRock\n'))).toBeUndefined();
  });

  it('matches the committed manifest, so the recorded flavor is real', () => {
    // Pins the tool against the actual repo state rather than a synthetic string:
    // `perfTiming` must be true or `npm run measure` samples a silent app.
    const flags = readCheckoutBuildFlags(path.join(process.cwd(), 'manifest'));
    expect(flags.perfTiming).toBe(true);
  });
});

describe('buildFlagsAgree — is the device running THIS checkout?', () => {
  it('is true when the app bracket matches the checkout', () => {
    expect(
      buildFlagsAgree({ debug: false, perfTiming: true }, { debug: false, perfTiming: true }),
    ).toBe(true);
  });

  it('is false when the running build was compiled differently', () => {
    // The only available evidence that a non-deploy run measured something other
    // than what this checkout would build — which is exactly the case where the
    // record's appVersion and commit describe the wrong artifact.
    expect(
      buildFlagsAgree({ debug: true, perfTiming: true }, { debug: false, perfTiming: true }),
    ).toBe(false);
  });

  it('is NULL, never true, when there is nothing to compare', () => {
    // "The flags match" and "no flags were seen" must not look alike — the same
    // rule that keeps `asserted: false` from looking like a tier-1 pass.
    expect(buildFlagsAgree(undefined, { debug: false })).toBeNull();
    expect(buildFlagsAgree({ debug: false }, undefined)).toBeNull();
    expect(buildFlagsAgree({ somethingElse: true }, { debug: false })).toBeNull();
  });

  it('ignores checkout flags the app does not stamp', () => {
    // The checkout declares more than the bracket carries; an absent key is not a
    // disagreement.
    expect(buildFlagsAgree({ debug: false }, { debug: false, perfTiming: true })).toBe(true);
  });
});

describe('missingIdentityFields — the quiet half of a failed read', () => {
  const full = {
    serverUrl: 'http://a',
    serverId: 's1',
    serverVersion: '10.11.11',
    apiVersion: 2,
    userId: 'u1',
  };

  it('reports nothing when the batch answered every field', () => {
    expect(missingIdentityFields(full)).toEqual([]);
  });

  it('names a field ODC answered but could not find', () => {
    // `readIdentity` throws when the BATCH fails — the loud case. This is the quiet
    // one: ODC answers and reports `found: false`, which otherwise becomes
    // `serverUrl: undefined` in a written record. That is the laundering the throw
    // exists to prevent, one layer down.
    expect(missingIdentityFields({ ...full, serverUrl: undefined })).toEqual(['serverUrl']);
  });

  it('treats an empty string as absent, not as a value', () => {
    // `JellyfinServer.serverUrl` defaults to `""`, so a not-signed-in app reports
    // found-but-empty rather than not-found.
    expect(missingIdentityFields({ ...full, serverUrl: '' })).toEqual(['serverUrl']);
  });

  it('makes serverUrl the fatal one, because tier 1 rests on it', () => {
    expect(IDENTITY_FATAL_FIELDS).toContain('serverUrl');
    expect(IDENTITY_FATAL_FIELDS).not.toContain('apiVersion');
  });
});

describe('fatalIdentityFields — which absent field aborts the series', () => {
  const noServer = { serverUrl: '', serverId: undefined, userId: undefined };

  it('aborts on an absent serverUrl by default', () => {
    expect(fatalIdentityFields(noServer)).toEqual(['serverUrl']);
  });

  it('does not abort on the non-fatal absences', () => {
    const noApiVersion = { serverUrl: 'http://a', serverId: 's1', apiVersion: undefined };
    expect(fatalIdentityFields(noApiVersion)).toEqual([]);
  });

  it('aborts on nothing once the operator DECLARED the no-server state', () => {
    expect(fatalIdentityFields(noServer, { expectNoServer: true })).toEqual([]);
  });

  it('requires the declaration — an absent serverUrl is never self-declaring', () => {
    // Deriving "no server" from the absence itself is how the tier goes blind: the
    // ordinary broken-read case and the intentional case become the same wire state,
    // and the ordinary one is what this module exists to catch. The flag is the only
    // thing that separates them, so its absence must still abort.
    expect(fatalIdentityFields(noServer, {})).toEqual(['serverUrl']);
    expect(fatalIdentityFields(noServer, { expectNoServer: false })).toEqual(['serverUrl']);
  });

  it('never aborts on the `userSelect` state, with or without the flag', () => {
    // The screen that is NOT what this option is for, pinned so the two pre-login states
    // cannot drift back together. Change user / Sign out clear `active_user` and leave
    // `server` alone, so identity reads a real `serverUrl` and only `userId` is absent —
    // which is deliberately not fatal. That is what already makes `userSelect`
    // measurable with no declaration at all.
    const onUserSelect = { serverUrl: 'http://192.0.2.10:8096', serverId: 'abc' };
    expect(fatalIdentityFields(onUserSelect)).toEqual([]);
    expect(missingIdentityFields(onUserSelect)).toContain('userId');
    expect(IDENTITY_FATAL_FIELDS).not.toContain('userId');
    // …and the flag would REFUSE that state, which is why nothing may advertise it there.
    expect(checkServerIdentity(onUserSelect, undefined, { expectNoServer: true }).ok).toBe(false);
  });
});

describe('enclosedServerIdentity — tier 1 for an arm with no ODC (ADR 0030)', () => {
  const url = 'http://192.0.2.10:8096';

  it('asserts, and says the assertion was ENCLOSED rather than observed', () => {
    expect(enclosedServerIdentity(url)).toMatchObject({
      asserted: true,
      ok: true,
      expected: url,
      identitySource: 'enclosed',
    });
  });

  it('records `observed: null` rather than echoing the declaration back', () => {
    // An `observed` equal to `expected` is exactly what a reader takes as a passing
    // read, which would launder the caller's inference into this arm's own observation —
    // the failure ADR 0030 rejected "carry the paired arm's identity across" over.
    expect(enclosedServerIdentity(url).observed).toBeNull();
  });

  it('is never `observed`, whatever it was handed', () => {
    expect(enclosedServerIdentity(url).identitySource).not.toBe('observed');
  });
});

describe('enclosureVerdict — may the enclosed block be published?', () => {
  const url = 'http://192.0.2.10:8096';
  const identity = (over = {}) => ({
    serverUrl: url,
    serverId: 'abc',
    serverVersion: '10.11.11',
    apiVersion: '1',
    userId: 'u1',
    ...over,
  });

  it('closes when both brackets agree with each other and with the declaration', () => {
    const verdict = enclosureVerdict({
      before: identity(),
      after: identity(),
      declaredServer: url,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.identitySource).toBe('enclosed');
    expect(verdict.identity.serverUrl).toBe(url);
  });

  it('carries BOTH reads, not just the agreed value', () => {
    // The claim on the record is "two observations, taken either side, agreed". A single
    // collapsed field gives a reader no way to check that.
    const verdict = enclosureVerdict({
      before: identity(),
      after: identity(),
      declaredServer: url,
    });
    expect(verdict.brackets.before).toBeTruthy();
    expect(verdict.brackets.after).toBeTruthy();
  });

  it('fails the WHOLE block when the brackets disagree, and names the drift', () => {
    const verdict = enclosureVerdict({
      before: identity(),
      after: identity({ serverUrl: 'http://192.0.2.11:8096' }),
      declaredServer: url,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.identity).toBeNull();
    expect(verdict.reason).toMatch(/serverUrl/);
    expect(verdict.reason).toMatch(/cannot say WHERE inside itself it moved/);
  });

  it('catches drift in a field tier 1 does not assert on', () => {
    // `serverId` / `userId` cannot tell the demo stable/unstable backends apart, which is
    // why tier 1 asserts the URL — but a MOVE in one of them is still the server changing
    // under the block, and the enclosure is the only thing watching here.
    const verdict = enclosureVerdict({
      before: identity(),
      after: identity({ userId: 'someone-else' }),
      declaredServer: url,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/userId/);
  });

  it('fails when the agreed identity is not the declared one', () => {
    // The enclosure is sound and the run is measuring the wrong server — a distinct
    // failure from the brackets disagreeing, and it needs a distinct sentence.
    const other = 'http://192.0.2.11:8096';
    const verdict = enclosureVerdict({
      before: identity(),
      after: identity(),
      declaredServer: other,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/not the .* this run declared/);
  });

  it.each([
    ['opening', { before: null, after: {} }],
    ['closing', { before: {}, after: null }],
  ])('fails on an unread %s bracket, and does NOT call it a disagreement', (which, brackets) => {
    // "The identity drifted" about an ODC call that timed out sends whoever hit it to
    // look at the server, which is the one place the answer is not.
    const verdict = enclosureVerdict({ ...brackets, declaredServer: url });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(new RegExp(`${which} bracket could not be read`));
    expect(verdict.reason).toMatch(/not a disagreement/);
  });

  it('uses tier 1’s own normalizer, so a trailing slash is not a failure', () => {
    expect(
      enclosureVerdict({
        before: identity(),
        after: identity(),
        declaredServer: `${url}/`,
      }).ok,
    ).toBe(true);
  });
});

describe('odcIsResident — testing for the ODC WITHOUT using RTA to do it', () => {
  /** Listen on an ephemeral port and hand it back, closing after the test. */
  const listening = async () => {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
  };

  it('is true when something is listening', async () => {
    const server = await listening();
    try {
      expect(await odcIsResident('127.0.0.1', { port: server.port })).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('is false when the port is refused — the plain arm’s expected answer', async () => {
    // The case that matters: a build with no on-device component refuses on 9000, and
    // this must resolve rather than reject. Trying the same question through RTA's client
    // instead retries the refusal internally and rejects a CACHED promise later, with
    // nobody attached — an `unhandledRejection` that killed both plain-arm blocks of the
    // first calibration run AFTER they had passed the check (2026-08-17).
    const server = await listening();
    const port = server.port;
    await server.close();
    expect(await odcIsResident('127.0.0.1', { port })).toBe(false);
  });

  it('never rejects, so a caller cannot be taken out by the probe itself', async () => {
    await expect(odcIsResident('127.0.0.1', { port: 1, timeoutMs: 500 })).resolves.toBe(false);
  });

  it('defaults to the port RTA’s component listens on', () => {
    expect(ODC_PORT).toBe(9000);
  });
});
