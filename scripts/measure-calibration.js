/**
 * Calibrate the instrument against itself: does a resident ODC component move the number
 * `npm run measure` reports?
 *
 *   npm run measure:calibrate -- --server http://192.0.2.10:8096
 *   npm run measure:calibrate -- --server <url> -n 30 --block-size 5
 *
 * The experiment's design — the two arms, why the plain one turns `ENABLE_RTA` off as
 * well as dropping the component, and why the blocks alternate — is in
 * [`measure-arms.js`](measure-arms.js), where it can be tested. This file is delivery:
 * build once, deploy each arm, take the bracket reads, run `measure.js` per block, and
 * publish the records the enclosure supports.
 *
 * ## Why it drives `measure.js` as a CHILD PROCESS
 *
 * The same reasoning `measure-devices.js` records, minus the singleton half (this tool
 * only ever talks to one device, so re-pointing the RTA client is not in question). What
 * remains is decisive on its own: a series needs the device lock, the console socket and
 * its replay defense, the sampling loop, mount selection, the medians, the launch audit
 * and the record assembly — and that last one is the layer this project deliberately did
 * not extract (`measure-record-assembly-untested`). An in-process harness would have
 * doubled the subsystem's one untested surface in order to avoid passing flags to a
 * process that already does the job.
 *
 * `measure-loop.js`'s header names this harness as its second caller. It is not, and the
 * header is corrected rather than left claiming one — the extraction bought testability,
 * which it delivered, and the second caller it predicted went the other way for the
 * reasons above.
 *
 * ## What this file is responsible for, and the child is not
 *
 *  - **ONE build, two deploys.** Both arms come off the same `build/` directory, so the
 *    only difference between them is what the deploy stages. The child never deploys —
 *    `--enclosed-server` refuses `--deploy` outright.
 *  - **The bracket reads.** The plain arm cannot read its own identity, so this takes an
 *    observed read immediately before its deploy and another immediately after the next
 *    RTA one. Both are this process's own ODC calls, which is what makes them
 *    observations rather than an inference carried across (ADR 0030).
 *  - **Publication.** Each child hands its record over (`--record-to`) instead of
 *    appending it, and a plain block's record is appended to `measurements.jsonl` only
 *    once its enclosure has closed. A block whose brackets disagree is written with
 *    `outcome: blocked` and an `enclosure` saying why — the samples are real and are
 *    kept, and nothing selects them.
 *  - **Leaving the device usable.** The run always ends by redeploying the RTA build,
 *    including on the way out of an interrupt. A device left holding a build with no ODC
 *    refuses the next `measure`, the next `test:rta` and the next sign-in, and that has
 *    already cost this project a whole RAM tier.
 *
 * ## The lock
 *
 * Held by this process only while IT touches the device (deploy, bracket read) and
 * released before each child, which takes it for its own series. Same trade
 * `measure-devices.js` makes and for the same reason: a parent holding the lock across
 * its children would have to tell each one to skip it, and the child would then record
 * itself as having run unlocked.
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupRtaEnv, deployBuild, ecp } from '../tests/rta/lib/driver.js';
import { acquireDeviceLock } from './device-lock.js';
import { measurementsLedgerPath } from './run-record.js';
import { readIdentity, enclosureVerdict, missingIdentityFields } from './measurement-guard.js';
import {
  ARMS,
  armLabel,
  CalibrationError,
  formatPlanLines,
  parseCalibrationArgs,
  planBlocks,
  summariseCalibration,
} from './measure-arms.js';
import { INTERRUPTED_EXIT } from './measure-matrix.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEASURE = path.join(here, 'measure.js');

/** Arms by their RECORDED id (`no-component`), which is not their JS key (`noComponent`). */
const ARM_BY_ID = Object.fromEntries(Object.values(ARMS).map((a) => [a.id, a]));

/** How many times a bracket read may come back empty before it is taken at its word. */
const BRACKET_READ_ATTEMPTS = 5;
const BRACKET_RETRY_MS = 2000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The one screen both arms can reach. `--nav` is driven over ODC, so the plain arm can
// only measure what a LAUNCH lands on — and Home is also the only screen with the n=30
// non-RTA baselines this calibration exists to make comparable again
// (`docs/dev/home-first-paint-performance.md`).
const MEASUREMENT = 'home-latest-rows';

const die = (message) => {
  console.error(`\n[calibrate] ${message}`);
  process.exit(1);
};

