/**
 * The ODC calibration's experiment design: which arms exist, what each one deploys, in
 * what order the blocks run, and how the command line is read.
 *
 * Pure, for the reason `measure-matrix.js` and `measure-args.js` are: the entry point
 * (`measure-calibration.js`) claims the device and cannot be reached by a test, and the
 * first cut of a rule that lived in such a file shipped as dead code
 * (`measure-devices.js`'s interrupt handler, 2026-08-16). Everything here is a rule; the
 * delivery layer keeps only deploy / spawn / print.
 *
 * ## The question, and why it needs two builds rather than a flag
 *
 * `npm run measure` reads the app's identity over ODC, and ODC exists only because the
 * build was deployed with `injectTestingFiles` — which makes a task component RESIDENT
 * for the whole session. Whether that component moves the number being measured has never
 * been established, so every number this project publishes carries an unmeasured
 * variable, and the n=30 non-RTA baselines in `home-first-paint-performance.md` cannot be
 * compared against at all (`measure:compare` refuses arms differing in `enableRta`).
 *
 * The comparison cannot be made INSIDE one build: the readout is a console emit that both
 * arms keep, but the identity read is not available in the arm that has no ODC. That is
 * what [ADR 0030](../docs/adr/0030-non-odc-arm-identity-by-enclosure.md) settles — the
 * no-ODC arm asserts identity by ENCLOSURE, from observed reads taken either side of it.
 *
 * ## Why the plain arm turns the flag OFF as well as dropping the component
 *
 * `injectTestingFiles: false` alone does NOT produce a non-RTA build. RTA rewrites
 * `ENABLE_RTA=false` -> `true` in the staged manifest unconditionally — the rewrite sits
 * outside that option's `if` (`RokuDevice.js:71-76`) — and `#if` is evaluated on the
 * DEVICE from the shipped manifest. So the obvious two arms would differ by the component
 * only, while both still ran every `#if ENABLE_RTA` block.
 *
 * Three reasons the plain arm flips the flag back (see `deployBuild`):
 *
 *  1. **It is the build the baselines were taken on.** `bs_const=debug=false;
 *     ENABLE_RTA=false;perfTiming=true` is what a plain `npm run build` + sideload ships,
 *     which is what those n=30 numbers were measured against. Making them comparable
 *     again is the concrete harm this calibration exists to close.
 *  2. **It needs no claim about the leftover hooks.** Leaving the flag on leaves
 *     `m.global.addFields({rtaSkeletonHoldMs: 0})` and a `createObject` for a node type
 *     that is no longer there running in the "no-ODC" arm, and the delta would then have
 *     to be argued to be negligible. Turning the flag off removes them along with the
 *     component, so nothing has to be dismissed.
 *  3. **It keeps `provenance.enableRta` true.** That field is derived from whether ODC
 *     answered; with the flag left on, the arm would record `false` about a build whose
 *     manifest said `true`.
 *
 * The cost is that a delta cannot say WHICH of the two it was. That decomposition is
 * deliberately not taken up front: at n=30 this method resolves ~120 ms and up
 * (`home-first-paint-performance.md`), and the leftover hooks are one field-add — an arm
 * isolating them could only ever report "below the floor". If the delta comes back at or
 * above the floor, THEN a third arm (`injectTestingFiles: false` with the flag left on)
 * is worth taking, because only then can it return an answer.
 */

/** Thrown for a calibration that cannot be run — the caller prints `.message` and exits. */
export class CalibrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CalibrationError';
  }
}

/** The npm script, for refusals that name the way forward. */
const CMD = 'npm run measure:calibrate';

/**
 * The two arms, and what each one puts on the device.
 *
 * `enableRta` is what the SHIPPED manifest must say, which is a separate decision from
 * `injectTestingFiles` — see the header. `odcResident` is what follows for the session,
 * and it is what decides whether the arm can read its own identity.
 */
export const ARMS = Object.freeze({
  rta: Object.freeze({
    id: 'rta',
    label: 'RTA build — ODC component resident',
    injectTestingFiles: true,
    enableRta: true,
    odcResident: true,
  }),
  plain: Object.freeze({
    id: 'plain',
    label: 'plain build — no ODC component, ENABLE_RTA=false',
    injectTestingFiles: false,
    enableRta: false,
    odcResident: false,
  }),
});

/**
 * What an arm RECORDS itself as, which is what `measure:compare` selects on. The bare arm
 * id when there is no label; `<arm>-<label>` when there is.
 */
export const armLabel = (armId, label) => (label ? `${armId}-${label}` : armId);

/** Defaults, named so the plan printout and the refusals can quote them. */
export const DEFAULT_SAMPLES = 30;
export const DEFAULT_BLOCK_SIZE = 5;

/**
 * The fewest blocks per arm that can be called interleaved.
 *
 * With one block each the run is all of A then all of B, which is precisely the shape the
 * interleave rule exists to prevent: anything that drifts with time — content, device
 * warm-up, a server getting busy — aliases entirely onto the second arm and is
 * indistinguishable from the effect under test. `measure:compare` reports the alternation
 * it finds; this refuses to TAKE a run whose answer it already knows.
 */
