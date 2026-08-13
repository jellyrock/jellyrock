/**
 * `npm run measure`'s command line, parsed STRICTLY.
 *
 * ## Why this is its own module
 *
 * It lives here rather than in `measure.js` for one reason: `measure.js` is a
 * top-level-await entry point that claims the device on import, so nothing can
 * import it to test it. This is the only part of the tool with real branching, and
 * it is the part whose failure mode is SILENT — so it is the part that has to be
 * testable. (`crash-report.js` and `server-upgrade.js` solve the same problem with
 * an `import.meta.url` main guard; that would mean restructuring a device
 * orchestration nobody can re-run without hardware, for no additional coverage.)
 *
 * ## Why strict
 *
 * The tool's whole thesis is that a measurement guard must not go quietly blind,
 * and a lenient parser is exactly how it does. Two holes, both real in the first
 * revision:
 *
 * - A trailing `--server` consumed `argv[i + 1]` = `undefined` and left the
 *   expectation undeclared, so tier 1 silently did NOT assert on the run the
 *   operator typed `--server` to make it assert.
 * - An unrecognised flag was dropped entirely, so `--sever https://…` and
 *   `--smaples 30` produced a confident, wrongly-shaped series.
 *
 * Neither is hypothetical in kind: `measure.js` already carried a note that the
 * documented `-n` short form failed to parse and was only caught by reading the
 * usage block against the parser. So every flag is declared in one table, an
 * unknown one is an error, and a value flag without a value is an error.
 */

/** Thrown for a bad command line — the caller prints `.message` and exits, no stack. */
export class MeasureArgError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MeasureArgError';
  }
}

/** Flags that take a value, and the key each writes. `-n` is the documented short form. */
const VALUE_FLAGS = new Map([
  ['-n', 'samples'],
  ['--samples', 'samples'],
  ['--measurement', 'measurement'],
  ['--server', 'server'],
  ['--window-ms', 'windowMs'],
]);

/** Flags that take no value. */
const BOOLEAN_FLAGS = new Map([['--deploy', 'deploy']]);

const knownFlags = () => [...VALUE_FLAGS.keys(), ...BOOLEAN_FLAGS.keys()].join(', ');

/**
 * Parse `process.argv.slice(2)`.
 *
 * `measurementIds` is passed in rather than imported so the validation message can
 * name the registered families without this module depending on the registry — the
 * registry is what the CLI is *about*, and a parser that imports it makes a cycle
 * the moment the registry wants to report a usage error.
 *
 * @throws {MeasureArgError} on an unknown flag, a value flag with no value, or a
 *   value that cannot be what the flag means.
 */
export function parseMeasureArgs(argv = [], { measurementIds = [], defaultMeasurement } = {}) {
  const raw = {};
  const args = { samples: 5, measurement: defaultMeasurement, deploy: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i]);
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;

    if (BOOLEAN_FLAGS.has(name)) {
      if (eq > 0) throw new MeasureArgError(`${name} takes no value (got ${JSON.stringify(arg)})`);
      args[BOOLEAN_FLAGS.get(name)] = true;
      continue;
    }

    const key = VALUE_FLAGS.get(name);
    if (!key) {
      throw new MeasureArgError(
        `unknown argument ${JSON.stringify(arg)}. Known flags: ${knownFlags()}. ` +
          'Refused rather than ignored — a dropped flag is how a measurement silently ' +
          'stops asserting the thing you passed it to assert.',
      );
    }
    // `--flag=` (empty) is a typo, not an empty value; `--flag` at the end of the
    // line has nothing to consume. Both are the silent-downgrade case.
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === '') {
      throw new MeasureArgError(`${name} needs a value`);
    }
    raw[key] = value;
  }

  if (raw.samples !== undefined) {
    const n = Number(raw.samples);
    if (!Number.isInteger(n) || n < 1) {
      throw new MeasureArgError(
        `-n / --samples must be a positive integer, got ${JSON.stringify(raw.samples)}`,
      );
    }
    args.samples = n;
  }

  if (raw.windowMs !== undefined) {
    const ms = Number(raw.windowMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new MeasureArgError(
        `--window-ms must be a positive number of milliseconds, got ${JSON.stringify(raw.windowMs)}`,
      );
    }
    args.windowMs = ms;
  }

  if (raw.measurement !== undefined) args.measurement = raw.measurement;
  if (measurementIds.length && !measurementIds.includes(args.measurement)) {
    throw new MeasureArgError(
      `unknown measurement ${JSON.stringify(args.measurement)}. Registered: ${measurementIds.join(', ')}`,
    );
  }

  if (raw.server !== undefined) args.server = raw.server;
  return args;
}
