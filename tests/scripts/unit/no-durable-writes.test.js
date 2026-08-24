/**
 * Gate on the gate.
 *
 * [`tests/scripts/setup/no-durable-writes.js`](../setup/no-durable-writes.js) is
 * the globalSetup that fails this suite if it wrote into `.device-runs/`. It has
 * one non-obvious line — Vitest reports a globalSetup teardown throw as
 * `error during close` and still exits 0, so `process.exitCode = 1` is what makes
 * it a gate rather than a diagnostic. That line reads like belt-and-braces and is
 * the whole mechanism; without a test, deleting it is a silent no-op, which is
 * precisely the failure class the guard exists to catch.
 *
 * These chdir into a tmpdir before touching anything, both because `LEDGER_ROOT`
 * is relative and because the alternative is this file leaking into the real
 * ledger while testing the thing that catches exactly that.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const LEDGER_ROOT = '.device-runs';
const GUARD = '../setup/no-durable-writes.js';

describe('the no-durable-writes guard', () => {
  let tmpDir;
  let cwd;
  let priorExitCode;

  const fresh = () => {
    vi.resetModules();
    return import(GUARD);
  };

  /** A file inside the ledger root, with a pinned mtime so a rewrite is unambiguous. */
  const writeLedgerFile = (name, body, mtimeSeconds) => {
    const target = path.join(LEDGER_ROOT, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
    fs.utimesSync(target, mtimeSeconds, mtimeSeconds);
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-durable-writes-'));
    cwd = process.cwd();
    process.chdir(tmpDir);
    // `teardown` sets this on purpose; leaking it would fail the whole run.
    priorExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = priorExitCode;
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes when the ledger root never existed', async () => {
    const { setup, teardown } = await fresh();
    setup();
    expect(() => teardown()).not.toThrow();
  });

  it('passes when an existing ledger is left alone', async () => {
    writeLedgerFile('rta/runs.jsonl', '{"run":"test:rta"}\n', 1_700_000_000);
    const { setup, teardown } = await fresh();
    setup();
    expect(() => teardown()).not.toThrow();
  });

  it('fails, and NAMES the file, when a record appears', async () => {
    const { setup, teardown } = await fresh();
    setup();
    writeLedgerFile('rta/runs/device-a/run-meta.json', '{}\n', 1_700_000_000);
    expect(() => teardown()).toThrow(/\+ rta[\\/]runs[\\/]device-a[\\/]run-meta\.json/);
  });

  it('fails, and names it, when a ledger row DISAPPEARS', async () => {
    // The `- removed` branch. A leak is not only an append: `resetFailures` and the
    // `rimraf`-shaped cleanups in this suite delete, and a test that wipes a real row
    // is the more expensive half of the class — an append is junk to strip, a delete
    // is a device run's evidence that no longer exists.
    writeLedgerFile('rta/runs.jsonl', '{"run":"test:rta"}\n', 1_700_000_000);
    const { setup, teardown } = await fresh();
    setup();
    fs.rmSync(path.join(LEDGER_ROOT, 'rta', 'runs.jsonl'));
    expect(() => teardown()).toThrow(/- rta[\\/]runs\.jsonl/);
  });

  it('fails when an existing ledger is appended to', async () => {
    writeLedgerFile('rta/runs.jsonl', '{"run":"test:rta"}\n', 1_700_000_000);
    const { setup, teardown } = await fresh();
    setup();
    writeLedgerFile('rta/runs.jsonl', '{"run":"test:rta"}\n{"run":"leak"}\n', 1_700_000_001);
    expect(() => teardown()).toThrow(/~ rta[\\/]runs\.jsonl/);
  });

  it('sets a non-zero exit code — Vitest does NOT fail the run on the throw alone', async () => {
    // THE case that matters. Measured on Vitest 4.1.11: a globalSetup teardown
    // that throws prints `error during close` and exits 0, so the throw is a
    // diagnostic and this is the gate. If this test is ever "simplified" away,
    // the guard silently stops guarding.
    const { setup, teardown } = await fresh();
    setup();
    process.exitCode = 0;
    writeLedgerFile('rta/runs.jsonl', '{"run":"leak"}\n', 1_700_000_000);
    expect(() => teardown()).toThrow();
    expect(process.exitCode).toBe(1);
  });

  it('reports an unreadable subtree as a change instead of aborting the walk', async () => {
    // Not the fail-closed test — this is the reason fail-closed is now hard to reach.
    // A device run rotating a directory under us used to abort the whole walk, and an
    // aborted walk escaped before the exit code was set. Per-entry handling turns that
    // into a recorded change, so the leak beside it is still reported.
    writeLedgerFile('rta/sub/a', '1', 1_700_000_000);
    const { setup, teardown } = await fresh();
    setup();
    writeLedgerFile('rta/sub/b', '2', 1_700_000_000); // a genuine leak
    const locked = path.join(LEDGER_ROOT, 'rta', 'sub');
    fs.chmodSync(locked, 0o000);
    try {
      process.exitCode = 0;
      expect(() => teardown()).toThrow();
      expect(process.exitCode).toBe(1);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });

  it('FAILS CLOSED if the snapshot throws at all — exit code set BEFORE the throw escapes', async () => {
    // The real fail-closed gate, and it needs a forced throw: with per-entry handling
    // above, no ordinary filesystem state makes the walk throw, so a test relying on
    // one passes whether or not the ordering is right (it did — caught by mutation).
    // A teardown throw exits 0 on its own, so if an unanticipated error escaped before
    // `process.exitCode = 1`, a real leak would pass green.
    const { setup, teardown } = await fresh();
    setup();
    const spy = vi.spyOn(fs, 'existsSync').mockImplementation(() => {
      throw new Error('forced snapshot failure');
    });
    try {
      process.exitCode = 0;
      expect(() => teardown()).toThrow(/forced snapshot failure/);
      expect(process.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('says "never snapshotted" when setup did not run, instead of blaming every file', async () => {
    // `before === undefined` (no snapshot) and `before === null` (directory absent)
    // are different answers, and collapsing them made the first cut report the whole
    // PRE-EXISTING tree as freshly added the moment `setup()` threw. Vitest calls
    // teardown even when setup throws, so this path is reachable, and the misleading
    // version sent you hunting a leak that never happened.
    writeLedgerFile('rta/runs.jsonl', '{"run":"test:rta"}\n', 1_700_000_000);
    const { teardown } = await fresh(); // deliberately NO setup()
    process.exitCode = 0;
    expect(() => teardown()).toThrow(/never snapshotted/);
    expect(() => teardown()).not.toThrow(/runs\.jsonl/);
    expect(process.exitCode).toBe(1);
  });

  it('detects a same-size rewrite, which a size+mtime fingerprint could not see', async () => {
    // Measured on ext4: mtime advances about once per MILLISECOND, and `mtimeNs`
    // collides in exactly the same cases as `mtimeMs` — so a same-size rewrite inside
    // one tick was invisible to the original `size:mtimeMs` stamp. `run-meta.json` is
    // that exact shape. Pinned with an identical mtime so only the content differs.
    writeLedgerFile('rta/runs.jsonl', 'AAAA', 1_700_000_000);
    const { setup, teardown } = await fresh();
    setup();
    writeLedgerFile('rta/runs.jsonl', 'BBBB', 1_700_000_000); // same size, same mtime
    expect(() => teardown()).toThrow(/~ rta[\\/]runs\.jsonl/);
  });

  it('detects a byte-identical rewrite, which a hash alone could not see', async () => {
    // The other direction, and why the fingerprint is hash AND mtime rather than a
    // hash: a test writing a file it must not touch is what this gate is for, even
    // when the bytes happen to come out the same.
    writeLedgerFile('rta/runs.jsonl', 'AAAA', 1_700_000_000);
    const { setup, teardown } = await fresh();
    setup();
    writeLedgerFile('rta/runs.jsonl', 'AAAA', 1_700_000_042); // same bytes, touched
    expect(() => teardown()).toThrow(/~ rta[\\/]runs\.jsonl/);
  });
});