let args;
try {
  args = parseCalibrationArgs(process.argv.slice(2));
} catch (e) {
  if (!(e instanceof CalibrationError)) throw e;
  die(e.message);
}

setupRtaEnv(); // throws if ROKU_IP / ROKU_PASSWORD are missing — before anything is built

const blocks = planBlocks(args);
console.log(`\n[calibrate] ${MEASUREMENT} on ${process.env.ROKU_IP}`);
for (const line of formatPlanLines(blocks, args)) console.log(`[calibrate] ${line}`);

// ─── One build, for both arms ────────────────────────────────────────────────
// Before the first deploy and never again: two builds would put a second variable in a
// comparison whose whole purpose is to have exactly one. `--no-build` is for re-running
// against a `build/` this checkout just produced, and it is the operator's claim, not
// something this can verify.
if (args.noBuild) {
  console.log('[calibrate] --no-build: using the existing build/ for BOTH arms as-is.');
} else {
  console.log('[calibrate] building this checkout once, for both arms ...');
  const built = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: false });
  if (built.status !== 0) die('the build failed — nothing was deployed.');
}

// ─── Device state ────────────────────────────────────────────────────────────
/** What the device is currently holding, so the exit path knows whether to restore. */
let residentArm = null;
/** The child running right now, or null between spawns. */
let current = null;
let interrupted = false;

/** Take the lock, do something to the device, release. See the header. */
async function withLock(what, fn) {
  const lock = await acquireDeviceLock({ what: `calibrate:${what}` });
  try {
    return await fn();
  } finally {
    await lock.release().catch(() => {});
  }
}

/** Deploy one arm and remember it. Returns the `bs_const` the device was actually given. */
async function deployArm(arm) {
  console.log(`\n[calibrate] deploying arm "${arm.id}" — ${arm.label} ...`);
  const { bsConst } = await deployBuild({
    injectTestingFiles: arm.injectTestingFiles,
    enableRta: arm.enableRta,
  });
  residentArm = arm;
  console.log(`[calibrate] device is holding: ${bsConst ?? 'bs_const unreadable'}`);
  return bsConst;
}

/**
 * An observed identity read, or null.
 *
 * Never throws: a bracket that could not be read is a fact the enclosure has to weigh
 * (`enclosureVerdict` distinguishes it from a disagreement), and an exception here would
 * take the whole run out over one bookkeeping call — the same defect the closing read in
 * `measure.js` was hardened against.
 */
async function bracketRead(when) {
  // RETRIED while the identity reads EMPTY, which is not the same as unreadable.
  //
  // `measure.js` fires a relaunch as it exits and does not wait for boot, so a read taken
  // immediately after a child returns can catch the app with `m.global.server` created and
  // not yet populated: ODC answers, every field is `""`, and the enclosure then sees
  // `"" -> "http://…"` and correctly fails the whole block as drifted. Observed once on
  // `.178` (block 10 of 12, 2026-08-17) — the gate was right and the input was wrong.
  //
  // Bounded, and it gives up rather than looping: if the app genuinely has no server this
  // must still return the empty read so the enclosure can fail on it loudly. Silence here
  // would be the guard going blind in exactly the case tier 1 exists for.
  for (let attempt = 0; attempt < BRACKET_READ_ATTEMPTS; attempt++) {
    try {
      const identity = await readIdentity();
      if (!missingIdentityFields(identity).includes('serverUrl')) {
        console.log(`[calibrate] bracket (${when}): ${identity.serverUrl}`);
        return identity;
      }
      if (attempt === BRACKET_READ_ATTEMPTS - 1) {
        console.error(
          `[calibrate] ⚠ bracket (${when}) read an EMPTY identity ${BRACKET_READ_ATTEMPTS}x — ` +
            'the app answered ODC with no server on it. Recorded as-is; the enclosure will fail.',
        );
        return identity;
      }
      console.log(`[calibrate] bracket (${when}): empty, app still booting — retrying ...`);
      await sleep(BRACKET_RETRY_MS);
    } catch (e) {
      console.error(`[calibrate] ⚠ bracket (${when}) could not be read: ${e.message}`);
      return null;
    }
  }
  return null;
}

