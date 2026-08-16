import { describe, it, expect } from 'vitest';
import {
  MatrixError,
  formatPlanLines,
  parseDeviceList,
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
});
