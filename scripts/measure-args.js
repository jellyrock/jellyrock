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
  // Which side of a comparison this series belongs to — a free-form label read
  // back by `measure-compare.js`. It exists because the two arms of the commonest
  // comparison are otherwise INDISTINGUISHABLE in the record: measuring an
  // uncommitted change means both arms carry the same `commit` and `dirty: true`,
  // so nothing but a label the operator supplies can separate them.
  ['--arm', 'arm'],
  // WHERE the app was. Only meaningful for a family whose `screen` is null (see
  // `measurements.js`), and only for a screen measurement cannot NAVIGATE to — see
  // `--nav`, which supersedes it wherever it applies.
  ['--screen', 'screen'],
  // DRIVE the app to a screen after each relaunch, by name, using the nav declared on
  // that screen's entry in `tests/rta/screens.js`.
  //
  // This is what makes anything but Home measurable: without it `measure.js` reaches a
  // screen by relaunching, so the app is always on Home and 26 of the 29 registered
  // screens are unreachable. Naming the screen registry rather than growing a private
  // one is the point — the functional suite and the store screenshots already drive
  // these navs, and a second copy would drift from the app the first one is keeping
  // honest.
  ['--nav', 'nav'],
  // The library id a nav should target, for a server with more than one library of a
  // type. `navLibraryByType` matches on collectionType when this is absent and REFUSES
  // an ambiguous match rather than guessing — correct, but it refuses on exactly the
  // large multi-library servers a perf measurement most wants to run against.
  ['--library', 'library'],
  // WHICH mount to report, when one launch produced several. A chained navigation
  // mounts one component more than once (a Season is reached THROUGH its Series), so
  // `indexInLaunch === 0` is the wrong screen. Unlike `--screen` this is CHECKABLE —
  // `measure.js` refuses a value no sample carried — so it is evidence rather than an
  // assertion, which is the same distinction that made the family's screen derived.
  ['--variant', 'variant'],
  // The other half of a mount's identity, and the half `--variant` alone cannot express:
  // a launch can mount two DIFFERENT components under the SAME variant. Every playback
  // nav does — reaching the player means walking through `ItemDetails`, and for a movie
  // both stamp `Movie` — so `--nav osd` saw one variant, concluded the launch was
  // single-mount, and reported the details screen's numbers under `screen: osd`.
  // Checkable on the same terms as `--variant`: refused if no sample carried it.
  ['--component', 'component'],
]);

/** Flags that take no value. */
const BOOLEAN_FLAGS = new Map([
  ['--deploy', 'deploy'],
  // Declare that the app has NO server on the node — the state `serverSelect` can only
  // be measured in, because reaching that screen means deleting the server. Turns tier
  // 1's absent `serverUrl` from a fatal read failure into an assertion, and asserts the
  // OTHER direction too: a device that still has a server lands on Home, so the flag
  // fails rather than measuring the wrong screen.
  //
  // NAMED for what it asserts, and that is a correction rather than a preference. The
  // first cut called it `--signed-out`, which is the app's word for a DIFFERENT state:
  // `SignOut()` (app menu → Sign out) and `SignOut(false)` (→ Change user) both clear
  // `active_user` and leave `server` untouched, so both land on `userSelect` — where
  // this flag REFUSES. Only Change server (`unsetSetting("server")` + `server.Delete()`)
  // produces the state it asserts. A name that points at the wrong menu item generated
  // four wrong sentences before anyone typed the flag; `--no-server` cannot, and it
  // reads as the plain negation of `--server <url>`, which is exactly what it is.
  ['--no-server', 'noServer'],
]);

/**
 * Characters a `--arm` / `--screen` label may not contain, because they are the
 * SELECTOR grammar `measure-compare.js` reads the label back with.
 *
 * `--a` splits on `,` and takes the first `=` as a key/value break. So a label
 * carrying either is written into the ledger fine and is then unaddressable:
 * `--arm "before,v2"` records `before,v2`, and `--a before,v2` parses to
 * `{arm: 'v2'}` — a DIFFERENT selection, made silently, which matches nothing and
 * reports "selected no usable series" while pointing at the wrong cause. `--arm
 * "a=b"` fails differently, as an unknown selector key `a`.
 *
 * Refused at the moment the label is created rather than diagnosed later, for the
 * same reason as every other refusal in this file: the failure is silent, and the
 * only place it can be attributed to what caused it is here. Spaces are deliberately
 * allowed — `--a "batched attach"` round-trips, because the selector parser trims
 * each part rather than splitting on whitespace.
 */
const LABEL_FORBIDDEN = /[,=]/;

