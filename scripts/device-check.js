/**
 * IS THERE A DEVICE? — answer it in one command, before claiming there isn't.
 *
 *   npm run device:check                    every device this checkout knows about
 *   npm run device:check -- 192.0.2.10      one host, ignoring .env
 *
 * ## Why this exists
 *
 * Eleven agent-facing places in this repo said "if hardware isn't reachable, say so
 * explicitly" and **not one of them said how to find out**. A rule phrased that way is
 * satisfied most cheaply by asserting unavailability, which is exactly what kept
 * happening: reviews reporting "I couldn't run the tests, no device access" on a machine
 * with a Roku answering on the LAN the whole time. That reads to whoever asked like a
 * considered result rather than a guess, which is what makes it expensive.
 *
 * So the fix is not another reminder — it is making the check cheaper than the excuse.
 *
 * ## It reuses the probes; it does not add any
 *
 * `fetchDeviceInfo` (ECP `/query/device-info`, the lock's own identity read) and
 * `odcIsResident` (a TCP connect to the ODC port) already existed and are already tested.
 * A second fetcher would be a second timeout policy and a second error vocabulary — the
 * exact argument `device-lock.js` makes for exporting the first one. This file is a CLI
 * over them and owns no probe of its own.
 *
 * ## What each answer licenses
 *
 * ECP is unauthenticated and needs neither dev mode nor "control by mobile apps", so it
 * answers on ANY powered Roku on the LAN. That makes it the right question for "is there
 * a device at all" and the wrong one for "can I deploy to it" — a device answering ECP can
 * still refuse a sideload if dev mode is off or `ROKU_PASSWORD` is another device's. The
 * output says which question it answered, because reporting "reachable" and then failing to
 * deploy is its own kind of misleading.
 *
 * ⚠️ The ODC line is even narrower, and the obvious reading of it is wrong. The component
 * lives INSIDE the running channel, so port 9000 goes quiet the moment the app closes — a
 * device that ran `measure --deploy` an hour ago reports "not answering" with the RTA build
 * still sideloaded on it. Absence therefore means "no RTA build **or** the channel is
 * closed", and it is never on its own a reason to redeploy.
 */
import path from 'node:path';

import { fetchDeviceInfo } from './device-lock.js';
import { odcIsResident } from './measurement-guard.js';
import { parseDeviceList } from './measure-matrix.js';
import { describeDevice, ramTierFor } from './roku-devices.js';

/**
 * Which hosts to probe: explicit arguments win, else `ROKU_DEVICES`, else `ROKU_IP`.
 *
 * Through `parseDeviceList` rather than a local `split(',')` so a `ROKU_DEVICES` value
 * that works for `measure:devices` means the same thing here.
 */
export function hostsToCheck(argv = [], env = process.env) {
  const explicit = argv.filter((a) => !a.startsWith('-'));
  if (explicit.length) return explicit;
  // Only when it is actually SET: `parseDeviceList` refuses an empty value on purpose
  // ("set but names no device" is an operator error worth refusing), and an unset variable
  // is a different state that must fall through to `ROKU_IP` rather than throw.
  if (env.ROKU_DEVICES) {
    const declared = parseDeviceList(env.ROKU_DEVICES);
    if (declared.length) return declared;
  }
  return env.ROKU_IP ? [env.ROKU_IP] : [];
}

/**
 * Probe one host. Never throws — an unreachable device is an ANSWER, not an error, and a
 * caller checking three devices should not lose the other two to the first failure.
 */
export async function checkHost(host) {
  try {
    const info = await fetchDeviceInfo(host);
    const modelNumber = info['model-number'] ?? null;
    return {
      host,
      reachable: true,
      model: info['model-name'] ?? null,
      modelNumber,
      osVersion: info['software-version'] ?? null,
      tier: modelNumber ? ramTierFor(modelNumber) : null,
      // Only meaningful once ECP answered: a TCP probe of a dead host says nothing.
      odc: await odcIsResident(host),
      error: null,
    };
  } catch (e) {
    return { host, reachable: false, error: e?.message || String(e) };
  }
}

/** One line per device, plus the verdict a caller is actually deciding on. */
export function report(results) {
  const lines = [];
  for (const r of results) {
    if (!r.reachable) {
      lines.push(`  ✗ ${r.host} — no answer over ECP (${r.error})`);
      continue;
    }
    const known = r.modelNumber ? describeDevice(r.modelNumber) : 'unlisted model';
    lines.push(
      `  ✓ ${r.host} — ${r.model ?? 'unknown'} · Roku OS ${r.osVersion ?? '?'} · ${known}`,
    );
    lines.push(
      `      ODC ${
        r.odc
          ? 'answering — an RTA build is resident AND running'
          : 'not answering — either no RTA build is resident, or the channel is simply closed'
      }`,
    );
  }
  return lines;
}

/**
 * The sentence the caller has to be able to write honestly afterwards.
 *
 * Deliberately not a bare "OK"/"FAIL": the thing being prevented is a REPORT, so the tool
 * hands over the wording rather than leaving it to be improvised.
 */
export function verdict(results) {
  const up = results.filter((r) => r.reachable);
  if (!results.length) {
    return 'No device configured — set ROKU_IP (or ROKU_DEVICES) in .env. Hardware tests cannot run, and that is now a checked fact rather than an assumption.';
  }
  if (!up.length) {
    return `No device answered (${results.length} tried). Hardware tests cannot run — say so, and say the probe failed rather than that you lack access.`;
  }
  return (
    `${up.length} of ${results.length} device(s) answered — hardware IS available, so run the tests ` +
    '(`npm run test:tdd` / `test:unit` / `test:rta`). ECP answering does not prove a sideload will ' +
    'succeed: dev mode off or a mismatched ROKU_PASSWORD still fails at deploy, which is a different report.'
  );
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const hosts = hostsToCheck(process.argv.slice(2));
  if (!hosts.length) {
    console.log('[device:check] no host configured');
    console.log(`  ${verdict([])}`);
    process.exit(1);
  }
  console.log(`[device:check] probing ${hosts.length} host(s) over ECP…\n`);
  const results = await Promise.all(hosts.map(checkHost));
  for (const line of report(results)) console.log(line);
  console.log(`\n  ${verdict(results)}`);
  process.exit(results.some((r) => r.reachable) ? 0 : 1);
}
