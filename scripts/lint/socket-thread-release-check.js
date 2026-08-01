// scripts/lint/socket-thread-release-check.js — guards the release of the
// ws:// socket Task thread (the `&h29` "Too many task threads" class, epic #728).
//
// WHY THIS EXISTS
// ---------------
// RokuOS caps concurrent Task threads at 50 (soft) / 100 (hard) per app, and a
// Task thread is NOT released by dropping the node reference — the spawned
// function has to return, or something has to STOP the node. RemoteControlTask
// creates a fresh `WebSocketClient` child per connect attempt, so before this
// was fixed every reconnect stranded a thread for the life of the app.
//
// Three source-level facts keep it released, and none of them fails loudly when
// broken. The app builds, connects, casts, and passes every test either way —
// the symptom is a crash days later on someone else's device, or a cast channel
// that silently stops reconnecting.
//
// WHY NOT AN END-TO-END TEST
// --------------------------
// Same unreachable path as socket-auth-binding-check.js: RTA drives an https://
// demo server (tests/rta/config.js) and the ws:// receiver only runs against
// http:// (remoteProtocol.isHttpServer, gated in RemoteControlTask.runReceiver),
// so the socket loop never executes under test. Rooibos runs on-device but has
// no way to hold a real socket open and drop it. Verifying this for real needs a
// local http:// Jellyfin plus a forced mid-session disconnect — a manual
// procedure. So this gates the source shape, and the paired Vitest test
// (tests/scripts/unit/lint/socket-thread-release.test.js) executes a model of
// the loop whose ordering is read back out of the real file.
//
// WHAT IT CHECKS
// --------------
//   1. The vendored task loop still has an `exit while` — without it, upstream's
//      infinite loop is back and every connect attempt leaks a thread.
//   2. That `exit while` sits BEFORE `m.ws.run()` in the loop body. This is the
//      subtle one. `run()` is what performs the CLOSED transition AND posts the
//      final ready_state/on_close/on_error messages to the port, so a
//      drained-port observation taken before `run()` proves nothing about what
//      `run()` then enqueued. Testing it after `run()` exits with the terminal
//      events still queued: m.top.on_close is never written, connectAndPump
//      blocks forever, and the cast channel dies without reconnecting. Ordering
//      is the entire invariant — the condition can look identical and be wrong.
//   3. The exit is guarded by the drained-port term (`msg = invalid`). That term
//      is what proves the queue was flushed to m.top before the thread went away.
//   4. The arming assignment sits AFTER `m.ws.run()` and is gated on
//      `m.connect_requested` — ready_state is CLOSED before open() is ever
//      called, so an un-opened node must keep waiting for its `open` event
//      instead of releasing the thread immediately.
//   5. RemoteControlTask publishes the child (`m.top.socketNode`), STOPs it in
//      closeSocket(), and clears the field there. The publish is what lets SignOut
//      reach a child whose owner thread is about to be killed; the STOP is what
//      covers the case where `control = "STOP"` — not the loop's own exit — is the
//      thing that has to release it; the clear is what stops the field naming a
//      node that is already dead across the reconnect backoff.
//   6. SignOut STOPs BOTH threads — the receiver and the published child — and
//      reaches the child through a LOCAL SNAPSHOT, never by dotting through the
//      field twice. `control = "STOP"` does not join the receiver thread, so it
//      can still be inside closeSocket() clearing that field between the test and
//      the use, and a dot on invalid crashes the calling thread mid-sign-out.
//
//      Rules 5 and 6 are deliberately written against the RESOLVED LOCALS rather
//      than against the presence of an identifier. An earlier draft asked only
//      whether the string `socketNode` appeared in SignOut, which passed a SignOut
//      that cleared the field without ever stopping the child — i.e. it passed the
//      precise regression it was written to catch. A guard nobody can test at
//      runtime has to be adversarial about its own false-passes.
//
// 1-4 live in vendored BrightWebSocket code, whose local modifications are
// documented in components/vendor/BrightWebSocket/README.md. A future upstream
// re-sync is the single likeliest way they get reverted.
//
// Only Node stdlib — no npm ci needed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripComments, indexOf } from './socket-auth-binding-check.js';

export const RECEIVER_REL = 'components/remotecontrol/RemoteControlTask.bs';
export const WS_TASK_REL =
  'components/vendor/BrightWebSocket/web_socket_client/WebSocketClientTask.brs';
export const SIGNOUT_REL = 'source/api/userAuth.bs';

const RE_EXIT = /exit\s+while/;
const RE_RUN = /m\.ws\.run\(\)/;
const RE_DRAIN = /msg\s*=\s*invalid/;
const RE_ARM = /m\.connection_closed\s*=\s*true/;
const RE_READY_CLOSED = /get_ready_state\(\)\s*=\s*m\.ws\.STATE\.CLOSED/;
const RE_CONNECT_REQUESTED = /m\.connect_requested/;

