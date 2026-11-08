import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  keepFailedConsole,
  KEEP_FAILED_CONSOLES,
  pruneConsoles,
} from '../../../../scripts/lib/console-capture.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-capture-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const touch = (name, body, ageSeconds) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  const t = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(file, t, t);
  return file;
};

describe('keepFailedConsole', () => {
  it('copies the console to a timestamped console-failed file beside it', () => {
    const src = touch('console.log', 'boom\n', 0);
    const kept = keepFailedConsole(src, { now: new Date('2026-11-07T12:34:56.789Z') });
    expect(kept).toBe(path.join(dir, 'console-failed-2026-11-07T12-34-56Z.log'));
    expect(fs.readFileSync(kept, 'utf8')).toBe('boom\n');
    expect(fs.readFileSync(src, 'utf8')).toBe('boom\n');
  });

  it('keeps only the newest `keep` copies and never deletes console.log', () => {
    const src = touch('console.log', 'now\n', 0);
    for (let i = 0; i < 4; i++) touch(`console-failed-old${i}.log`, 'old', 1000 + i);
    const kept = keepFailedConsole(src, { keep: 3, now: new Date('2026-11-07T00:00:00Z') });
    const left = fs.readdirSync(dir).sort();
    expect(left).toEqual([
      'console-failed-2026-11-07T00-00-00Z.log',
      'console-failed-old0.log',
      'console-failed-old1.log',
      'console.log',
    ]);
    expect(kept).toBe(path.join(dir, 'console-failed-2026-11-07T00-00-00Z.log'));
  });

  it('does not prune other console-*.log files', () => {
    const src = touch('console.log', 'x', 0);
    touch('console-server1.log', 'y', 5000);
    keepFailedConsole(src, { keep: 1 });
    expect(fs.existsSync(path.join(dir, 'console-server1.log'))).toBe(true);
  });

  it('returns null without throwing when there is nothing to copy', () => {
    expect(keepFailedConsole(path.join(dir, 'missing.log'))).toBeNull();
    expect(keepFailedConsole(undefined)).toBeNull();
  });

  it('has a small default limit', () => {
    expect(KEEP_FAILED_CONSOLES).toBeGreaterThan(0);
    expect(KEEP_FAILED_CONSOLES).toBeLessThan(20);
  });
});

describe('pruneConsoles', () => {
  it('still prunes console-*.log by default, whatever the name', () => {
    touch('console-a.log', 'a', 30);
    touch('console-b.log', 'b', 20);
    touch('console-failed-c.log', 'c', 10);
    touch('other.log', 'd', 40);
    pruneConsoles(dir, 2);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'console-b.log',
      'console-failed-c.log',
      'other.log',
    ]);
  });
});
