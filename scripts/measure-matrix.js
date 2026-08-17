/**
 * The rules of a multi-device measurement run: which devices, whether the set is
 * coherent, and how it went.
 *
 * ## Why this is separate from `measure-devices.js`
 *
 * Same reason `measure-args.js`, `measure-selection.js` and `measure-loop.js` are
 * separate from `measure.js`: the entry point spawns processes and reads the network,
 * so nothing in it can be reached by a test. Everything here is a pure function over
 * plain data — a device list, a set of ECP probes, a set of child exit codes — so the
 * refusals can be driven without three Rokus on the LAN.
 *
 * ## What a matrix run is, and what it is NOT
 *
 * It is the SAME measurement taken once per device, sequentially, each one writing its
 * own line to `measurements.jsonl`. It is deliberately NOT a report: the matrix report
 * is a READER over that file (see the 2026-08-16 decision in the project PLAN), because
 * a reader can rebuild the matrix from runs taken weeks apart on different devices while
 * an in-process report can only ever describe the run that just finished.
 *
 * So this module's whole job is to make sure the right lines get written, and to refuse
 * a set of devices whose lines could not afterwards be told apart.
 */

/** Thrown for a matrix that cannot be run — the caller prints `.message` and exits. */
export class MatrixError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MatrixError';
  }
}

/** The npm script, for use in refusal messages that name the way forward. */
const CMD = 'npm run measure:devices';

/** The repair for a device left seeded, named wherever one might be. */
const RESTORE_CMD = 'npm run rta:restore';

/**
 * Split a `ROKU_DEVICES` value into an ordered device list.
 *
 * Strict on the same principle as `measure-args.js`: a silently-dropped address is a
 * device missing from a matrix the operator believes is complete, and nothing later
 * in the run can notice — `measurements.jsonl` records what WAS measured, never what
 * was meant to be.
 *
 * @throws {MatrixError} on an empty list or a repeated address.
 */