const MIN_BLOCKS_PER_ARM = 2;

const VALUE_FLAGS = new Map([
  ['-n', 'samples'],
  // A suffix for BOTH arm labels, so two calibration runs cannot pool.
  //
  // `measure:compare` selects series by arm label across the whole ledger, so a second
  // run — a re-run after a fix, a smoke run at n=2, the same calibration a month later —
  // is silently merged into the first by `--a arm=rta --b arm=plain`. That is the
  // mixed-population failure this subsystem refuses everywhere else, reachable here
  // through nothing but a default. With `--label smoke` the arms record as `rta-smoke` /
  // `plain-smoke` and can only be selected deliberately.
  ['--label', 'label'],
  ['--samples', 'samples'],
  ['--block-size', 'blockSize'],
  ['--server', 'server'],
  ['--window-ms', 'windowMs'],
]);

const BOOLEAN_FLAGS = new Map([['--no-build', 'noBuild']]);

const knownFlags = () => [...VALUE_FLAGS.keys(), ...BOOLEAN_FLAGS.keys()].join(', ');

/** The selector grammar `measure:compare` reads labels back with splits on these. */
const LABEL_FORBIDDEN = /[,=]/;

const positiveInt = (raw, flag) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new CalibrationError(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return n;
};

/**
 * Parse the driver's command line, strictly — same posture and the same reasons as
 * `parseMeasureArgs`: an unknown flag is an error, and a value flag with no value is an
 * error, because a dropped flag is how a measurement stops asserting what it was typed to
 * assert.
 *
 * Deliberately a SMALL grammar. The calibration is one fixed experiment, not a general
 * measurement front end, and the flags it does not accept are the point: `--nav` gates on
 * ODC and cannot run in the plain arm, and `--deploy` would contradict the arm the driver
 * just deployed.
 */
export function parseCalibrationArgs(argv = []) {
  const raw = {};
  const args = {
    samples: DEFAULT_SAMPLES,
    blockSize: DEFAULT_BLOCK_SIZE,
    noBuild: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;

    if (BOOLEAN_FLAGS.has(name)) {
      if (eq > 0) {
        throw new CalibrationError(`${name} takes no value (got ${JSON.stringify(arg)})`);
      }
      args[BOOLEAN_FLAGS.get(name)] = true;
      continue;
    }
    const key = VALUE_FLAGS.get(name);
    if (!key) {
      throw new CalibrationError(
        `unknown argument ${JSON.stringify(arg)}. Known flags: ${knownFlags()}.\n` +
          '  This is one fixed experiment rather than a measurement front end — in particular\n' +
          '  --nav is not accepted (a nav is driven over ODC, which the plain arm has none of,\n' +
          '  which is why the target is a launch-only screen) and neither is --deploy (the\n' +
          '  driver deploys both arms off ONE build).',
      );
    }
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === '') throw new CalibrationError(`${name} needs a value`);
    raw[key] = value;
  }

  if (raw.label !== undefined) {
    if (LABEL_FORBIDDEN.test(raw.label) || raw.label !== raw.label.trim()) {
      throw new CalibrationError(
        `--label may not contain "," or "=" or outer whitespace (got ${JSON.stringify(raw.label)}) — ` +
          'it becomes part of the arm label, which is the selector grammar ' +
          '`npm run measure:compare -- --a <selector>` reads back.',
      );
    }
    args.label = raw.label;
  }

  if (raw.samples !== undefined) args.samples = positiveInt(raw.samples, '-n / --samples');
  if (raw.blockSize !== undefined) args.blockSize = positiveInt(raw.blockSize, '--block-size');
  if (raw.windowMs !== undefined) {
    const ms = Number(raw.windowMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new CalibrationError(
        `--window-ms must be a positive number of milliseconds, got ${JSON.stringify(raw.windowMs)}`,
      );
    }
    args.windowMs = ms;
  }

  // REQUIRED, and it is the one flag that has no sensible default. The plain arm has no
  // ODC to read identity from, so `--server` is not merely tier 1's expectation there —
  // it is the only thing the enclosing brackets can be checked AGAINST. Without it the
  // enclosure would confirm that two reads agreed with each other, which a device sitting
  // on the wrong server all along satisfies perfectly.
  if (raw.server === undefined) {
    throw new CalibrationError(
      '--server <url> is required.\n' +
        '  The plain arm cannot read its own identity, so the enclosing reads are checked\n' +
        '  against what you declare. Without it the enclosure would only prove the two\n' +
        '  brackets agreed with EACH OTHER — which a device parked on the wrong server the\n' +
        '  whole time satisfies exactly.\n' +
        `  ${CMD} -- --server <url>`,
    );
  }
  args.server = raw.server;

  const blocks = blockSizes(args.samples, args.blockSize).length;
  if (blocks < MIN_BLOCKS_PER_ARM) {
    throw new CalibrationError(
      `--block-size ${args.blockSize} over n=${args.samples} gives ${blocks} block(s) per arm, ` +
        'so the run would be all of one arm and then all of the other.\n' +
        '  Anything that drifts with time — content, device warm-up, a busy server — then\n' +
        '  lands entirely on the second arm and cannot be told from the effect under test.\n' +
        `  Use --block-size ${Math.floor(args.samples / MIN_BLOCKS_PER_ARM)} or smaller.`,
    );
  }

  return args;
}

