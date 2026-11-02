import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  stripAnsi,
  isLockRefusal,
  parseTestsLine,
  serverEnv,
  formatSummary,
} from '../../../scripts/rta-servers.js';
import {
  reconnectDelay,
  MAX_RECONNECTS,
  consolesToPrune,
  startConsoleCapture,
} from '../../../scripts/lib/console-capture.js';

describe('rta-servers parsing', () => {
  it('strips colour codes', () => {
    expect(stripAnsi('\u001b[32mok\u001b[39m')).toBe('ok');
  });
  it('recognises the lock refusal', () => {
    expect(isLockRefusal('The Roku at x is in use by a run')).toBe(true);
    expect(isLockRefusal('all good')).toBe(false);
  });
  it('reads the Tests line through colour codes, and null without one', () => {
    expect(
      parseTestsLine('  \u001b[2m   Tests \u001b[22m \u001b[32m3 passed\u001b[39m (3)\n'),
    ).toBe('3 passed (3)');
    expect(parseTestsLine('Test Files  1 passed (1)')).toBeNull();
  });
  it('builds the server environment', () => {
    expect(serverEnv('u', 'a', undefined, 'f')).toEqual({
      RTA_SERVER_URL: 'u',
      RTA_SERVER_USER: 'a',
      RTA_SERVER_PASS: '',
      RTA_CONSOLE_LOG: 'f',
    });
  });
  it('formats one row per server', () => {
    const out = formatSummary([
      { index: 1, version: '10.11.0', code: 0, tests: '3 passed (3)', consoleFile: 'c1' },
      { index: 2, code: 1, note: 'device busy, gave up', consoleFile: 'c2' },
    ]);
    expect(out).toContain('passed');
    expect(out).toContain('FAILED (1)');
    expect(out.split('\n')).toHaveLength(4);
  });
});

describe('console capture', () => {
  const dirs = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
    dirs.push(d);
    return d;
  };

  it('stops reconnecting after the budget', () => {
    expect(reconnectDelay(1)).toBeGreaterThan(0);
    expect(reconnectDelay(MAX_RECONNECTS + 1)).toBeNull();
  });
  it('prunes all but the newest', () => {
    const e = [
      { name: 'a', mtimeMs: 1 },
      { name: 'b', mtimeMs: 3 },
      { name: 'c', mtimeMs: 2 },
    ];
    expect(consolesToPrune(e, 2)).toEqual(['a']);
  });
  it('writes data to the file and logs once on a refused connection', () => {
    const file = path.join(tmp(), 'console.log');
    const sock = new EventEmitter();
    sock.destroy = vi.fn();
    const log = vi.fn();
    const cap = startConsoleCapture({ host: 'h', file, connect: () => sock, log });
    sock.emit('data', Buffer.from('hello\n'));
    sock.emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    sock.emit('error', new Error('again'));
    expect(fs.readFileSync(file, 'utf8')).toBe('hello\n');
    expect(log).toHaveBeenCalledTimes(1);
    cap.close();
    expect(sock.destroy).toHaveBeenCalled();
  });
  it('reconnects after a drop and appends', () => {
    vi.useFakeTimers();
    const file = path.join(tmp(), 'console.log');
    const socks = [];
    const connect = () => {
      const s = new EventEmitter();
      s.destroy = vi.fn();
      socks.push(s);
      return s;
    };
    const cap = startConsoleCapture({ host: 'h', file, connect, log: vi.fn() });
    socks[0].emit('data', Buffer.from('one\n'));
    socks[0].emit('close');
    vi.advanceTimersByTime(1500);
    expect(socks).toHaveLength(2);
    socks[1].emit('data', Buffer.from('two\n'));
    expect(fs.readFileSync(file, 'utf8')).toBe('one\ntwo\n');
    cap.close();
    socks[1].emit('close');
    vi.advanceTimersByTime(5000);
    expect(socks).toHaveLength(2);
  });
  it('survives a connect that throws', () => {
    const file = path.join(tmp(), 'console.log');
    const log = vi.fn();
    startConsoleCapture({
      host: 'h',
      file,
      connect: () => {
        throw new Error('boom');
      },
      log,
    });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
