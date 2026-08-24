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
 *
 * The verdict is per SESSION, not per run: Vitest tears a `globalSetup` down only
 * from `Vitest.close()`, so under `test:scripts:tdd` (watch) it arrives when you
 * QUIT, not between reruns. `setup` still snapshots at session start, so nothing
 * escapes — it just arrives late.
 *
 * ## Why a content hash and not `size:mtime`
 *
 * The first cut fingerprinted `size:mtimeMs`, which cannot see a same-size
 * rewrite inside one filesystem clock tick — and `run-meta.json` is exactly that
 * shape, a fixed set of keys rewritten per run. `mtimeNs` looks like the fix and
 * is not: measured on this repo's ext4, 2000 rapid same-size rewrites collided on
 * `mtimeNs` in the SAME 1918 cases as on `mtimeMs`, because the field carries
 * nanosecond digits but only advances about once per millisecond. Hashing the
 * bytes is the only thing that actually closes it, and it is cheap here — 3.4 ms
 * per run over the current tree, ~435 ms extrapolated to 100 MB.
 *
 * The fingerprint keeps the mtime alongside the hash, because swapping one blind
 * spot for another is not a fix: a hash alone cannot see a byte-identical rewrite,
 * and a test writing a file it must not touch is exactly what this gate is for even
 * when the bytes happen to match. Together they miss nothing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LEDGER_ROOT = '.device-runs';
const MAX_LISTED = 10;

/**
 * A path that could not be read. A STABLE value, deliberately: a permanently
 * unreadable entry fingerprints the same before and after and so does not trip
 * the gate, while an entry that becomes readable (or stops being) shows up as a
 * change, which is what it is.
 */
const UNREADABLE = '<unreadable>';

/**
 * Every entry under `dir`, as `relative path -> content fingerprint`.
 *
 * Returns `null` — never `undefined` — when the directory does not exist. The
 * two are different answers and `teardown` treats them differently: `null` is a
 * real, comparable state ("nothing there"), while `undefined` means no snapshot
 * was ever taken. Collapsing them is what made the first cut report every
 * pre-existing file as a fresh leak when `setup()` had failed.
 *
 * Never throws on a single bad entry: a device run rotating a directory under us
 * would otherwise abort the whole walk, and an aborted walk used to mean the gate
 * failed OPEN.
 */
function snapshot(dir) {
  if (!fs.existsSync(dir)) return null;
  const seen = new Map();
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      seen.set(`${path.relative(dir, current)}${path.sep}`, UNREADABLE);
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      // Anything that is not a directory is fingerprinted, symlinks included —
      // `isFile()` is false for a symlink, so an earlier cut skipped them and a
      // symlinked ledger would have been invisible to the gate.
      const rel = path.relative(dir, full);
      try {
        // Content hash AND mtime, because each alone has a blind spot and the pair
        // has none: a hash misses a byte-identical rewrite (a test writing where it
        // must not, which is the thing being gated), and an mtime misses a same-size
        // rewrite inside one clock tick (measured real — see the header).
        const stat = fs.statSync(full);
        const hash = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
        seen.set(rel, `${hash}:${stat.size}:${stat.mtimeMs}`);
      } catch {
        seen.set(rel, UNREADABLE);
      }
    }
  };
  walk(dir);
  return seen;
}

/** `+ added`, `- removed`, `~ modified` — one line each, bounded. */
function describeChanges(before, after) {
  // `null` (the directory did not exist) is the only nullish value that reaches
  // here; `undefined` is rejected in `teardown` before this is called.
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
  // FAIL CLOSED. Every exit from here that is not "verified clean" sets a
  // non-zero code BEFORE throwing, and that ordering is the whole gate: Vitest
  // reports a globalSetup teardown throw as `error during close` and still exits
  // 0 — measured on 4.1.11 — so a throw alone buys a diagnostic nobody's exit
  // status reads. The first cut computed the diff as an argument, which meant an
  // error inside the walk escaped before this line and let a real leak through
  // with a green exit. Re-measure before reordering any of this.
  if (before === undefined) {
    process.exitCode = 1;
    throw new Error(
      `${LEDGER_ROOT}/ was never snapshotted, so this run cannot say whether it wrote there.\n` +
        'setup() did not run, or it threw — Vitest calls teardown either way. Fix that failure.\n' +
        'This is NOT a leak report: do not go looking for the files it would have listed.',
    );
  }

  let after;
  try {
    after = snapshot(LEDGER_ROOT);
  } catch (e) {
    // Set the code, explain, then rethrow the original untouched — the repo has no
    // `error-cause` precedent and its lint config pins a Node range that predates it,
    // so the context goes to stderr rather than onto a wrapper.
    process.exitCode = 1;
    console.error(
      `[no-durable-writes] could not read ${LEDGER_ROOT}/ to verify the suite left it alone.\n` +
        'Failing CLOSED — an unverifiable run is treated as a failed one, because the whole\n' +
        'point of this gate is that a silent write must not pass.',
    );
    throw e;
  }

  const changes = describeChanges(before, after);
  if (changes.length === 0) return;

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
      'suites must not overlap: `test:scripts` also wipes `out/` wholesale, which is where that\n' +
      'run keeps its `run-meta.json` and failure records.',
  );
}