/**
 * Positional facts about the vendored task loop, in the order they execute.
 * Exported so the paired Vitest test can drive its loop model off the REAL
 * file instead of a hand-copied transcription that would drift.
 *
 * @param {string} wsTask — raw WebSocketClientTask.brs contents
 * @returns {{hasExit: boolean, exitBeforeRun: boolean, exitGuardHasDrain: boolean,
 *            armAfterRun: boolean, exitGuardHasReadyState: boolean}}
 */
export function extractLoopShape(wsTask) {
  const src = stripComments(wsTask);
  const exitIdx = indexOf(src, RE_EXIT);
  const runIdx = indexOf(src, RE_RUN);
  const armIdx = indexOf(src, RE_ARM);

  // The exit guard is the statement (or `if` block header) the `exit while`
  // belongs to: everything from the preceding line break back to the last `if`.
  const guard = exitIdx < 0 ? '' : src.slice(Math.max(0, exitIdx - 400), exitIdx);
  const lastIf = guard.lastIndexOf('if ');
  const guardText = lastIf < 0 ? guard : guard.slice(lastIf);

  return {
    hasExit: exitIdx >= 0,
    exitBeforeRun: exitIdx >= 0 && runIdx >= 0 && exitIdx < runIdx,
    exitGuardHasDrain: RE_DRAIN.test(guardText),
    // A guard that re-reads live socket state at the exit point instead of a
    // flag armed after run() is the pre-fix shape; modelled so the test can
    // reproduce the event-drop it caused.
    exitGuardHasReadyState: RE_READY_CLOSED.test(guardText),
    armAfterRun: armIdx >= 0 && runIdx >= 0 && armIdx > runIdx,
  };
}

// True when `<name>.control = "STOP"` appears — the only form that actually
// releases a Task thread. `name` is a local the caller resolved from the source,
// so this asks "is THIS binding stopped", not "does a STOP appear somewhere".
function stopsControlOf(src, name) {
  return new RegExp(`\\b${name}\\s*\\.\\s*control\\s*=\\s*"STOP"`).test(src);
}

/**
 * @param {{receiver: string, wsTask: string, signOut: string}} sources — file contents
 * @returns {string[]} violations; empty means the invariant holds
 */
