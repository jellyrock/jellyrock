/**
 * `npm run syncplay:probe`. See `scripts/syncplay-probe.js`.
 *
 * The analysis is the product: every tightness change is judged by its figures. So the main
 * case holds it to a recorded device run whose figures the first analysis script (Python,
 * kept in the project's records) gave for the same file.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  commandRecord,
  edgeBetween,
  isThisMachine,
  offsetsFromLine,
  parseMediaPlayer,
  parseRecords,
  recordOptions,
  summarize,
  summaryLine,
} from '../../../scripts/syncplay-probe.js';

const fixture = path.join(import.meta.dirname, 'fixtures/syncplay-probe/ultra-group-seeks.jsonl');

const unpause = (positionMs, whenMs) => ({
  kind: 'command',
  command: 'Unpause',
  positionMs,
  whenMs,
});
const edge = (at, positionMs, over = {}) => ({
  kind: 'edge',
  at,
  state: 'play',
  prevState: 'play',
  positionMs,
  prevPositionMs: positionMs - 500,
  ...over,
});

describe('the analysis of a recorded run', () => {
  it('gives the figures the first analysis gave for an Ultra run of group Seeks', () => {
    // Recorded 2026-11-21 on an Ultra against Jellyfin 12.4.0: the first three group Seeks of a run.
    const records = parseRecords(fs.readFileSync(fixture, 'utf8'));
    expect(summarize(offsetsFromLine(records))).toEqual({
      edges: 149,
      median: -44,
      p10: -66,
      p90: -13,
      min: -76,
      max: 19,
      stdev: 21,
    });
  });

  it('reads a member 200 ms behind the line as -200', () => {
    const records = [unpause(10000, 1000), edge(2000, 10800), edge(2500, 11300)];
    expect(offsetsFromLine(records)).toEqual([-200, -200]);
  });

  it('reads a member ahead of the line as positive', () => {
    expect(offsetsFromLine([unpause(10000, 1000), edge(2000, 11050)])).toEqual([50]);
  });

  it('measures against the newest Unpause', () => {
    const records = [unpause(10000, 1000), unpause(60000, 5000), edge(6000, 61000)];
    expect(offsetsFromLine(records)).toEqual([0]);
  });

  it('leaves out steps while the group is not playing', () => {
    const pause = { kind: 'command', command: 'Pause', positionMs: 12000, whenMs: 3000 };
    const records = [unpause(10000, 1000), pause, edge(3500, 12500)];
    expect(offsetsFromLine(records)).toEqual([]);
  });

  it('leaves out a step before the Unpause takes effect', () => {
    expect(offsetsFromLine([unpause(10000, 1000), edge(900, 10000)])).toEqual([]);
  });

  it('leaves out a step that is not one position report long', () => {
    const jump = edge(2000, 11000, { prevPositionMs: 4000 });
    const tiny = edge(2000, 11000, { prevPositionMs: 10900 });
    expect(offsetsFromLine([unpause(10000, 1000), jump, tiny])).toEqual([]);
  });

  it('leaves out a step that starts or ends outside play', () => {
    const fromPause = edge(2000, 11000, { prevState: 'pause' });
    const toBuffer = edge(2000, 11000, { state: 'buffer' });
    expect(offsetsFromLine([unpause(10000, 1000), fromPause, toBuffer])).toEqual([]);
  });

  it('measures nothing before the first command', () => {
    expect(offsetsFromLine([edge(2000, 11000)])).toEqual([]);
  });
});

describe('the summary', () => {
  it('is null for no offsets, and says so in its line', () => {
    expect(summarize([])).toBeNull();
    expect(summaryLine('run', null)).toBe('run: no usable steps');
  });

  it('takes the middle pair for an even count', () => {
    expect(summarize([10, 20, 30, 40]).median).toBe(25);
  });

  it('does not reorder the offsets it was given', () => {
    const offsets = [30, 10, 20];
    summarize(offsets);
    expect(offsets).toEqual([30, 10, 20]);
  });

  it('names the direction in its line', () => {
    expect(summaryLine('run', summarize([-200, -200]))).toBe(
      'run: 2 steps, median -200 ms, p10 -200, p90 -200, min -200, max -200, stdev 0 (positive is ahead)',
    );
  });
});

describe('reading the Roku', () => {
  const playing =
    '<player error="false" state="play"><plugin id="dev"/><position>61234 ms</position></player>';

  it('reads the state and the position from an ECP reply', () => {
    expect(parseMediaPlayer(playing)).toEqual({ state: 'play', positionMs: 61234 });
  });

  it('reads a closed player as no position', () => {
    const closed = parseMediaPlayer('<player error="false" state="close"></player>');
    expect(closed.state).toBe('close');
    expect(closed.positionMs).toBeNaN();
  });

  it('stamps a step at the middle of the window it happened in', () => {
    const last = { positionMs: 1000, state: 'play', sentAt: 100 };
    const now = { positionMs: 1500, state: 'play', repliedAt: 130 };
    expect(edgeBetween(last, now)).toEqual({
      kind: 'edge',
      at: 115,
      windowMs: 30,
      state: 'play',
      positionMs: 1500,
      prevPositionMs: 1000,
      prevState: 'play',
    });
  });

  it('reports a change of state at the same position', () => {
    const last = { positionMs: 1000, state: 'play', sentAt: 100 };
    expect(edgeBetween(last, { positionMs: 1000, state: 'pause', repliedAt: 130 })?.state).toBe(
      'pause',
    );
  });

  it('reports nothing when nothing changed, on the first poll, or with no position', () => {
    const last = { positionMs: 1000, state: 'play', sentAt: 100 };
    expect(edgeBetween(last, { positionMs: 1000, state: 'play', repliedAt: 130 })).toBeNull();
    expect(edgeBetween(null, { positionMs: 1000, state: 'play', repliedAt: 130 })).toBeNull();
    expect(edgeBetween(last, { positionMs: NaN, state: 'close', repliedAt: 130 })).toBeNull();
  });
});

describe('a command frame', () => {
  it('becomes a record in milliseconds', () => {
    const data = {
      Command: 'Unpause',
      PositionTicks: 3000000000,
      When: '2026-11-21T05:45:00.5000000Z',
      EmittedAt: '2026-11-21T05:45:00.1000000Z',
    };
    expect(commandRecord(data, 42)).toEqual({
      kind: 'command',
      at: 42,
      command: 'Unpause',
      positionMs: 300000,
      whenMs: Date.UTC(2026, 10, 21, 5, 45, 0, 500),
      emittedMs: Date.UTC(2026, 10, 21, 5, 45, 0, 100),
    });
  });
});

describe('the server must be this machine', () => {
  const interfaces = {
    eth0: [{ address: '192.0.2.3' }],
    lo: [{ address: '127.0.0.1' }, { address: '::1' }],
  };

  it("accepts localhost, loopback and this machine's own address", () => {
    expect(isThisMachine('http://localhost:8096', interfaces)).toBe(true);
    expect(isThisMachine('http://127.0.0.1:8096', interfaces)).toBe(true);
    expect(isThisMachine('http://[::1]:8096', interfaces)).toBe(true);
    expect(isThisMachine('http://192.0.2.3:8103', interfaces)).toBe(true);
  });

  it('refuses any other host', () => {
    expect(isThisMachine('http://192.0.2.99:8096', interfaces)).toBe(false);
    expect(isThisMachine('https://demo.jellyfin.org/stable', interfaces)).toBe(false);
  });
});

describe('the record options', () => {
  it('takes the device from --roku before ROKU_IP', () => {
    expect(recordOptions(['--out', 'a.jsonl'], { ROKU_IP: '192.0.2.10' }).roku).toBe('192.0.2.10');
    expect(
      recordOptions(['--out', 'a.jsonl', '--roku', '192.0.2.20'], { ROKU_IP: '192.0.2.10' }).roku,
    ).toBe('192.0.2.20');
  });

  it('defaults to the run the 2026-11-21 comparison made', () => {
    expect(recordOptions(['--out', 'a.jsonl'], { ROKU_IP: '192.0.2.10' })).toEqual({
      out: 'a.jsonl',
      roku: '192.0.2.10',
      group: 'RTA stress party',
      drive: 'pause',
      seconds: 260,
      cycles: 8,
      pollMs: 15,
      waitSeconds: 420,
      settleSeconds: 30,
    });
  });

  it('refuses a run with no file, no device, an unknown drive or a bad number', () => {
    const env = { ROKU_IP: '192.0.2.10' };
    expect(() => recordOptions([], env)).toThrow('--out');
    expect(() => recordOptions(['--out', 'a.jsonl'], {})).toThrow('ROKU_IP');
    expect(() => recordOptions(['--out', 'a.jsonl', '--drive', 'spin'], env)).toThrow('spin');
    expect(() => recordOptions(['--out', 'a.jsonl', '--seconds', 'soon'], env)).toThrow(
      '--seconds',
    );
  });
});
