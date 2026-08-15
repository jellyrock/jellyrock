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
    expect(parse([])).toEqual({
      samples: 5,
      measurement: 'home-latest-rows',
      deploy: false,
      signedOut: false,
    });
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

  it('REFUSES an empty label — `--arm=` is a typo, not an unlabeled series', () => {
    expect(() => parse(['--arm='])).toThrow(MeasureArgError);
    expect(() => parse(['--arm'])).toThrow(/needs a value/);
  });

  it('REFUSES a label the selector grammar could never name again', () => {
    // `--a before,v2` parses to `{arm: 'v2'}` — a different selection, made silently.
    // So the label is refused where it is created, not diagnosed where it fails.
    expect(() => parse(['--arm', 'before,v2'])).toThrow(/may not contain/);
    expect(() => parse(['--arm', 'a=b'])).toThrow(/may not contain/);
    expect(() => parse(['--screen', 'movies,grid'])).toThrow(/may not contain/);
    expect(() => parse(['--arm', ' before'])).toThrow(/leading or trailing whitespace/);
  });

  it('allows a space, which the selector parser trims per part and round-trips', () => {
    expect(parse(['--arm', 'batched attach']).arm).toBe('batched attach');
  });
});

describe('--screen may not contradict a family that declares one', () => {
  // `measure.js` reaches a screen by RELAUNCHING, so the app is always on Home. With
  // the old `args.screen ?? measurement.screen` precedence, `--screen movies-grid`
  // wrote a record asserting a screen the app was never on — and tier 3 cannot tell
  // that from provenance after the fact.
  const withScreens = (argv) =>
    parseMeasureArgs(argv, {
      measurementIds: ['home-latest-rows', 'item-grid'],
      screens: { 'home-latest-rows': 'home', 'item-grid': null },
      defaultMeasurement: 'home-latest-rows',
    });

  it('refuses a --screen that disagrees with the declared one', () => {
    expect(() => withScreens(['--screen', 'movies-grid'])).toThrow(MeasureArgError);
    expect(() => withScreens(['--screen', 'movies-grid'])).toThrow(/contradicts/);
  });

  it('accepts --screen for a family whose screen the registry records as null', () => {
    expect(withScreens(['--measurement', 'item-grid', '--screen', 'movies-grid']).screen).toBe(
      'movies-grid',
    );
  });

  it('accepts a --screen that merely restates the declared one', () => {
    expect(withScreens(['--screen', 'home']).screen).toBe('home');
  });
});

describe('--nav, which is what makes anything but Home reachable', () => {
  // The registry reduced to what the parser needs. Mirrors `tests/rta/screens.js`:
  // most screens are reached from a signed-in Home, and two are reached only with the
  // app signed OUT — which `measure` cannot drive to, because it writes no registry.
  // Those two are measured by LAUNCHING instead; see the `--signed-out` block below.
  const withNav = (argv) =>
    parseMeasureArgs(argv, {
      measurementIds: ['home-latest-rows', 'screen-load'],
      screens: { 'home-latest-rows': 'home', 'screen-load': null },
      navScreens: [
        { name: 'home', state: 'home' },
        { name: 'movieDetails', state: 'home' },
        { name: 'userSelect', state: 'userSelect' },
      ],
      defaultMeasurement: 'home-latest-rows',
    });

  it('accepts a screen the registry knows', () => {
    expect(withNav(['--nav', 'movieDetails']).nav).toBe('movieDetails');
  });

  it('REFUSES a screen the registry does not have, naming the ones it does', () => {
    // A typo'd screen name would otherwise navigate nowhere and record a series taken
    // on Home under a name that says otherwise.
    expect(() => withNav(['--nav', 'movieDetials'])).toThrow(MeasureArgError);
    expect(() => withNav(['--nav', 'movieDetials'])).toThrow(/unknown screen/);
    expect(() => withNav(['--nav', 'movieDetials'])).toThrow(/movieDetails/);
  });

  it('REFUSES a --nav to a screen the app must be signed OUT to see', () => {
    // `measure` writes no registry and restores none, so it cannot put the app in that
    // state. Refused rather than attempted and timed out on a screen that was never
    // going to appear — and the refusal now names the path that DOES work, because
    // "impossible" stopped being true when `--signed-out` landed: these screens are
    // reached by LAUNCHING, so the refusal must not read as a dead end.
    expect(() => withNav(['--nav', 'userSelect'])).toThrow(/never writes the registry/);
    expect(() => withNav(['--nav', 'userSelect'])).toThrow(/--signed-out/);
  });

  it('REFUSES --screen alongside --nav', () => {
    // Driving there is evidence; typing it is an assertion. Once the tool has driven,
    // a hand-typed screen can only agree redundantly or contradict silently.
    expect(() => withNav(['--nav', 'movieDetails', '--screen', 'home'])).toThrow(
      /may not be combined with --nav/,
    );
  });

  it('REFUSES a --nav carrying the selector grammar', () => {
    expect(() => withNav(['--nav', 'a,b'])).toThrow(/may not contain/);
  });
});

