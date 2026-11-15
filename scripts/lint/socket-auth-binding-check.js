// scripts/lint/socket-auth-binding-check.js: guards the ws:// session-identity
// binding (issue #743).
//
// WHY THIS EXISTS
// ---------------
// Jellyfin resolves a request's DeviceId from the `Authorization` header and
// nowhere else (never from a query string), and when the header omits it the
// server silently substitutes the DeviceId the auth TOKEN was minted under
// (AuthorizationContext, identical 10.7 -> 10.11). So the `&deviceId=` parameter
// on the socket URL is inert, and a header-less ws:// upgrade lands on a
// DIFFERENT Jellyfin session than the REST API, the capabilities POST and
// /pair: the cast target resolves, but commands are delivered where the app
// isn't listening. That was #743.
//
// The fix is one line that does not fail loudly when broken: the app still
// builds, still connects, still passes every unit test. It only silently stops
// receiving cast commands. This check is the only automated gate on it.
//
// WHY NO END-TO-END TEST
// -----------------------
// The natural gate would be an RTA functional test. It can't reach this path:
// RTA drives https://demo.jellyfin.org/stable (tests/rta/config.js), and the
// ws:// receiver only runs against an http:// server (remoteProtocol.isHttpServer,
// gated in RemoteControlTask.runReceiver); on https it takes the long-poll
// branch instead. Verifying the real binding needs a local http:// Jellyfin plus
// a token minted under a mismatched DeviceId; that is a manual procedure, and
// the measured result is recorded in PR #747. This static check guards the
// SOURCE SHAPE those manual runs validated, so a later edit can't quietly
// revert it. See docs/progress.md for the open followup on closing the e2e gap.
//
// WHAT IT CHECKS
// --------------
// RemoteControlTask calls `m.ws.set_headers(...)` BEFORE `m.ws.open(...)`. The
// client builds its handshake string inside open(), so a header set afterwards
// never reaches the wire. The receiver runs the client object on its own
// thread, so there is no second file to guard: the socket Task that once sat
// between them, and its three rules here, are gone.
//
// Only Node stdlib, so no npm ci needed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RECEIVER_REL = 'components/remotecontrol/RemoteControlTask.bs';

// Strip whole-line BrightScript comments so the rule can't be satisfied (or
// tripped) by prose.
export function stripComments(src) {
  return src
    .split('\n')
    .map((line) => (/^\s*'/.test(line) ? '' : line))
    .join('\n');
}

// Index of the first match, or -1. Regex so we tolerate whitespace variation
// (`m.ws.open(` vs `m.ws.open (`) without tolerating a different target.
export function indexOf(src, re) {
  const m = re.exec(src);
  return m ? m.index : -1;
}

/**
 * @param {{receiver: string}} sources file contents
 * @returns {string[]} violations; empty means the invariant holds
 */
export function check({ receiver }) {
  const problems = [];
  const rx = stripComments(receiver);

  const setHeaders = indexOf(rx, /m\.ws\.set_headers\s*\(/);
  const setOpen = indexOf(rx, /m\.ws\.open\s*\(/);
  if (setHeaders < 0) {
    problems.push(
      `${RECEIVER_REL}: no \`m.ws.set_headers(...)\` call. The ws:// upgrade must carry an ` +
        "Authorization header, or the socket binds to the token's DeviceId instead of the " +
        'advertised one (#743).',
    );
  } else if (setOpen < 0) {
    problems.push(`${RECEIVER_REL}: no \`m.ws.open(...)\` call — cannot verify header ordering.`);
  } else if (setHeaders > setOpen) {
    problems.push(
      `${RECEIVER_REL}: \`m.ws.set_headers\` is called AFTER \`m.ws.open\`. The client builds its ` +
        'handshake inside open(), so the header never reaches the wire. Move the set_headers ' +
        'call above the open call (#743).',
    );
  }

  return problems;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? argv[rootIdx + 1] : '.';

  let sources;
  try {
    sources = {
      receiver: readFileSync(path.join(rootDir, RECEIVER_REL), 'utf8'),
    };
  } catch (err) {
    console.error(`socket-auth-binding: ${err.message}`);
    process.exit(2);
  }

  const problems = check(sources);
  if (problems.length === 0) {
    console.log('socket-auth-binding: ws:// upgrade still carries the advertised DeviceId ✓');
    return;
  }
  console.error('socket-auth-binding: the ws:// session-identity binding is broken:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nWhy this blocks: cast commands would be delivered to a different Jellyfin session than ' +
      'the app listens on — silently, with no crash and no failing test. See ' +
      'docs/architecture/remote-control.md ("How the DeviceId is actually bound") and issue #743.',
  );
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