/**
 * How `samples` splits into blocks. The last one carries the remainder rather than being
 * padded, so `-n 30 --block-size 4` takes 30 samples and not 32 — the operator asked for
 * a series length, and silently changing it is the sort of thing a reader finds months
 * later in the `requested` field.
 */
export function blockSizes(samples, blockSize) {
  const sizes = [];
  for (let left = samples; left > 0; left -= blockSize) sizes.push(Math.min(blockSize, left));
  return sizes;
}

/**
 * The run, as an ordered list of blocks.
 *
 * Always `rta` then `plain`, cycle after cycle, so every plain block has an RTA arm on
 * both sides of it to be enclosed by. The closing bracket for the LAST plain block comes
 * from the restore deploy at the end of the run — which is not a block and is not
 * optional: a device left holding a build with no ODC is a device the next tool cannot
 * use, and that has already cost this project a whole RAM tier (`.178`, 2026-08-17). So
 * the final observed read is free, and the plan does not need a trailing arm to buy it.
 *
 * Both arms therefore get exactly `samples`, which is worth stating because the obvious
 * alternative — ending on an extra RTA block — silently gives one arm more.
 *
 * @returns {{index: number, arm: string, count: number, enclosure: number|null}[]}
 *   `enclosure` groups a plain block with the bracket reads either side of it; it is null
 *   for the RTA blocks, which observe their own identity.
 */
export function planBlocks({ samples = DEFAULT_SAMPLES, blockSize = DEFAULT_BLOCK_SIZE } = {}) {
  const blocks = [];
  blockSizes(samples, blockSize).forEach((count, cycle) => {
    blocks.push({ index: blocks.length, arm: ARMS.rta.id, count, enclosure: null });
    blocks.push({ index: blocks.length, arm: ARMS.plain.id, count, enclosure: cycle });
  });
  return blocks;
}

/** The plan, as lines to print before anything touches the device. */
export function formatPlanLines(blocks, { samples, server, label }) {
  const per = (arm) => blocks.filter((b) => b.arm === arm).reduce((total, b) => total + b.count, 0);
  return [
    `${blocks.length} blocks, ${per(ARMS.rta.id)} + ${per(ARMS.plain.id)} launches, ` +
      `alternating in blocks of up to ${Math.max(...blocks.map((b) => b.count))}`,
    ...Object.values(ARMS).map(
      (arm) =>
        `  arm ${armLabel(arm.id, label).padEnd(5)} ${arm.label} ` +
        `(injectTestingFiles: ${arm.injectTestingFiles}, ENABLE_RTA=${arm.enableRta})`,
    ),
    `  n=${samples} per arm, every sample asserted against ${server}`,
    '  each arm switch is a redeploy off the SAME build — do not edit source/ or components/ ' +
      'while this runs',
  ];
}

/**
 * How it went, and — the part that earns its own function — what did NOT reach the
 * ledger.
 *
 * A calibration that silently published fewer blocks than it took is the failure this
 * whole subsystem is written against: the numbers would look clean and be a subset
 * somebody chose. So every block is accounted for by name, and the exit code follows the
 * accounting rather than the last child's status.
 *
 * @param {{index: number, arm: string, count: number, status: number|null,
 *   published: boolean, reason: string|null}[]} rows
 */
export function summariseCalibration(rows = []) {
  const lines = [];
  for (const row of rows) {
    const state = row.published
      ? 'published'
      : `NOT PUBLISHED — ${row.reason ?? 'no reason recorded'}`;
    lines.push(
      `[calibrate] block ${row.index + 1} · arm ${row.arm.padEnd(5)} · n=${row.count} · ` +
        `exit ${row.status ?? '—'} · ${state}`,
    );
  }
  const published = rows.filter((r) => r.published);
  const withheld = rows.filter((r) => !r.published);
  if (withheld.length) {
    lines.push(
      `[calibrate] ⚠ ${withheld.length} of ${rows.length} block(s) were withheld from ` +
        'measurements.jsonl. They are named above; the samples they took are not in any ' +
        'number read back from the ledger.',
    );
  }
  return {
    lines,
    published: published.length,
    withheld: withheld.length,
    // Every block published, and both arms actually carry something — a run that
    // published six RTA blocks and no plain ones is not a calibration, and would
    // otherwise report itself as a clean pass.
    ok:
      rows.length > 0 &&
      withheld.length === 0 &&
      new Set(published.map((r) => r.arm)).size === Object.keys(ARMS).length,
  };
}
