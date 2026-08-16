import { describe, it, expect } from 'vitest';
import {
  MatrixError,
  formatPlanLines,
  parseDeviceList,
  parseSignIn,
  preflightRefusal,
  resolveDevices,
  serverDeclarationRefusal,
  summariseMatrix,
} from '../../../scripts/measure-matrix.js';

/**
 * A live probe, in the shape `fetchDeviceInfo` really returns — a flat map of the ECP
 * `device-info` tags. The three defaults are the three devices this was developed
 * against, so a fixture here cannot drift into a model number Roku does not publish.
 */
const probe = (host, overrides = {}) => ({
  host,
  info: {
    'device-id': `id-${host}`,
    'model-name': 'Streaming Stick 4K',
    'model-number': '3820RW',
    ...overrides,
  },
  error: null,
});

const dead = (host, error = 'ECP timeout') => ({ host, info: null, error });

describe('parseDeviceList', () => {
  it('splits, trims and preserves the declared order', () => {
    expect(parseDeviceList(' 192.0.2.10 ,192.0.2.11,  192.0.2.12 ')).toEqual([
      '192.0.2.10',
      '192.0.2.11',
      '192.0.2.12',
    ]);
  });

  it('ignores an empty entry from a trailing or doubled comma', () => {
    expect(parseDeviceList('192.0.2.10,,192.0.2.11,')).toEqual(['192.0.2.10', '192.0.2.11']);
  });

  it('refuses a value that names no device at all', () => {
    expect(() => parseDeviceList(' , ')).toThrow(MatrixError);
    expect(() => parseDeviceList('')).toThrow(/names no device/);
  });

  /**
   * A repeat would relaunch one device twice and write two records for it. Refused
   * rather than deduped, because deduping silently delivers a two-device matrix to
   * someone who typed three entries.
   */
  it('refuses a repeated address, and names it', () => {
    expect(() => parseDeviceList('192.0.2.10,192.0.2.11,192.0.2.10')).toThrow(
      /192\.0\.2\.10 more than once/,
    );
  });
});

describe('resolveDevices', () => {
  it('reads ROKU_DEVICES', () => {
    expect(resolveDevices({ ROKU_DEVICES: '192.0.2.10,192.0.2.11' })).toEqual([
      '192.0.2.10',
      '192.0.2.11',
    ]);
  });

  /**
   * Deliberately NOT a fallback to `ROKU_IP`. A one-device matrix is what
   * `npm run measure` already is, and delivering one under this command would leave an
   * operator believing they had measured every tier they own.
   */
  it('refuses when ROKU_DEVICES is unset, and points at the single-device tool', () => {
    expect(() => resolveDevices({ ROKU_IP: '192.0.2.10' })).toThrow(MatrixError);
    expect(() => resolveDevices({})).toThrow(/npm run measure/);
    expect(() => resolveDevices({})).not.toThrow(/ROKU_IP=/); // no "just export it" advice
  });
});

/**
 * The one rule the driver keeps that `measure` cannot. The server is the WORKLOAD, and
 * only this layer knows there is more than one arm — so a matrix whose devices might be
 * signed into different servers is refused here or nowhere. It has bitten twice on the
 * real devices: two on `demo.jellyfin.org` beside one on a real server, reading as a
 * hardware difference until the `rows` column was checked.
 */
describe('serverDeclarationRefusal', () => {
  it('accepts --server in either spelling', () => {
    expect(serverDeclarationRefusal(['-n', '30', '--server', 'http://192.0.2.10:8096'])).toBeNull();
    expect(serverDeclarationRefusal(['--server=http://192.0.2.10:8096'])).toBeNull();
  });

  /** A `serverSelect` matrix is the coherent opposite claim, not an exemption. */
  it('accepts --no-server', () => {
    expect(serverDeclarationRefusal(['--no-server', '--component', 'setServer'])).toBeNull();
  });

  it('refuses a run that declares neither, and names both ways out', () => {
    const refusal = serverDeclarationRefusal(['--measurement', 'screen-load', '--nav', 'settings']);
    expect(refusal).toMatch(/--server <url>/);
    expect(refusal).toMatch(/--no-server/);
    expect(refusal).toMatch(/WORKLOAD/);
  });

  it('refuses an empty command line', () => {
    expect(serverDeclarationRefusal([])).not.toBeNull();
    expect(serverDeclarationRefusal()).not.toBeNull();
  });

  /**
   * `--screen` and `--server` share a prefix, and a `startsWith('--server')` test would
   * read the first as a declaration. That would be a silent hole in the one gate this
   * module exists for.
   */
  it('is not satisfied by a different flag that starts the same way', () => {
    expect(serverDeclarationRefusal(['--screen', 'movies-grid'])).not.toBeNull();
    expect(serverDeclarationRefusal(['--servername=x'])).not.toBeNull();
  });
});

