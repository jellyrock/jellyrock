/**
 * Vitest globalSetup — the hardware-free suite must leave the durable device
 * ledger alone.
 *
 * `.device-runs/` is where real device runs accumulate: the per-run-kind ledger
 * a baseline reads across, and one record directory per device. `run-record.js`
 * reaches it through the RELATIVE `LEDGER_ROOT = '.device-runs'`, so any test
 * that opens a run without first chdir'ing into a tmpdir resolves that against
 * the checkout and writes into the real thing.
 *
 * That is not hypothetical and it is not loud. `run-record.test.js`'s
 * device-scoping case did exactly this on every `npm run test:scripts` — two
 * ledger rows plus two stray record directories per run, `outcome: null`,
 * accruing indefinitely in every contributor's checkout and visible only to
 * someone who happened to read the ledger. The same file's comments record an
 * earlier round of the same class: 124 stray directories named after test
 * tmpdirs, hand-cleaned. A per-test `process.chdir` closes each instance; this
 * closes the class, because nothing else notices.
 *
 * Runs once around the whole suite (not per file) deliberately: test files run in
 * parallel workers, so a per-file check would turn several files red for one
 * file's leak. The tradeoff is that this names WHAT appeared, not WHO wrote it —
 * the leaked content nearly always says, since a record carries the fixture's own
 * `deviceKey` and `run`.
 *
 * It reports and fails; it never cleans up. Reverting would risk deleting rows
 * from a device run that was genuinely in flight.
 */
import fs from 'node:fs';
import path from 'node:path';

const LEDGER_ROOT = '.device-runs';
const MAX_LISTED = 10;

/** Every file under `dir`, as `relative path -> size:mtimeMs`. `null` if absent. */
function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const seen = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const { size, mtimeMs } = fs.statSync(full);
        seen.set(path.relative(dir, full), `${size}:${mtimeMs}`);
      }
    }
  };
  walk(dir);
  return seen;
}

/** `+ added`, `- removed`, `~ modified` — one line each, bounded. */
function describeChanges(before, after) {
  const was = before ?? new Map();
  const now = after ?? new Map();
  const changes = [];
  for (const [file, stamp] of now) {
    if (!was.has(file)) changes.push(`+ ${file}`);
    else if (was.get(file) !== stamp) changes.push(`~ ${file}`);
  }
  for (const file of was.keys()) if (!now.has(file)) changes.push(`- ${file}`);
  changes.sort();
  const listed = changes.slice(0, MAX_LISTED);
  if (changes.length > MAX_LISTED) listed.push(`… and ${changes.length - MAX_LISTED} more`);
  return listed;
}

let before;

export function setup() {
  before = snapshot(LEDGER_ROOT);
}

export function teardown() {
  const changes = describeChanges(before, snapshot(LEDGER_ROOT));
  if (changes.length === 0) return;

  // Both lines are load-bearing, and this one is the gate. Vitest prints a
  // globalSetup teardown throw as `error during close` and still exits 0 —
  // measured on 4.1.11 — so the throw alone buys a diagnostic nobody's exit
  // status reads. Removing this makes the guard decorative. Re-measure before
  // touching it.
  process.exitCode = 1;
  throw new Error(
    `The hardware-free suite wrote to ${LEDGER_ROOT}/ — that directory belongs to real device runs.\n` +
      `${changes.map((line) => `  ${line}`).join('\n')}\n\n` +
      'Usual cause: a test called `beginRun`/`endRun` (or anything reaching `runsLedgerPath`)\n' +
      "without chdir'ing into a tmpdir first, so the relative ledger path resolved against the\n" +
      'checkout. Fix it with the `process.chdir(tmpDir)` / `process.chdir(cwd)` pair the run-record\n' +
      'tests use — NOT by pointing `RTA_RECORD_DIR` at a tmpdir, which makes the derivation tests\n' +
      'vacuous. Restore the rows above by hand; this guard deliberately does not clean up.\n\n' +
      'If a real device run was in flight in this checkout, that is the cause instead — the two\n' +
      'suites must not overlap (`test:scripts` also deletes `out/rta/`).',
  );
}
