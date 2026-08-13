/**
 * `npm run measure`'s command line — see `scripts/measure-args.js`.
 *
 * These exist because the parser's failure mode is SILENT. A lenient parser drops
 * what it does not recognise, so `--sever https://…` and a trailing `--server`
 * both produce a run that quietly did not assert the server it was invoked to
 * assert — the one failure a measurement guard must not have. Every case below is
 * a downgrade that the first revision would have accepted without a word.
 */
import { describe, expect, it } from 'vitest';

import { MeasureArgError, parseMeasureArgs } from '../../../scripts/measure-args.js';

const IDS = ['home-latest-rows', 'item-grid'];
const parse = (argv) => parseMeasureArgs(argv, { measurementIds: IDS, defaultMeasurement: IDS[0] });

describe('defaults', () => {
  it('samples the first registered measurement five times, without deploying', () => {
    expect(parse([])).toEqual({ samples: 5, measurement: 'home-latest-rows', deploy: false });
  });
});

describe('the shapes the usage block documents', () => {
  it('accepts the short -n the header advertises', () => {
    // Spelled out rather than derived: the header documented `-n` while the parser
    // only handled `--samples`, and only a read of both caught it.
    expect(parse(['-n', '30']).samples).toBe(30);
  });

  it('accepts --flag value and --flag=value alike', () => {
    expect(parse(['--samples', '10']).samples).toBe(10);
    expect(parse(['--samples=10']).samples).toBe(10);
    expect(parse(['--server', 'http://x:8096']).server).toBe('http://x:8096');
    expect(parse(['--server=http://x:8096']).server).toBe('http://x:8096');
  });

  it('keeps a URL whose value contains its own = signs intact', () => {
    expect(parse(['--server=http://x:8096/p?a=1&b=2']).server).toBe('http://x:8096/p?a=1&b=2');
  });

  it('takes --deploy as a bare switch', () => {
    expect(parse(['--deploy']).deploy).toBe(true);
  });

  it('takes --window-ms', () => {
    expect(parse(['--window-ms', '20000']).windowMs).toBe(20000);
  });
});

describe('refusals — every one of these used to be a silent downgrade', () => {
  it('REFUSES a trailing --server instead of leaving tier 1 unasserted', () => {
    // The worst of the set: the operator typed the flag that turns the assert on,
    // and got a run that did not assert.
    expect(() => parse(['--server'])).toThrow(MeasureArgError);
    expect(() => parse(['--server'])).toThrow(/needs a value/);
  });

  it('REFUSES an empty value', () => {
    expect(() => parse(['--server='])).toThrow(/needs a value/);
  });

  it('REFUSES an unknown flag rather than dropping it', () => {
    // `--sever` produced a confident, unasserted series.
    expect(() => parse(['--sever', 'http://x'])).toThrow(/unknown argument/);
    expect(() => parse(['--smaples', '30'])).toThrow(/unknown argument/);
  });

  it('names the known flags when it refuses one', () => {
    expect(() => parse(['--nope'])).toThrow(/--server/);
  });

  it('REFUSES a value on --deploy, which takes none', () => {
    expect(() => parse(['--deploy=true'])).toThrow(/takes no value/);
  });

  it('REFUSES a sample count that is not a positive integer', () => {
    for (const bad of ['0', '-3', 'abc', '2.5']) {
      expect(() => parse(['-n', bad])).toThrow(MeasureArgError);
    }
  });

  it('REFUSES a window that is not a positive duration', () => {
    expect(() => parse(['--window-ms', '0'])).toThrow(/positive number/);
    expect(() => parse(['--window-ms', 'soon'])).toThrow(/positive number/);
  });

  it('REFUSES an unregistered measurement, and lists the registered ones', () => {
    expect(() => parse(['--measurement', 'home'])).toThrow(/unknown measurement/);
    expect(() => parse(['--measurement', 'home'])).toThrow(/item-grid/);
  });

  it('accepts a registered measurement', () => {
    expect(parse(['--measurement', 'item-grid']).measurement).toBe('item-grid');
  });
});

describe('the comparison labels', () => {
  it('carries an arm label and a screen through', () => {
    const args = parse(['--arm', 'before', '--screen', 'movies-grid']);
    expect([args.arm, args.screen]).toEqual(['before', 'movies-grid']);
  });

  it('leaves both undefined when not given, so the record writes null', () => {
    expect(parse([]).arm).toBeUndefined();
    expect(parse([]).screen).toBeUndefined();
  });

  it('REFUSES an empty label — `--arm=` is a typo, not an unlabelled series', () => {
    expect(() => parse(['--arm='])).toThrow(MeasureArgError);
    expect(() => parse(['--arm'])).toThrow(/needs a value/);
  });
});
