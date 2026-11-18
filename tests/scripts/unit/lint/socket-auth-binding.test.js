// Tests for scripts/lint/socket-auth-binding-check.js: the static guard on the
// ws:// session-identity binding (#743).
//
// Pure layer: hand-written source strings exercise the rule and its ordering
// logic. Plus a smoke pass over the REAL committed RemoteControlTask.bs, so
// reverting the fix fails here (offline, with no Roku hardware and no Jellyfin
// server).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, RECEIVER_REL } from '../../../../scripts/lint/socket-auth-binding-check.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

// Minimal well-formed source: the shape the guard wants, nothing more.
const GOOD_RECEIVER = `
sub connectAndPump(url as string)
  m.ws = WebSocketClient()
  m.ws.set_message_port(m.wsEvents)
  m.ws.set_headers(["Authorization", buildAuthHeader(false)])
  m.ws.open(url)
end sub
`;

describe('the happy path', () => {
  it('reports nothing when the receiver holds the invariant', () => {
    expect(check({ receiver: GOOD_RECEIVER })).toEqual([]);
  });
});

describe('the receiver sets headers before open', () => {
  it('flags a missing set_headers call (the literal #743 regression)', () => {
    const receiver = GOOD_RECEIVER.replace(/\s*m\.ws\.set_headers\(.*\n/, '\n');
    const problems = check({ receiver });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(RECEIVER_REL);
    expect(problems[0]).toMatch(/no `m\.ws\.set_headers/);
  });

  it('flags headers set AFTER open', () => {
    const receiver = `
sub connectAndPump(url as string)
  m.ws.open(url)
  m.ws.set_headers(["Authorization", buildAuthHeader(false)])
end sub
`;
    const problems = check({ receiver });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/called AFTER/);
  });

  it('flags a receiver that never opens the socket', () => {
    const receiver = GOOD_RECEIVER.replace(/\s*m\.ws\.open\(.*\n/, '\n');
    const problems = check({ receiver });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/cannot verify header ordering/);
  });

  it('tolerates whitespace variation before the parenthesis', () => {
    const receiver = GOOD_RECEIVER.replace('m.ws.set_headers(', 'm.ws.set_headers (');
    expect(check({ receiver })).toEqual([]);
  });
});

describe('comment stripping', () => {
  it('does not let a commented-out set_headers call satisfy the rule', () => {
    const receiver = `
sub connectAndPump(url as string)
  ' m.ws.set_headers(["Authorization", buildAuthHeader(false)])
  m.ws.open(url)
end sub
`;
    const problems = check({ receiver });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no `m\.ws\.set_headers/);
  });
});

describe('the committed source', () => {
  it('holds the ws:// DeviceId binding invariant (offline regression gate)', () => {
    const receiver = readFileSync(resolve(REPO_ROOT, RECEIVER_REL), 'utf8');
    expect(check({ receiver })).toEqual([]);
  });
});
