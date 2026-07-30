// Tests for scripts/lint/socket-auth-binding-check.js — the static guard on the
// ws:// session-identity binding (#743).
//
// Pure layer: hand-written source strings exercise each rule and its ordering
// logic. Plus a smoke pass over the REAL committed RemoteControlTask.bs +
// WebSocketClientTask.brs, so reverting the fix in either file fails here
// (offline — no Roku hardware and no Jellyfin server, which is the point: the
// true end-to-end check is unreachable from RTA, see the lint's header).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check,
  RECEIVER_REL,
  WS_TASK_REL,
} from '../../../../scripts/lint/socket-auth-binding-check.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

// Minimal well-formed sources — the shape the guard wants, nothing more.
const GOOD_RECEIVER = `
sub connectAndPump(url as string)
  m.ws = CreateObject("roSGNode", "WebSocketClient")
  m.ws.observeField("on_open", m.port)
  m.ws.headers = ["Authorization", buildAuthHeader(false)]
  m.ws.open = url
end sub
`;

const GOOD_WS_TASK = `
sub runSocketLoop()
  m.ws = WebSocketClient()
  m.port = createObject("roMessagePort")
  m.top.observeField("headers", m.port)
  if m.top.headers <> invalid and m.top.headers.count() > 0
    m.ws.set_headers(m.top.headers)
  end if
  if len(m.top.open) > 0
    m.ws.open(m.top.open)
  end if
end sub
`;

const good = () => ({ receiver: GOOD_RECEIVER, wsTask: GOOD_WS_TASK });

describe('the happy path', () => {
  it('reports nothing when both files hold the invariant', () => {
    expect(check(good())).toEqual([]);
  });
});

describe('rule 1 — receiver sets headers before open', () => {
  it('flags a missing headers assignment (the literal #743 regression)', () => {
    const receiver = GOOD_RECEIVER.replace(/\s*m\.ws\.headers = .*\n/, '\n');
    const problems = check({ ...good(), receiver });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(RECEIVER_REL);
    expect(problems[0]).toMatch(/no `m\.ws\.headers/);
  });

  it('flags headers set AFTER open — the intermittent-failure reordering', () => {
    const receiver = `
sub connectAndPump(url as string)
  m.ws.open = url
  m.ws.headers = ["Authorization", buildAuthHeader(false)]
end sub
`;
    const problems = check({ ...good(), receiver });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/set AFTER/);
  });

  it('tolerates whitespace variation around the assignment', () => {
    const receiver = GOOD_RECEIVER.replace('m.ws.headers =', 'm.ws.headers   =');
    expect(check({ ...good(), receiver })).toEqual([]);
  });
});

describe('rule 2 — the upstream header clobber stays gone', () => {
  it('flags a restored `m.top.headers = m.ws.get_headers()`', () => {
    const wsTask = GOOD_WS_TASK.replace(
      'm.ws = WebSocketClient()',
      'm.ws = WebSocketClient()\n  m.top.headers = m.ws.get_headers()',
    );
    const problems = check({ ...good(), wsTask });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(WS_TASK_REL);
    expect(problems[0]).toMatch(/get_headers/);
  });
});

describe('rule 3 — the seed sits between observer registration and open', () => {
  it('flags a missing seed', () => {
    const wsTask = GOOD_WS_TASK.replace(/\s*m\.ws\.set_headers\(m\.top\.headers\)\n/, '\n');
    const problems = check({ ...good(), wsTask });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/startup seed is missing/);
  });

  it('flags a seed placed before observeField("headers")', () => {
    const wsTask = `
sub runSocketLoop()
  m.ws.set_headers(m.top.headers)
  m.top.observeField("headers", m.port)
  m.ws.open(m.top.open)
end sub
`;
    const problems = check({ ...good(), wsTask });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/BEFORE `observeField/);
  });

  it('flags a seed placed after open()', () => {
    const wsTask = `
sub runSocketLoop()
  m.top.observeField("headers", m.port)
  m.ws.open(m.top.open)
  m.ws.set_headers(m.top.headers)
end sub
`;
    const problems = check({ ...good(), wsTask });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/AFTER `m\.ws\.open/);
  });
});

describe('rule 4 — the dead m.task_port typo stays dead', () => {
  it('flags a restored m.task_port', () => {
    const wsTask = GOOD_WS_TASK.replace(
      'm.top.observeField("headers", m.port)',
      'm.top.observeField("headers", m.task_port)',
    );
    const problems = check({ ...good(), wsTask });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/task_port/);
  });
});

// Load-bearing, not decorative: BOTH real files quote every banned pattern
// inside their explanatory comments (that is how the local modifications are
// documented). Without comment-stripping the guard would fail on the very tree
// it is meant to bless.
describe('comment stripping', () => {
  it('ignores banned patterns that appear only in comments', () => {
    const wsTask = `
sub runSocketLoop()
  ' upstream did \`m.top.headers = m.ws.get_headers()\` here; we do not
  ' and \`m.task_port\` is never assigned, so we use m.port
  m.top.observeField("headers", m.port)
  m.ws.set_headers(m.top.headers)
  m.ws.open(m.top.open)
end sub
`;
    expect(check({ ...good(), wsTask })).toEqual([]);
  });

  it('does not let a commented-out headers assignment satisfy rule 1', () => {
    const receiver = `
sub connectAndPump(url as string)
  ' m.ws.headers = ["Authorization", buildAuthHeader(false)]
  m.ws.open = url
end sub
`;
    const problems = check({ ...good(), receiver });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no `m\.ws\.headers/);
  });
});

describe('the committed sources', () => {
  it('hold the ws:// DeviceId binding invariant (offline regression gate)', () => {
    const sources = {
      receiver: readFileSync(resolve(REPO_ROOT, RECEIVER_REL), 'utf8'),
      wsTask: readFileSync(resolve(REPO_ROOT, WS_TASK_REL), 'utf8'),
    };
    expect(check(sources)).toEqual([]);
  });
});
