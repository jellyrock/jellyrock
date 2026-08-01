// Tests for scripts/lint/socket-thread-release-check.js — the static guard on
// release of the ws:// socket Task thread (epic #728).
//
// Two layers:
//
//  1. PURE — hand-written source strings exercise each rule, plus a smoke pass
//     over the REAL committed files so reverting any part of the fix fails here.
//
//  2. EXECUTABLE MODEL — the loop-exit ordering is the one rule whose condition
//     can look identical and still be wrong, so asserting on source position
//     alone is weak. This layer models WebSocketClient's posting contract (WHEN
//     it enqueues terminal events relative to the ready_state it reports,
//     transcribed with line citations from WebSocketClient.brs) and runs the
//     loop against it — with the loop's ordering READ BACK OUT of the real
//     WebSocketClientTask.brs via extractLoopShape(), so the model can't drift
//     away from the source it claims to test. The pre-fix ordering is asserted
//     to drop the terminal event; the committed one is asserted not to.
//
// There is no device and no Jellyfin server in this suite by design: the ws://
// receiver is unreachable from RTA (it drives https://, the receiver only runs
// on http://) and Rooibos can't hold a real socket open and drop it. See the
// lint's header for the full "why not an end-to-end test".

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check,
  extractLoopShape,
  RECEIVER_REL,
  WS_TASK_REL,
  SIGNOUT_REL,
} from '../../../../scripts/lint/socket-thread-release-check.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

// ── layer 1: pure ──────────────────────────────────────────────────────────────

// Minimal well-formed sources — the shape the guard wants, nothing more.
const GOOD_WS_TASK = `
sub runSocketLoop()
  m.connect_requested = false
  m.connection_closed = false
  while true
    msg = wait(100, m.port)
    if m.connection_closed and msg = invalid
      exit while
    end if
    m.ws.run()
    if m.connect_requested and m.ws.get_ready_state() = m.ws.STATE.CLOSED
      m.connection_closed = true
    end if
  end while
end sub
`;

const GOOD_RECEIVER = `
function connectAndPump(url as string) as boolean
  m.ws = CreateObject("roSGNode", "WebSocketClient")
  m.top.socketNode = m.ws
end function

sub closeSocket()
  m.ws.close = [1000]
  m.ws.control = "STOP"
  m.top.socketNode = invalid
end sub
`;

const GOOD_SIGNOUT = `
sub SignOut(deleteSavedEntry = true as boolean)
  remoteControlTask = m.global.remoteControlTask
  if isValid(remoteControlTask)
    remoteControlTask.control = "STOP"
    socketNode = remoteControlTask.socketNode
    if isValid(socketNode) then socketNode.control = "STOP"
    remoteControlTask.socketNode = invalid
  end if
end sub
`;

const good = () => ({ receiver: GOOD_RECEIVER, wsTask: GOOD_WS_TASK, signOut: GOOD_SIGNOUT });

describe('the happy path', () => {
  it('reports nothing when all three files hold the invariant', () => {
    expect(check(good())).toEqual([]);
  });

  it('is not satisfied by prose — the rules read code, not comments', () => {
    const wsTask = GOOD_WS_TASK.replace(/^\s*exit while$/m, "  ' exit while");
    expect(check({ ...good(), wsTask }).join('\n')).toMatch(/no `exit while`/);
  });
});

describe('rule 1 — the loop terminates', () => {
  it("flags upstream's infinite loop (the state of main before the fix)", () => {
    const wsTask = GOOD_WS_TASK.replace(/\s*exit while\n/, '\n');
    const problems = check({ ...good(), wsTask });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(WS_TASK_REL);
    expect(problems[0]).toMatch(/100-thread hard cap/);
  });
});

describe('rule 2 — the exit test precedes m.ws.run()', () => {
  // The literal shape of commit 965052ba: condition correct, position wrong.
  const PREFIX_WS_TASK = `
sub runSocketLoop()
  m.connect_requested = false
  while true
    msg = wait(100, m.port)
    m.ws.run()
    if m.connect_requested and msg = invalid and m.ws.get_ready_state() = m.ws.STATE.CLOSED
      exit while
    end if
  end while
end sub
`;

  it('flags an exit placed after run(), even with the drain term present', () => {
    const problems = check({ ...good(), wsTask: PREFIX_WS_TASK });
    expect(problems.join('\n')).toMatch(/`exit while` runs AFTER `m\.ws\.run\(\)`/);
  });

  it('explains the consequence, not just the rule', () => {
    const problems = check({ ...good(), wsTask: PREFIX_WS_TASK });
    expect(problems.join('\n')).toMatch(/m\.top\.on_close is never written/);
  });
});