/**
 * Refuse a label the selector grammar cannot name. Shared by `--arm` and `--screen`
 * because both are selector keys and both fail identically.
 */
function checkLabel(flag, value) {
  if (LABEL_FORBIDDEN.test(value)) {
    throw new MeasureArgError(
      `${flag} may not contain "," or "=" (got ${JSON.stringify(value)}) — those are the ` +
        'selector grammar `npm run measure:compare -- --a <selector>` reads the label back ' +
        'with, so a label carrying one records fine and can never be selected again.',
    );
  }
  if (value !== value.trim()) {
    throw new MeasureArgError(
      `${flag} may not have leading or trailing whitespace (got ${JSON.stringify(value)}) — ` +
        'the selector parser trims, so the recorded label would never match what you type.',
    );
  }
}

const knownFlags = () => [...VALUE_FLAGS.keys(), ...BOOLEAN_FLAGS.keys()].join(', ');

/**
 * Parse `process.argv.slice(2)`.
 *
 * `measurementIds` and `screens` are passed in rather than imported so the validation
 * messages can name the registered families without this module depending on the
 * registry — the registry is what the CLI is *about*, and a parser that imports it
 * makes a cycle the moment the registry wants to report a usage error.
 *
 * @param {string[]} [options.measurementIds] every registered family id.
 * @param {Record<string, string|null>} [options.screens] each family's DECLARED
 *   screen, or null where the family alone cannot say. Used to refuse a `--screen`
 *   that contradicts one.
 * @param {{name: string, state: string}[]} [options.navScreens] the screen registry,
 *   reduced to what validating `--nav` needs. Passed in for the same reason as the
 *   two above — and additionally because importing `tests/rta/screens.js` here would
 *   pull the whole nav/ODC stack into a pure parser.
 * @throws {MeasureArgError} on an unknown flag, a value flag with no value, or a
 *   value that cannot be what the flag means.
 */
