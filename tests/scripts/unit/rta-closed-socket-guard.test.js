// The RTA on-device component must survive a socket event for a client socket it already closed.
//
// `closeSocket()` deletes the id from `m.clientSockets`, so an event that arrives for that id
// afterwards finds nothing there. Unpatched, `handleClientSocketEvent()` and `closeSocket()` call
// a method on that missing socket and the task crashes with `runtime error &hec`.
// `patches/roku-test-automation+*.patch` makes both functions check the lookup first.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(
  require.resolve('roku-test-automation/device/components/RTA_OnDeviceComponentTask.brs'),
  'utf8',
);

function body(name) {
  const match = source.match(new RegExp(`^sub ${name}\\(.*\\)[^\\n]*\\n([\\s\\S]*?)^end sub`, 'm'));
  expect(match, `${name}() not found`).not.toBeNull();
  return match[1];
}

// True when a line testing `socket` against invalid comes before the first `needle` call.
function guardsBefore(text, needle) {
  const call = text.indexOf(needle);
  expect(call, `${needle} not found`).toBeGreaterThan(-1);
  return /socket\s*=\s*invalid|socket\s*<>\s*invalid/i.test(text.slice(0, call));
}

describe('RTA closed client socket guard', () => {
  it('handleClientSocketEvent() checks the socket exists before receive()', () => {
    expect(guardsBefore(body('handleClientSocketEvent'), '.receive(')).toBe(true);
  });

  it('closeSocket() checks the socket exists before close()', () => {
    expect(guardsBefore(body('closeSocket'), '.close()')).toBe(true);
  });
});