/** Run `measure.js` for one block, and hand back where it left its record. */
function runMeasure(block, recordPath) {
  const arm = ARM_BY_ID[block.arm];
  const argv = [
    MEASURE,
    '--measurement',
    MEASUREMENT,
    '-n',
    String(block.count),
    '--arm',
    armLabel(arm.id, args.label),
    // Tier 1's expectation, and WHICH kind of expectation it is. The RTA arm checks it
    // against a read of its own; the plain arm has none, so it declares the enclosure and
    // this process supplies the reads either side.
    ...(arm.odcResident ? ['--server', args.server] : ['--enclosed-server', args.server]),
    '--record-to',
    recordPath,
    // This run did not deploy; the driver did, seconds ago, off this checkout. Without
    // this the child prints the resident-build warning on every block — true of an
    // ordinary run and false here.
    '--deployed-by',
    'measure-calibration',
    ...(args.windowMs ? ['--window-ms', String(args.windowMs)] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { stdio: 'inherit' });
    current = child;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      current = null;
      resolve(result);
    };
    child.on('error', (e) => {
      console.error(`\n[calibrate] could not start measure.js: ${e.message}`);
      done({ status: null });
    });
    child.on('exit', (status) => done({ status }));
  });
}

/** Read back the record a child was told to write, or null if it never wrote one. */
function takeRecord(recordPath) {
  try {
    return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  } catch {
    return null;
  }
}

const outPath = measurementsLedgerPath();
/** Append a record to the ledger — the only place in this file that publishes. */
function publish(record) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.appendFileSync(outPath, `${JSON.stringify(record)}\n`);
}

/**
 * Stamp what THIS process knows and the child could not.
 *
 * `provenance.checkout.deployedFromCheckout` is deliberately NOT touched. It is a claim
 * about what the CHILD did, and the child deployed nothing — overwriting it here would
 * make the record say the series deployed its own build. The deployer's claim goes in its
 * own field, named for who made it.
 *
 * The literal `bs_const` is recorded rather than the arm's intent: what matters to a
 * reader months later is what the device was actually given, and that is the string RTA
 * staged — read back out of the staging dir rather than assumed from the flags.
 */
function stampDeploy(record, { arm, bsConst }) {
  record.provenance.deploy = {
    arm: arm.id,
    injectTestingFiles: arm.injectTestingFiles,
    odcResident: arm.odcResident,
    bsConst,
    deployedBy: 'measure-calibration',
  };
  return record;
}

// ─── Interrupts ──────────────────────────────────────────────────────────────
// A first signal stops after the current block and STILL restores the RTA build, for the
// same reason `measure-devices.js` protects its restore: the damage of an abandoned run
// is not the lost samples, it is the device left in a state the next tool refuses. A
// second signal abandons, and says what that leaves behind rather than leaving it to be
// discovered by the next run's failure.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (interrupted) {
      console.log(
        `\n[calibrate] ${signal} again — abandoning.` +
          (residentArm && !residentArm.odcResident
            ? '\n[calibrate] ⚠ THE DEVICE IS LEFT HOLDING A BUILD WITH NO ODC. Nothing that ' +
              'talks\n[calibrate]   to it will work until you re-deploy: ' +
              'npm run measure -- --deploy'
            : ''),
      );
      process.exit(INTERRUPTED_EXIT);
    }
    interrupted = true;
    console.log(
      `\n[calibrate] ${signal} — stopping after this block, then restoring the RTA build ` +
        '(~90 s).\n[calibrate]   Press again to abandon (leaves the device holding whatever ' +
        'arm is on it).',
    );
    current?.kill(signal);
  });
}

// ─── The run ─────────────────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyrock-calibrate-'));
const rows = [];
/** A plain block's record, waiting for the bracket read that closes its enclosure. */
let pending = null;
/**
 * The last observed identity before ODC goes away — the OPENING bracket of the plain
 * block about to run. Read while the RTA build is still resident, because after its
 * deploy there is nothing left to ask.
 */
let openingBracket = null;