describe('rule 3 — the exit is gated on a drained port', () => {
  it('flags an exit that releases the thread without draining', () => {
    const wsTask = GOOD_WS_TASK.replace(
      'm.connection_closed and msg = invalid',
      'm.connection_closed',
    );
    expect(check({ ...good(), wsTask }).join('\n')).toMatch(/does not test `msg = invalid`/);
  });
});

describe('rule 4 — arming follows run() and respects connect_requested', () => {
  it('flags a missing arming assignment — the thread would never be released', () => {
    const wsTask = GOOD_WS_TASK.replace(/\s*m\.connection_closed = true\n/, '\n');
    expect(check({ ...good(), wsTask }).join('\n')).toMatch(/arming assignment is missing/);
  });

  it('flags arming that ignores connect_requested — an un-opened node would self-release', () => {
    const wsTask = GOOD_WS_TASK.replace(
      'm.connect_requested and m.ws.get_ready_state()',
      'm.ws.get_ready_state()',
    );
    expect(check({ ...good(), wsTask }).join('\n')).toMatch(/not gated on `m\.connect_requested`/);
  });
});

describe('rule 5 — the receiver publishes and STOPs its child', () => {
  it('flags a child that is never published', () => {
    const receiver = GOOD_RECEIVER.replace(/\s*m\.top\.socketNode = m\.ws\n/, '\n');
    expect(check({ ...good(), receiver }).join('\n')).toMatch(
      /not published to `m\.top\.socketNode`/,
    );
  });

  it('flags a closeSocket() that drops the reference without STOPping', () => {
    const receiver = GOOD_RECEIVER.replace(/\s*m\.ws\.control = "STOP"\n/, '\n');
    expect(check({ ...good(), receiver }).join('\n')).toMatch(
      /does not set `m\.ws\.control = "STOP"`/,
    );
  });

  it('flags a STOP issued before the close request — the frame would never be sent', () => {
    const receiver = `
sub closeSocket()
  m.ws.control = "STOP"
  m.ws.close = [1000]
end sub
sub publish()
  m.top.socketNode = m.ws
end sub
`;
    expect(check({ ...good(), receiver }).join('\n')).toMatch(/STOPs the child BEFORE/);
  });
});

describe('rule 6 — SignOut stops both threads, and snapshots before dotting', () => {
  // These three mutations all passed an earlier draft of the guard, because the
  // rules tested for the PRESENCE of an identifier rather than for a STOP on a
  // resolved binding. Each one is a real regression the guard is meant to own, so
  // each stays pinned here rather than living only in the rule's prose.
  it('flags a SignOut that clears the field but never stops the child', () => {
    const signOut = GOOD_SIGNOUT.replace(
      '    if isValid(socketNode) then socketNode.control = "STOP"\n',
      '',
    );
    expect(check({ ...good(), signOut }).join('\n')).toMatch(/does not STOP the published/);
  });

  it('flags a SignOut that stops the child but not the receiver itself', () => {
    const signOut = GOOD_SIGNOUT.replace('    remoteControlTask.control = "STOP"\n', '');
    expect(check({ ...good(), signOut }).join('\n')).toMatch(
      /does not set `control = "STOP"` on the remote-control receiver/,
    );
  });

  it('flags a closeSocket() that leaves a stale handle in the published field', () => {
    const receiver = GOOD_RECEIVER.replace('  m.top.socketNode = invalid\n', '');
    expect(check({ ...good(), receiver }).join('\n')).toMatch(/never clears `m\.top\.socketNode`/);
  });

  it('flags the double dot-read that can crash sign-out', () => {
    const signOut = GOOD_SIGNOUT.replace(
      'socketNode = remoteControlTask.socketNode\n' +
        '    if isValid(socketNode) then socketNode.control = "STOP"',
      'if isValid(remoteControlTask.socketNode) then remoteControlTask.socketNode.control = "STOP"',
    );
    expect(check({ ...good(), signOut }).join('\n')).toMatch(
      /dots through `\.socketNode\.control`/,
    );
  });

  it('flags a SignOut that never stops the child at all', () => {
    const signOut = GOOD_SIGNOUT.replace(/.*socketNode.*\n/g, '');
    expect(check({ ...good(), signOut }).join('\n')).toMatch(/does not STOP the published/);
  });
});