/**
 * The mode that lets the matrix ESTABLISH the precondition it has always asserted. Every
 * rule here is a refusal or a rewrite of the command line, so this is the only place the
 * mode can be gated without three Rokus on the LAN.
 */
describe('parseSignIn', () => {
  const URL = 'http://192.0.2.2:8096';

  it('leaves a command line with no sign-in flags exactly as it found it', () => {
    const argv = ['--server', URL, '--nav', 'settings', '-n', '30'];
    expect(parseSignIn(argv)).toEqual({ signIn: null, forward: argv });
    expect(parseSignIn([])).toEqual({ signIn: null, forward: [] });
    expect(parseSignIn()).toEqual({ signIn: null, forward: [] });
  });

  /**
   * The seed and the tier-1 assert must name ONE server or the mode defeats itself:
   * seeding device 3 into A while asserting B is the confound this layer exists to refuse.
   * Forwarding the sign-in URL as `--server` is what makes the seed CHECKED against the
   * running app rather than trusted.
   */
  it('strips its own flags and forwards the URL as --server', () => {
    const { signIn, forward } = parseSignIn([
      '--sign-in',
      URL,
      '--user',
      'alice',
      '--nav',
      'settings',
      '-n',
      '30',
    ]);
    expect(signIn).toEqual({ url: URL, username: 'alice', password: '' });
    expect(forward).toEqual(['--nav', 'settings', '-n', '30', '--server', URL]);
  });

  /** So `--sign-in` satisfies the server declaration on its own, rather than by exemption. */
  it('produces a command line the server-declaration gate accepts', () => {
    const { forward } = parseSignIn(['--sign-in', URL, '--user', 'alice']);
    expect(serverDeclarationRefusal(forward)).toBeNull();
  });

  it('accepts the --flag=value spelling too', () => {
    const { signIn, forward } = parseSignIn([`--sign-in=${URL}`, '--user=alice', '--deploy']);
    expect(signIn).toEqual({ url: URL, username: 'alice', password: '' });
    expect(forward).toEqual(['--deploy', '--server', URL]);
  });

  /**
   * A blank password is a real Jellyfin account state (`HasPassword: false`) and is the
   * common case on a LAN test server, so it must not read as "no password given".
   */
  it('takes the password from the environment, and lets an explicit blank stand', () => {
    expect(
      parseSignIn(['--sign-in', URL, '--user', 'alice'], { MEASURE_SIGNIN_PASSWORD: 's3cret' })
        .signIn.password,
    ).toBe('s3cret');
    expect(
      parseSignIn(['--sign-in', URL, '--user', 'alice', '--password='], {
        MEASURE_SIGNIN_PASSWORD: 's3cret',
      }).signIn.password,
    ).toBe('');
  });

  /**
   * `measure-args`' lesson one layer out: a trailing value flag that consumes `undefined`
   * half-configures the mode and fails somewhere that cannot name the flag responsible.
   */
  it('refuses a value flag with nothing after it, or another flag after it', () => {
    expect(() => parseSignIn(['--sign-in'])).toThrow(MatrixError);
    expect(() => parseSignIn(['--sign-in', '--user', 'alice'])).toThrow(/--sign-in needs a value/);
    expect(() => parseSignIn(['--sign-in', URL, '--user'])).toThrow(/--user needs a value/);
  });

  it('refuses --sign-in without --user, and says passwordless accounts need no --password', () => {
    const run = () => parseSignIn(['--sign-in', URL, '-n', '30']);
    expect(run).toThrow(MatrixError);
    expect(run).toThrow(/--user <name>/);
    expect(run).toThrow(/MEASURE_SIGNIN_PASSWORD/);
  });

  /**
   * Refused rather than ignored. Dropping them would run the matrix against whatever the
   * devices are already signed into — the exact state the mode exists to replace — and
   * nothing in the output would say so.
   */
  it('refuses --user or --password with no --sign-in to attach them to', () => {
    expect(() => parseSignIn(['--user', 'alice', '--server', URL])).toThrow(
      /--user was given without --sign-in/,
    );
    expect(() => parseSignIn(['--password', 'x', '--server', URL])).toThrow(
      /--password was given without --sign-in/,
    );
  });

  /**
   * Not a redundancy — `measure` takes the LAST `--server` on its line, so forwarding two
   * would settle a disagreement between the seed and the assert SILENTLY, which is how this
   * subsystem produces a well-formed record of the wrong thing.
   */
  it('refuses --server alongside --sign-in, in either spelling', () => {
    expect(() => parseSignIn(['--sign-in', URL, '--user', 'a', '--server', URL])).toThrow(
      /already declares the server/,
    );
    expect(() => parseSignIn(['--sign-in', URL, '--user', 'a', `--server=${URL}`])).toThrow(
      /already declares the server/,
    );
  });

  /** `serverSelect` is reached by DELETING the server, so seeding one is its opposite. */
  it('refuses --no-server alongside --sign-in', () => {
    expect(() => parseSignIn(['--sign-in', URL, '--user', 'a', '--no-server'])).toThrow(
      /contradict each other/,
    );
  });

  /** `--screen`/`--server` share a prefix; nothing here may swallow a neighbouring flag. */
  it('does not consume a different flag that starts the same way', () => {
    const { signIn, forward } = parseSignIn([
      '--sign-in',
      URL,
      '--user',
      'alice',
      '--username-ish',
      'x',
    ]);
    expect(signIn.username).toBe('alice');
    expect(forward).toEqual(['--username-ish', 'x', '--server', URL]);
  });
});