export function parseDeviceList(raw) {
  const hosts = String(raw ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  if (!hosts.length) {
    throw new MatrixError(
      `ROKU_DEVICES is set but names no device (got ${JSON.stringify(raw)}). ` +
        'Expected a comma-separated list of addresses, e.g. ROKU_DEVICES=192.0.2.10,192.0.2.11',
    );
  }

  // A repeat is a typo every time. The run would take twice as long and write two
  // records for one device, which is the mis-attribution this subsystem exists to
  // refuse — see `sameModelRefusal` below for the harder version of the same problem.
  const seen = new Set();
  const repeated = hosts.filter((h) => (seen.has(h) ? true : (seen.add(h), false)));
  if (repeated.length) {
    throw new MatrixError(
      `ROKU_DEVICES names ${[...new Set(repeated)].join(', ')} more than once. Each device is ` +
        'measured once; a repeat only doubles the run and writes two records for one device.',
    );
  }

  return hosts;
}

/**
 * The device list for this run, from the environment.
 *
 * `ROKU_DEVICES` declares which devices EXIST; `scripts/data/roku-hardware.json` declares
 * what tier a model IS. That split is what lets a contributor list only their own
 * addresses and get correct tier labels for free — the addresses are the one thing no
 * committed dataset can know.
 *
 * Absent means REFUSE rather than fall back to `ROKU_IP`. A one-device "matrix" is what
 * `npm run measure` already is, and quietly delivering one under the matrix command
 * would leave an operator believing they had measured three tiers.
 *
 * @throws {MatrixError} when `ROKU_DEVICES` is unset or unusable.
 */
export function resolveDevices(env = {}) {
  if (env.ROKU_DEVICES === undefined) {
    throw new MatrixError(
      'ROKU_DEVICES is not set, so there is no matrix to run.\n' +
        '  Add it to .env as a comma-separated list of the devices you have:\n' +
        '    ROKU_DEVICES=192.0.2.10,192.0.2.11,192.0.2.12\n' +
        '  ROKU_IP stays the single-device default — `npm run measure` is unchanged and is\n' +
        '  still the right tool for one device.',
    );
  }
  return parseDeviceList(env.ROKU_DEVICES);
}

/**
 * Refuse a matrix that has not said which server every device must be on.
 *
 * **This is the one rule the driver keeps that `measure` cannot**, and it is worth being
 * precise about why. Single-device, an undeclared server is merely unasserted: the tool
 * pins whatever identity it finds, re-checks it at the end, and says out loud that it did
 * not assert. Across devices it is something else entirely — the SERVER IS THE WORKLOAD,
 * and a matrix whose rows differ in both hardware and library is not measuring hardware at
 * all. Only this layer knows there is more than one arm, so only this layer can refuse it.
 *
 * Not a hypothetical, and not one incident. The tech-debt entry records the first
 * hand-driven matrix measuring two devices against the DEMO server and one against the
 * real one, which read as "the 512 MB Stick is nearly twice as fast as the 1 GB Stick 4K"
 * until someone checked the `rows` column. The very first run of THIS tool then hit the
 * same split on the same three devices — `.176` on `demo.jellyfin.org`, `.177` on the
 * developer's own server — because nothing had changed on the devices in the meantime.
 * A confound that survives being written down twice needs a gate, not a third warning.
 *
 * `--server <url>` is the instrument that already exists: tier 1 turns it into a hard
 * assert, so a device on the wrong server refuses BEFORE it takes a sample, loudly and by
 * name. `--no-server` is the coherent opposite for a `serverSelect` matrix. Either one
 * makes the claim checkable; neither being present makes it unmade.
 *
 * @param {string[]} forwarded the flags being passed through to `measure`.
 * @returns {string|null} the refusal, ready to print.
 */
export function serverDeclarationRefusal(forwarded = []) {
  const declares = forwarded.some(
    (a) => a === '--server' || a.startsWith('--server=') || a === '--no-server',
  );
  if (declares) return null;
  return (
    'a matrix run must declare which server the devices are on — pass --server <url>\n' +
    '  (or --no-server for a `serverSelect` matrix).\n' +
    '  The server is the WORKLOAD, so a matrix whose devices are signed into different\n' +
    '  servers measures the libraries, not the hardware. It has happened twice on these\n' +
    '  devices already: one Roku left on demo.jellyfin.org next to two on a real server\n' +
    '  reads as a hardware difference until somebody checks the `rows` column.\n' +
    '  `npm run measure` alone only WARNS about this, because with one device there is\n' +
    "  nothing to confound; the flag is a hard tier-1 assert, so a device that isn't on\n" +
    '  that server refuses before taking a single sample.\n' +
    '  If the devices are NOT all on that server yet, --sign-in <url> --user <name> puts\n' +
    '  each one there, measures it, and restores it — and declares the server by itself.'
  );
}

/** The flags that make up the sign-in mode, and the key each writes. */
const SIGN_IN_FLAGS = new Map([
  ['--sign-in', 'url'],
  ['--user', 'username'],
  ['--password', 'password'],
]);

/**
 * Split the sign-in mode out of the flags bound for `measure`, or return `{signIn: null}`.
 *
 * ## Why the matrix needs this at all
 *
 * `serverDeclarationRefusal` above ASSERTS that every device is on one server; it cannot
 * PUT them there, because `measure` deliberately never writes the registry. So until this
 * existed, a cross-tier run meant signing three devices in by hand BEFORE every run — and
 * because the sanctioned workflow restores each device afterwards, that ritual recurred
 * indefinitely rather than being one-time setup (measured 2026-08-16: ~2 minutes per run,
 * plus a restore to verify). A matrix that demands a manual ritual before every run is not
 * the "cheap to take" the project charter asks for.
 *
 * ## Why the seed lives on the DRIVER and never on `measure`
 *
 * `measure.js`'s header states the terms: *"If a future mode needs to seed, it must adopt
 * `lib/registry.js` at the same time; do not add a seed without one."* Its invariant of
 * never touching the registry is load-bearing — it is what lets a single-device run measure
 * the app exactly as the device already has it. The driver is a different contract: it
 * already refuses a run whose devices might differ, so it is the layer that owes the
 * operator a way to make them agree.
 *
 * ## `--sign-in <url>` IMPLIES `--server <url>`
 *
 * The seed and the assert must name the same server or the mode would be self-defeating:
 * seeding device 3 into A while tier 1 asserts B is the confound this whole layer exists
 * to refuse. Rather than asking the operator to type the URL twice and hoping they match,
 * the URL is forwarded as `--server`, so tier 1 still hard-asserts on every device — the
 * seed is CHECKED against the running app rather than trusted. That also means `--sign-in`
 * satisfies the server declaration on its own, which falls out rather than being special-cased:
 * the refusal reads the forwarded list, and by then it carries `--server`.
 *
 * @param {string[]} forwarded the raw command line, sign-in flags included.
 * @param {object} env process env — `MEASURE_SIGNIN_PASSWORD` is the non-argv way to pass
 *   a password, so a real one need not land in shell history or in `ps` output.
 * @returns {{signIn: {url: string, username: string, password: string}|null, forward: string[]}}
 *   `forward` is what `measure` should receive: the sign-in flags removed, `--server` added.
 * @throws {MatrixError} on a half-configured or self-contradicting mode.
 */
export function parseSignIn(forwarded = [], env = {}) {
  const list = [...(forwarded ?? [])];
  const values = {};
  const forward = [];

  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const key = SIGN_IN_FLAGS.get(name);
    if (!key) {
      forward.push(arg);
      continue;
    }

    let value;
    if (eq === -1) {
      value = list[i + 1];
      // The `measure-args` lesson, one layer out: a trailing value flag that consumes
      // `undefined` configures the mode half-way and fails much later, somewhere that
      // cannot name the flag the operator actually typed. `--flag --other` is the same
      // mistake wearing a value. (A password that genuinely starts with `--` is why
      // MEASURE_SIGNIN_PASSWORD exists.)
      if (value === undefined || value.startsWith('--')) {
        throw new MatrixError(
          `${name} needs a value, and the next thing on the command line was ` +
            `${value === undefined ? 'nothing' : JSON.stringify(value)}.\n` +
            `  e.g. ${CMD} -- --sign-in http://192.0.2.10:8096 --user alice --nav settings -n 30`,
        );
      }
      i++;
    } else {
      value = arg.slice(eq + 1);
    }

    // A blank password is a real Jellyfin account state (`HasPassword: false`), so only
    // the two flags that name something refuse an empty value.
    if (value === '' && key !== 'password') {
      throw new MatrixError(`${name} was given an empty value.`);
    }

    // A REPEAT is refused on exactly the reasoning that refuses `--server` beside
    // `--sign-in` sixty lines below: the last one silently wins, so a disagreement
    // between two spellings of the same intent gets SETTLED rather than surfaced,
    // and the run produces a well-formed record of the wrong thing. `--sign-in A
    // --sign-in B` would seed and assert B without a word. Same rule
    // `parseDeviceList` applies to a repeated address, for the same reason.
    //
    // The values are deliberately NOT echoed: one of these flags is a password.
    if (values[key] !== undefined) {
      throw new MatrixError(
        `${name} was given more than once, and the last one would silently win.\n` +
          '  That is the one failure this mode cannot tolerate — the seed and the tier-1\n' +
          '  assert have to name ONE server. Keep the one you meant and drop the other.',
      );
    }
    values[key] = value;
  }

  const { url, username, password } = values;

  if (url === undefined) {
    // Refused rather than ignored: silently dropping them would run the matrix against
    // whatever the devices happen to be signed into, which is the exact state this mode
    // exists to replace — and the operator would have no way to tell from the output.
    const orphan = username !== undefined ? '--user' : password !== undefined ? '--password' : null;
    if (orphan) {
      throw new MatrixError(
        `${orphan} was given without --sign-in <url>, so there is nothing to sign in to.\n` +
          `  Add the server: ${CMD} -- --sign-in <url> --user <name> <the same flags>`,
      );
    }
    return { signIn: null, forward };
  }

  if (username === undefined) {
    throw new MatrixError(
      '--sign-in <url> needs --user <name>: the seed writes a real authenticated session,\n' +
        '  so it has to know whose. Passwordless accounts are the common case here and need\n' +
        '  no --password; set MEASURE_SIGNIN_PASSWORD in the environment for one that does.',
    );
  }

  // Both of these are contradictions rather than redundancies, and neither can be resolved
  // by picking a winner: `measure` would take the LAST `--server` on its line, so forwarding
  // two would settle a disagreement silently — which is how this subsystem produces a
  // well-formed record of the wrong thing.
  if (forward.some((a) => a === '--server' || a.startsWith('--server='))) {
    throw new MatrixError(
      '--sign-in <url> already declares the server, so --server is redundant at best and a\n' +
        '  contradiction at worst: the mode seeds every device into the sign-in URL and\n' +
        '  forwards that same URL as --server, so tier 1 asserts what was actually seeded.\n' +
        '  Drop --server and keep --sign-in.',
    );
  }
  if (forward.includes('--no-server')) {
    throw new MatrixError(
      '--sign-in <url> and --no-server contradict each other: one signs every device INTO a\n' +
        '  server, the other asserts there is none on the node. A `serverSelect` matrix is\n' +
        '  measured with --no-server and no sign-in — that screen is reached by DELETING the\n' +
        '  server, so seeding one is the opposite of establishing its precondition.',
    );
  }

  return {
    signIn: { url, username, password: password ?? env.MEASURE_SIGNIN_PASSWORD ?? '' },
    forward: [...forward, '--server', url],
  };
}

