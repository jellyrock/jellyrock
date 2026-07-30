// scripts/lint/socket-auth-binding-check.js — guards the ws:// session-identity
// binding (issue #743).
//
// WHY THIS EXISTS
// ---------------
// Jellyfin resolves a request's DeviceId from the `Authorization` header and
// NOWHERE else — never from a query string — and when the header omits it the
// server silently substitutes the DeviceId the auth TOKEN was minted under
// (AuthorizationContext, identical 10.7 -> 10.11). So the `&deviceId=` parameter
// on the socket URL is inert, and a header-less ws:// upgrade lands on a
// DIFFERENT Jellyfin session than the REST API, the capabilities POST and
// /pair: the cast target resolves, but commands are delivered where the app
// isn't listening. That was #743.
//
// The fix is four lines spread across two files, and NONE of them fail loudly
// when broken — the app still builds, still connects, still passes every unit
// test. It just silently stops receiving cast commands. This check is the only
// automated gate on them.
//
// WHY NOT AN END-TO-END TEST
// --------------------------
// The natural gate would be an RTA functional test. It can't reach this path:
// RTA drives https://demo.jellyfin.org/stable (tests/rta/config.js), and the
// ws:// receiver only runs against an http:// server (remoteProtocol.isHttpServer,
// gated in RemoteControlTask.runReceiver) — on https it takes the long-poll
// branch instead. Verifying the real binding needs a local http:// Jellyfin plus
// a token minted under a mismatched DeviceId; that is a manual procedure, and
// the measured result is recorded in PR #747. This static check guards the
// SOURCE SHAPE those manual runs validated, so a later edit can't quietly
// revert it. See docs/progress.md for the open followup on closing the e2e gap.
//
// WHAT IT CHECKS
// --------------
//   1. RemoteControlTask sets `m.ws.headers` BEFORE `m.ws.open`. The client
//      builds its handshake string inside open(), so a header set afterwards
//      never reaches the wire. Reordering does NOT fail cleanly: the task's
//      startup seed reads m.top.headers before calling open, so whether it
//      breaks depends on which thread wins — i.e. INTERMITTENT cast failures.
//   2. WebSocketClientTask does not restore upstream's
//      `m.top.headers = m.ws.get_headers()`, which overwrites the caller's
//      header with the client's empty default.
//   3. Its replacement seed (`m.ws.set_headers(m.top.headers)`) sits between
//      the observer registration and the open() call — after, so a write that
//      landed early is picked up; before, so it reaches the handshake.
//   4. `m.task_port` (never assigned anywhere in the component: 3 reads, 0
//      writes) has not come back. It rebinds fields to an invalid port and is
//      only reachable now that we call set_headers.
//
// 2-4 all live in vendored BrightWebSocket code, whose local modifications are
// documented in components/vendor/BrightWebSocket/README.md. A future upstream
// re-sync is the single likeliest way they get reverted, and a large vendor
// diff is exactly where a four-line semantic change hides during review.
//
// Only Node stdlib — no npm ci needed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RECEIVER_REL = 'components/remotecontrol/RemoteControlTask.bs';
export const WS_TASK_REL =
  'components/vendor/BrightWebSocket/web_socket_client/WebSocketClientTask.brs';

// Strip whole-line BrightScript comments so a rule can't be satisfied — or
// tripped — by prose. The banned-pattern rules especially: every one of these
// patterns is quoted in an explanatory comment in the very files we scan.
function stripComments(src) {
  return src
    .split('\n')
    .map((line) => (/^\s*'/.test(line) ? '' : line))
    .join('\n');
}

// Index of the first match, or -1. Regex so we tolerate whitespace variation
// (`m.ws.headers=` vs `m.ws.headers  =`) without tolerating a different target.
function indexOf(src, re) {
  const m = re.exec(src);
  return m ? m.index : -1;
}

/**
 * @param {{receiver: string, wsTask: string}} sources — file contents
 * @returns {string[]} violations; empty means the invariant holds
 */
export function check({ receiver, wsTask }) {
  const problems = [];
  const rx = stripComments(receiver);
  const wx = stripComments(wsTask);

  // ── 1. receiver: headers before open ────────────────────────────────────────
  const setHeaders = indexOf(rx, /m\.ws\.headers\s*=/);
  const setOpen = indexOf(rx, /m\.ws\.open\s*=/);
  if (setHeaders < 0) {
    problems.push(
      `${RECEIVER_REL}: no \`m.ws.headers = ...\` assignment. The ws:// upgrade must carry an ` +
        "Authorization header, or the socket binds to the token's DeviceId instead of the " +
        'advertised one (#743).',
    );
  } else if (setOpen < 0) {
    problems.push(
      `${RECEIVER_REL}: no \`m.ws.open = ...\` assignment — cannot verify header ordering.`,
    );
  } else if (setHeaders > setOpen) {
    problems.push(
      `${RECEIVER_REL}: \`m.ws.headers\` is set AFTER \`m.ws.open\`. The client builds its ` +
        'handshake inside open(), so the header never reaches the wire. This fails ' +
        'INTERMITTENTLY (it depends on which thread wins startup), so tests will not catch it. ' +
        'Move the headers assignment above the open assignment (#743).',
    );
  }

  // ── 2. vendored task: no upstream clobber ───────────────────────────────────
  if (/m\.top\.headers\s*=\s*m\.ws\.get_headers\(\)/.test(wx)) {
    problems.push(
      `${WS_TASK_REL}: upstream's \`m.top.headers = m.ws.get_headers()\` is back. It overwrites ` +
        "the caller's Authorization header with the client's empty default, re-splitting the " +
        'Jellyfin session (#743). Seed the client FROM the node instead.',
    );
  }

  // ── 3. vendored task: seed sits between observers and open ──────────────────
  const seed = indexOf(wx, /m\.ws\.set_headers\(\s*m\.top\.headers\s*\)/);
  const observe = indexOf(wx, /observeField\(\s*"headers"/);
  const open = indexOf(wx, /m\.ws\.open\(/);
  if (seed < 0) {
    problems.push(
      `${WS_TASK_REL}: the \`m.ws.set_headers(m.top.headers)\` startup seed is missing. Without ` +
        'it, a caller that sets `headers` before this thread starts loses the value silently ' +
        '(init() sets control="RUN", so that race is the common case) (#743).',
    );
  } else {
    if (observe >= 0 && seed < observe) {
      problems.push(
        `${WS_TASK_REL}: the header seed runs BEFORE \`observeField("headers", ...)\`. Registering ` +
          'observers first is what closes the race in both directions — an early write is picked ' +
          'up by the seed, a later one still arrives as a field event (#743).',
      );
    }
    if (open >= 0 && seed > open) {
      problems.push(
        `${WS_TASK_REL}: the header seed runs AFTER \`m.ws.open(...)\`. The handshake is built ` +
          'inside open(), so headers seeded afterwards never reach the wire (#743).',
      );
    }
  }

  // ── 4. vendored task: the dead port typo stays dead ─────────────────────────
  if (/m\.task_port/.test(wx)) {
    problems.push(
      `${WS_TASK_REL}: \`m.task_port\` is back. It is never assigned in this component, so ` +
        'observeField() rebinds the field to an invalid port. Dead upstream, but live for us ' +
        'because the remote-control receiver sets `headers` — use `m.port` (#743).',
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
      wsTask: readFileSync(path.join(rootDir, WS_TASK_REL), 'utf8'),
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