describe('--library', () => {
  const withNav = (argv) =>
    parseMeasureArgs(argv, {
      measurementIds: ['screen-load'],
      navScreens: [{ name: 'movieDetails', state: 'home' }],
      defaultMeasurement: 'screen-load',
    });

  it('threads an explicit library id through to the nav', () => {
    // Not hypothetical: the first real run of `--nav movieDetails` against a developer
    // server refused, because that server has FOUR movie libraries and `nav.js` will
    // not guess between them.
    expect(withNav(['--nav', 'movieDetails', '--library', 'abc123']).library).toBe('abc123');
  });

  it('REFUSES --library without --nav, where it selects nothing', () => {
    expect(() => withNav(['--library', 'abc123'])).toThrow(/only means something with --nav/);
  });
});

describe('--variant, which says WHICH mount a chained nav meant', () => {
  const withNav = (argv) =>
    parseMeasureArgs(argv, {
      measurementIds: ['screen-load'],
      navScreens: [{ name: 'seasonDetails', state: 'home' }],
      defaultMeasurement: 'screen-load',
    });

  it('accepts a variant', () => {
    expect(withNav(['--nav', 'seasonDetails', '--variant', 'Season']).variant).toBe('Season');
  });

  it('REFUSES a variant carrying the selector grammar', () => {
    // Same hygiene as --arm / --screen: it becomes a recorded selector, so a label the
    // `measure:compare` grammar cannot name would record fine and never select again.
    expect(() => withNav(['--variant', 'a=b'])).toThrow(/may not contain/);
  });

  it('REFUSES a --library carrying the selector grammar', () => {
    // This was the one value flag that skipped checkLabel, and it is recorded now.
    expect(() => withNav(['--nav', 'seasonDetails', '--library', 'a,b'])).toThrow(
      /may not contain/,
    );
  });
});

describe('--component, the other half of a mount identity', () => {
  // `--variant` alone cannot name a mount when a launch mounts DIFFERENT components under
  // the SAME variant, which is what every playback nav does: reaching the player means
  // walking through `ItemDetails`, and for a movie both stamp `Movie`.
  const withNav = (argv) =>
    parseMeasureArgs(argv, {
      measurementIds: ['screen-load'],
      navScreens: [{ name: 'osd', state: 'home' }],
      defaultMeasurement: 'screen-load',
    });

  it('accepts a component', () => {
    expect(withNav(['--nav', 'osd', '--component', 'videoPlayer']).component).toBe('videoPlayer');
  });

  it('composes with --variant', () => {
    const args = withNav(['--nav', 'osd', '--component', 'videoPlayer', '--variant', 'Movie']);
    expect(args.component).toBe('videoPlayer');
    expect(args.variant).toBe('Movie');
  });

  it('REFUSES a component carrying the selector grammar', () => {
    // Recorded in the measurement record like every other selector, so it goes through
    // the same label hygiene — a value `measure:compare`'s grammar cannot name would
    // record fine and then never select again.
    expect(() => withNav(['--component', 'a=b'])).toThrow(/may not contain/);
  });

  it('is absent when not passed, so the first-mount default still applies', () => {
    expect(withNav(['--nav', 'osd']).component).toBeUndefined();
  });
});

describe('--signed-out, which is how the login screens become measurable', () => {
  const withNav = (argv) =>
    parseMeasureArgs(argv, {
      measurementIds: ['screen-load'],
      navScreens: [
        { name: 'home', state: 'home' },
        { name: 'serverSelect', state: 'serverSelect' },
      ],
      defaultMeasurement: 'screen-load',
    });

  it('takes it as a bare switch, defaulting off', () => {
    expect(withNav(['--signed-out']).signedOut).toBe(true);
    expect(withNav([]).signedOut).toBe(false);
  });

  it('REFUSES a value, like every other boolean flag', () => {
    expect(() => withNav(['--signed-out=true'])).toThrow(/takes no value/);
  });

  it('REFUSES --server alongside it — two answers to tier 1 one question', () => {
    // Neither can win quietly: taking the URL makes the flag a no-op on the run that
    // most needs it, and taking the flag drops an assertion the operator typed in
    // order to assert.
    expect(() => withNav(['--signed-out', '--server', 'http://x:8096'])).toThrow(
      /may not be combined with --server/,
    );
    expect(() => withNav(['--server', 'http://x:8096', '--signed-out'])).toThrow(
      /may not be combined with --server/,
    );
  });

  it('REFUSES --nav alongside it, rather than letting the nav time out', () => {
    // A nav is driven from a signed-in Home, so the pair can never both hold. Caught
    // here, where the contradiction is visible, instead of ~30 s later on a screen
    // that was never going to appear.
    expect(() => withNav(['--signed-out', '--nav', 'home'])).toThrow(
      /may not be combined with --nav/,
    );
  });

  it('composes with the flags a signed-out series actually needs', () => {
    const args = withNav(['--signed-out', '--deploy', '-n', '30', '--component', 'setServer']);
    expect(args).toMatchObject({ signedOut: true, deploy: true, samples: 30 });
    expect(args.component).toBe('setServer');
  });
});
