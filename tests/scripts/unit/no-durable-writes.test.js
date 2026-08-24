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
});