/**
 * What an interrupt should do, given which child is running and whether one already landed.
 *
 * ## Why this is a function here rather than three `if`s in the handler
 *
 * The driver's interrupt handling has already been wrong once in a way no reader
 * caught, and the reason it survived review is that there was nowhere to pin it. The
 * first cut recorded the signal in a flag and branched on it — correct-looking, and
 * DEAD: the device loop was `spawnSync` throughout, so the event loop never yielded a
 * turn and the handler body never ran before `process.exit`. Verified 2026-08-16 by
 * standalone reproduction, after which the loop went async (see `runFor` in
 * `measure-devices.js`). The rules moved HERE at the same time, because this module's
 * whole charter is that the driver's rules can be driven without three Rokus on the
 * LAN — an interrupt policy is exactly that kind of rule, and it is the one that had
 * been verified by reasoning instead.
 *
 * ## The rules, and the one the sibling entry point did not need
 *
 * `rta-run.js` faced this first and settled the shape: the first signal stops the run
 * and lets the restore happen, a second abandons it, and the child is killed outright
 * so a bare `kill` means the same thing a terminal Ctrl-C does. That is inherited.
 *
 * What is new here is that the matrix has THREE kinds of child and `rta-run.js` has
 * one, so it never had to say which of them may be killed. The restore is the child
 * this whole mechanism exists to buy time for, so a FIRST signal must not kill it —
 * a literal port would abort the put-back while printing "stopping after this device
 * is put back", which is the opposite of what it says. It is protected once; the
 * second signal abandons it, and the snapshot on disk is what makes that safe.
 *
 * @param {string} signal the signal received, e.g. `SIGINT`.
 * @param {object} state
 * @param {string|null} state.kind which child is running — `sign-in` / `measure` /
 *   `restore`, or `null` between two spawns (the window that used to be unreachable).
 * @param {string|null} state.host the device that child is driving, so the abandon path
 *   names the repair for the device actually at risk rather than a `<host>` placeholder.
 * @param {boolean} state.interrupted whether a signal has already been recorded.
 * @returns {{lines: string[], kill: 'SIGTERM'|'SIGKILL'|null, exit: number|null}}
 *   `kill` is what to send the RUNNING child, and is `null` when there is none to send it
 *   to — the caller would no-op on that anyway, but a policy that returns a signal for a
 *   child that does not exist is a rule nobody can read back. `exit` is a process exit
 *   code, or `null` to carry on.
 */
