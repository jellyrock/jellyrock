/**
 * Vitest globalSetup: the hardware-free suite must leave the durable device
 * state alone: the ledger in `.device-runs/` and the run output in `out/`.
 *
 * `out/` holds the build output a device run installs: `run-roku-tests.js` zips
 * and sideloads `out/jellyrock.zip`. Two writers once hit it from
 * `test:scripts`: the transpile harness (BrighterScript empties its outDir before
 * writing) and `create-package.cjs` (it zipped the real `build/` over the real
 * package). Both now take a temp directory, and this watches `out/` so a third
 * fails the run instead of being found by hand.
 *
 * `.device-runs/` is where real device runs accumulate: the per-run-kind ledger
 * a baseline reads across, and one record directory per device. `run-record.js`
 * reaches it through the RELATIVE `.device-runs` path, so any test
 * that opens a run without first chdir'ing into a tmpdir resolves that against
 * the checkout and writes into the real thing.
 *
 * That is not hypothetical and it is not loud. `run-record.test.js`'s
 * device-scoping case did exactly this on every `npm run test:scripts`: two
 * ledger rows plus two stray record directories per run, `outcome: null`,
 * accruing indefinitely in every contributor's checkout and visible only to
 * someone who happened to read the ledger. The same file's comments record an
 * earlier round of the same class: 124 stray directories named after test
 * tmpdirs, hand-cleaned. A per-test `process.chdir` closes each instance; this
 * closes the class, because nothing else notices.
 *
 * Runs once around the whole suite (not per file) on purpose: test files run in
 * parallel workers, so a per-file check would turn several files red for one
 * file's leak. The tradeoff is that this names what appeared, not who wrote it.
 * The leaked content nearly always says who, since a record carries the
 * fixture's own `deviceKey` and `run`.
 *
 * It reports and fails; it never cleans up. Reverting would risk deleting rows
 * from a device run that was in flight.
 *
 * The verdict is per SESSION, not per run: Vitest tears a `globalSetup` down only
 * from `Vitest.close()`, so under `test:scripts:tdd` (watch) it arrives when you
 * QUIT, not between reruns. `setup` still snapshots at session start, so nothing
 * escapes. The verdict only arrives late.
 *
 * ## Why a content hash and not `size:mtime`
 *
 * The first cut fingerprinted `size:mtimeMs`, which cannot see a same-size
 * rewrite inside one filesystem clock tick, and `run-meta.json` is exactly that
 * shape, a fixed set of keys rewritten per run. `mtimeNs` looks like the fix and
 * is not: measured 2026-08-24 on this repo's ext4, 2000 rapid same-size
 * rewrites collided on `mtimeNs` in the SAME 1918 cases as on `mtimeMs`, because
 * the field carries nanosecond digits but only advances about once per
 * millisecond. Hashing the bytes is the only thing that actually closes it, and
 * it is cheap here: 3.4 ms per run over the tree of that day, about 435 ms
 * extrapolated to 100 MB.
 *
 * The fingerprint keeps the mtime alongside the hash, because swapping one blind
 * spot for another is not a fix: a hash alone cannot see a byte-identical rewrite,
 * and a test writing a file it must not touch is exactly what this gate is for even
 * when the bytes happen to match. Together they miss nothing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Relative on purpose: they resolve against the cwd, which is the checkout.
const WATCHED_ROOTS = ['.device-runs', 'out'];
const MAX_LISTED = 10;

/**
 * A path that could not be read. A stable value, on purpose: a permanently
 * unreadable entry fingerprints the same before and after and so does not trip
 * the gate, while an entry that becomes readable (or stops being) shows up as a
 * change, which is what it is.
 */
const UNREADABLE = '<unreadable>';

/**
 * Every entry under `dir`, as `relative path -> content fingerprint`.
 *
 * Returns `null` (never `undefined`) when the directory does not exist. The
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
      // Anything that is not a directory is fingerprinted, symlinks included:
      // `isFile()` is false for a symlink, so an earlier cut skipped them and a
      // symlinked ledger would have been invisible to the gate.
      const rel = path.relative(dir, full);
      try {
        // Content hash AND mtime, because each alone has a blind spot and the pair
        // has none: a hash misses a byte-identical rewrite (a test writing where it
        // must not, which is the thing being gated), and an mtime misses a same-size
        // rewrite inside one clock tick (measured real, see the header).
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

/** `+ added`, `- removed`, `~ modified`: one line each, bounded. */
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

/** `root -> snapshot`, or `undefined` before `setup()` has run. */
let before;

export function setup() {
  before = new Map(WATCHED_ROOTS.map((root) => [root, snapshot(root)]));
}

export function teardown() {
  // FAIL CLOSED. Every exit from here that is not "verified clean" sets a
  // non-zero code BEFORE throwing, so the gate never depends on how Vitest
  // treats a teardown throw. Vitest 4.1.11 reported one as `error during close`
  // and still exited 0 (measured 2026-08-24); Vitest 5.0.3 exits 1 (measured
  // 2026-10-12). The first cut computed the diff as an argument, which meant an
  // error inside the walk escaped before this line and let a real leak through
  // with a green exit. Re-measure before reordering any of this.
  if (before === undefined) {
    process.exitCode = 1;
    throw new Error(
      `${WATCHED_ROOTS.join(', ')} were never snapshotted, so this run cannot say whether it wrote there.\n` +
        'setup() did not run, or it threw — Vitest calls teardown either way. Fix that failure.\n' +
        'This is NOT a leak report: do not go looking for the files it would have listed.',
    );
  }

  const report = [];
  for (const root of WATCHED_ROOTS) {
    let after;
    try {
      after = snapshot(root);
    } catch (e) {
      // Set the code, explain, then rethrow the original untouched. The repo has no
      // `error-cause` precedent and its lint config pins a Node range that predates it,
      // so the context goes to stderr rather than onto a wrapper.
      process.exitCode = 1;
      console.error(
        `[no-durable-writes] could not read ${root}/ to verify the suite left it alone.\n` +
          'Failing CLOSED — an unverifiable run is treated as a failed one, because the whole\n' +
          'point of this gate is that a silent write must not pass.',
      );
      throw e;
    }
    const changes = describeChanges(before.get(root), after);
    if (changes.length > 0)
      report.push(`${root}/\n${changes.map((line) => `  ${line}`).join('\n')}`);
  }
  if (report.length === 0) return;

  process.exitCode = 1;
  throw new Error(
    `The hardware-free suite wrote to a directory that belongs to real device runs:\n${report.join('\n')}\n\n` +
      'Usual cause for `.device-runs/`: a test called `beginRun`/`endRun` (or anything reaching\n' +
      "`runsLedgerPath`) without chdir'ing into a tmpdir first, so the relative ledger path resolved\n" +
      'against the checkout. Fix it with the `process.chdir(tmpDir)` / `process.chdir(cwd)` pair the\n' +
      'run-record tests use, not by pointing `RTA_RECORD_DIR` at a tmpdir, which makes the derivation\n' +
      'tests vacuous.\n' +
      'Usual cause for `out/`: a test ran BrighterScript or `create-package.cjs` without an outDir of\n' +
      'its own. `transpileWithPlugin` takes a temp one, and `create-package.cjs` takes `--out-dir`.\n' +
      'Restore the entries above by hand; this guard does not clean up.\n\n' +
      'If a real device run was in flight in this checkout, that is the cause instead. The two\n' +
      'suites must not overlap: that run installs the package it built in `out/`.',
  );
}