/** Close `pending` against the identity just observed, and publish or withhold it. */
function closeEnclosure(after) {
  if (!pending) return;
  const verdict = enclosureVerdict({
    before: pending.before,
    after,
    declaredServer: args.server,
  });
  pending.record.enclosure = verdict;
  if (verdict.ok) {
    // `record.enclosure` and NOTHING ELSE. Filling `provenance.server` from the identity
    // the brackets agreed on is the one option ADR 0030 rejects by name — that field is
    // where a reader takes a value as observed, and a deduction written there is
    // indistinguishable from a measurement to `checkSeriesConsistency`, to
    // `measure:compare`'s gates, and to the matrix report that does not exist yet.
    //
    // Readers that need this arm's server ask for it where it is: `measure-compare.js`'s
    // `SERIES_KEYS.server` falls back to `enclosure.identity.serverUrl`, which is opt-in
    // by construction.
    publish(pending.record);
    pending.row.published = true;
    console.log(`[calibrate] enclosure closed — block ${pending.row.index + 1} published.`);
  } else {
    // Kept, and kept UNUSABLE. The samples are real and throwing them away would be the
    // half-job `NavFailedError.samples` was fixed to stop; folding the outcome is what
    // makes sure no comparison selects them.
    pending.record.outcome = 'blocked';
    publish(pending.record);
    pending.row.published = false;
    pending.row.reason = verdict.reason;
    console.error(`\n[calibrate] ⚠ enclosure FAILED — ${verdict.reason}`);
  }
  pending = null;
}

for (const block of blocks) {
  const arm = ARM_BY_ID[block.arm];
  const row = {
    index: block.index,
    arm: arm.id,
    count: block.count,
    status: null,
    published: false,
    reason: null,
  };
  rows.push(row);

  // Checked at the TOP so an interrupt cannot buy one more 90-second deploy before it
  // takes effect. Every block that never ran is still named in the summary — a run that
  // stopped early and reported only what it managed is the shape this file refuses.
  if (interrupted) {
    row.reason = 'the run was interrupted before this block ran';
    continue;
  }

  console.log(
    `\n[calibrate] ── block ${block.index + 1}/${blocks.length} · arm ${arm.id} · n=${block.count} ──`,
  );

  const bsConst = await withLock(`deploy:${arm.id}`, async () => {
    // The two brackets are taken at the only two instants they can be, and both are
    // pinned to the DEPLOY rather than to the block:
    //
    //  - the OPENING one immediately before the plain deploy, which is the last moment
    //    ODC exists to be asked;
    //  - the CLOSING one immediately after the next RTA deploy, which is the first.
    //
    // Anything between them is `npm run build`'s output being sideloaded, ECP presses and
    // a console socket — none of which writes the app's registry, which is the whole
    // reason the enclosure is a real assertion rather than a guess (ADR 0030).
    if (!arm.odcResident) openingBracket = await bracketRead(`before the ${arm.id} block`);
    const staged = await deployArm(arm);
    if (arm.odcResident && pending) {
      closeEnclosure(await bracketRead(`after the ${pending.row.arm} block`));
    }
    return staged;
  });

  const recordPath = path.join(tmpDir, `block-${block.index}.json`);
  const { status } = await runMeasure(block, recordPath);
  row.status = status;
  const record = takeRecord(recordPath);

  if (!record) {
    row.reason = `measure.js exited ${status ?? 'without a status'} and wrote no record`;
    console.error(`[calibrate] ⚠ block ${block.index + 1}: ${row.reason}`);
    continue;
  }
  stampDeploy(record, { arm, bsConst });

  if (arm.odcResident) {
    // This arm observed its own identity, so there is nothing to wait for.
    publish(record);
    row.published = true;
  } else {
    // Held until the next RTA deploy's read closes the enclosure.
    pending = { record, row, before: openingBracket };
  }
}

// ─── Leave the device usable, and close the last enclosure with the read that does it ──
console.log('\n[calibrate] restoring the RTA build ...');
await withLock('restore', async () => {
  await deployArm(ARMS.rta);
  // The restore's read is the last enclosure's CLOSING bracket — which is why the plan
  // does not need a trailing RTA block to buy one. Skipped when nothing is open (an
  // interrupt during an RTA block, or a plain block that never wrote a record).
  if (pending) closeEnclosure(await bracketRead('closing'));
});
await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
fs.rmSync(tmpDir, { recursive: true, force: true });

const summary = summariseCalibration(rows, { arms: [ARMS.rta.id, args.against] });
console.log('\n[calibrate] ── summary ──');
for (const line of summary.lines) console.log(line);
console.log(
  `[calibrate] ${summary.published}/${rows.length} block(s) published to ` +
    `${path.relative(process.cwd(), outPath)}.\n` +
    '[calibrate] Read the answer back with:\n' +
    `[calibrate]   npm run measure:compare -- --a arm=${ARMS.rta.id} --b arm=${ARMS.plain.id}`,
);
process.exit(summary.ok && !interrupted ? 0 : 1);