/**
 * The exit code a child uses when a signal ended it.
 *
 * 130 rather than the shell's `128+n`, because that is already what every script in this
 * repo that traps a signal exits with — `measure.js`, `measure-signin.js`, `rta-run.js`,
 * `capture-screenshots.js`, `run-roku-tests.js` — and `rta-run.js` goes further, mapping a
 * child KILLED by any signal onto 130 as well. The convention deliberately drops WHICH
 * signal, and encoding it in two of the five would have bought that detail at the price of
 * a reader having to remember which scripts do and do not.
 *
 * Exported so the children import it rather than each retyping a literal: the writer and
 * `wasInterrupted` below are the two halves of one contract, and a drift between them is
 * invisible until an operator's deliberate stop is filed as a device failure.
 */
export const INTERRUPTED_EXIT = 130;

/**
 * Did this child stop because someone signalled it?
 *
 * `signal` is the OBSERVED answer. Node fills it in only when the OS actually killed the
 * process — so a child that TRAPS its signals and exits under its own power always reports
 * `null` there. Both measurement children have to trap: releasing the device lock is an
 * `await`, and a dying process never gets one. The result was that the driver saw nothing
 * but a non-zero status and filed an operator's deliberate stop as that device's failure.
 *
 * The exit code is the INFERRED answer, and it is weaker on purpose — it establishes THAT a
 * signal ended the child, never which one. Callers must keep the two apart rather than
 * collapsing them into one field: `summariseMatrix` prints a signal name only where one was
 * observed, and says a bare "interrupted" where only the code says so.
 *
 * @param {number|null} status the child's exit code, or `null` if a signal killed it.
 * @param {string|null} [signal] the signal name Node reported, when it killed the child.
 * @returns {boolean} whether a signal ended this child, observed or inferred.
 */