export function parseMeasureArgs(
  argv = [],
  { measurementIds = [], screens = {}, navScreens = [], defaultMeasurement } = {},
) {
  const raw = {};
  const args = { samples: 5, measurement: defaultMeasurement, deploy: false, noServer: false };

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

  // Free-form in MEANING — an arm label means whatever the operator's experiment
  // means — but not in SHAPE: see `checkLabel`. `--arm=` was already rejected above.
  if (raw.arm !== undefined) {
    checkLabel('--arm', raw.arm);
    args.arm = raw.arm;
  }

  if (raw.screen !== undefined) {
    checkLabel('--screen', raw.screen);
    // A family that DECLARES its screen owns it, and `--screen` may not contradict
    // it. `home-latest-rows` is emitted by Home's own loader and by nothing else, so
    // its screen is a property of the family; `item-grid` backs every library grid,
    // so its screen is null and only the operator can say.
    //
    // Precedence used to run the other way (`args.screen ?? measurement.screen`),
    // which made the ONE thing this tool exists to prevent reachable from its own
    // command line: `measure.js` cannot navigate — it relaunches, so the app is
    // always on Home — and `npm run measure -- --screen movies-grid` therefore wrote
    // a record asserting a screen the app was never on. Tier 3 would then compare it
    // against a real movies-grid series and refuse nothing, because by then the lie
    // is indistinguishable from provenance.
    const declared = screens[args.measurement];
    if (declared != null && declared !== raw.screen) {
      throw new MeasureArgError(
        `--screen ${JSON.stringify(raw.screen)} contradicts the ${JSON.stringify(args.measurement)} ` +
          `family, which is always taken on ${JSON.stringify(declared)}. Drop --screen; it exists ` +
          'for families whose screen the registry records as null, which nothing but the ' +
          'operator can supply.',
      );
    }
    args.screen = raw.screen;
  }

  if (raw.nav !== undefined) {
    checkLabel('--nav', raw.nav);
    const entry = navScreens.find((s) => s.name === raw.nav);
    if (navScreens.length && !entry) {
      throw new MeasureArgError(
        `unknown screen ${JSON.stringify(raw.nav)}. Registered in tests/rta/screens.js: ` +
          `${navScreens.map((s) => s.name).join(', ')}`,
      );
    }
    // `measure` writes no registry and restores none — see its header. Every screen it
    // can DRIVE to is a `home`-state one. The other two are not driven to at all:
    // `beginLogin()` re-reads `server` / `active_user` on every launch, so once the
    // operator has put the app in that state BY HAND the relaunch loop lands on the
    // screen sample after sample, with no nav involved. So this refusal names the path
    // that works rather than calling the screen unreachable.
    //
    // Per STATE, and that distinction is the whole point of the branch below. An earlier
    // cut said "sign out by hand (Change Server / Change User)" for both, which is two
    // different registry states under one sentence — and following it for `userSelect`
    // walked into a hard tier-1 refusal:
    //
    //   serverSelect — reached by DELETING the server (app menu → Change server, which
    //                  runs `unsetSetting("server")` + `server.Delete()`). Identity then
    //                  has no `serverUrl`, which is fatal unless `--no-server` declares it.
    //   userSelect   — reached by clearing the ACTIVE USER (app menu → Change user, or
    //                  Sign out). The server STAYS, so identity reads normally and no
    //                  declaration is wanted at all; `--no-server` would refuse the run.
    //                  `--server <url>` still works here, and is worth passing.
    // `reach` is the imperative; `note` is the state's own caveat, kept as its own
    // sentence rather than folded in as a parenthetical — the flag advice is the part a
    // reader most needs to land on, and it is the part a mid-sentence aside loses.
    const REACHED_BY_HAND = {
      serverSelect: {
        reach:
          'delete the server by hand (app menu → Change server), then re-run with ' +
          '--no-server and NO --nav',
        note: '',
      },
      userSelect: {
        reach:
          'clear the active user by hand (app menu → Change user, or Sign out), then ' +
          're-run with NO --nav',
        note:
          ' The server stays, so identity still reads normally: no declaration is needed ' +
          'here, --server <url> still asserts tier 1, and --no-server would REFUSE the run.',
      },
    };
    if (entry && entry.state !== 'home') {
      // An unrecognised state gets the shape of the answer without a fabricated menu
      // item: the two above are the two `screens.js` declares, and a third would be
      // worse served by a confident wrong instruction than by an honest general one.
      const { reach, note } = REACHED_BY_HAND[entry.state] ?? {
        reach: 'put the app in that state by hand, then re-run with NO --nav',
        note: '',
      };
      throw new MeasureArgError(
        `--nav ${JSON.stringify(raw.nav)} needs the app in "${entry.state}" state, and ` +
          '`npm run measure` never writes the registry (it measures the app as your device ' +
          `already has it), so it cannot put the app there. It does not need to: ${reach} — ` +
          'every relaunch then lands on that screen, which is also why the series inherits no ' +
          `navigation cap.${note}`,
      );
    }
    // The screen is now KNOWN, so a hand-typed one is at best redundant and at worst a
    // contradiction the record would carry as provenance.
    if (raw.screen !== undefined) {
      throw new MeasureArgError(
        `--screen may not be combined with --nav: --nav ${JSON.stringify(raw.nav)} already says ` +
          'which screen the app was driven to, and it says so by driving there rather than by ' +
          'being asserted. Drop --screen.',
      );
    }
    args.nav = raw.nav;
  }

  if (raw.library !== undefined) {
    // Through the same label hygiene as every other recorded value: `--library` is
    // recorded in the measurement record and is therefore a selector like the rest, and
    // it was the one value flag that skipped this.
    checkLabel('--library', raw.library);
    if (raw.nav === undefined) {
      throw new MeasureArgError(
        '--library only means something with --nav — it selects which library the nav opens, ' +
          'and without a nav nothing opens one.',
      );
    }
    args.library = raw.library;
  }

  // The two answers to tier 1's one question, and neither can win quietly: taking the
  // URL would make the flag a no-op on the run that most needs it, and taking the flag
  // would drop an assertion the operator typed in order to assert. Same refusal shape as
  // `--screen` with `--nav`.
  if (args.noServer && args.server !== undefined) {
    throw new MeasureArgError(
      '--no-server may not be combined with --server: one declares that the app has NO ' +
        `server, the other declares that it is on ${JSON.stringify(args.server)}. Tier 1 ` +
        'cannot assert both. Drop whichever one is not what you meant.',
    );
  }
  // A nav needs a signed-in Home to start from, so this pair can never both be true —
  // and it would fail late and obscurely (the nav timing out on a screen that never
  // came) rather than here, where the contradiction is visible.
  if (args.noServer && args.nav !== undefined) {
    throw new MeasureArgError(
      '--no-server may not be combined with --nav: a nav is driven from a signed-in Home, ' +
        'and --no-server says there is no server to sign in to. `serverSelect` is reached by ' +
        'LAUNCHING — drop --nav and every relaunch lands on it.',
    );
  }

  if (raw.variant !== undefined) {
    checkLabel('--variant', raw.variant);
    args.variant = raw.variant;
  }

  if (raw.component !== undefined) {
    checkLabel('--component', raw.component);
    args.component = raw.component;
  }

  return args;
}