describe('preflightRefusal', () => {
  const cannotRunApps = (model) => model === 'LEGACY1';

  it('passes a healthy, distinct set', () => {
    const probes = [
      probe('192.0.2.10', { 'model-number': '3600X' }),
      probe('192.0.2.11', { 'model-number': '3820RW' }),
      probe('192.0.2.12', { 'model-number': '4850X' }),
    ];
    expect(preflightRefusal(probes, { cannotRunApps })).toBeNull();
  });

  /**
   * The refusal has to carry the SUBSET COMMAND, not just the diagnosis. A three-device
   * run is tens of minutes long and the commonest cause is one device asleep; making the
   * operator reassemble the list by hand is where a preflight stops being worth having.
   */
  it('refuses an unreachable device and offers the rest as a one-line subset', () => {
    const probes = [probe('192.0.2.10'), dead('192.0.2.11', 'EHOSTUNREACH'), probe('192.0.2.12')];
    const refusal = preflightRefusal(probes, { cannotRunApps });
    expect(refusal).toMatch(/1 of 3 device\(s\) did not answer ECP/);
    expect(refusal).toMatch(/192\.0\.2\.11 — EHOSTUNREACH/);
    expect(refusal).toMatch(/ROKU_DEVICES=192\.0\.2\.10,192\.0\.2\.12 npm run measure:devices/);
  });

  it('offers no subset when nothing answered', () => {
    const refusal = preflightRefusal([dead('192.0.2.10'), dead('192.0.2.11')], { cannotRunApps });
    expect(refusal).toMatch(/did not answer ECP/);
    expect(refusal).not.toMatch(/ROKU_DEVICES=/);
  });

  it('refuses a device Roku says cannot run apps at all', () => {
    const probes = [
      probe('192.0.2.10'),
      probe('192.0.2.11', { 'model-number': 'LEGACY1', 'model-name': 'Roku 1' }),
    ];
    const refusal = preflightRefusal(probes, { cannotRunApps });
    expect(refusal).toMatch(/cannot run JellyRock at all/);
    expect(refusal).toMatch(/192\.0\.2\.11 — Roku 1 \(LEGACY1\)/);
    expect(refusal).toMatch(/ROKU_DEVICES=192\.0\.2\.10 /);
  });

  /**
   * An address is not an identity. A DHCP lease that moved makes two entries one Roku,
   * which would be relaunched twice and recorded twice — and nothing downstream could
   * tell that from two devices agreeing to the millisecond.
   */
  it('refuses two addresses that resolve to ONE device', () => {
    const probes = [
      probe('192.0.2.10', { 'device-id': 'SAME' }),
      probe('192.0.2.11', { 'device-id': 'SAME' }),
    ];
    expect(preflightRefusal(probes, { cannotRunApps })).toMatch(
      /same physical device is named more than once[\s\S]*192\.0\.2\.10 and 192\.0\.2\.11/,
    );
  });

  /**
   * Two DIFFERENT devices of one model is a legitimate experiment and still cannot be
   * recorded here: `measurements.jsonl` identifies a device by model / model number /
   * RAM tier and by nothing else. The refusal has to name the escape (`--arm`), because
   * unlike the cases above this one is not a mistake.
   */
  it('refuses two distinct devices of the same model, and names the --arm escape', () => {
    const probes = [
      probe('192.0.2.10', { 'device-id': 'A', 'model-number': '3820RW' }),
      probe('192.0.2.11', { 'device-id': 'B', 'model-number': '3820RW' }),
    ];
    const refusal = preflightRefusal(probes, { cannotRunApps });
    expect(refusal).toMatch(/same MODEL/);
    expect(refusal).toMatch(/3820RW — 192\.0\.2\.10, 192\.0\.2\.11/);
    expect(refusal).toMatch(/ROKU_IP=192\.0\.2\.10 npm run measure -- --arm/);
  });

  /**
   * Order matters: a device that never answered has no model to compare, so a
   * same-model check run first would report a two-device duplicate as a three-device
   * one — diagnosing the wrong problem on the way to the right one.
   */
  it('reports an unreachable device before a duplicate model', () => {
    const probes = [
      probe('192.0.2.10', { 'device-id': 'A' }),
      probe('192.0.2.11', { 'device-id': 'B' }),
      dead('192.0.2.12'),
    ];
    expect(preflightRefusal(probes, { cannotRunApps })).toMatch(/did not answer ECP/);
  });

  /**
   * A missing tag must not become a group key — two devices that both fail to report a
   * `device-id` are not the same device, and calling them one would refuse a matrix
   * that is fine.
   */
  it('does not treat two absent device-ids as a match', () => {
    const probes = [
      probe('192.0.2.10', { 'device-id': '', 'model-number': '3600X' }),
      probe('192.0.2.11', { 'device-id': '', 'model-number': '4850X' }),
    ];
    expect(preflightRefusal(probes, { cannotRunApps })).toBeNull();
  });
});