export function wasInterrupted(status, signal = null) {
  return Boolean(signal) || status === INTERRUPTED_EXIT;
}

export function signalPolicy(signal, { kind = null, host = null, interrupted = false } = {}) {
  // "Ctrl-C" only when Ctrl-C is what it was: this mode is now reachable by a bare
  // `kill` and by a `timeout` wrapper, where telling the operator to press Ctrl-C
  // names an action they did not take and cannot repeat.
  const again = signal === 'SIGINT' ? 'Ctrl-C' : signal;

  if (interrupted) {
    // Never trap someone in an un-killable process. The snapshot is on disk before any
    // seeding, so abandoning is recoverable rather than destructive — the same trade
    // `armRestoreOnInterrupt` makes in `tests/rta/lib/registry.js`, and the reason the
    // repair command travels with the message rather than being left to the summary
    // (there will not be one).
    return {
      lines: [
        `second ${signal} — abandoning the restore, exiting now.`,
        `recover with: ROKU_IP=${host ?? '<host>'} ${RESTORE_CMD}`,
      ],
      kill: kind ? 'SIGKILL' : null,
      exit: 130,
    };
  }

  if (kind === 'restore') {
    return {
      lines: [
        `${signal} — this device is being put back; that finishes first (~30 s).`,
        `${again} again to abandon it — the snapshot on disk is the repair.`,
      ],
      kill: null,
      exit: null,
    };
  }

  return {
    lines: [`${signal} — stopping after this device is put back. ${again} again to abandon.`],
    // Killed rather than drained, so one signal means one thing however it was sent: a
    // terminal Ctrl-C already reached the child through the process group, and this is
    // what makes a bare `kill` behave the same instead of being absorbed for the rest
    // of an n=30 series. The samples are lost either way on that path.
    kill: kind ? 'SIGTERM' : null,
    exit: null,
  };
}

/**
 * Refuse a probe set that cannot produce an attributable matrix, or return null.
 *
 * Checked BEFORE the first sample rather than discovered during it, because a three-device
 * series is tens of minutes long and every failure here is knowable in the first second.
 *
 * @param {{host: string, info: object|null, error: string|null}[]} probes one per device,
 *   `info` being the flat ECP `device-info` document (see `fetchDeviceInfo`).
 * @param {(modelNumber: string) => boolean} cannotRunApps injected rather than imported so
 *   this module stays a pure function over data — and so a test can exercise the legacy
 *   refusal without depending on which models Roku currently lists as legacy.
 * @returns {string|null} the refusal, ready to print.
 */