describe('the real committed sources', () => {
  it('hold the invariant', () => {
    expect(
      check({
        receiver: read(RECEIVER_REL),
        wsTask: read(WS_TASK_REL),
        signOut: read(SIGNOUT_REL),
      }),
    ).toEqual([]);
  });
});

// ── layer 2: executable model ──────────────────────────────────────────────────

const STATE = { OPEN: 1, CLOSING: 2, CLOSED: 3 };

// WebSocketClient's posting contract, transcribed from
// components/vendor/BrightWebSocket/web_socket_client/WebSocketClient.brs.
// The load-bearing detail: the CLOSED transition and the on_close post BOTH
// happen inside run(), so a port drained before run() tells you nothing about
// what run() leaves behind.
class SocketClientModel {
  // runsBeforeClose  — run() calls while OPEN before the server's CLOSE frame.
  // runsInClosing    — run() calls spent in CLOSING before _try_force_close
  //                    fires. Real value: _CLOSING_DELAY is 30s at a ~100ms
  //                    loop cadence (:37, :161), i.e. hundreds — which is
  //                    exactly why the port is always drained by then.
  //
  // The server-closes-first sequence this models is MEASURED, not assumed:
  // probing a real Jellyfin 10.11.11 with the same raw upgrade the vendored
  // client builds, ending the session server-side produced a WebSocket CLOSE
  // frame (code 1000, "System Shutdown") — not a TCP drop — and the connection
  // then stayed up rather than being FIN'd early. That matters because a CLOSE
  // frame posts NO on_error (:737-740), so on_close emitted at the later CLOSED
  // transition is the only terminal event the parent ever gets. The TCP-drop
  // path, by contrast, posts on_error (:334-335) and would have notified the
  // parent even under the pre-fix ordering. The common path is the failing one.
  constructor({ runsBeforeClose = 3, runsInClosing = 5, initialState = STATE.OPEN } = {}) {
    this.readyState = initialState;
    this.port = [];
    this._runs = 0;
    this._closingRuns = 0;
    this._runsBeforeClose = runsBeforeClose;
    this._runsInClosing = runsInClosing;
  }

  run() {
    this._runs += 1;
    if (this.readyState === STATE.OPEN && this._runs > this._runsBeforeClose) {
      // CLOSE frame -> _handle_frame -> _close(): state is OPEN, so send our own
      // close frame and go CLOSING. _state posts ready_state. (:737-740, :712-714)
      this.readyState = STATE.CLOSING;
      this.port.push({ id: 'ready_state', data: STATE.CLOSING });
      return;
    }
    if (this.readyState === STATE.CLOSING) {
      this._closingRuns += 1;
      if (this._closingRuns > this._runsInClosing) {
        // _try_force_close -> _close(): no longer OPEN, so CLOSED + on_close. (:160-163, :741-744)
        this.readyState = STATE.CLOSED;
        this.port.push({ id: 'ready_state', data: STATE.CLOSED });
        this.port.push({ id: 'on_close', data: '' });
      }
    }
    // Once CLOSED the client posts nothing further: _read_socket_data early-returns
    // (:324) and _try_force_close only fires on CLOSING (:161). That is what makes
    // a post-CLOSED drained wait() a safe release point.
  }

  // True when the NEXT run() is the one that will reach CLOSED. Only used to
  // place an event precisely enough to exercise the pre-fix bug's escape case.
  willCloseOnNextRun() {
    return this.readyState === STATE.CLOSING && this._closingRuns + 1 > this._runsInClosing;
  }
}