export function check({ receiver, wsTask, signOut }) {
  const problems = [];
  const rx = stripComments(receiver);
  const wx = stripComments(wsTask);
  const sx = stripComments(signOut);
  const shape = extractLoopShape(wsTask);

  // ── 1. the loop still terminates ────────────────────────────────────────────
  if (!shape.hasExit) {
    problems.push(
      `${WS_TASK_REL}: the task loop has no \`exit while\` — upstream's infinite loop is back. ` +
        'Each connect attempt then holds a Task thread for the life of the app, against ' +
        "RokuOS's 100-thread hard cap (the &h29 crash class, epic #728).",
    );
    return problems; // rules 2-4 are all about that exit; nothing further to say
  }

  // ── 2. ordering: exit BEFORE run() ──────────────────────────────────────────
  if (indexOf(wx, RE_RUN) < 0) {
    problems.push(`${WS_TASK_REL}: no \`m.ws.run()\` call — cannot verify the loop-exit ordering.`);
  } else if (!shape.exitBeforeRun) {
    problems.push(
      `${WS_TASK_REL}: \`exit while\` runs AFTER \`m.ws.run()\`. run() is what performs the ` +
        'CLOSED transition and posts the final ready_state/on_close/on_error messages, so a ' +
        'drained-port observation taken before it says nothing about what it then enqueued. ' +
        'Exiting there strands the terminal events in the queue: m.top.on_close is never ' +
        'written, RemoteControlTask.connectAndPump blocks forever, and the cast channel dies ' +
        'silently instead of reconnecting. Move the test to the head of the loop body.',
    );
  }

  // ── 3. the exit is gated on a drained port ──────────────────────────────────
  if (!shape.exitGuardHasDrain) {
    problems.push(
      `${WS_TASK_REL}: the \`exit while\` guard does not test \`msg = invalid\`. The drained-port ` +
        'term is what proves every queued on_close/on_error/ready_state event was forwarded to ' +
        'm.top before the thread went away. Without it the loop can release the thread with the ' +
        'parent still waiting on an event it will now never receive.',
    );
  }

  // ── 4. arming: after run(), gated on connect_requested ──────────────────────
  if (!shape.armAfterRun) {
    problems.push(
      `${WS_TASK_REL}: the \`m.connection_closed = true\` arming assignment is missing or does ` +
        'not follow `m.ws.run()`. It has to be set from post-run() state, or the exit test at ' +
        'the head of the loop can never fire and the thread is held forever.',
    );
  } else {
    const arming = wx.slice(indexOf(wx, RE_RUN));
    if (!RE_CONNECT_REQUESTED.test(arming)) {
      problems.push(
        `${WS_TASK_REL}: the arming assignment is not gated on \`m.connect_requested\`. ` +
          'ready_state is CLOSED before open() is ever called, so an un-opened node would arm ' +
          'immediately and release its thread instead of waiting for its `open` field event.',
      );
    }
  }

  // ── 5. receiver publishes and STOPs the child ───────────────────────────────
  if (!/m\.top\.socketNode\s*=\s*m\.ws/.test(rx)) {
    problems.push(
      `${RECEIVER_REL}: the socket child is not published to \`m.top.socketNode\`. SignOut STOPs ` +
        'this task mid-loop, so closeSocket() never runs there — without the published handle ' +
        "the child's thread survives sign-out and server-switch (#728).",
    );
  }
  if (!/m\.top\.socketNode\s*=\s*invalid/.test(rx)) {
    problems.push(
      `${RECEIVER_REL}: closeSocket() never clears \`m.top.socketNode\`. The field would keep ` +
        'pointing at a STOPped child across the reconnect backoff, so a SignOut landing in that ' +
        'window STOPs a dead node and — worse — the stale handle outlives the socket it named.',
    );
  }
  if (indexOf(rx, /m\.ws\.control\s*=\s*"STOP"/) < 0) {
    problems.push(
      `${RECEIVER_REL}: closeSocket() does not set \`m.ws.control = "STOP"\`. Dropping the node ` +
        'reference does not release its Task thread; every reconnect would strand one (#728).',
    );
  }

  // ── 6. SignOut stops BOTH threads, and snapshots before dotting ─────────────
  //
  // Presence of the identifier is NOT the rule — the rule is that each of the two
  // threads is actually STOPped. Testing only for the word `socketNode` would let a
  // SignOut that merely clears the field pass, which is the exact regression this
  // rule exists to name. So resolve the locals the code binds and demand a STOP on
  // each of them.
  const rcLocal = /(\w+)\s*=\s*m\.global\.remoteControlTask/.exec(sx)?.[1];
  const receiverStopped = rcLocal
    ? stopsControlOf(sx, rcLocal)
    : /m\.global\.remoteControlTask\s*\.\s*control\s*=\s*"STOP"/.test(sx);
  if (!receiverStopped) {
    problems.push(
      `${SIGNOUT_REL}: SignOut does not set \`control = "STOP"\` on the remote-control receiver. ` +
        'It is the single logout + server-switch chokepoint, so without it the receiver keeps its ' +
        'thread — and its socket — across a logout or a server switch (#666, #728).',
    );
  }

  // Order matters: the dots-through form DOES stop the child, just unsafely, and it
  // leaves no local to resolve. Diagnosing it as "you never stopped the child" would
  // send the author looking for the wrong thing, so the anti-pattern is named first.
  const childLocal = /(\w+)\s*=\s*\w+\.socketNode\b/.exec(sx)?.[1];
  if (/\.socketNode\s*\.\s*control/.test(sx)) {
    problems.push(
      `${SIGNOUT_REL}: SignOut dots through \`.socketNode.control\` instead of snapshotting the ` +
        'child into a local first. `control = "STOP"` does not join the receiver thread, so it ' +
        'can clear that field (closeSocket) between the isValid() test and this write — a dot on ' +
        'invalid crashes the calling thread during sign-out. Read it into a local, then test and ' +
        'use the local.',
    );
  } else if (!childLocal || !stopsControlOf(sx, childLocal)) {
    problems.push(
      `${SIGNOUT_REL}: SignOut does not STOP the published \`socketNode\` child through a local ` +
        'snapshot. Clearing the field is not enough: the external STOP on the receiver kills it ' +
        "before its own closeSocket() can run, so nothing else releases the child's thread and it " +
        'outlives the session (#728). Bind the child to a local, then `<local>.control = "STOP"`.',
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
      signOut: readFileSync(path.join(rootDir, SIGNOUT_REL), 'utf8'),
    };
  } catch (err) {
    console.error(`socket-thread-release: ${err.message}`);
    process.exit(2);
  }

  const problems = check(sources);
  if (problems.length === 0) {
    console.log('socket-thread-release: the ws:// socket Task thread is still released ✓');
    return;
  }
  console.error('socket-thread-release: the ws:// socket thread can be leaked or stranded:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nWhy this blocks: a held Task thread accumulates silently toward RokuOS's 100-thread hard " +
      'cap (the &h29 crash in epic #728), and a stranded terminal event kills the cast channel ' +
      'with no crash and no failing test. See docs/architecture/remote-control.md ' +
      '("Socket-thread release") and components/vendor/BrightWebSocket/README.md.',
  );
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