export function preflightRefusal(probes, { cannotRunApps = () => false } = {}) {
  return (
    unreachableRefusal(probes) ?? legacyRefusal(probes, cannotRunApps) ?? sameDeviceRefusal(probes)
  );
}

/** `ROKU_DEVICES=<the ones that are fine> npm run measure:devices -- <same flags>` */
function subsetHint(probes, keep) {
  const survivors = probes.filter(keep).map((p) => p.host);
  if (!survivors.length) return '';
  return (
    `\n  To measure the rest anyway, name them for this run only:\n` +
    `    ROKU_DEVICES=${survivors.join(',')} ${CMD} -- <the same flags>`
  );
}

/**
 * A device that did not answer ECP.
 *
 * The whole set is refused rather than the device dropped, and that is the deliberate
 * direction: `ROKU_DEVICES` is a DECLARATION of the matrix, so a run that silently
 * delivers two of its three tiers hands back a different deliverable under the same
 * name. The subset hint makes proceeding one command rather than an argument.
 */
function unreachableRefusal(probes) {
  const dead = probes.filter((p) => !p.info);
  if (!dead.length) return null;
  return (
    `${dead.length} of ${probes.length} device(s) did not answer ECP:\n` +
    dead.map((p) => `    ${p.host} — ${p.error || 'no response'}`).join('\n') +
    '\n  A matrix run is tens of minutes long, so this is refused now rather than found\n' +
    '  partway through. Check the device is powered on and on this network.' +
    subsetHint(probes, (p) => p.info)
  );
}

/**
 * A device JellyRock cannot run on at all.
 *
 * Roku's own table says these models "cannot be used to run IDK apps", so this is not a
 * gap in the dataset — it is a fact about the hardware, and the run would fail at deploy
 * with something far less clear.
 */
function legacyRefusal(probes, cannotRunApps) {
  const legacy = probes.filter((p) => p.info && cannotRunApps(p.info['model-number']));
  if (!legacy.length) return null;
  return (
    'these device(s) cannot run JellyRock at all, per Roku’s published hardware table:\n' +
    legacy
      .map((p) => `    ${p.host} — ${p.info['model-name']} (${p.info['model-number']})`)
      .join('\n') +
    subsetHint(probes, (p) => p.info && !cannotRunApps(p.info['model-number']))
  );
}

/**
 * Two entries that cannot be told apart in the record afterwards.
 *
 * Two cases, one consequence. **Two addresses, one device** — a DHCP lease moved and the
 * list now names the same Roku twice — would relaunch one device twice and write two
 * records for it. **Two different devices of the same MODEL** is a legitimate thing to
 * want to measure (device-to-device variance), and it still cannot be recorded here:
 * `measurements.jsonl` identifies a device by `model` / `modelNumber` / `ramTier` and by
 * nothing else, so the two series come back indistinguishable, and a reader pairing them
 * as one population is exactly the silent mis-attribution the mount-identity work
 * (ADR 0028) exists to prevent.
 *
 * The escape is real and is named in the message: measure them one at a time with
 * `--arm`, which IS a per-series label the record carries and a comparison selects on.
 */
function sameDeviceRefusal(probes) {
  const live = probes.filter((p) => p.info);
  const byId = groupBy(live, (p) => p.info['device-id']);
  const dupIds = [...byId.values()].filter((g) => g.length > 1);
  if (dupIds.length) {
    return (
      'the same physical device is named more than once — ECP reports one `device-id` for:\n' +
      dupIds.map((g) => `    ${g.map((p) => p.host).join(' and ')}`).join('\n') +
      '\n  An address is not an identity: a DHCP lease can move, so two entries in\n' +
      '  ROKU_DEVICES can be one Roku. It would be relaunched twice and recorded twice.'
    );
  }

  const byModel = groupBy(live, (p) => p.info['model-number']);
  const dupModels = [...byModel.entries()].filter(([, g]) => g.length > 1);
  if (dupModels.length) {
    return (
      'two devices of the same MODEL are in one matrix, and their records could not be told\n' +
      '  apart afterwards:\n' +
      dupModels
        .map(([model, g]) => `    ${model} — ${g.map((p) => p.host).join(', ')}`)
        .join('\n') +
      '\n  `measurements.jsonl` identifies a device by model / model number / RAM tier and by\n' +
      '  nothing else, so both series read back as one population.\n' +
      '  Measure them one at a time and label each with --arm, which the record does carry:\n' +
      `    ROKU_IP=${dupModels[0][1][0].host} npm run measure -- --arm <a-name> <the same flags>`
    );
  }

  return null;
}