// Runs the task loop with the ordering described by `shape`. Everything the
// loop does with a message is modelled by forwarding it to `top` — which is the
// whole point: an event still sitting in `port` when the loop exits is an event
// RemoteControlTask never receives.
function runTaskLoop(shape, client, { connectRequested = true, maxIterations = 2000 } = {}) {
  const top = {};
  let armed = false;
  let iterations = 0;
  let exited = false;

  const shouldExit = (msg) => {
    const terms = [];
    if (shape.exitGuardHasDrain) terms.push(msg === null);
    if (shape.armAfterRun) terms.push(armed);
    if (shape.exitGuardHasReadyState) {
      terms.push(connectRequested && client.readyState === STATE.CLOSED);
    }
    // A guard with no terms at all would release the thread on iteration 1;
    // treat it as never exiting so a malformed shape fails loudly on the
    // leak assertion instead of silently "passing" the drop assertion.
    return terms.length > 0 && terms.every(Boolean);
  };

  while (iterations < maxIterations) {
    iterations += 1;
    const msg = client.port.shift() ?? null;

    if (shape.exitBeforeRun && shouldExit(msg)) {
      exited = true;
      break;
    }

    if (msg) top[msg.id] = msg.data;

    client.run();

    if (shape.armAfterRun) {
      if (connectRequested && client.readyState === STATE.CLOSED) armed = true;
    }

    if (!shape.exitBeforeRun && shouldExit(msg)) {
      exited = true;
      break;
    }
  }

  return { top, exited, stranded: client.port.length, iterations };
}

// The shape of commit 965052ba, kept as a literal because it no longer exists in
// the tree. This is what the model has to reproduce the failure against.
const PREFIX_SHAPE = {
  hasExit: true,
  exitBeforeRun: false,
  exitGuardHasDrain: true,
  exitGuardHasReadyState: true,
  armAfterRun: false,
};

describe('loop-exit ordering, executed', () => {
  it('drops the terminal on_close when the exit test runs after run() (the pre-fix shape)', () => {
    const result = runTaskLoop(PREFIX_SHAPE, new SocketClientModel());

    expect(result.exited).toBe(true); // the thread IS released...
    expect(result.top.on_close).toBeUndefined(); // ...but the parent never learns why
    expect(result.stranded).toBeGreaterThan(0);
  });

  it('forwards on_close before releasing the thread, with the ordering the tree has now', () => {
    const shape = extractLoopShape(read(WS_TASK_REL));
    const result = runTaskLoop(shape, new SocketClientModel());

    expect(result.exited).toBe(true);
    expect(result.top.on_close).toBe(''); // RemoteControlTask.connectAndPump wakes and reconnects
    expect(result.top.ready_state).toBe(STATE.CLOSED);
    expect(result.stranded).toBe(0);
  });

  it('still releases the thread promptly — the fix costs one extra iteration, not a hang', () => {
    const shape = extractLoopShape(read(WS_TASK_REL));
    const closed = runTaskLoop(
      shape,
      new SocketClientModel({ runsBeforeClose: 3, runsInClosing: 5 }),
    );

    // 3 OPEN + 6 CLOSING runs to reach CLOSED, then drain 2 queued events, then exit.
    expect(closed.iterations).toBeLessThan(15);
  });

  it('holds the thread for a node that was never opened (the connect_requested guard)', () => {
    const shape = extractLoopShape(read(WS_TASK_REL));
    const idle = new SocketClientModel({ initialState: STATE.CLOSED });
    const result = runTaskLoop(shape, idle, { connectRequested: false, maxIterations: 50 });

    // ready_state is CLOSED before open() is ever called. Releasing here would
    // kill the node before its `open` field event could arrive.
    expect(result.exited).toBe(false);
  });

  it("pins how narrow the pre-fix bug's escape case was", () => {
    // The old ordering survived in exactly one situation: something had to be
    // sitting in the port at the START of the transition iteration, so that
    // iteration's wait() returned a message and the `msg = invalid` term was
    // false. Note how precise that is — an event arriving DURING the transition
    // does not help, because the exit test reads a `msg` already fetched. The
    // window is the single ~100ms iteration preceding the close, which is why
    // this could pass a hand test on a chatty socket and still be broken.
    const client = new SocketClientModel();
    const original = client.run.bind(client);
    client.run = () => {
      original();
      // A receiver keepalive `send` field event landing one iteration early.
      if (client.willCloseOnNextRun()) client.port.push({ id: 'field_event', data: 'send' });
    };
    const lucky = runTaskLoop(PREFIX_SHAPE, client);

    expect(lucky.top.on_close).toBe(''); // survives — by luck, not by design
    expect(lucky.stranded).toBe(0);

    // Same client, same traffic, one iteration later: back to dropping it.
    const unlucky = runTaskLoop(PREFIX_SHAPE, new SocketClientModel());
    expect(unlucky.top.on_close).toBeUndefined();
  });
});
