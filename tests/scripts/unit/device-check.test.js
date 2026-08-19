/**
 * `npm run device:check`. See `scripts/device-check.js`.
 *
 * The behaviour under test is mostly about what the tool SAYS, which is unusual for a
 * probe — but the failure it exists to prevent is a false REPORT ("no device access") on a
 * machine with three Rokus answering, so the wording is the product and the probe is the
 * plumbing. The probes themselves are `fetchDeviceInfo` / `odcIsResident` and are tested
 * where they live; nothing is re-probed here.
 */
import { describe, expect, it } from 'vitest';

import { hostsToCheck, report, verdict } from '../../../scripts/device-check.js';

const up = (over = {}) => ({
  host: '192.0.2.10',
  reachable: true,
  model: 'Streaming Stick 4K',
  modelNumber: '3820X',
  osVersion: '15.3.4',
  tier: '1GB',
  odc: false,
  error: null,
  ...over,
});

describe('which hosts get probed', () => {
  it('prefers explicit arguments over anything in the environment', () => {
    expect(hostsToCheck(['192.0.2.99'], { ROKU_IP: '192.0.2.10' })).toEqual(['192.0.2.99']);
  });

  it('falls back to ROKU_DEVICES, then ROKU_IP', () => {
    expect(hostsToCheck([], { ROKU_DEVICES: '192.0.2.10,192.0.2.11' })).toEqual([
      '192.0.2.10',
      '192.0.2.11',
    ]);
    expect(hostsToCheck([], { ROKU_IP: '192.0.2.10' })).toEqual(['192.0.2.10']);
  });

  it('parses ROKU_DEVICES through the same helper `measure:devices` uses', () => {
    // A list that works for one command has to mean the same thing here, or the check
    // reports on a different set of devices than the run does.
    expect(hostsToCheck([], { ROKU_DEVICES: ' 192.0.2.10 , 192.0.2.11 ' })).toEqual([
      '192.0.2.10',
      '192.0.2.11',
    ]);
  });

  it('returns nothing when no device is configured, rather than inventing a default', () => {
    expect(hostsToCheck([], {})).toEqual([]);
  });

  it('treats an UNSET ROKU_DEVICES as absent, not as an empty declaration', () => {
    // `parseDeviceList` refuses `''` on purpose — "set but names no device" is an operator
    // error. Unset is a different state and has to fall through to ROKU_IP, not throw.
    expect(() => hostsToCheck([], { ROKU_IP: '192.0.2.10' })).not.toThrow();
    expect(hostsToCheck([], { ROKU_IP: '192.0.2.10' })).toEqual(['192.0.2.10']);
  });
});

describe('the verdict — the sentence the caller has to write afterwards', () => {
  it('says hardware IS available and to run the tests, when anything answered', () => {
    // The whole point. A reachable device must produce an instruction to test, not a
    // neutral status the reader can round down to "probably fine to skip".
    const v = verdict([up(), { host: '192.0.2.11', reachable: false, error: 'timeout' }]);
    expect(v).toMatch(/1 of 2 device\(s\) answered — hardware IS available, so run the tests/);
  });

  it('distinguishes "the probe failed" from "I lack access" when nothing answered', () => {
    // These are different claims and only one of them is checkable. The failure this tool
    // exists for is reporting the second when the first was never attempted.
    expect(verdict([{ host: '192.0.2.10', reachable: false, error: 'timeout' }])).toMatch(
      /say the probe failed rather than that you lack access/,
    );
  });

  it('calls an unconfigured checkout a checked fact, not an assumption', () => {
    expect(verdict([])).toMatch(/checked fact rather than an assumption/);
  });

  it('never lets ECP reachability imply a sideload will succeed', () => {
    // Dev mode off, or ROKU_PASSWORD belonging to a different device, still fails at
    // deploy — reporting "reachable" and then failing to deploy is its own bad report.
    expect(verdict([up()])).toMatch(/does not prove a sideload will succeed/);
  });
});

describe('the report', () => {
  it('names the model, OS and hardware tier of a device that answered', () => {
    expect(report([up()]).join('\n')).toMatch(
      /✓ 192\.0\.2\.10 — Streaming Stick 4K · Roku OS 15\.3\.4/,
    );
  });

  it('attributes a non-answer instead of dropping the device', () => {
    const out = report([{ host: '192.0.2.11', reachable: false, error: 'ECONNREFUSED' }]).join(
      '\n',
    );
    expect(out).toMatch(/✗ 192\.0\.2\.11 — no answer over ECP \(ECONNREFUSED\)/);
  });

  it('does NOT read an absent ODC as a missing RTA build', () => {
    // The component lives inside the running channel, so port 9000 goes quiet when the app
    // closes — a device still holding an RTA build reports absent. Telling the reader to
    // redeploy would be wrong advice on a correctly-deployed device.
    const out = report([up({ odc: false })]).join('\n');
    expect(out).toMatch(/either no RTA build is resident, or the channel is simply closed/);
    expect(out).not.toMatch(/deploy an RTA build/);
  });

  it('says an answering ODC means resident AND running', () => {
    expect(report([up({ odc: true })]).join('\n')).toMatch(/resident AND running/);
  });
});