function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (k === undefined || k === '') continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

/**
 * One line per device, naming what is about to be measured.
 *
 * Printed before the first launch because a matrix is long and unattended, and "which
 * three devices did this actually run on" is otherwise a question only the records can
 * answer — after the fact. An unknown RAM tier is SAID rather than blanked: the dataset
 * lags Roku's table by up to a week (see the sync workflow), and a device missing from it
 * is still perfectly measurable, just not labelled.
 *
 * @param {(modelNumber: string) => string} describeDevice injected, per `preflightRefusal`.
 */
export function formatPlanLines(probes, { describeDevice = (m) => String(m) } = {}) {
  return probes.map(
    (p, i) => `  ${i + 1}. ${p.host} — ${describeDevice(p.info?.['model-number'])}`,
  );
}

/**
 * What became of each device, and whether the matrix as a whole stands.
 *
 * A device that failed is REPORTED, never dropped: the point of the per-device split is
 * that losing one device costs one row rather than the run, and a summary that silently
 * omitted the row would turn a two-of-three matrix back into an unmarked one.
 *
 * A device left DIRTY is louder still, and is the one thing here that is not about the
 * measurement at all: under `--sign-in` the matrix seeds a real session onto someone's own
 * Roku, so a restore that did not verify has to be named on its own line with the command
 * that repairs it. It also fails the run — a summary reporting three measured devices while
 * one of them is still signed into the matrix's server would be true and useless.
 *
 * @param {{host: string, label: string, status: number|null, signal: string|null,
 *   skipped?: boolean, stage?: string, restored?: boolean}[]} results in the order the
 *   devices ran. `stage` names which child failed (`sign-in` / `measure`); `restored` is
 *   absent when nothing was seeded, so there was nothing to put back.
 */
export function summariseMatrix(results) {
  const lines = results.flatMap((r) => {
    // The stage rides on BOTH outcomes, not just the failure. "Interrupted" alone
    // cannot say whether a device got as far as a series, and that is the difference
    // between a row with samples on disk and one with none.
    const stage = r.stage ? `${r.stage} ` : '';
    // Named only when a name was OBSERVED. A child that trapped its signal and exited
    // under its own power leaves the exit code as the only evidence, and that establishes
    // THAT it was interrupted, never which signal did it — so the bare word is the honest
    // rendering. Inventing a plausible name here would put a deduction in the one line an
    // operator reads to decide whether their own Ctrl-C caused this.
    const verdict = r.skipped
      ? 'not run (the matrix stopped first)'
      : r.signal
        ? `${stage}interrupted (${r.signal})`
        : r.interrupted
          ? `${stage}interrupted`
          : r.status === 0
            ? 'measured'
            : `${stage}FAILED (exit ${r.status}) — its own output above says why`;
    const line = `  ${r.host} — ${r.label}: ${verdict}`;
    return r.restored === false
      ? [
          line,
          `    ⚠ RESTORE FAILED — this device is STILL SEEDED. Repair it before trusting it:`,
          `        ROKU_IP=${r.host} npm run rta:restore`,
        ]
      : [line];
  });
  const measured = results.filter(
    (r) => !r.skipped && !r.signal && !r.interrupted && r.status === 0,
  ).length;
  return {
    lines,
    measured,
    // The exit code the entry point returns. Anything short of every declared device
    // measuring cleanly is a non-zero exit, because a matrix that lost a tier is not the
    // thing that was asked for — even though the tiers that did run are on disk and real.
    ok:
      measured === results.length &&
      results.length > 0 &&
      !results.some((r) => r.restored === false),
  };
}