describe('formatPlanLines', () => {
  it('numbers each device in run order and labels it', () => {
    const lines = formatPlanLines(
      [probe('192.0.2.10', { 'model-number': '3600X' }), probe('192.0.2.11')],
      { describeDevice: (m) => `${m} (labelled)` },
    );
    expect(lines).toEqual([
      '  1. 192.0.2.10 — 3600X (labelled)',
      '  2. 192.0.2.11 — 3820RW (labelled)',
    ]);
  });
});

describe('summariseMatrix', () => {
  const row = (host, extra) => ({ host, label: 'Some Roku', status: 0, signal: null, ...extra });

  it('calls a clean sweep ok', () => {
    const s = summariseMatrix([row('a'), row('b')]);
    expect(s.ok).toBe(true);
    expect(s.measured).toBe(2);
    expect(s.lines).toEqual(['  a — Some Roku: measured', '  b — Some Roku: measured']);
  });

  /**
   * A failed device is a LINE, never an omission. The whole reason the driver runs one
   * process per device is that losing one costs one row rather than the run; a summary
   * that dropped the row would turn a two-of-three matrix back into an unmarked one.
   */
  it('keeps a failed device in the summary and fails the run', () => {
    const s = summariseMatrix([row('a'), row('b', { status: 1 })]);
    expect(s.ok).toBe(false);
    expect(s.measured).toBe(1);
    expect(s.lines[1]).toMatch(/b — Some Roku: FAILED \(exit 1\)/);
  });

  it('distinguishes an interrupted device from the ones that never started', () => {
    const s = summariseMatrix([
      row('a'),
      row('b', { status: null, signal: 'SIGINT' }),
      row('c', { status: null, signal: null, skipped: true }),
    ]);
    expect(s.ok).toBe(false);
    expect(s.lines[1]).toMatch(/interrupted \(SIGINT\)/);
    expect(s.lines[2]).toMatch(/not run \(the matrix stopped first\)/);
  });

  it('is not ok with no devices at all', () => {
    expect(summariseMatrix([]).ok).toBe(false);
  });

  /**
   * "It failed" and "it failed BEFORE it measured anything" send an operator to different
   * places — a sign-in failure is a server or a credential, a measure failure is the app or
   * the nav. The stage is the only thing that separates them in a summary printed after
   * three devices' worth of scrollback.
   */
  it('names which stage failed when the run had more than one', () => {
    const s = summariseMatrix([row('a', { status: 1, stage: 'sign-in' })]);
    expect(s.lines[0]).toMatch(/a — Some Roku: sign-in FAILED \(exit 1\)/);
  });

  /**
   * A device left seeded is damage to someone's own Roku rather than a lost datapoint, and
   * it compounds — the next run to snapshot it adopts the leftovers as the user's state. So
   * it gets its own line WITH the repair command, and it fails the run even when the
   * measurement itself was perfect.
   */
  it('fails the run and prints the repair command when a restore did not verify', () => {
    const s = summariseMatrix([row('192.0.2.10', { restored: false })]);
    expect(s.ok).toBe(false);
    expect(s.measured).toBe(1); // the samples are real; the device is not clean
    expect(s.lines[0]).toMatch(/measured/);
    expect(s.lines[1]).toMatch(/RESTORE FAILED — this device is STILL SEEDED/);
    expect(s.lines[2]).toMatch(/ROKU_IP=192\.0\.2\.10 npm run rta:restore/);
  });

  it('says nothing about restoring when nothing was seeded', () => {
    const s = summariseMatrix([row('a'), row('b', { restored: true })]);
    expect(s.ok).toBe(true);
    expect(s.lines).toHaveLength(2);
  });
});
